# 03 — Smart TRV heating with forecast gating

## What it does

Per-room radiator heating on smart TRVs (thermostatic radiator valves): morning pre-heats for the bedroom and office, an evening window for the kitchen and living room, a 22:00 whole-house night setback to a 5°C frost floor, and a one-hour boost button that saves and restores whatever the schedules had set. Every warm window is gated on the forecast outside temperature, so the heating suppresses itself in mild weather and comes back on a cold snap — there is no "summer mode" switch to remember, ever.

## Hardware needed

| Item | Rough UK price | Notes |
|---|---|---|
| Sonoff TRVZB (one per radiator) | £20–25 each (often less on sale) | Zigbee, natively supported by Zigbee2MQTT and ZHA — no custom converter needed. Reports current temperature. Runs on 3× AA. |
| Zigbee coordinator (e.g. Sonoff ZBDongle-E) | £20–25 | Skip if you already have Zigbee working. |
| M28 valve adapter | Included in the TRVZB box | Most UK valve bodies are M30×1.5, which the TRVZB fits directly. Some older bodies (e.g. Myson) are M28 — the TRVZB ships with an M28 adapter. Genuinely odd valves (Danfoss RA and friends) need a third-party adapter, ~£5. |

You do **not** need a smart wall thermostat. See the first gotcha for why.

## Install

1. **Set your boiler up as a passthrough.** On the boiler programmer, set central heating to **continuous** (CONT/24hr). If you have a wall thermostat, turn it up high (e.g. 25°C) so it never cuts the boiler off — the TRVs become the real controllers. (Hot water stays on its own timed schedule; this only concerns central heating.)
2. **Fit and pair the TRVs.** Screw each TRVZB onto its valve body (hand-tight), run its mechanical calibration, then pair via Zigbee2MQTT/ZHA (enable permit-join, long-press the TRV's button). Read the sleepy-device gotchas below **before** you start — they will save you an evening.
3. **Rename the TRV entities** (or the placeholders in the package — either direction works) so they match the table below.
4. **Check your weather integration.** A fresh Home Assistant install has Met.no built in, which creates `weather.forecast_home`. If your weather entity is named differently, rename it in the package (three template sensors + one automation condition).
5. **Copy the package**: `package/heating_trv.yaml` → `/config/packages/heating_trv.yaml`. (The kit's base config loads everything in `/config/packages/`.)
6. **Restart Home Assistant** (template sensors and packages need a full restart, not a YAML reload).
7. **Set the helper values** in Settings → Devices & Services → Helpers: Heating Outside Threshold → **8°C**; Office Heating Start → 05:45; Office Heating End → 17:00; Evening Heating Start → 18:00; Evening Heating End → 20:00; Bedroom Morning Start → 05:00; Bedroom Evening Start → 21:30. **Until you set the threshold, nothing heats** — that's deliberate (fail-cold, see gotchas).
8. Optional: put `script.heating_boost` on a dashboard button, and enable the companion app's **Next alarm** sensor (Android) for the alarm-driven pre-heats.

## Rename these

| Placeholder in package | What yours will be called |
|---|---|
| `climate.office_trv` | Your office/study radiator TRV |
| `climate.living_room_trv` | Your living room TRV |
| `climate.kitchen_trv` | Your kitchen TRV |
| `climate.hallway_trv` | Your hallway TRV (or delete if none) |
| `climate.bedroom_trv` | Your bedroom TRV |
| `weather.forecast_home` | Your weather entity (this is the Met.no default) |
| `sensor.your_phone_next_alarm` | Companion app "Next alarm" sensor, e.g. `sensor.<phone_name>_next_alarm` (Android only; delete the two alarm automations if not used) |
| `media_player.announce_speaker` | Any speaker you want boost announcements on (or delete the two `tts.speak` steps) |
| `tts.home_assistant_cloud` | Your TTS entity (e.g. `tts.piper`, `tts.google_translate_en_com`) |

## secrets.yaml keys needed

None.

## Gotchas

These are the production lessons baked into this package. Most of them cost a cold morning or a wasted evening to learn.

**Why TRVs-as-controllers beats one wall thermostat.** A single wall thermostat heats the whole house to whatever the hallway happens to need. In a typical UK radiator house the rooms you actually occupy change through the day — bedroom at 05:30, office at 09:00, kitchen at 18:30 — and a hallway thermostat serves none of them well. Set the boiler programmer to continuous, neutralise the wall stat (turn it right up so it's a passthrough), and let per-room TRVs decide. The boiler only fires when at least one valve is calling for heat, so "continuous" does not mean "always burning".

**The 22°C targets are not a typo.** A TRV's sensor sits centimetres from a hot pipe, so once the radiator warms up it reads ~3°C above true room temperature. Ask for 19°C and the valve closes with the room at ~16°C. 22°C on the dial ≈ 19°C in the room. If a room consistently over- or under-shoots, adjust its target rather than assuming the valve is broken. Better still: the TRVZB accepts an **external temperature sensor** (a `select` entity switches its reference from internal to external, and a `number` entity receives the reading). If a room has any separate temperature sensor, sync it across with a small automation — push on every change **plus** an hourly safety-net push, because a missed single update otherwise leaves the valve steering on stale data indefinitely.

**Forecast gating instead of a seasonal toggle.** Every warm window checks "will it be cold at the hour that matters?" against one threshold number. Mild spell → pre-heats silently skip. Cold snap in May → they fire. Nobody has to remember a changeover weekend in either direction. Crucially, the **off/setback automations are ungated** — the 5°C frost floor is asserted every night no matter what the forecast, the weather integration, or the template sensors are doing. Gate the ONs, never the OFFs.

**`weather.get_forecasts` — plural.** Forecast data is no longer available as a state attribute; you must call the `weather.get_forecasts` service and capture the response. The singular `weather.get_forecast` service was removed from Home Assistant entirely — older blog posts and forum snippets that use it will silently not work.

**A forecast sensor for 06:00 is answering "which 06:00?"** After 06:00 has passed, the hourly forecast's next 06:00 is *tomorrow's* — which is why the 08:00 "settled" automation gates on the **current** outside temperature instead of the 0600 sensor. It doubles as a second chance: if the pre-heat skipped because the forecast promised a mild morning that never materialised, the 08:00 check catches it with real data.

**Forecast outage ≠ heating outage.** The template sensors fall back to the current outside temperature when the hourly lookup returns nothing, so a weather-integration wobble degrades the gate gracefully instead of flipping every sensor to `unknown` (which, depending on your template defaults, could either freeze the house or heat it all summer).

**Fail-cold by design.** A freshly installed copy heats nothing: a new `input_number` sits at its minimum (0°C), so no forecast gate can pass until you set the threshold, and the ungated setbacks still run. The wrong-way failure — an unconfigured kit merrily heating an empty house — is structurally impossible.

**No `initial:` on the helpers, deliberately.** `initial:` re-applies at every restart, silently reverting any tuning you did from the dashboard. Without it, helper values persist across restarts — but you must set them once after install (step 7).

**5°C with `hvac_mode: heat` is "off", `hvac_mode: off` is not.** All the setbacks set a 5°C target and leave the mode on `heat`. That keeps the valve alive as frost protection — it will still open if the room approaches freezing. `hvac_mode: off` disables the valve entirely, which is exactly what you don't want in an empty house in January.

**The night setback excludes the bedroom on purpose.** The bedroom's evening window runs 21:30→22:30, straddling the 22:00 setback; including it would cut the warm-up short every night. It handles its own off at 22:30. If you add TRVs, add them to the setback list — every radiator belongs there *except* the bedroom.

**The boost script snapshots before it touches anything.** It captures the current setpoints with `scene.create` and restores them afterwards, so boosting during a scheduled warm window hands control back to the schedule rather than dumping everything to frost. The `input_boolean` guard matters: the script runs in `restart` mode (pressing boost again extends the hour), and without the guard a re-press would re-snapshot the already-boosted temperatures and then "restore" them forever. The TTS steps carry `continue_on_error` so a broken speaker can never abort the script before the restore runs — without that, a failed announcement leaves the boost on indefinitely. One honest limitation: the snapshot lives in memory, so **a Home Assistant restart mid-boost cancels the restore** — the script dies with the delay, and the snapshot scene dies with it. The package clears the boost guard at startup (so future boosts still work), and the rooms simply return to schedule at their next scheduled window — worst case, the ungated 22:00 night setback. The guard is also cleared *before* the restore step, with `continue_on_error` on the restore itself, so even a lost snapshot can never leave the guard latched.

**Alarm-driven pre-heat: no alarm means no heat, and that's a feature.** The dynamic pre-heats fire 20 minutes before the phone's next alarm — so lie-ins and holidays get no pre-heat automatically, because you didn't set one. The template trigger fires inside a 60-second window around (alarm − 20 min); `mode: single` + `max_exceeded: silent` stop it double-firing as the template re-evaluates within that window. The ONs overlap safely with the fixed-time schedules — both idempotently set the same target. The off side needs its own sweeper, though: the fixed 06:00 bedroom off fires too early to catch a pre-heat for a later alarm, so a **09:00 catch-all off** returns the bedroom to the frost floor after any alarm-driven warm-up. It fires exactly once, so anything you set by hand after 09:00 still wins. (The office alarm pre-heat needs no sweeper — the end-of-day office off already covers it.)

**Sleepy-device pairing: the TRVZB will test your patience.** Battery Zigbee devices sleep aggressively. Hard-won pairing rules:

- After a Zigbee2MQTT restart, a TRV may take **minutes** to report — press its button to wake it before concluding the pairing failed.
- **Force-remove old devices from the Zigbee network, not just from the config.** A device deleted only from the configuration will quietly re-register itself. In Zigbee2MQTT, remove with `force: true` (via the UI or the `bridge/request/device/remove` MQTT topic).
- If the interview fails with **"DatabaseEntry does not exist"**: force-remove the new device, restart Zigbee2MQTT, and pair again from scratch. It works the second time.
- **Entities created before you rename a device keep hex-address names** (`climate.0xa1b2...`). Rename the device's friendly name in Zigbee2MQTT *first*, delete any hex-named entities from Home Assistant's entity registry, and let them re-register cleanly.
- Zigbee2MQTT **may revert a friendly-name on the first restart after renaming a freshly-paired device**. If your rename disappears: rename again, clean up any hex-named entities, restart Zigbee2MQTT a second time. Second rename sticks.
- `leave_count > 0` in a device's Zigbee2MQTT health data means it has dropped off the network at some point and may need re-pairing.

**Radiators with no valve body can't be made smart.** A TRV replaces an existing thermostatic valve head; a radiator with a plain lockshield at both ends has nowhere to put one. Check before ordering one per radiator.
