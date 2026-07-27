#!/usr/bin/env python3
"""The Long Take — radar history precompute.

Pulls the last N hours of mmWave-radar target data per room out of the Home
Assistant recorder database, pairs the (x, y) coordinate streams by closest
timestamp, joins speed, decimates to a browser-friendly size, and writes one
flat JSON file per room. The WebGL page (www/long-take.js) fetches those
files and renders the time-tube.

Works against ANY recorder backend, because the recorder schema (`states` +
`states_meta`) is identical across them — pick with --db-url:

    sqlite (stock HA):   sqlite:////config/home-assistant_v2.db     (default)
    MariaDB / MySQL:     mysql+pymysql://recorder_ro:PASS@db-host/homeassistant
    PostgreSQL:          postgresql+psycopg2://recorder_ro:PASS@db-host/homeassistant

For the stock SQLite database, run this ON the HA host (e.g. inside the
"Advanced SSH & Web Terminal" add-on with protection mode off, or via a
`shell_command` — see the README) so the config directory is reachable.
Path note: the /config defaults below are the HA config dir as HA's own
container sees it (correct for shell_command). Inside the SSH add-on that
same directory appears as /homeassistant, so pass
--db-url sqlite:////homeassistant/home-assistant_v2.db and
--out /homeassistant/www/long-take/data there. For a networked database it
can run on any box that can reach the DB server; point --out at a directory
that ends up served as /local/long-take/data/.

Requires: Python 3.9+ and SQLAlchemy (plus the DB driver for non-SQLite
backends). Home Assistant's own container already ships SQLAlchemy, which is
what makes the shell_command scheduling option work with zero installs.

JSON shape (intentionally flat + small — this is the canonical contract
between the pipeline and the renderer):
{
  "room": "living_room",
  "label": "Living Room",
  "n": 28456,                     # decimated count
  "n_original": 57858,
  "decimation": 2,                # 1 of every N kept
  "window_hours": 24.0,
  "window_start_ts": 1714510800,  # unix seconds
  "window_end_ts":   1714597200,
  "room_dims_mm": [5000, 4000, 2700],
  "ts": [...],   # seconds since window_start, length n
  "x":  [...],   # mm, radar local frame, length n
  "y":  [...],   # mm, radar local frame, length n
  "s":  [...],   # mm/s absolute speed, length n
  "tg": [...]    # target id (1, 2, 3), length n — for multi-body rooms
}
"""
from __future__ import annotations

import argparse
import bisect
import json
import sys
import time
from pathlib import Path

try:
    from sqlalchemy import create_engine, text
except ImportError:
    sys.exit(
        "SQLAlchemy is required: pip install sqlalchemy\n"
        "(inside the Home Assistant container it is already installed -\n"
        " the recorder itself depends on it)"
    )

# ─── ROOMS config — edit this block to match your house ────────────────────
#
# One entry per radar room. The entity-id templates below match what
# component 08's `radar-presence-node.yaml` produces out of the box: a node
# whose ESPHome substitution is `name: presence-living-room` publishes
#   sensor.presence_living_room_target_1_x
#   sensor.presence_living_room_target_1_y
#   sensor.presence_living_room_target_1_speed      (and the same for 2, 3)
# `{n}` in the template is replaced with the target number 1..MAX_TARGETS.
#
# Confirm YOUR ids in Developer Tools → States (search "target_1_x") and use
# --list-sensors to see every target-ish entity the recorder actually knows.
#
#   id        room slug — becomes the JSON filename and the page's ?r= value
#   label     display name shown in the corner of the renderer
#   dims_mm   room [width, depth, height] in mm — stored in the JSON for
#             future use / your own hacks; the current renderer doesn't need
#             it, so a rough guess is fine
#   pos_scale multiply raw position values by this to get mm.
#             The LD2450 component that component 08 pins reports POSITION IN
#             METRES → 1000.0. If your sensors report mm (some forks do),
#             set 1.0. The script warns loudly when the result looks wrong.
#   spd_scale multiply raw speed values by this to get mm/s (cm/s → 10.0).
ROOMS = [
    {
        "id": "living_room",
        "label": "Living Room",
        "dims_mm": [5000, 4000, 2700],
        "x": "sensor.presence_living_room_target_{n}_x",
        "y": "sensor.presence_living_room_target_{n}_y",
        "s": "sensor.presence_living_room_target_{n}_speed",
        "pos_scale": 1000.0,
        "spd_scale": 10.0,
    },
    {
        "id": "office",
        "label": "The Office",
        "dims_mm": [3400, 2800, 2400],
        "x": "sensor.presence_office_target_{n}_x",
        "y": "sensor.presence_office_target_{n}_y",
        "s": "sensor.presence_office_target_{n}_speed",
        "pos_scale": 1000.0,
        "spd_scale": 10.0,
    },
]

MAX_TARGETS = 3            # the LD2450 tracks up to 3 bodies

# ─── DB layer ──────────────────────────────────────────────────────────────

STATES_QUERY = text(
    """
    SELECT s.last_updated_ts, s.state
    FROM states s
    JOIN states_meta m ON s.metadata_id = m.metadata_id
    WHERE m.entity_id = :eid AND s.last_updated_ts >= :since
    ORDER BY s.last_updated_ts
    """
)


def fetch_one(conn, eid: str, since_ts: float) -> list[tuple[float, float]]:
    """Pull (last_updated_ts, state) rows for one entity since `since_ts`.
    Returns an empty list if the entity doesn't exist or has no rows.
    Skips rows whose state is non-numeric ('unknown', 'unavailable')."""
    out = []
    for ts, val in conn.execute(STATES_QUERY, {"eid": eid, "since": since_ts}):
        try:
            out.append((float(ts), float(val)))
        except (TypeError, ValueError):
            continue
    return out


# ─── Pairing + assembly ────────────────────────────────────────────────────


def pair_by_ts(a, b, max_gap_s: float = 0.3):
    """Pair each entry of `a` with the closest-timestamp entry of `b` within
    max_gap_s. Returns a list of (ts, val_a, val_b).

    Why pairing at all: the recorder stores each sensor as its own state
    stream, so an x reading and its matching y reading arrive as separate
    rows microseconds-to-milliseconds apart. Closest-timestamp matching
    within a tight window reassembles them into (x, y) points."""
    if not a or not b:
        return []
    b_ts = [r[0] for r in b]
    out = []
    for ts, va in a:
        i = bisect.bisect_left(b_ts, ts)
        best = None
        for j in (i - 1, i):
            if 0 <= j < len(b_ts):
                if best is None or abs(b_ts[j] - ts) < abs(b_ts[best] - ts):
                    best = j
        if best is not None and abs(b_ts[best] - ts) <= max_gap_s:
            out.append((ts, va, b[best][1]))
    return out


def collect_target(conn, room: dict, target_id: int, since_ts: float):
    """Return a list of (ts, x_mm, y_mm, speed_mms) for one target (1..3) of
    one radar, normalised via the room's pos_scale / spd_scale."""
    xs = fetch_one(conn, room["x"].format(n=target_id), since_ts)
    ys = fetch_one(conn, room["y"].format(n=target_id), since_ts)
    ss = fetch_one(conn, room["s"].format(n=target_id), since_ts)
    if not xs or not ys:
        return []
    ps = room.get("pos_scale", 1.0)
    sc = room.get("spd_scale", 1.0)
    xy = pair_by_ts(xs, ys)
    # Speed updates less often than position — allow a looser join window.
    sp_pairs = pair_by_ts([(t, x) for t, x, _ in xy], ss, max_gap_s=2.0)
    sp_by_ts = {t: abs(s) * sc for t, _, s in sp_pairs}
    return [(t, x * ps, y * ps, sp_by_ts.get(t, 0.0)) for t, x, y in xy]


def collect_room(conn, room: dict, since_ts: float):
    """Collect all targets for a room. Returns a list of
    (ts, x, y, speed, target_id) sorted by ts."""
    out = []
    for tgt in range(1, MAX_TARGETS + 1):
        for ts, x, y, sp in collect_target(conn, room, tgt, since_ts):
            # Skip the (0, 0) "no target" sentinel the LD2450 emits when a
            # target slot is empty — it pollutes the data at the origin.
            if x == 0 and y == 0:
                continue
            out.append((ts, x, y, sp, tgt))
    out.sort(key=lambda r: r[0])
    return out


def decimate(points: list, target_n: int):
    """Keep every Nth point, but ALSO keep every point with speed
    >= 200 mm/s so brisk walk-throughs survive decimation — a transit
    lasts seconds and plain striding would routinely erase it."""
    n = len(points)
    if n <= target_n:
        return points, 1
    stride = max(1, n // target_n)
    decimated = []
    for i, p in enumerate(points):
        keep = (i % stride == 0) or (p[3] >= 200)
        if keep:
            decimated.append(p)
    return decimated, stride


def sanity_check_units(room: dict, points: list) -> None:
    """Loudly warn when the configured pos_scale looks wrong. After scaling,
    positions should be room-sized: hundreds to a few thousand mm."""
    if not points:
        return
    max_pos = max(max(abs(p[1]), abs(p[2])) for p in points)
    # Console output deliberately sticks to ASCII — Windows consoles still
    # default to legacy codepages and crash on fancier characters.
    if max_pos < 100:
        print(
            f"  WARNING {room['id']}: max |position| after scaling is {max_pos:.1f} mm "
            f"- implausibly tiny. Your sensors probably report METRES while "
            f"pos_scale is 1.0; set pos_scale: 1000.0 for this room."
        )
    elif max_pos > 20000:
        print(
            f"  WARNING {room['id']}: max |position| after scaling is {max_pos:.0f} mm "
            f"(over 20 m) - implausibly huge. Your sensors probably report mm "
            f"while pos_scale is 1000.0. Set pos_scale: 1.0 for this room."
        )


def write_room(out_dir: Path, room: dict, points: list, stride: int,
               n_orig: int, since_ts: float, hours: float) -> int:
    room_id, label, dims = room["id"], room["label"], room["dims_mm"]
    if not points:
        payload = {
            "room": room_id, "label": label, "n": 0,
            "n_original": 0, "decimation": 1,
            "window_hours": hours,
            "window_start_ts": int(since_ts),
            "window_end_ts": int(time.time()),
            "room_dims_mm": dims,
            "ts": [], "x": [], "y": [], "s": [], "tg": [],
        }
    else:
        t0 = points[0][0]
        payload = {
            "room": room_id,
            "label": label,
            "n": len(points),
            "n_original": n_orig,
            "decimation": stride,
            "window_hours": hours,
            "window_start_ts": int(t0),
            "window_end_ts": int(points[-1][0]),
            "room_dims_mm": dims,
            "ts": [round(p[0] - t0, 2) for p in points],
            "x":  [int(p[1]) for p in points],
            "y":  [int(p[2]) for p in points],
            "s":  [int(p[3]) for p in points],
            "tg": [int(p[4]) for p in points],
        }
    blob = json.dumps(payload, separators=(",", ":"))
    # Write BOTH underscore and hyphen filenames (living_room.json AND
    # living-room.json) so the page's ?r= parameter resolves whichever
    # convention gets typed into a URL. Single-word rooms produce one file.
    for nm in {room_id, room_id.replace("_", "-")}:
        (out_dir / f"{nm}.json").write_text(blob)
    return payload["n"]


# ─── Debug helper ──────────────────────────────────────────────────────────


def list_sensors(conn) -> None:
    """Print every entity the recorder knows that looks like a radar target
    sensor — the fastest way to align the ROOMS templates with reality."""
    rows = conn.execute(text(
        "SELECT entity_id FROM states_meta "
        "WHERE entity_id LIKE '%target%' ORDER BY entity_id"
    )).fetchall()
    if not rows:
        print("No entity_ids containing 'target' found in states_meta.")
        print("Either the radar node isn't publishing yet, or the recorder")
        print("is excluding its sensors (check recorder: include/exclude).")
        return
    print(f"{len(rows)} target-ish entities known to the recorder:")
    for (eid,) in rows:
        print(f"  {eid}")


# ─── Main ──────────────────────────────────────────────────────────────────


def main():
    ap = argparse.ArgumentParser(
        description="Precompute radar-history JSON for The Long Take renderer."
    )
    ap.add_argument(
        "--db-url", default="sqlite:////config/home-assistant_v2.db",
        help="SQLAlchemy database URL for the HA recorder "
             "(default: %(default)s - the stock SQLite recorder on the HA host). "
             "For MariaDB/PostgreSQL pass the full URL; keep credentials out of "
             "shared files - read-only DB user recommended.",
    )
    ap.add_argument(
        "--out", default="/config/www/long-take/data",
        help="Directory to write per-room JSON into (default: %(default)s - "
             "served by HA at /local/long-take/data/). Created if missing.",
    )
    ap.add_argument(
        "--hours", type=float, default=24.0,
        help="History window in hours (default: %(default)s).",
    )
    ap.add_argument(
        "--room", default=None,
        help="Only process this room id from the ROOMS config (default: all).",
    )
    ap.add_argument(
        "--points", type=int, default=30_000,
        help="Decimation target - roughly this many points kept per room "
             "(default: %(default)s). Lower it for weaker client devices.",
    )
    ap.add_argument(
        "--list-sensors", action="store_true",
        help="Just list every 'target'-ish entity_id in the recorder and exit "
             "(use this to align the ROOMS templates with your real ids).",
    )
    args = ap.parse_args()

    engine = create_engine(args.db_url)

    rooms = ROOMS if args.room is None else [r for r in ROOMS if r["id"] == args.room]
    if not rooms and not args.list_sensors:
        known = ", ".join(r["id"] for r in ROOMS)
        sys.exit(f"Unknown room '{args.room}'. Configured rooms: {known}")

    since_ts = time.time() - args.hours * 3600
    out_dir = Path(args.out)
    summary = {"generated_at": int(time.time()), "rooms": {}}

    with engine.connect() as conn:
        if args.list_sensors:
            list_sensors(conn)
            return

        out_dir.mkdir(parents=True, exist_ok=True)
        print(f"The Long Take precompute - {args.hours:g}h window, "
              f"~{args.points} points/room -> {out_dir}")
        print("=" * 64)

        for room in rooms:
            pts = collect_room(conn, room, since_ts)
            n_orig = len(pts)
            decim, stride = decimate(pts, args.points)
            sanity_check_units(room, decim)
            n_kept = write_room(out_dir, room, decim, stride, n_orig,
                                since_ts, args.hours)
            size_kb = (out_dir / f"{room['id']}.json").stat().st_size // 1024
            print(f"  {room['label']:18s} orig={n_orig:7d}  kept={n_kept:6d}  "
                  f"stride={stride:2d}  {size_kb:5d}KB")
            if n_orig == 0:
                print(f"    -> no rows found. First entity checked: "
                      f"{room['x'].format(n=1)}")
                print(f"       Wrong id, or the recorder is excluding it. "
                      f"Run with --list-sensors to see what exists.")
            summary["rooms"][room["id"]] = {
                "label": room["label"],
                "n_original": n_orig,
                "n_kept": n_kept,
                "size_kb": size_kb,
            }

    (out_dir / "index.json").write_text(json.dumps(summary, indent=2))
    print(f"\nWrote {out_dir}/index.json")


if __name__ == "__main__":
    main()
