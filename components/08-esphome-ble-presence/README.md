# 08 — ESP32 Presence Mesh (ESPHome)

> **For the curious.** This is the most advanced component in the kit. Nothing
> else depends on it — skip it entirely and come back when you want room-level
> "who is where" tracking. It involves flashing microcontrollers and, for the
> radar variant, a small amount of wiring. It is also, per pound spent, the
> most capable presence system you can put in a house.

## What it does

Scatters cheap ESP32 boards around the house, each running ESPHome as a
**Bluetooth proxy** — effectively giving Home Assistant an antenna in every
room, so it can tell *which room* a phone or watch is in, not just "home /
away". The optional radar variant adds an **HLK-LD2450 24 GHz mmWave sensor**
that tracks up to three people with X/Y coordinates and speed at 10 Hz
(positions publish in metres, speed in cm/s — the units components 14 and 16
consume) — catching someone sitting perfectly still, which PIR sensors never
will.

Two node types, two files in `esphome/`:

| File | Board | Gives you |
|---|---|---|
| `ble-proxy-node.yaml` | any bare ESP32 dev board | Bluetooth proxy + optional per-beacon RSSI |
| `radar-presence-node.yaml` | Seeed XIAO ESP32-S3 + LD2450 | all of the above + still-person detection + per-target coordinates |

## Hardware needed

| Item | Rough UK price | Notes |
|---|---|---|
| Bare ESP32 dev board (ESP32-WROOM-32 "DEVKIT" style) | ~£5 | fine for BLE-proxy-only nodes — but see the **VIN trap** gotcha before planning to add peripherals later |
| Seeed XIAO ESP32-S3 | ~£8 | for radar nodes — tiny, USB-C, has a genuine 5V/VBUS pin |
| HLK-LD2450 radar module | ~£10–15 | usually ships with a JST pigtail cable — see the **cable colour trap** |
| USB power supply + cable per node | ~£5 | any 5V/1A phone charger |
| Dupont / silicone wire, heat-shrink | ~£5 | keep radar wire runs under 15 cm |
| A multimeter | ~£15–20 | not optional if you're doing the radar build — it turns hours of debugging into a 30-second measurement |

**How many boards?** One per room you actually care about. Four to six covers
a typical UK semi (hallway, living room, kitchen, bedroom, office). BLE
trilateration gets meaningfully better with each extra scanner; radar is a
per-room decision (put it in rooms where people sit still — office, living
room — and use plain BLE proxies elsewhere).

## Install

1. **Install ESPHome** on any computer: `pip install esphome` (or use the
   ESPHome add-on inside Home Assistant and paste the YAML there).
2. **Create `secrets.yaml`** next to the node configs — copy
   `secrets.yaml.example` and fill it in. Generate the API key with
   `openssl rand -base64 32`.
3. **Copy the node file** once per board, edit the two `substitutions` at the
   top (`name` must be unique per board).
4. **First flash is over USB.** Plug the board in and run:
   ```
   esphome run ble-proxy-node.yaml --device COM5      # Windows
   esphome run ble-proxy-node.yaml --device /dev/ttyACM0  # Linux/Mac
   ```
   If a XIAO ESP32-S3 isn't detected, hold its BOOT button while plugging in
   the cable to force bootloader mode. Every later update is over WiFi — no
   ladder required.
5. **Windows only:** run the build from a folder **without spaces in the
   path** (e.g. `C:\esp_flash\`, not `C:\Users\Me\My Documents\...`). The
   PlatformIO compiler toolchain rejects paths containing whitespace with
   confusing errors. Stage the YAML + secrets there before flashing.
6. **Wire the radar** (radar nodes only) — see the pinout below, and read the
   cable-colour gotcha *first*.
7. **Add to Home Assistant**: each node is auto-discovered by the ESPHome
   integration (Settings → Devices & Services). Paste the API key when asked.
8. **Mount it**: 1.5–2.0 m off the floor. Radar antenna face pointing *into*
   the room (the beam comes out perpendicular to the module face, not the
   edges). More placement rules in the gotchas.

### Radar wiring (XIAO ESP32-S3 ↔ HLK-LD2450)

| LD2450 JST pin (read the **silkscreen**, top→bottom `5V / RX / TX / GND`) | XIAO pin | Why |
|---|---|---|
| 5V | 5V (USB VBUS) | radar needs 5V at ~200 mA — the 3.3V rail cannot drive it |
| RX (radar's input) | D8 / GPIO7 (ESP TX) | ESP transmits → radar receives |
| TX (radar's output) | D9 / GPIO8 (ESP RX) | radar transmits → ESP receives |
| GND | GND | common ground — required for UART integrity even if you power the radar separately |

Before trusting the XIAO's 5V pin, probe it against GND with USB plugged in:
it should read 4.5–5.0 V. Some board variants require a solder bridge for 5V
passthrough — verify, don't assume.

## HA-side options (what consumes this mesh)

You almost certainly want **both** of these:

### Private BLE Device (built-in integration) — track phones and watches

Phones and watches **rotate their Bluetooth MAC address every ~15 minutes**
as a privacy measure, so you cannot track them by MAC — the "device" you
tracked simply evaporates on every rotation. The fix is cryptographic: each
device has a stable **IRK (Identity Resolving Key)** that lets a trusted
receiver mathematically undo the rotation. HA's **Private BLE Device**
integration does exactly this: give it a device's IRK and it produces a
stable `device_tracker` + distance sensor that survives every MAC rotation.
The integration's setup flow documents how to extract the IRK per platform
(Android: the HA Companion app can supply it; iOS/watches: a one-off pairing
trick). **Treat an IRK like a password — anyone who has it can track that
device. Never commit it to a repo.**

### Bermuda (HACS integration) — room-level trilateration

[Bermuda](https://github.com/agittins/bermuda) takes RSSI readings from every
proxy and produces an `area` per tracked device — "which room is this phone
in". Hard-won calibration advice:

- **Scanner RSSI offsets are global per-scanner, not per-beacon.** The
  calibration flow *looks* like it's per-beacon; it isn't — submitting for a
  second beacon overwrites the first. Pick ONE reference beacon (your phone),
  calibrate everything against it, accept that distance estimates for other
  beacons will be off. Area classification still works because relative
  scanner strengths are preserved.
- **Calibration sequence that works**: walk the house pausing ~1 m from each
  board and note each scanner's peak RSSI for your phone; the strongest
  scanner is your zero-offset reference; set global `ref_power` to its peak;
  each other scanner's offset = reference peak − its peak.
- **Drop `smoothing_samples` from the default 20 to ~8.** The default gives
  20–30 s of lag on room changes, which defeats real-time tracking; 8 gives
  ~5–8 s and is stable enough for walking pace.
- **A weaker transmitter gives *cleaner* room transitions.** A watch's weak
  BLE reaches only the closest scanner, so its area flips once per room
  entry; a phone's strong signal reaches several scanners at once and the
  winner flickers during transit. Use watch-area for "on entering the room"
  triggers, phone-area for "which room are they settled in".
- Expect ~85% correct transitions on a walk-test with 4+ calibrated
  scanners, and 1–3 m distance accuracy for the reference beacon. That is
  the realistic ceiling — design automations accordingly.

## Rename these

ESPHome derives entity ids from the `substitutions` block, so renaming
happens **in the YAML before flashing**, not in HA afterwards:

| Placeholder | Change to |
|---|---|
| `name: presence-hallway` / `presence-living-room` | one unique slug per board, e.g. `presence-bedroom` |
| `friendly_name: "Presence Node — Hallway"` | your room, e.g. `"Presence Node — Bedroom"` |
| resulting entities, e.g. `sensor.presence_hallway_wifi_signal`, `binary_sensor.presence_living_room_radar_presence`, `sensor.presence_living_room_target_1_x` | follow automatically from `name` |
| `ibeacon_uuid: "XXXXXXXX-…"` (commented out) | your own beacon's UUID, only if you use the optional raw-RSSI sensors |

If you're ever unsure what entity ids a node actually created, the ground
truth is **Developer Tools → States** in HA (search `target_1_x`) — or
component 16's `precompute_radar.py --list-sensors`, which lists every
target entity the recorder knows about.

## secrets.yaml keys needed

In **ESPHome's** `secrets.yaml` (next to the node configs — not Home
Assistant's):

| Key | What |
|---|---|
| `wifi_ssid` | your 2.4 GHz WiFi name (ESP32s cannot see 5 GHz networks) |
| `wifi_password` | its password |
| `presence_node_api_key` | 32-byte base64 API encryption key (`openssl rand -base64 32`), shared across nodes |
| `presence_node_ota_password` | OTA update + rescue-hotspot password, shared across nodes |

## Gotchas

The production lessons. Every one of these cost real bench time.

- **The LD2450 cable colour trap.** Modules commonly ship with a JST pigtail
  whose wire colours do **not** follow convention — one widespread batch maps
  **black = 5V, red = RX, white = TX, yellow = GND**. Wire it "the obvious
  way" (red = power, black = ground) and you short the radar's 5V to ground
  and feed 5V into a signal pin. Symptoms: no LED on the radar PCB, ESPHome
  reports `Firmware version: 0.00.00000000`, every radar entity `unknown`.
  None of that is fixed by swapping tx/rx pins, changing baud rate, or
  re-seating wires — hours go there and it's never the issue. **Read the JST
  silkscreen on the radar (`5V / RX / TX / GND`) and trace each wire colour
  to its labelled pin before powering anything.** Colours vary between
  batches; only the silkscreen is reliable.

- **The DEVKIT-V1 VIN trap.** On many clone ESP32 "DEVKIT V1" boards
  (especially USB-C revisions), the `VIN` pin is *input-only* — the diode
  topology means USB power does **not** flow back out of VIN. The board runs
  fine, BLE proxying works fine, but any peripheral you later wire to VIN is
  simply unpowered: no LED, no UART, firmware version all-zeros. Probe VIN to
  GND with USB plugged in — under 1 V means you have the trap. This is why
  the radar config specifies the XIAO ESP32-S3, which exposes genuine USB
  VBUS on a labelled 5V pin. If you're buying boards "for BLE now,
  peripherals later", buy ones with a real 5V/VBUS pin from day one.

- **Trust the silkscreen, not the convention** — the meta-rule behind both
  traps above. Labels printed on the actual hardware are right; assumptions
  about wire colours and pin behaviour are how evenings disappear.

- **Why the external LD2450 component.** ESPHome's built-in `ld2450` has
  been observed to read the radar's firmware/MAC and publish `target_count`
  while silently mis-parsing the target frames — per-target coordinates never
  publish, even though a raw UART dump shows valid multi-target frames
  streaming the whole time. It looks *almost* working, which makes it worse.
  The TillFleisch external component (referenced straight from GitHub in the
  config) parses correctly. Older tutorials point at a screek-workshop fork
  that has since been deleted from GitHub.

- **The LD2450 component prefixes target names — leave the sub-sensor names
  bare.** In `radar-presence-node.yaml` the per-target sub-sensors are named
  just `X` / `Y` / `Speed` / `Distance` on purpose: the component
  automatically prepends the target's own name, so `X` under `Target 1`
  publishes as "Target 1 X" → `sensor.<node>_target_1_x`. Rename them to
  "Target 1 X" yourself and the prefix doubles
  (`sensor.<node>_target_1_target_1_x`), quietly breaking components 14
  and 16, which expect the single form.

- **First-boot radar silence.** A cold-powered LD2450 can take 30–60 s to
  start emitting UART frames. If entities show `unavailable` right after
  flashing, wait a minute before touching the wiring.

- **256000 baud is not negotiable** — it's fixed in the radar firmware, and
  it's also why wire runs must stay under ~15 cm; longer runs drop frames.

- **Radar placement rules.** Mount 1.5–2.0 m high (lower loses standing
  adults off the top of the vertical cone; above ~2.2 m loses seated people).
  The beam is *broadside* — perpendicular to the module face — so the face
  points into the room. Keep 30 cm clear in front of it. Avoid pointing at
  large metal surfaces (radiators, fridges) within 2 m — they create ghost
  targets; angle away ~20° if unavoidable. Avoid rotating fans and don't
  point two radars at each other (24 GHz interference). Curtains, wood,
  books, plaster are all fine. And expect **phantom targets near hard walls**
  at close range — pull `Radar Max Distance` in from HA until they stop.

- **Radar doesn't cross floors, BLE does.** 24 GHz barely penetrates a floor,
  so a radar target is unambiguously *in this room* — whereas BLE RSSI bleeds
  through ceilings and regularly places someone in the room above/below.
  This is exactly why the two sensors complement each other: radar for
  certainty in-room, BLE for identity ("which person").

- **Pets are targets too.** A dog reads as a small, short-lived radar target
  — not distinguishable from a crouching human by radar alone. Combine with
  BLE: radar sees two targets but only one tracked device present → one of
  them is the dog.

- **2.4 GHz only.** ESP32s can't see 5 GHz WiFi. If your router uses one name
  for both bands, the boards will still find the 2.4 GHz side — but if the
  2.4 GHz radio ever wedges (it happens on consumer routers), *every* node
  drops at once while 5 GHz devices stay up. A whole-mesh simultaneous outage
  is a router-radio symptom, not a fleet of dead boards.

- **BLE and WiFi share one radio.** The continuous scan window
  (`interval == window`) is right for presence, but it's the first thing to
  back off if a node shows WiFi instability.

- **Room RF is not uniform.** A kitchen (tiles + appliances) can read
  ~20 dB weaker than an open living room from equally good mounting — that's
  real absorption, not a broken board; calibration offsets absorb it. And in
  a typical two-storey house, a centrally-located upstairs room tends to win
  trilateration from everywhere via short diagonal paths — that's what the
  per-scanner offsets are for.

- **The rescue hotspot earns its keep.** The `ap:` + `captive_portal:` block
  means a board that can't join WiFi (changed SSID, typo'd password)
  broadcasts its own hotspot instead of bricking — join it and fix the
  credentials from your phone, no ladder, no USB cable.
