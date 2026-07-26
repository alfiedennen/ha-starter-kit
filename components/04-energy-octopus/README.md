# 04 — Energy: Octopus Agile awareness

## What it does

Turns the Octopus Energy integration's raw meter sensors into a small, stable energy brain: clean **alias sensors** (so nothing downstream ever references a meter serial number), a rolling **"cheapest 3-hour window"** sensor computed from today's half-hourly Agile rates, **peak-rate and off-peak alerts**, and a **07:30 morning briefing** (current rate, yesterday's cost, cheapest window) delivered as a notification and optionally spoken aloud. The alias-layer pattern generalises to any dynamic tariff — the aliases are the contract, the tariff integration behind them is swappable.

## Hardware needed

| Item | Rough UK price | Notes |
|---|---|---|
| SMETS2 smart meter | £0 | Fitted free by Octopus (or your current supplier) — required for Agile / half-hourly billing |

No other hardware. Everything else is software.

## Install

1. Install the **Octopus Energy** integration by BottlecapDave via HACS (HACS → search "Octopus Energy" → Download), then restart Home Assistant.
2. Add the integration: Settings → Devices & Services → Add Integration → "Octopus Energy". You'll need your **API key** and **account number** from your Octopus online dashboard (Account → Personal details → API access). The key is entered in this UI flow and stored by the integration — it does **not** go in `secrets.yaml`.
3. Find your meter-ID entity names: Developer Tools → States, filter for `octopus`. You'll see entities like `sensor.octopus_energy_electricity_<serial>_<mpan>_current_rate` (electricity uses serial + MPAN; gas uses serial + MPRN).
4. Check the **day-rates event entity** exists: filter for `_current_day_rates`. If it's missing, open the integration's device page and enable it — the cheapest-window sensor reads its `rates` attribute and is permanently `unknown` without it.
5. Copy `package/energy_octopus.yaml` into `/config/packages/` (create the folder if needed) and make sure your `configuration.yaml` contains:
   ```yaml
   homeassistant:
     packages: !include_dir_named packages
   ```
6. Search-and-replace the placeholder ids in the package file with your real ones (table below), then restart Home Assistant (template + package changes need a restart, not just a reload).
7. Set the **Electricity peak alert threshold** helper to `35` (Settings → Devices & Services → Helpers) — it starts at the minimum on first creation, deliberately (see Gotchas).
8. Optional spoken briefing: replace `media_player.announce_speaker` and `tts.home_assistant_cloud` with your own speaker and TTS entity, then turn on the **Morning briefing: speak aloud** toggle.
9. Notifications go to `notify.notify` — HA's default notifier, which targets your Companion App device(s) once the app is signed in. To route elsewhere (e.g. a Telegram bot or a notify group), swap the service name in the three automations.

## Rename these

| Placeholder in the package | What yours will be called |
|---|---|
| `sensor.octopus_energy_electricity_meter00serial_meter00point00number_current_rate` | `sensor.octopus_energy_electricity_<serial>_<mpan>_current_rate` |
| `sensor.octopus_energy_electricity_meter00serial_meter00point00number_previous_accumulative_cost` | `..._previous_accumulative_cost` (same prefix) |
| `binary_sensor.octopus_energy_electricity_meter00serial_meter00point00number_off_peak` | `binary_sensor.octopus_energy_electricity_<serial>_<mpan>_off_peak` |
| `event.octopus_energy_electricity_meter00serial_meter00point00number_current_day_rates` | `event.octopus_energy_electricity_<serial>_<mpan>_current_day_rates` |
| `sensor.octopus_energy_gas_meter00serial_meter00point00number_current_rate` | `sensor.octopus_energy_gas_<serial>_<mprn>_current_rate` |
| `sensor.octopus_energy_gas_meter00serial_meter00point00number_previous_accumulative_cost` | `..._previous_accumulative_cost` (same gas prefix) |
| `media_player.announce_speaker` | your announcement speaker (e.g. a Nest/Echo/Sonos `media_player`) |
| `tts.home_assistant_cloud` | your TTS entity (e.g. `tts.google_translate_en_gb`) |
| `notify.notify` | keep, or your preferred notifier (e.g. `notify.mobile_app_<phone>`) |

Tip: replace only the **six long octopus ids** (one search-and-replace each for the electricity prefix and the gas prefix covers all of them). Everything else in the package references the aliases, never the meter ids — that's the point.

## secrets.yaml keys needed

None. The Octopus API key is entered once in the integration's UI config flow and stored encrypted by Home Assistant — it never appears in YAML.

## Gotchas

- **The alias layer is the whole trick.** The integration bakes your meter serial + MPAN/MPRN into every entity id. Re-add the integration, get a meter exchanged, switch account, or move house, and those ids change — silently breaking every automation, dashboard and script that references them. Alias each raw sensor exactly once; point everything else at the alias. When the ids change you edit six lines, not your whole config. This also makes the tariff swappable: move to any other dynamic-tariff integration and only the alias definitions change.
- **Pounds vs pence WILL bite you.** The integration reports rates in £/kWh (`0.35` = 35p). A threshold of `35` against a £/kWh sensor never fires; `0.35` against a pence sensor fires constantly. This package converts to pence in exactly one place (`sensor.electricity_rate_pence`) and does all comparisons in pence — keep it that way.
- **Day rates live on an event entity.** Older guides show a `rates` attribute on the current-rate sensor; the integration moved the full day's rate list to `event.*_current_day_rates`. If the cheapest-window sensor is permanently `unknown`, that event entity is missing, disabled, or misnamed.
- **The cheapest-window loop appears three times** (state + two attributes). Not an accident: a template sensor's state and attributes render independently and cannot share intermediate values. It's harmless — renders are cheap, and the `now()` reference makes it re-render once a minute, which is exactly what keeps the window rolling forward past slots that have already started.
- **The window goes unknown late in the evening.** Once fewer than six future half-hour slots remain today, there's no valid 3-hour window and the state empties until tomorrow's rates arrive. Next-day Agile rates publish around 16:00 (occasionally hours late — don't alarm on it). Extend the template with the `*_next_day_rates` event for an overnight-aware version.
- **Rate alerts need a cooldown.** Agile evening prices oscillate around any threshold, and every 30-minute slot boundary can re-cross it — a raw `numeric_state` trigger becomes one notification per slot. The peak alert carries a one-alert-per-hour template condition; keep it (or lengthen it) rather than deleting it the first evening it feels quiet.
- **`from: "off"` on the off-peak trigger is load-bearing.** A bare `to: "on"` also matches the sensor recovering from `unavailable` (integration reload, restart, cloud blip) and fires phantom "off-peak started" notices at odd hours.
- **Yesterday's cost arrives late.** Smart-meter consumption data flows through the national metering network with hours of lag — the previous-cost sensors are often still `unknown` at 07:30. The briefing template checks every value and says "hasn't come through from the meter yet" rather than announcing "unknown pounds". Keep that defensive pattern in anything else you build on these sensors.
- **No `initial:` on the threshold helper — deliberately.** Home Assistant re-applies an `input_number`'s `initial:` on *every* restart, silently clobbering whatever you set in the UI. Omitting it means the helper restores its last value; the one-time cost is setting it to 35 after install.
- **`device_class: monetary` only accepts real currency units.** It's correct on the GBP cost sensors but makes HA nag in the logs if you put it on a £/kWh rate sensor — which is why the rate aliases deliberately don't carry it.
- **The off-peak binary sensor depends on your tariff.** The integration only creates it where the tariff defines an off-peak band. If yours doesn't have one, delete the off-peak automation and alias, or recreate the notice as a `numeric_state` trigger on `sensor.electricity_rate_pence` dropping `below` a cheap threshold.
- **Spoken briefings and sleeping households.** The TTS leg is off by default and behind its own toggle for a reason — a 07:30 announcement is only charming if everyone is up. If your household varies, gate the TTS branch on a presence or workday condition, or just move the trigger time.
