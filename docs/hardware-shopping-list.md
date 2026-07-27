# Hardware shopping list

Rough UK street prices — shop around, and check used/refurbished for anything
without a battery or a radio certification worry. You do **not** need all of
this. Buy the Foundation tier, then add tiers as you install the components
that use them.

A recurring theme: this kit prefers boring, locally-controlled, standards-based
hardware (Zigbee, ESPHome, MQTT) over anything that needs a vendor cloud
account to turn a light on.

---

## Foundation

| Item | Rough price | What it unlocks | Used by |
|---|---|---|---|
| Raspberry Pi 5 (4GB) + PSU + case + USB SSD | ~£100 | The controller (easy route) | everything |
| — or — used mini-PC (HP ProDesk/EliteDesk-class, Dell OptiPlex-class, i5 / 8–16GB) | £100–150 | The controller (headroom route, runs Proxmox + HAOS VM) | everything |
| SSD (if the mini-PC came with a spinning disk) | ~£25 | A database that doesn't grind. Non-negotiable — HA's recorder on a 5400rpm drive is misery | everything |
| Sonoff ZBDongle-E | ~£20 | Zigbee coordinator radio | 01, and every Zigbee tier below |
| USB 2.0 extension cable (1m) | ~£3 | Gets the dongle away from USB3 interference — genuinely mandatory, see component 01 | 01 |

## Lighting

| Item | Rough price | What it unlocks | Used by |
|---|---|---|---|
| Zigbee RGB/CCT E27 or B22 bulbs (Third Reality / Innr class) | £10–15 each | Scenes, colour-temperature schedules, presence lighting | 02, 06, 07 |
| Zigbee GU10 spots (Innr-class) | £10–13 each | Same, for ceiling spot fittings | 02, 06, 07 |
| Zigbee smart plugs (Sonoff S60-class) | £10–12 each | Lamps and "dumb" devices become switchable; mains-powered plugs also strengthen the Zigbee mesh as routers | 02, 06, 07, 11, 12 |
| Plain 10AX on/off light switches (Click Scolmore-class) | £5–8 each | Replacing dimmer switches — see the hard rule below | — |

> **Hard rule: never put smart bulbs behind a phase-cut dimmer switch.**
> Trailing-edge/leading-edge dimmers chop the mains waveform — even at "full
> brightness" the bulb's power supply is being starved, and the first thing to
> fail is the Zigbee radio. Symptoms: bulbs that won't pair, pair then drop
> off the mesh, or flicker. Swap the dimmer for a plain on/off switch (COM ←
> permanent live, L1 ← switched live) and let the bulb do the dimming — that's
> its job now. If in any doubt about mains wiring, pay an electrician for the
> half-hour.

> **Buy routers before end devices.** Mains-powered Zigbee devices (bulbs*,
> plugs) route traffic and strengthen the mesh; battery devices don't. Pair a
> few plugs/bulbs around the house *first* and the battery sensors you add
> later will find a good route home. (*Most mains bulbs route — but a bulb on
> a switched-off wall switch is a router that just left the network, which is
> another reason for the hard rule above.)

## Climate

| Item | Rough price | What it unlocks | Used by |
|---|---|---|---|
| Sonoff TRVZB radiator valve | £25–30 per radiator | Per-room heating schedules with real temperature feedback | 03 |
| M28→M30 valve adapters | £3–5 | Older valve bodies (some brands are M28 thread; the TRVZB is M30 and ships with a couple of adapters — check yours before ordering) | 03 |

The TRVZB is natively supported by Zigbee2MQTT — no custom converter needed —
and reports current temperature. It is a "sleepy" battery device: read the
pairing procedure in component 01 before you start, it will save you an hour.

## Sensing

| Item | Rough price | What it unlocks | Used by |
|---|---|---|---|
| mmWave presence sensor (Aqara FP300-class: mmWave + PIR + temp/humidity/lux) | £40–50 | Real occupancy — detects a *still* human, unlike PIR which only sees movement. The difference between lights that work and lights that plunge you into darkness mid-book | 02 |
| Door/window contact sensor | ~£10 | Door-open automations, lock verification, "did I leave it open" alerts | 05, 07 |
| Cheap Zigbee temp/humidity sensor | £8–10 | Better room temperature feedback than the TRV's own sensor (which sits next to a hot pipe) | 03 |

## Voice

| Item | Rough price | What it unlocks | Used by |
|---|---|---|---|
| M5Stack Atom Echo (one per room you talk to) | £12–15 | A tiny wake-word voice satellite for HA Assist | 10 |
| A decent speaker HA can cast to (Nest Mini / Echo-class, or any `media_player`) | £20–30 | Announcements and voice replies that don't sound like a crisp packet — the Echo's own speaker is for emergencies only | 10 |

## Displays

| Item | Rough price | What it unlocks | Used by |
|---|---|---|---|
| Used Android tablet (Fire HD 10-class) | £40–60 | A wall-mounted always-on dashboard via Fully Kiosk | 11 |
| Wall mount + long USB cable + charger | ~£15 | Mounting it somewhere the household actually walks past | 11 |

Older/cheaper tablets are fine for dashboards, but note very old Android
versions cap which Fully Kiosk version you can run. Component 11 includes the
battery-protecting charge cycling that stops a permanently-plugged-in tablet
cooking its battery.

## DIY (ESPHome)

| Item | Rough price | What it unlocks | Used by |
|---|---|---|---|
| ESP32 devkit boards | £5–8 each | Bluetooth-proxy presence mesh nodes; general tinkering | 08, 14 |
| Seeed XIAO ESP32-S3 | ~£8 | **Required for the radar nodes** — it has a genuine 5V/VBUS output pin. Plain devkits' VIN is input-only and cannot power the LD2450 | 08, 14, 16 |
| HLK-LD2450 24GHz radar module | £10–15 | Multi-target position/speed radar for room presence (pairs with the XIAO above) | 08, 14, 16 |
| M5StickC Plus2 | £18–22 | A one-press physical action button with instant beep feedback (screen and battery included) | 09 |

ESP32 boards are the gateway drug of this hobby: £6 of hardware, a YAML file,
and you've built a sensor that would cost £50 retail. Start with component 08
once the Zigbee side of the house is stable.

---

## Suggested first order

For a "weekend one" that ends with something working:

- Controller of choice + SSD
- ZBDongle-E + USB extension — **£23**
- 3–4 bulbs for one room — **~£40**
- 2 smart plugs — **~£22**
- 1 mmWave presence sensor — **~£45**

Roughly £130 on top of the controller, and enough for components 01, 02 and 06.
