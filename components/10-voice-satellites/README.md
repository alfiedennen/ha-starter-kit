# 10 — Voice satellites: room voice control + timers

## What it does

Puts a small always-listening voice puck (M5Stack Atom Echo) in each room, wired into Home Assistant's Assist pipeline so "turn on the kitchen lights" just works — no phone, no cloud assistant account. On top of that it adds a household pool of **3 labelled timers** and **3 one-shot alarms**, all announced through a single `script.announce` (spoken alert on a proper speaker + phone notification). That script is the *pattern* the kit's other components mirror — each has its own announce point targeting `media_player.announce_speaker` — so renaming that one placeholder consistently across components is what actually re-points the whole house at your speaker.

## Hardware needed

| Item | Rough UK price | Notes |
|---|---|---|
| M5Stack Atom Echo | ~£12–15 each | One per room you want to talk to. Tiny, USB-C powered. |
| USB-C power supply + cable | ~£5 | Any 5 V / 1 A phone charger is plenty. |
| A decent speaker (optional, strongly recommended) | ~£20–35 | Nest Mini, Echo Dot (as a Bluetooth/cast target), or any `media_player` HA can see. This becomes `media_player.announce_speaker`. |
| Nabu Casa subscription (optional) | ~£6/month | The easy STT/TTS path — see trade-offs below. |

## Install

1. Copy `package/voice-satellites.yaml` into `/config/packages/` and restart Home Assistant (packages need a full restart, not just an automation reload).
2. Rename the placeholder entities per the table below — at minimum `media_player.announce_speaker`. Test with **Developer tools → Actions → `script.announce`** and a message; you should hear it.
3. Install the **ESPHome Device Builder** add-on (Settings → Add-ons). Create a new device, then paste in `esphome/voice-satellite.yaml`, changing the two `substitutions` (e.g. `voice-satellite-kitchen`).
4. Put your wifi credentials in the ESPHome add-on's **own** `secrets.yaml` (`/config/esphome/secrets.yaml` — a separate file from HA's `secrets.yaml`).
5. First flash over USB-C (browser flashing via the ESPHome dashboard works in Chrome/Edge). Every later update is over-the-air.
6. HA will discover the device (Settings → Devices & services). Add it, then **assign it to the room it physically sits in** — this is the make-or-break step, see Gotchas.
7. Set up an Assist pipeline (Settings → Voice assistants → Add assistant): choose a conversation agent (start with the built-in Home Assistant agent), an STT engine and a TTS engine (options below). Set the satellite's pipeline on its device page.
8. Expose the entities you want to control by voice: Settings → Voice assistants → Expose. Fewer is better — only expose what you'd actually say.
9. Say "Okay Nabu, turn on the kitchen lights". The LED goes blue (listening), pulses (thinking), green (replying).
10. Repeat steps 3–6 per room, one file copy per satellite.

### Choosing STT/TTS — the honest trade-offs

| | Home Assistant Cloud (Nabu Casa) | Local (Whisper + Piper add-ons) |
|---|---|---|
| Cost | ~£6/month | Free |
| Privacy | Audio goes to Nabu Casa's cloud | Everything stays in the house |
| STT speed | ~1–2 s round trip, consistently | Depends entirely on your server. Pi-class hardware: 3–8 s with the `tiny`/`base` models and noticeably worse accuracy on far-field audio. An Intel N100 or better runs `small` comfortably. |
| STT accuracy | Very good, many languages | `tiny`/`base` mishear far-field speech often enough to be annoying; `small`+ is decent |
| TTS quality | Natural cloud voices | Piper is fast on almost any hardware and perfectly listenable, a notch below cloud voices |

Pragmatic recommendation: **start with HA Cloud** to prove the whole chain works, then go local later if privacy or cost demands it. Debugging wake word + pipeline + areas + exposure is enough for week one without also debugging a slow local STT.

### Why route announcements to an external speaker

The Atom Echo's built-in speaker is 0.5 W — fine for a beep, tinny and quiet for speech. The pattern that works long-term: the Echo is **ears only**, and everything worth hearing (timer alerts, alarms, any component's announcements) plays through `script.announce` on a proper speaker in the room. Once you have that speaker, delete the `speaker: echo_speaker` line inside `voice_assistant:` in the ESPHome file (option B in the comments) and the puck goes listen-only. Until then, option A (replies on the Echo itself) works out of the box.

## Rename these

| Placeholder | What yours will be called |
|---|---|
| `media_player.announce_speaker` | Your main announcement speaker (e.g. `media_player.kitchen_nest_mini`) |
| `tts.home_assistant_cloud` | Your TTS entity — keep for HA Cloud, or `tts.piper` for local |
| `sensor.your_phone_phone_state` (commented option) | Your phone's companion-app phone state sensor |
| `person.partner` (commented option) | Your partner's `person` entity |
| `media_player.upstairs_speaker` / `sensor.your_house_zone` (commented option) | Second speaker + whatever presence/zone sensor you trust |
| `voice-satellite-1` / `Voice Satellite 1` (ESPHome substitutions) | One per room, e.g. `voice-satellite-kitchen` |
| `timer.voice_timer_1..3`, `input_datetime.voice_alarm_1..3` and their labels/flags | Fine to keep as-is — only rename if they collide with something you already have |

## secrets.yaml keys needed

In the **ESPHome add-on's** `secrets.yaml` (`/config/esphome/secrets.yaml`):

| Key | What it is |
|---|---|
| `wifi_ssid` | Your 2.4 GHz wifi network name |
| `wifi_password` | Its password |
| `fallback_ap_password` | Password for the satellite's recovery hotspot |
| `voice_satellite_1_api_key` (optional) | Per-device API encryption key, if you manage keys by hand |

The HA-side package file needs no secrets.

## Gotchas

Hard-won production lessons — read these before blaming the hardware.

- **Area assignment is the whole ballgame.** Assist resolves "turn on the lights" using the *satellite's* area as the spoken-from room, and finds "the kitchen lights" via the *target entity's* area. Both must be right: put each satellite device in its room, and check that every light/switch you voice-control has an area (via its device, or set directly on the entity). Orphan or wrong areas are the number-one cause of "no device found" and — worse — commands landing in the wrong room.

- **Multi-word entity names break intent parsing.** The built-in intent matcher greedily tries to read the first word(s) of a name as an area — "Office Table Lamp" makes it hunt for an area called "Office Table" and fail. Fix with short entity names plus **Assist aliases** (entity settings → Voice assistants → Aliases): give the lamp aliases like "desk lamp" and "table lamp" rather than fighting the parser.

- **YAML-defined groups can't hold aliases.** A `light` group defined in YAML (`platform: group`) has no entity-registry entry, so there is nowhere to attach Assist aliases and no UI area assignment. For voice-facing groups ("office lights"), create the group via **Settings → Devices & services → Helpers → Group** instead — helper groups live in the registry and take aliases and areas like any other entity.

- **Far-field STT produces garbage, routinely.** False wakes happen — the wake model hears something wake-word-shaped in TV dialogue — and then STT dutifully transcribes whatever ambient audio follows into nonsense. With the built-in Assist agent this fails safely ("Sorry, I didn't understand"). If you ever swap in an LLM conversation agent, know that it will happily improvise a paragraph in response to transcribed TV audio unless you add a garbled-input guard. Either way: keep satellites at least a metre from TV speakers, and expect the occasional blue flash for nothing.

- **A satellite that seems deaf is usually a connection problem, not a mic problem.** The wake word engine deliberately only starts once the HA API connection is up (see the `on_boot` handler), and the config restarts it on every reconnect — but after an odd sequence of router/HA restarts a puck can still end up wedged. Power-cycling the satellite is the reliable un-wedge; check the ESPHome dashboard shows it online before deeper debugging.

- **Every satellite dropping at once = router problem, not device problem.** ESP32s are 2.4 GHz-only. If the whole fleet goes unavailable simultaneously while phones and laptops (on 5 GHz) stay happy, the router's 2.4 GHz radio has wedged — a known failure mode on consumer routers after long uptimes. Restart the radio (or the router); rebooting the satellites themselves fixes nothing because they have no network to rejoin.

- **Set the volume *before* `tts.speak`.** Smart speakers keep whatever volume was last set by anything. Without the explicit `media_player.volume_set` step, your 07:00 alarm plays at last night's whisper volume, or a mid-afternoon timer plays at party volume. The script does this for you — keep that ordering if you modify it.

- **The timer-label filter is not paranoia.** Labels arriving via voice or automations occasionally come through as literal `unknown`, `unavailable`, or the word "timer" itself — which produces stuttered TTS like "Your timer timer is done." The fire automations filter these before speaking. Keep the filter if you extend the pool.

- **Timers die on restart unless `restore: true`.** By default an HA restart mid-countdown silently discards a running timer — no finish event, no announcement. The pool sets `restore: true` on every slot so a countdown survives a restart and still fires (late finishes are announced on start-up if the deadline passed during the restart).

- **Alarms do not catch up across restarts.** A `time` trigger pointed at an `input_datetime` only fires if HA is running at that moment. If HA was down at 07:00, the 07:00 alarm is simply missed — no retro-fire. Don't hang anything safety-critical off these; that's what the phone's own alarm clock is for.

- **Alarms are one-shot on purpose.** Date + time (not time-only) plus the auto-disarm flag means an alarm fires exactly once and must be deliberately re-armed. The alternative — a time-only trigger that repeats daily — is a trap: it keeps firing at 06:00 weeks after everyone forgot it exists. The label is kept after firing so re-arming a recurring alarm ("meds") is a one-toggle job.

- **`notify.notify` only exists once a notifier does.** Install the HA companion app (or any notify integration) to get phone pushes. Until then the action would error — which is why the automations set `continue_on_error: true` on it and also raise a persistent notification in the HA UI as an always-works fallback.

- **Windows flashing: no spaces in the path.** The ESPHome/PlatformIO toolchain fails on project paths containing whitespace when compiling locally on Windows. If you compile outside the add-on, stage the YAML in a space-free directory (e.g. `C:\esp_flash\`) first.

- **Give the satellites DHCP reservations.** mDNS discovery is the primary mechanism and usually fine, but fixed leases make the ESPHome dashboard and OTA updates reliably find each device, and make "which puck is which" obvious in your router's client list.

- **Silence is a feature.** The less the assistant talks, the more you use it. Keep spoken output for things worth interrupting a room for — timer/alarm alerts, answers to questions — and resist adding a spoken confirmation to every light switch.
