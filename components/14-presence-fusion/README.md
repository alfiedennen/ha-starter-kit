# 14 — Presence Fusion (server-side "who is in which room")

> **Advanced extension of component 08 (ESP32 Presence Mesh).** Everything here
> consumes signals that component 08's nodes produce — install and calibrate
> that first, or nothing in this component has anything to fuse.

## What it does

Component 08 gives you raw signals: per-room Bluetooth antennas and (optionally)
mmWave radar with per-target coordinates. This component turns those signals
into **answers**: template sensors that say, calmly and reliably, *who is in
which room* — the foundation every "lights follow people" / "heat the room
someone is actually in" automation stands on.

The mental model that makes the whole thing click:

| Layer | Sensor | Knows | Doesn't know |
|---|---|---|---|
| Identity | BLE (phone/watch via the proxies) | **who** it is | exactly where — RSSI is woolly, bleeds through floors |
| Presence | mmWave radar | a **body** is here, right now, to the centimetre | whose body it is |
| Fusion | the templates in this package | **who is in which room** | — |

Radar is near-certain but anonymous; BLE is identified but vague. Keep them as
separate layers and fuse at the end — never try to make one sensor do both
jobs.

What ships in `package/presence_fusion.yaml`, in install order:

1. **Radar zone / occupancy sensors** — per-room "anyone present" plus two
   worked coordinate-zone examples: a rectangular "at desk" box and an "in
   doorway" strip. Identity-blind, rock solid. Useful on day one.
2. **Per-person "really home" sensors** — home/away that keys off the phone
   (the device people actually take with them), with a 20-minute grace window
   and a person-entity fallback.
3. **Nearest-room sensor** — raw RSSI winner-takes-all with hysteresis and
   hold-last-value. The simple per-person room sensor: **start with this**.
4. **Committed-room sensor** — the stateful fusion sensor with last-good-room
   memory, transit suppression, cross-floor cooldown, a 15-second heartbeat
   and a manual override. **Graduate to this** when the nearest-room sensor's
   failure modes start to bite (they will — see below).
5. **Weighted-centroid position** *(optional, ships commented out)* — a live
   (x, y) dot for a floor-plan map, from the log-distance path-loss model and
   1/d²-weighted scanner positions.

## Hardware

None new. This is pure Home Assistant template logic on top of component 08's
mesh and two upstream integrations.

## Upstream integrations

Two independent data paths feed the package — you don't need both on day one:

**Path A — identity (feeds "really home" + committed room).**
The **Private BLE Device** integration (built-in) resolves each person's phone
and watch into a stable `device_tracker` despite the ~15-minute Bluetooth MAC
rotation every modern phone performs — it works from the device's IRK
(Identity Resolving Key), which mathematically undoes the rotation. On top of
that, **Bermuda** (HACS) turns per-proxy RSSI into an `area` sensor per device
— "this phone is in the Kitchen". Component 08's README covers IRK extraction,
Bermuda setup and the calibration traps (read the **per-scanner offset**
section there before trusting any area reading — the calibration flow looks
per-beacon but is global per-scanner).

**Path B — raw RSSI (feeds nearest-room + centroid).**
The optional per-beacon `ble_rssi` sensor block in component 08's node configs
(commented out there — uncomment it on every node), plus a fixed iBeacon
broadcast from the phone (HA Companion app → Settings → Companion app →
Manage sensors → BLE Transmitter). The node-side filters are load-bearing:
`timeout` slams a vanished beacon to −127 dBm (which is what makes "not seen"
detectable) and `heartbeat` keeps readings flowing.

## Install

1. **Prerequisites**: component 08 nodes online in every room you care about;
   Private BLE Device tracking each person's phone (and watch, if worn);
   Bermuda installed and calibrated per component 08's README.
2. **For the nearest-room / centroid sensors**: uncomment the `ble_rssi`
   block in each node's ESPHome config, set your beacon UUID, re-flash (OTA),
   and start the Companion app's BLE Transmitter on the phone.
3. **Copy** `package/presence_fusion.yaml` to `/config/packages/`.
4. **Rename** every placeholder entity to your own — table below. The room
   names inside the templates (`area_map`, `scanner_map`, the `rooms` /
   `downstairs` / `non_transit` lists) must match *your* rooms and *your* HA
   area names.
5. **Restart Home Assistant** — a template-reload is not enough the first
   time; the override `input_text` only gets created on a full config load.
6. **Walk-test and tune** — methodology below. Then calibrate the radar zone
   boxes from real traces (instructions are inline in the YAML).

## Start simple, graduate deliberately

The nearest-room sensor is genuinely good, and its failure modes are the best
tutorial in why the committed-room sensor exists. Run it for a week and you
will meet all three:

- **Boundary flapping** — stand near a room boundary and the winner flickers
  with every decibel of noise. The 5 dB hysteresis margin kills most of it.
- **Transit rooms** — walking through the hallway names "Hallway" for two
  seconds, and everything downstream twitches. Nobody *dwells* in a corridor;
  committing to it is always noise.
- **Cross-floor bleed** — 2.4 GHz sails through ceilings. The room directly
  above often hears a phone better than the room it's actually in, so you
  "teleport" upstairs while sitting on the sofa.

The committed-room sensor answers each one structurally: hysteresis becomes
*memory* (hold the last good room whenever the signal goes quiet), transit
rooms are *never committed*, and upstairs candidates within 60 seconds of a
downstairs commit are *held* as probable bleed. That is the whole design.

## Rename these

| Placeholder | Change to |
|---|---|
| `person.you` / `person.partner` | your two person entities (Settings → People) |
| `device_tracker.your_phone_ble`, `device_tracker.your_watch_ble`, `device_tracker.partner_phone_ble` | the Private BLE Device trackers — the slug follows from the name you give each device when adding it to the integration |
| `sensor.your_phone_ble_area`, `sensor.your_watch_ble_area` | Bermuda's area sensor for each tracked device (named after the same device entry) |
| `sensor.presence_<room>_phone_rssi` | the per-beacon RSSI sensors from component 08's nodes — slug = node `name` + the `ble_rssi` sensor's name ("Phone RSSI") |
| `binary_sensor.presence_<room>_radar_presence`, `sensor.presence_<room>_target_1_x` / `_y` | the radar entities from component 08's radar nodes — slugs follow the node `name` |
| `binary_sensor.bedroom_presence` | any occupancy-grade sensor in a radar-less room — e.g. a Zigbee mmWave named per component 02's `binary_sensor.<room>_presence` convention |
| `area_map` keys (`living_room`, `study`, …) | your HA area names, lowercased with spaces → underscores |
| `scanner_map` MACs (`AA:BB:CC:00:00:01`, …) | each proxy's real Bluetooth MAC — shown on the node's ESPHome device page in HA, or in `esphome logs` at boot |
| Room-name strings (`'Living Room'`, `'Study'`, …) and the `rooms` / `downstairs` / `non_transit` lists | your rooms; keep every list consistent with the map values |
| At-desk box bounds (`-2.2 ≤ x ≤ -0.9`, `1.4 ≤ y ≤ 2.2`) and doorway line (`y ≥ 2.4`) | values (in metres) from your own calibration trace (method in the YAML comments) |
| Centroid `boards:` coordinates | each node's measured (x, y) in metres from one fixed origin, plus floor index |

## secrets.yaml keys needed

None — this component is pure template logic; no credentials involved.

## The walk-test

The only calibration methodology that actually works, for every sensor in
this file:

1. Open the sensor's more-info dialog on a phone (the nearest-room sensor
   exposes every scanner's raw RSSI as attributes for exactly this).
2. Walk the house on a fixed route: every room, 30–60 seconds of standing
   still in each, normal walking pace between them, including at least one
   full staircase round-trip.
3. Watch what the sensor *commits* versus where you *are*. Score the
   transitions, not the steady states — steady states are easy.
4. Tune one number at a time: the hysteresis margin (flapping at boundaries →
   raise it), the cross-floor cooldown (teleporting upstairs → raise it;
   real stair climbs lagging → lower it; it should be slightly longer than
   your stairs take), the hold thresholds.
5. Re-walk after every change. Expect ~85% clean transitions with four or
   more calibrated scanners — that is the realistic ceiling for BLE, and the
   radar layer is what covers the rest.

## Gotchas

The production lessons — every one of these cost real debugging time.

- **Trigger-based template sensors keep state across reloads but reset on
  restart.** The committed-room sensor's memory lives in `this.state`, which
  survives a template-reload and even a config reload — but a full HA restart
  wipes it. After a restart the sensor reads `unknown` until the first real
  signal lands (at worst one 15-second heartbeat later). Don't build
  automations that panic on `unknown`; treat it as "no answer yet", not
  "nobody home".

- **`this.state` is only trustworthy on *trigger-based* template entities.**
  The whole memory pattern — "hold the previous room" — works because a
  trigger-based entity can read its own last-emitted value. A plain
  state-based template sensor re-renders whenever HA feels like it and
  self-reference becomes a feedback loop. If you refactor, keep the
  `triggers:` block.

- **The time-pattern heartbeat is load-bearing, not decoration.** Templates
  re-evaluate when a *watched entity changes* — never because time passed.
  Every timed rule in this file (the 20-minute away threshold, the 60-second
  cross-floor cooldown, the post-23:00 rule) only works because a heartbeat
  trigger forces re-evaluation. Delete the `time_pattern` trigger and the
  sensor silently stops honouring its own clocks — it still *looks* alive,
  because entity changes keep triggering it.

- **Wearable BLE is bursty.** Watches doze their radios to save battery and
  can go silent for tens of seconds while sitting perfectly still on a wrist.
  This is why every per-person sensor holds its last value when signals go
  quiet instead of flipping to `unknown` — a device that stopped advertising
  did not teleport; it dozed. The flip side: use the watch for *room
  precision while present* (worn = where the body is, and its weak signal
  bleeds less), never as the primary home/away signal.

- **The phone-in-drawer problem — and its mirror.** No BLE system tracks the
  *person*; it tracks the *radio*. A phone in a coat pocket in the hallway
  places its owner in the hallway all evening; a watch left on a desk holds
  its owner "home" all day. The package attacks both ends: the really-home
  sensors are phone-primary (the device people actually take), and the
  committed-room sensor prefers the watch only *while present*. Accept the
  residual: the fusion is only as honest as people's carrying habits.

- **Don't let companion-app GPS vote on presence.** Phone OSes aggressively
  suspend the companion app, and a suspended app holds its last GPS state —
  which can be a stale "home" for *hours*. One stale "home" fed into a
  presence gate overrides two correctly-reporting BLE trackers, and the
  committed-room sensor cheerfully places someone in the bedroom who left
  after lunch. The gate in this package trusts only the in-house BLE
  trackers, OR'd; GPS stays on the person entity for zone automations, where
  slow-and-eventually-right is fine.

- **The 20-minute away threshold is a compromise, on purpose.** Shorter and
  a phone that deep-sleeps in a quiet corner of the house flaps the whole
  household to "away" (and if component 07's empty-house setback consumes
  it, your heating follows). Longer and the house takes even more time to
  notice a genuine departure. Twenty minutes has survived contact with
  reality; tune it with the same care you'd tune a lock automation.

- **Bermuda's area state is a *name*, and names drift.** The area sensor
  emits the HA area's friendly name — rename an area in HA and the
  `area_map` lookup silently stops matching, and the whole tier goes dark
  (the sensor falls back to the scanner-MAC tier, so it *degrades* rather
  than breaks — which makes the drift easy to miss). After any area rename,
  re-check the map. The lowercase/underscore normalisation in the template
  handles case, not renames.

- **Radar zone boxes come from traces, not tape measures.** The at-desk box
  ships with one real desk's numbers and they will be wrong for yours. Sit
  in the chair, watch `target_1_x` / `target_1_y` in Developer Tools for a
  few minutes, note the envelope, pad it ~0.1–0.2 m. The coordinates are in
  **metres**, signed — X left/right of the radar, +Y straight out of the
  antenna face into the room. (Component 16's precompute converts them to
  millimetres via `pos_scale: 1000` — only that pipeline thinks in mm.) If
  left/right is mirrored versus your floor plan, set `flip_x_axis` on the
  node instead of negating your maths.

- **Zone sensors read target 1 only.** The radar promotes the dominant
  (usually nearest) target to slot 1 — right most of the time in a one-desk
  room, wrong the moment a second person wanders closer to the module.
  Extend the box test across targets 2 and 3 if a zone matters in a shared
  room.

- **`delay_off` is what makes radar liveable.** Raw radar occupancy drops
  for a few seconds when someone is perfectly still (reading, typing
  pauses). The 2-minute hold on the room sensors and 1-minute on the desk
  zone absorb that; the doorway sensor deliberately gets only 5 seconds
  because its entire value is being transitional. If you find yourself
  raising a hold past ~5 minutes to stop flicker, fix the mounting or the
  max-distance setting instead — you're masking a coverage problem.

- **Two sensors covering one space will double-attribute.** A radar and a
  Zigbee mmWave in the same room, or two radars in one long room, can both
  claim the same body. OR them into a single "anyone present" sensor (shown
  in the YAML) rather than feeding two per-room sensors downstream — or, for
  two radars, award the body to whichever reports the smaller target
  distance and have the other report empty.

- **Hysteresis needs a margin, not a debounce.** The nearest-room sensor
  only switches when the new winner beats the *incumbent's own reading* by
  5 dB. A time-debounce instead just delays the flapping; a margin removes
  it, because stationary-person noise is 1–2 dB and a genuine room change is
  10+. Raise the margin if you still see flapping; every dB of margin costs
  a little responsiveness at true boundaries.

- **The centroid's permissive floor is deliberate.** An earlier cut of the
  position sensor dropped boards reading below −95 dBm — and the overnight
  case (dozing device, every board −95..−105) left it stuck on `unknown`.
  The shipped −110 floor includes almost everything and lets the 1/d²
  weighting bury the weak boards. Similarly, the floor *index* snaps to the
  single strongest board rather than being centroided — a weighted average
  of floors puts the dot inside the ceiling.

- **Fuse at the end, not at the source.** The recurring temptation is to
  make the radar sensors person-aware ("the study radar means it's me") or
  the BLE sensors body-aware. Resist it. The layering — anonymous radar,
  identified BLE, one fusion point — is what keeps every failure mode
  debuggable: when the answer is wrong you can see *which layer* lied.
