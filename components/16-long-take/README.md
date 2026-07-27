# 16 — The Long Take (radar space-time sculpture)

> **Advanced extension of component 08 (ESP32 Presence Mesh).** It consumes
> the per-target coordinate and speed sensors published by 08's
> `radar-presence-node.yaml` — build at least one radar node first, or there
> is nothing to draw.

![The Long Take — an office's day as a translucent membrane](../../docs/images/longtake-site.png)

**[See it running live →](https://haroldathome.com/the-long-take)** — my
public install, four rooms of my house's real radar data in the same
renderer this component ships. The kitchen is the busy one; the small blips
through the day are my dogs going in and out of the garden. The radar is
correct to count them.

![Kitchen — the eruption of lobes is two bodies passing](../../docs/images/longtake-kitchen.png)

## What it does

Let's be honest about this one: it is art. A 24-hour space-time sculpture of
movement in a room, rendered live in your browser — a living Muybridge strip
of the house. The last day of mmWave radar history becomes a single
continuous translucent tube along a time axis: slim and smooth where the
room stood empty, swollen and lobed where somebody moved. A playback cursor
sweeps along it (24 hours replay in about two minutes), the camera dollies
with it, and each active half-minute fires a pentatonic water-drop note over
an ambient drone. You can orbit it, zoom it, scrub it, pause it.

It tells you nothing an occupancy sensor doesn't. But it makes a day of
domestic life visible as a shape — the empty overnight stretch, the morning
scramble, the long still afternoon at a desk — and it is the piece guests
ask about. The install, unlike the output, is entirely pragmatic.

**The architecture in one breath**: the radar node (component 08) streams
per-target X/Y/speed into Home Assistant → the recorder database stores it
like any other sensor history → a small Python script runs every 5 minutes,
pulls the last 24 h per room, pairs the coordinate streams, decimates, and
writes one static JSON file per room into `/config/www/long-take/data/` → a
self-contained WebGL page served from `/local/long-take/` fetches that JSON
and renders the tube. No custom integration, no websockets, no add-on: the
moving parts are one script, one HTML file, one JS file.

## Files

| File | Goes to | Purpose |
|---|---|---|
| `www/long-take.html` | `/config/www/long-take/long-take.html` | The page — UI shell, styles, three.js importmap |
| `www/long-take.js` | `/config/www/long-take/long-take.js` | The renderer — tube geometry, shader, audio, playback |
| `scripts/precompute_radar.py` | `/config/scripts/precompute_radar.py` | Recorder DB → per-room JSON, every 5 minutes |
| `dashboard/long-take-view.yaml` | `/config/dashboards/long-take.yaml` | Optional full-screen iframe dashboard (one view per room) |

## Prerequisites

- **A radar node from component 08**, mounted somewhere people actually move
  (see the gotchas), publishing `sensor.presence_<room>_target_1_x` / `_y` /
  `_speed`.
- **The recorder must be recording those sensors.** Stock HA records
  everything, so if you have never touched `recorder:` in
  `configuration.yaml` you are fine. If you have an `include:` or `exclude:`
  block, make sure the radar target sensors are inside the tent — an
  excluded sensor produces an empty JSON and an invisible tube, with no
  error anywhere.
- **Recorder retention**: the default `purge_keep_days: 10` is ample — the
  piece only ever reads a 24-hour window. You do not need to raise it.
- A browser with WebGL2 and JavaScript modules — any current Chrome,
  Firefox, Safari or Edge. (Elderly kiosk tablets with fossilised WebViews
  will show a black screen; that is the tablet, not the config.)

## Install

1. **Copy the web files**: create `/config/www/long-take/` and put
   `long-take.html` + `long-take.js` in it. If `/config/www` did not exist
   before, restart Home Assistant once — HA only registers the `/local/`
   static path if the folder existed at startup.
2. **Copy the script** to `/config/scripts/precompute_radar.py` (any
   `/config` subfolder works; the scheduling examples below assume this one).
3. **Edit the `ROOMS` block** at the top of the script: one entry per radar
   room, with the entity-id templates matching your component-08 node names.
   The defaults match a node flashed with `name: presence-living-room`.
4. **Run it once by hand** from a shell on the HA host (the "Advanced SSH &
   Web Terminal" add-on with protection mode off gives you one). One path
   quirk to know first: inside this add-on your HA config directory appears
   as `/homeassistant` — the add-on's own `/config` is its private
   directory, and the `/config/...` paths elsewhere in this README refer to
   the HA config dir as HA itself sees it. So from the add-on's shell,
   point the script at the `/homeassistant` forms explicitly:

   ```
   python3 /homeassistant/scripts/precompute_radar.py \
     --db-url sqlite:////homeassistant/home-assistant_v2.db \
     --out /homeassistant/www/long-take/data
   ```

   It prints one line per room — you want a non-zero `orig=` count. If a
   room comes back `orig=0`, re-run the same command with `--list-sensors`
   added to see every target-ish entity the recorder actually knows, and
   fix the templates.
5. **Open the page**:
   `http://homeassistant.local:8123/local/long-take/long-take.html?r=living_room`.
   You should see the tube and the scrubber. Give the radar a day before
   judging the shape — a 20-minute-old tube is a stub.
6. **Schedule the precompute** every 5 minutes — pick ONE of the three
   options below.
7. **Optional dashboard**: copy `dashboard/long-take-view.yaml` to
   `/config/dashboards/long-take.yaml` and register it (instructions in the
   file's header). One full-screen view per room, selected by the `?r=`
   parameter.

### Scheduling option A — `shell_command` inside HA (no installs at all)

Home Assistant's own container ships Python **and** SQLAlchemy (the recorder
depends on it), so HA can run the script itself. In `configuration.yaml`:

```yaml
shell_command:
  long_take_precompute: python3 /config/scripts/precompute_radar.py
```

and an automation (in your automations file or a package):

```yaml
automation:
  - id: long_take_precompute_refresh
    alias: "Long Take — refresh radar data"
    description: >-
      Re-runs the radar-history precompute every 5 minutes so the sculpture
      stays ~5 minutes behind reality.
    mode: single
    triggers:
      - trigger: time_pattern
        minutes: "/5"
    actions:
      - action: shell_command.long_take_precompute
```

**Caveat**: HA kills `shell_command` processes at 60 seconds. Each run
recomputes the full 24-hour window, so on slow storage with several radar
rooms you can outgrow that budget. Time a manual run first; if it is
anywhere near a minute, use option B or C.

### Scheduling option B — cron in the SSH add-on

The "Advanced SSH & Web Terminal" add-on (protection mode **off**) can run a
crontab. The add-on container resets on restart, so establish everything in
its `init_commands` (add-on Configuration tab). Remember the path mapping
from install step 4: inside this add-on the HA config directory is
`/homeassistant` (the add-on's `/config` is its own private dir), so every
path in the cron line uses that form:

```yaml
init_commands:
  - apk add --no-cache python3 py3-pip
  - pip3 install --break-system-packages sqlalchemy
  - echo '*/5 * * * * python3 /homeassistant/scripts/precompute_radar.py --db-url sqlite:////homeassistant/home-assistant_v2.db --out /homeassistant/www/long-take/data >> /homeassistant/long-take.log 2>&1' | crontab -
  - crond
```

The cron line itself, for reference:

```
*/5 * * * * python3 /homeassistant/scripts/precompute_radar.py --db-url sqlite:////homeassistant/home-assistant_v2.db --out /homeassistant/www/long-take/data >> /homeassistant/long-take.log 2>&1
```

No 60-second limit, and the log file tells you exactly what each run did.

### Scheduling option C — systemd timer on another machine

If your recorder is MariaDB or PostgreSQL, the script can run anywhere that
can reach the database server — a NAS, a mini-PC, whatever is already awake.
Two things must be reachable: the DB (over the network) and the output
directory (e.g. HA's `config` folder mounted via the Samba add-on).

`/etc/long-take.env` (owner root, `chmod 600` — the DB password lives here,
not in the unit file):

```
LONG_TAKE_DB_URL=mysql+pymysql://recorder_ro:CHANGE_ME@192.168.1.x:3306/homeassistant
```

`/etc/systemd/system/long-take-precompute.service`:

```ini
[Unit]
Description=The Long Take — radar history precompute

[Service]
Type=oneshot
EnvironmentFile=/etc/long-take.env
ExecStart=/usr/bin/python3 /opt/long-take/precompute_radar.py \
  --db-url ${LONG_TAKE_DB_URL} \
  --out /mnt/ha-config/www/long-take/data
```

`/etc/systemd/system/long-take-precompute.timer`:

```ini
[Unit]
Description=Run The Long Take precompute every 5 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min

[Install]
WantedBy=timers.target
```

Then `systemctl enable --now long-take-precompute.timer`. Use a dedicated
**read-only** database user (like the `recorder_ro` above) — the script only
ever SELECTs, so give it nothing more.

## Rename these

| Placeholder | Change to |
|---|---|
| `ROOMS` ids `living_room` / `office` (in `precompute_radar.py`) | one slug per radar room — becomes the JSON filename and the page's `?r=` value |
| `ROOMS` labels `"Living Room"` / `"The Office"` | the display name shown in the page's corner |
| entity templates `sensor.presence_living_room_target_{n}_x` (etc.) | your node's prefix — follows the `name:` substitution you chose in component 08 (`presence-bedroom` → `sensor.presence_bedroom_target_{n}_x`) |
| `dims_mm: [5000, 4000, 2700]` | rough room measurements in mm (stored in the JSON for future use; a guess is fine) |
| `DEFAULT_ROOM` in `long-take.js` | the room to show when no `?r=` is given |
| view `title` / `path` / `icon` / `r=` in `long-take-view.yaml` | one view block per room |

## secrets.yaml keys needed

None — nothing in the HA YAML touches a secret. The only credential in the
whole component is the database URL when your recorder is MariaDB/PostgreSQL:
keep it in an environment file (`chmod 600`, as in option C), never in the
script, and make the DB user read-only.

## Performance notes

- **The decimation knob is `--points`** (default 30 000 per room). It is the
  single biggest lever on both JSON size (~500 KB–1 MB per room) and browser
  load. Halve it for weaker clients; the tube shape barely changes because
  the precompute deliberately keeps every fast-movement point regardless of
  stride.
- **Any real GPU laughs at this.** A desktop, laptop or recent phone renders
  it at a solid 60 fps — the tube is a few hundred thousand triangles and
  the expensive part is the bloom pass, which any integrated GPU of the last
  decade absorbs.
- **A Raspberry Pi browser will run it, grudgingly** — expect low frame
  rates at 1080p. Drop `--points`, and lower the browser zoom (fewer pixels
  = less bloom work). The page already caps `devicePixelRatio` at 2 so 4K
  screens don't quadruple the cost.
- **Hidden pages cost nothing.** The renderer pauses playback, GPU work and
  audio whenever the page is hidden (Page Visibility API) or the canvas is
  out of the viewport (IntersectionObserver), and resumes where it left off.
  A wall of six room-tabs only ever renders the one you're looking at. If
  the tube "stops moving" when you switch away and back — that's this
  feature, not a bug.

## The CDN dependency

The page loads three.js (v0.169.0, pinned) from the jsDelivr CDN via an
import map — two URLs at the bottom of `long-take.html`. That is the one
external dependency; everything else is self-contained. If you want the page
fully LAN-only (offline houses, allergy to third-party requests), download
the three.js release, copy `build/three.module.js` and the whole
`examples/jsm/` folder into `/config/www/long-take/vendor/`, and rewrite the
two import-map URLs to `/local/long-take/vendor/three.module.js` and
`/local/long-take/vendor/jsm/`. The addons resolve their own `from "three"`
imports through the same import map, so nothing else changes.

## Audio behaviour

Browsers refuse to start audio without a user gesture, so the page is
**silent until first tap or click** — the pulsing "TAP TO ENABLE SOUND" pill
(top right) or any click on the canvas unlocks it. After that the pill
toggles mute, and the choice is remembered **per room** in `localStorage`,
surviving reloads. When a page is hidden it auto-mutes without touching your
saved preference — switching room tabs never leaves a drone playing from a
room you've left.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Page says `(no data)` | The JSON fetch failed — precompute never ran, wrote to the wrong directory, or the room slug in `?r=` matches no file. Check `/config/www/long-take/data/` exists and has your room's `.json` in it. |
| JSON exists but `"n": 0` | The precompute found no rows: wrong entity ids in `ROOMS`, or the recorder is excluding the sensors. Run `--list-sensors` and compare. |
| Tube is a uniform smooth cylinder | 24 hours of genuinely empty room — or the radar is mounted where nobody walks (pointing at a wall, above a door nobody uses). Move the node, or check its coverage against component 08's placement rules. |
| Tube swells but never lobes dramatically | The speed sensor isn't joining (check the `_speed` template) — presence alone produces gentle swell, speed produces the drama. |
| Positions warning about implausible mm values | The units trap — see gotchas. |
| Black screen | No WebGL2 (ancient WebView / kiosk tablet), or the CDN is unreachable from that client. Try a modern browser first; self-host three.js second. |

## Gotchas

The production lessons. Every one of these cost real time somewhere.

- **The honest cost: radar makes your recorder work.** One radar room is
  roughly six chattering sensors (X, Y, speed per active target) updating
  many times a minute whenever someone is present. That is exactly the
  history this piece feeds on — and it is real write load on the recorder
  database. Two mitigations worth knowing: `recorder:` →
  `commit_interval: 5` (or higher) batches writes instead of committing
  every second, and keeping `purge_keep_days` at the stock 10 stops the DB
  growing without bound. Take flash-storage wear seriously: a year of
  radar-rate history is a real workload, and it is precisely why the house
  this kit came from eventually moved its recorder database off an SD card
  onto a proper disk. If your HA lives on an SD card and you add several
  radar rooms, plan the same move.

- **The units trap.** Different LD2450 ESPHome components disagree about
  units: the one component 08 pins reports position in **metres** and speed
  in **cm/s**; other forks report **mm** and **mm/s**. The renderer wants mm
  and mm/s, hence the per-room `pos_scale` / `spd_scale` in `ROOMS`
  (defaults: 1000.0 and 10.0, matching component 08). Get it wrong and the
  data is nonsense at 1000× in either direction. The script sanity-checks
  scaled positions against room-plausible sizes and warns loudly; trust the
  warning, then confirm by eyeballing a raw `target_1_x` value in Developer
  Tools → States while standing 2 m from the radar (reads ~`2.0` = metres,
  ~`2000` = mm).

- **An excluded sensor fails silently.** The recorder's `include`/`exclude`
  config is the number-one cause of "empty JSON, no errors anywhere". The
  sensors exist, the dashboard shows them live, the radar is fine — but if
  the recorder isn't *storing* them, history queries return nothing.
  `--list-sensors` reads the recorder's own metadata table, so it shows the
  truth of what is actually being recorded, not what exists in HA.

- **SQLite must be read on the host — never over a network share.** Pointing
  `--db-url sqlite://` at a Samba/NFS-mounted copy of
  `home-assistant_v2.db` invites lock errors and corruption; SQLite and
  network filesystems are a known-bad combination. Reading the live DB *on
  the HA host* is safe (HA runs SQLite in WAL mode, and this script only
  reads). The rule is asymmetric: writing the **output JSON** over a network
  share is completely fine — they're plain files.

- **The (0, 0) sentinel.** When an LD2450 target slot is empty, the sensor
  pair reads exactly (0, 0). Feed that through naively and every room gains
  a phantom body camped at the origin, smearing activity across the whole
  day. The precompute drops exact-(0,0) points; if you fork the pipeline,
  keep that filter.

- **`shell_command` has a hard 60-second timeout** and HA kills the process
  at the limit, mid-write. The precompute recomputes the full window every
  run (it's stateless on purpose — it can never drift or double-count), so
  the cost doesn't shrink after the first run. If a manual run takes more
  than ~30 s, don't schedule it via option A.

- **The page's UI sits at `top: 80px` for a reason.** When iframed into a
  dashboard, HA's header bar overlays the top ~56 px of the page. The status
  strip and audio toggle are pushed below it, and the dashboard view
  deliberately plays **no z-index games** to fight the header — the header
  is how people escape a full-screen view on a wall tablet. Resist the urge
  to "fix" the overlap.

- **Room slugs: underscores and hyphens both work, by construction.** Room
  ids use underscores (they come from entity ids), but URLs get typed with
  hyphens. Rather than police it, the precompute writes both
  `living_room.json` and `living-room.json`. If you fork the naming, keep
  the double-write or pick one convention and never waver.

- **If you fork the renderer: transparent meshes want `depthWrite: false`.**
  The tube is double-sided and alpha-blended; with depth-write on, the back
  wall self-occludes against discarded fragments near the leading edge and
  you get flickering black squares when viewing the tube face-on. This cost
  an evening. It is the standard rule for translucent geometry, but the
  failure mode looks so much like a driver bug that it sends you hunting in
  entirely the wrong places.

- **Give it 24 hours before judging it.** The tube only grows as history
  accumulates, and the piece's whole point — the shape of a day — doesn't
  exist until a day has passed. The first evening's stub is not the piece.
