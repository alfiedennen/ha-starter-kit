# 09 — ESPHome smart button

## What it does

A physical push-button that triggers any Home Assistant automation — toggle a light, unlock a door, run a scene — with proper audio feedback at the button itself: an instant local "heard you" chirp the moment you press, then a success or error tune once Home Assistant reports whether the action actually worked. No looking at phones or dashboards to know if it did the thing.

## Hardware needed

| Item | Rough UK price | Notes |
|---|---|---|
| M5StickC Plus2 | ~£15 | The reference build: ESP32, big front button, passive piezo, battery and USB-C all in one tidy case. Nothing to solder. |
| — or — any classic ESP32 dev board | ~£5–8 | Plus a momentary push-button (~£1) and a passive piezo buzzer (~£1–2). Adjust the pin map in the ESPHome YAML. |
| USB-C/micro-USB power supply | ~£5 | The button should be always-on mains-powered; the battery is only a graceful-unplug buffer. |

## Install

1. Copy `esphome/action-button.yaml` into your ESPHome dashboard (add-on or standalone) as a new device.
2. Add the four secrets to **ESPHome's own `secrets.yaml`** (note: this is a separate file from Home Assistant's `secrets.yaml` — it lives in the ESPHome config directory):
   - `wifi_ssid`, `wifi_password`
   - `action_button_api_key` — generate one with the ESPHome dashboard ("Generate" next to the encryption key field) or any 32-byte base64 string
   - `action_button_ota_password` — any password you choose
3. Flash the board over USB the first time (`Install → Plug into this computer`). Later updates go over-the-air.
4. In Home Assistant: **Settings → Devices & Services** — the device is auto-discovered by the ESPHome integration. Adopt it, pasting the API key when asked.
5. **Critical, easy to miss**: open the device's ESPHome integration entry → **Configure** → enable **"Allow the device to perform Home Assistant actions"**. Without this the callback beeps silently fail (see Gotchas).
6. Copy `package/action-button.yaml` into `/config/packages/`.
7. Rename the placeholder entities (table below), then reload automations (**Developer tools → YAML → Automations**) or restart HA.
8. Press the button: you should hear the instant chirp, the light should toggle, and then the rising success tune should play.

## Rename these

| Placeholder | What yours will be called |
|---|---|
| `binary_sensor.action_button_press` | Your button's press sensor. Follows the ESPHome device name — if you rename the device from `action-button`, this changes too. |
| `light.hallway_pendant` | Whatever light (or scene, script, cover…) you want the press to control. |
| `esphome.action_button_beep_success` / `esphome.action_button_beep_error` | The callback actions. Also derived from the ESPHome device name — `esphome.<device_name_with_underscores>_beep_success`. |
| `lock.front_door` | (Lock variant only) your lock entity. |
| `media_player.announce_speaker` | (Lock variant only) a speaker near the button for spoken confirmation. |
| `tts.home_assistant_cloud` | Your TTS engine entity — swap for `tts.piper` or whatever you use. |
| `notify.notify` | Your notifier — the HA companion app's `notify.mobile_app_<phone>` or a Telegram bot. |

## secrets.yaml keys needed

In **ESPHome's** `secrets.yaml` (not Home Assistant's):

| Key | What it is |
|---|---|
| `wifi_ssid` | Your WiFi network name |
| `wifi_password` | Your WiFi password |
| `action_button_api_key` | ESPHome native API encryption key (32-byte base64) |
| `action_button_ota_password` | Over-the-air update password (also used for the fallback hotspot) |

The Home Assistant package file needs no secrets.

## Gotchas

- **The callback beeps 403 until you flip one hidden switch.** The ESPHome integration blocks devices from being called back by default: each device has an **"Allow the device to perform Home Assistant actions"** option (device entry → Configure) that defaults **off**. Until you enable it, every `esphome.action_button_beep_*` call fails with a 403 — the press works, the automation runs, but the button never confirms. This is the single most common "it half works" cause with this component.

- **Instant local feedback is not optional polish.** The press-to-action round-trip (button → WiFi → HA → automation → action → callback → WiFi → button) takes anywhere from 200ms to several seconds, and effectively forever during a WiFi hiccup. If the button is silent for even a second, people press it again — and now you have double-fires. The on-device `on_press` chirp fires before any network traffic, so the button always feels alive even when the network isn't. Keep it even if you strip everything else.

- **`mode: single` is the double-fire backstop.** Even with instant local feedback, mashes happen. `mode: single` drops presses that arrive while the automation is still running. For the lock variant use `mode: restart` instead — a burst of panicked presses then collapses into one verification pass after the last press, instead of a stack of queued alerts.

- **GPIO34–39 on classic ESP32 are input-only with NO internal pullups.** The M5StickC Plus2's button is on GPIO37 and the board provides an external pullup, so the config deliberately omits `pullup: true` — ESPHome validation actually rejects it on these pins. On a bare ESP32 with your own button, either add an external pullup resistor, or use any normal input pin (e.g. GPIO25) with `mode: { input: true, pullup: true }` and save yourself a resistor.

- **Keep the ESPHome sensor `name:` short.** HA builds the entity id as device-name + sensor-name. Naming the sensor "Action Button" on a device called "Action Button" yields `binary_sensor.action_button_action_button`. `name: "Press"` gives the clean `binary_sensor.action_button_press`.

- **The power-hold pin matters on battery-equipped boards.** The M5StickC Plus2 has a power latch on GPIO4 that must be driven HIGH or the board shuts down when running off its battery. The config sets it at boot so a brief mains unplug doesn't kill the button. On boards without a power latch it's a harmless no-op — but remove it if your board uses GPIO4 for something else.

- **Passive vs active buzzer.** A passive piezo (what the Plus2 has) needs a PWM waveform to make any sound — that's why the config drives it through LEDC + `rtttl`, which also gets you free melodies from ringtone strings. An active buzzer only needs on/off: use a plain `gpio` switch and pulse it instead, but you lose the distinct success/error tunes, which are the point.

- **For consequential actions, verify state — never trust the service call.** Smart locks in particular (especially Bluetooth ones) can accept `lock.unlock`, report success, and never move the bolt: expired cloud auth, a manual thumb-turn override, lost BT, a dying battery. The commented lock variant waits and then checks the lock's actual state before choosing the success or error beep. Calibrate the wait generously — BLE lock latency runs 4–8 seconds end-to-end and spikes after an integration reload, so a 5-second wait will false-alarm on a perfectly healthy lock. 10 seconds is the tested value. A late success beep beats a false error every time.

- **Announce on a fixed speaker near the button, not a clever presence-routed script.** Whoever pressed the button is standing at the button. If your setup routes announcements to "wherever the phone is", the confirmation for a door unlock can play upstairs while a guest stands at the door hearing nothing.

- **Alert when the button goes offline.** A dead button is a silent failure — you discover it exactly when you need it. The package includes a 30-minute `unavailable` watchdog; 30 minutes is long enough to ignore router reboots, short enough to catch a genuinely dead device the same day.

- **Debounce in firmware, not in HA.** The 30ms `delayed_on` filter kills switch-contact noise at the source. Doing it HA-side (with `for:` on the trigger) adds latency to every legitimate press.

- **`name_add_mac_suffix: false` keeps entity ids stable.** With the MAC suffix on, replacing a failed board renames every entity and quietly breaks the automations pointing at them.
