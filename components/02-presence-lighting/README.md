# 02 — Presence-Driven Room Lighting

## What it does

Lights that come on when you walk in and go off shortly after you leave, driven by mmWave presence sensors rather than PIR — so they stay on while you're sitting still. Three exemplar rooms, each showing a different pattern: a **hallway** with time-of-day brightness bands (bright in the evening, dim amber late at night), a **kitchen** with simple on/off on non-dimmable wall relays, and a **bathroom** with a humidity-spike shower detector that holds the extractor fan on for a 20-minute run-on. Every room has its own "auto" toggle so manual control always wins.

## Hardware needed

| Item | Rough UK price | Notes |
|---|---|---|
| Aqara FP300-class mmWave presence sensor (Zigbee) | ~£40–50 | The reference device for this package. mmWave + PIR + temperature/humidity/lux in one unit — the built-in humidity sensor covers the bathroom shower detector with no extra hardware. Battery powered, so placement is flexible. |
| Aqara FP2 (Wi-Fi, mains) | ~£80 | Multi-zone alternative if you want per-zone presence in one big room. Overkill for a hallway. |
| Sonoff SNZB-06P (Zigbee mmWave) | ~£15–20 | Budget option. Presence only — no PIR, no humidity, and slower absence detection. Fine for the hallway pattern. |
| DIY ESPHome LD2450/LD2410 board | ~£10–15 | Best capability-per-pound if you're happy soldering — see **component 08** for the build. Gives you real target coordinates, which none of the Zigbee options reliably do. |
| A humidity sensor in the bathroom | ~£10–15 | Only needed if your presence sensor doesn't include one (the FP300 class does). Any Zigbee temperature/humidity sensor works. |

You also need something to switch: a dimmable `light.*` entity (or light group) for the hallway pattern, and any `switch.*` relay (e.g. a ZBMINI-class in-wall module behind the existing wall switch, ~£10–15) for the kitchen/bathroom patterns.

### Why mmWave and not PIR?

PIR sees *motion* — a warm body moving across its view. mmWave radar sees *presence* — it detects micro-movement down to breathing. In a hallway either works, but in any room where people **sit still** (kitchen table, bathtub, sofa, desk) PIR times out and plunges you into darkness mid-sentence, and no amount of off-delay tuning fixes it without making the room stupid. mmWave holds occupancy for as long as someone is genuinely there. The ideal sensor has both: mmWave for occupancy, PIR for a fast edge on entry (see the kitchen re-entry gotcha below).

## Install

1. Make sure packages are enabled in your `configuration.yaml` (the kit's base config already does this):
   ```yaml
   homeassistant:
     packages: !include_dir_named packages
   ```
2. Copy `package/presence_lighting.yaml` into `/config/packages/`.
3. Rename the placeholder entities (table below) to your own entity ids.
4. If a room doesn't apply to you, delete that room's automations — each block is self-contained.
5. **Restart Home Assistant** (Developer Tools → Check configuration first). A plain automation reload is not enough on first install — the `input_boolean` helpers and the shower timer are only created on a full configuration load.
6. Walk-test each room and watch the sensor entity in Developer Tools → States. Tune the sensor's own absence delay *first*, then the automation `for:` delays (they stack — see Gotchas).

## Rename these

| Placeholder in the package | What yours will be called |
|---|---|
| `binary_sensor.hallway_presence` | Your hallway mmWave presence entity |
| `binary_sensor.kitchen_presence` | Your kitchen mmWave presence entity |
| `binary_sensor.kitchen_motion` | Your kitchen PIR/motion entity (optional — delete the trigger and the off-guard condition if your sensor has no separate motion entity) |
| `binary_sensor.bathroom_presence` | Your bathroom mmWave presence entity |
| `sensor.bathroom_humidity` | Your bathroom humidity sensor |
| `light.hallway_lights` | Your hallway light or light group (must be dimmable for the brightness bands to mean anything) |
| `switch.kitchen_lights` | Your kitchen light relay or switch group |
| `switch.bathroom_lights` | Your bathroom lights + extractor fan circuit (see note in the package if yours are separate entities) |

Tip: if your Zigbee sensors arrived with hex-address entity ids, rename the *devices* in Zigbee2MQTT/ZHA to friendly names before wiring them in — future-you will thank you, and re-pairing a renamed device keeps its entity ids.

## secrets.yaml keys needed

None.

## Gotchas

These are production lessons, learned the slow way. Read them before tuning.

- **The "auto" toggle is not optional polish — it's the difference between automation and a haunting.** Without a per-room kill switch, the off-automation *will* fight you the one evening you want the light to stay on (guests, cleaning, a sick pet), and your only recourse is disabling the automation in the UI and forgetting to re-enable it. One toggle per room, checked as a condition in every automation, visible on a dashboard. Note the deliberate choice in the package: `initial: true` makes auto mode self-heal on restart. Remove it if you'd rather the toggle be remembered.

- **Off-delays stack.** Most mmWave sensors apply their own internal absence delay (typically ~10s, often configurable) before reporting "clear". The automation's `for:` wait is *added on top*. A "60 second" automation delay on a sensor with a 10s internal hold is really ~70s to darkness. Tune the sensor first, then the automation, and test with a stopwatch, not vibes.

- **mmWave latches; PIR pulses. You need the pulse for re-entry.** Real sequence: you turn the kitchen lights off manually, step out for ten seconds, walk back in — and nothing happens. The mmWave occupancy never dropped in that gap, so there's no off→on edge to trigger on. The fix is a second trigger on the sensor's PIR/motion entity, which fires a fresh pulse on every entry. If your sensor is mmWave-only, you simply lose this case — worth knowing before you buy.

- **Some mmWave sensors only expose reliable on/off presence over Zigbee.** Sensors in this class are often marketed on distance, zones and target positions, but over Zigbee the firmware frequently ships only the plain presence flag (plus PIR) reliably — the fancy attributes sit silent or update erratically. Design your automations around `on`/`off` presence and treat anything richer as a bonus. If you genuinely need coordinates and zones, that's the DIY LD2450 route (component 08).

- **Pets are presence too.** A dog wandering through re-triggers the room via motion edges and can keep an "empty" kitchen lit for twenty minutes. Mitigations, in order of effectiveness: shorter off-delay (the 60s kitchen value here was cut from 2 minutes for exactly this reason), mounting height/angle so the beam skims above pet height, and accepting the trade-off — a stationary cook may occasionally need to wave at the sensor. Pick your failure mode consciously.

- **Have a "night silence" band, and make it truly manual.** The kitchen automations only run 19:00–23:00. Overnight, *neither* the on- nor the off-automation fires: walking in for a glass of water at midnight doesn't blast every light on, and if you deliberately switch lights on at 23:30 they *stay* on. Gating only the on-automation and leaving the off-automation armed is a classic mistake — the room turns itself off around you all night.

- **Late-night brightness bands beat a single setting.** The hallway's 22:30–06:00 band is 20% at 2200K — enough to navigate by without resetting your eyes at 3am. HA's time condition wraps midnight correctly when `after` is later than `before`, so `after: "22:30"` / `before: "06:00"` is one condition, not two automations.

- **Detect showers by humidity *rate-of-rise*, never an absolute threshold.** Bathroom baseline humidity drifts enormously — season to season and hour to hour depending on ventilation. A fixed "fire above 70%" either never fires (baseline already there on a muggy day) or false-fires on ambient drift. A jump of 12+ points between consecutive sensor reports is unambiguous: Zigbee humidity sensors report in coarse steps, so a real shower arrives as one big jump while drift between reports is under a point. The template also guards against `unavailable`/`unknown` flaps, which otherwise crash the comparison.

- **The absence-off automation must yield to the shower timer.** Steam clearing takes far longer than the person does. If the off-on-absence automation doesn't check `timer.bathroom_shower` is `idle`, the fan cuts the moment you leave and the room stays damp — which over time means mould. The timer *is* the feature; the presence lighting is the garnish.

- **Give the shower timer `restore: true`.** Without it, a Home Assistant restart mid-shower silently discards the running timer: `timer.finished` never fires, the absence automation keeps deferring to a timer that no longer exists, and the fan runs until someone notices. One line prevents it.

- **Non-dimmable relays mean `switch.*`, not `light.*`.** In-wall relay modules behind existing switches show up as switches; brightness and colour-temperature settings silently do nothing on them. The kitchen and bathroom patterns here use `switch.turn_on/off` for exactly that reason. Brightness bands need real smart bulbs or a smart dimmer.

- **Smart bulbs hate dimmer wall switches.** If your hallway has trailing-edge/phase-cut dimmers and you put smart bulbs behind them, expect flaky pairing and random dropouts — even at "full brightness" the chopped waveform starves the bulb's radio. Replace the dimmer plate with a plain on/off switch (dimming then happens in software) or use a smart dimmer module with dumb bulbs. Don't mix.

- **Mind what the radar can see.** mmWave penetrates plasterboard — a badly aimed sensor happily detects someone in the *next room* and holds your light on. It also sees "motion" in oscillating fans, wafting curtains and heat shimmer above radiators. Aim the sensor's cone at the space you mean, away from walls shared with occupied rooms and away from moving objects, and walk-test the edges before trusting it.

- **Package automations are read-only in the UI.** Automations defined in a package file show up in Settings → Automations but can't be edited there — edit the YAML, then Developer Tools → YAML → Reload Automations (helpers and timers still need a restart if you add new ones).

## Going further: desk-level presence

The same idea scales down from "room" to "zone". With an ESPHome LD2450 board (component 08) you get live target coordinates, and a couple of template binary sensors — "someone in the room" and "someone in the desk chair rectangle", each with a `delay_off` hold — give you clean *arrived / left / sat at desk / stood up* signals to hang deeper automations on: switch to a work scene when you sit down, pause the lights' off-timer while you're in the chair, log focus sessions. Start with `logbook.log` actions to verify the zone boundaries behave before wiring them to anything visible; calibrating zone rectangles against reality takes a few passes.
