# 06 — Scenes, scene controller & voice scene phrases

## What it does

Four ready-made lighting scenes (Warm Evening / Bright / Movie / Relax) with production-calibrated brightness and colour values, plus three ways to trigger them: a £10 Zigbee 4-button remote, natural-language voice phrases matched entirely locally by HA Assist (zero cloud), and an automatic "cinema mode" that dims the room when someone settles in front of a playing TV.

## Hardware needed

| Item | Rough UK price | Notes |
|---|---|---|
| Sonoff SNZB-01M 4-button scene controller | ~£10 | Zigbee; needs a coordinator + Zigbee2MQTT (or ZHA — see Gotchas) |
| Colour-temp-capable smart bulbs | ~£8–15 each | Any Zigbee/WiFi bulb that does 2200–5000 K |
| RGB-capable bulbs (optional) | ~£10–18 each | Only needed for the Relax scene's deep amber |
| Smart plug for a "dumb" lamp (optional) | ~£10 | Scenes can switch it on/off, nothing more |
| mmWave presence sensor (optional) | ~£25–50 | Only for the cinema auto-scene; PIR works but times out on motionless viewers |

Everything except the bulbs is optional — the scenes themselves need nothing but lights.

## Install

1. Merge the contents of `scenes.yaml` into your `/config/scenes.yaml` (the default HA config already loads it via `scene: !include scenes.yaml`). Don't put scenes in the package — see Gotchas for why.
2. Copy `package/scenes-extras.yaml` into `/config/packages/`.
3. Rename the placeholder entities in both files (table below).
4. Pair the SNZB-01M in Zigbee2MQTT (enable *Permit join*, then hold the controller's pairing button ~5 s) and set its friendly name to exactly `Scene Controller` — or edit the MQTT topics in the package to match whatever name you choose.
5. Restart Home Assistant (first install of a package needs a restart; later edits only need *Developer Tools → YAML → Reload automations* / *Reload scenes*).
6. Test: **Developer Tools → Actions → `scene.turn_on`** for each scene, then press the controller buttons, then type "movie please" into the Assist dialog (top-right voice icon).

## Rename these

| Placeholder | What yours will be called |
|---|---|
| `light.living_room_pendant` | Your main ceiling light (colour-temp capable) |
| `light.living_room_lamp` | A table lamp (RGB + colour-temp for the Relax scene) |
| `light.reading_lamp` | A floor / reading lamp |
| `switch.floor_lamp` | A dumb lamp on a smart plug (delete from scenes if none) |
| `media_player.living_room_tv` | Your TV's media player entity (cinema auto-scene) |
| `binary_sensor.living_room_presence` | Any occupancy sensor in the TV room (optional — see comments) |
| `zigbee2mqtt/Scene Controller/action` | MQTT topic — must match the controller's Z2M friendly name |
| `climate.living_room_trv` | Your room's TRV (only if you uncomment the heating nudge) |

## secrets.yaml keys needed

None. (MQTT credentials live in the MQTT integration, not in this package.)

## Scene design advice

- **Warm Evening — 2200 K, half brightness.** Most bulbs' "warm white" preset is 2700 K, which still reads as *white*. 2200 K — the floor of most colour-temp ranges — is candle-adjacent and is what actually makes a room feel like evening. Brightness 100–150 of 255.
- **Bright — 5000 K, full brightness.** Task lighting for cleaning, finding things, reading small print. 6500 K is available on most bulbs but starts to feel clinical.
- **Movie — one dim warm anchor, everything else off.** Total darkness causes eye strain against a bright screen, and someone always needs to find a drink. One light at brightness 30, 2200 K, is "visible but ignorable".
- **Relax — RGB firelight, below the colour-temp floor.** A deep amber sits *below* 2200 K, so colour temperature can't reach it — `rgb_color: [255, 147, 41]` (classic incandescent) can. Vary the hue slightly per lamp so the room doesn't look flat.
- **Transitions**: scenes snap on instantly by default. `scene.turn_on` accepts `transition:` — the package uses ~1 s on button presses (deliberate but instant-feeling) and 3 s on the auto-scene (ambient, not startling).

## Gotchas

These are the lessons that cost real debugging time — read them before anything misbehaves.

### Scenes

- **The UI scene editor only edits `scenes.yaml`.** Scenes defined inside a package work fine but are invisible to the UI editor forever. Keeping scene definitions in `scenes.yaml` (as this component does) means brightness/colour can be tweaked from the dashboard later. The automations stay in the package; they appear in the UI as read-only, which is expected.
- **There is no "scene off".** A scene is a one-shot application of states, not a mode you enter and leave. To "leave" a scene, apply another scene or turn lights off. (If you need capture-and-restore around a temporary change, that's `scene.create` — a different tool.)
- **Smart plugs in scenes are on/off only.** A `switch.*` entity in a scene can carry `state:` and nothing else. Putting `brightness:` on a switch is silently ignored at best.
- **`rgb_color` needs RGB hardware.** A colour-temp-only bulb included in an `rgb_color` scene will error or ignore the setting. Check the bulb's supported colour modes in Developer Tools → States before adding it to the Relax scene.
- **Prefer `color_temp_kelvin` over the legacy `color_temp`.** The old field is in mireds, which are *inverted* (higher = warmer) — a recurring source of "why did my warm scene come out cold". One caveat: a few group/bulb implementations reject one form or the other with a 400 error on `light.turn_on` calls — if a group call fails mysteriously, try the other field.
- **Smart bulbs need full, clean mains power.** A smart bulb on a phase-cut dimmer (even at "full on") gets a chopped waveform that starves its radio — symptoms are random unavailability and failed pairing. Replace dimmer wall-switches with plain on/off switches on any circuit feeding smart bulbs; dimming is the bulb's job now.

### SNZB-01M scene controller

- **Wire single AND long press to the same action.** The firmware emits distinct `single_button_X` and `long_button_X` payloads, and people long-press by reflex — if only `single` is wired, the device *looks broken* half the time it's used. The package wires both. Double-press (`double_button_X`) is left free: 4 spare slots.
- **The MQTT topic embeds the Z2M friendly name.** Rename the device in Zigbee2MQTT and every automation silently stops matching. Rename the topic strings in the package at the same time.
- **Debug presses at the MQTT layer, not in HA.** When a button "does nothing", subscribe to the raw topic and watch what actually arrives:
  ```
  mosquitto_sub -h 127.0.0.1 -u <mqtt_user> -P <mqtt_password> \
                -t "zigbee2mqtt/Scene Controller/action" -v
  ```
  If payloads appear there but the automation doesn't fire, it's a topic/payload mismatch in YAML. If nothing appears, it's a pairing/radio problem — no amount of YAML edits will help.
- **Using ZHA instead of Zigbee2MQTT?** There is no MQTT topic; replace the MQTT triggers with device triggers (Settings → Automations → New → Device → pick the controller) or `event` triggers on `zha_event`. The mapping logic stays identical.

### Voice (HA Assist conversation triggers)

- **This is local and deterministic.** Conversation triggers are matched by HA's built-in sentence matcher *before* any fallback conversation agent — no cloud, no LLM, instant. They work from the typed Assist dialog and any voice pipeline, including a fully local one.
- **Pattern syntax** (worth memorising, it's the whole trick):
  - `[word]` — optional word
  - `(a|b|c)` — required, choose one
  - `[(a|b)]` — optional, choose one
  So `"[set] (cinema|film) [(mode|scene)]"` matches "cinema", "set film mode", "film scene", etc.
- **Cover the singular, plural AND terse forms.** HA's built-in grammar often matches "office lights off" but rejects "office light off" — the matcher tries to parse the first word as an area name and fails. Custom sentence triggers that enumerate `(light|lights|lighting)` catch every natural form, which is exactly what the scene-phrase automation does.
- **Area assignment makes or breaks built-in voice commands.** Outside these custom triggers, HA resolves "turn off the kitchen lights" through the *area* assigned to each entity (or its device). An entity in the wrong area — or no area — is the single most common reason a voice command fails. Also assign an area to the voice satellite device itself: it's used as the "spoken-from" context for commands like "turn off the lights *in here*".
- **Multi-word entity names confuse the built-in matcher.** "Office Table Lamp" gets parsed as area "Office Table" + entity "Lamp" and fails. Fix with entity **aliases** (Settings → entity → Voice assistants → Aliases): add "desk lamp", "office lamp", etc.
- **YAML-defined light groups can't carry aliases.** A `light:` platform group defined in YAML has no entity-registry entry, so the alias editor refuses it. Two fixes: create the group as a Helper (Settings → Devices & Services → Helpers → Light group — registry-backed, alias-capable), or do what this package does and write conversation-trigger automations that map phrases straight to the group. The automation route is also the only way to get *phrases* (whole sentences) rather than just alternative names.
- **Default reply is "Done".** Add a `set_conversation_response` action inside a choose branch for a custom reply, or set it to an empty string for silence.

### Cinema auto-scene

- **The 2-minute hold is load-bearing.** A raw `to: "playing"` trigger dims the room every time someone flicks through the programme guide — and some TVs report "playing" while sitting in their launcher menus. Two stable minutes of TV + presence means someone has actually settled in.
- **The 1-hour re-fire guard respects manual overrides.** If someone turned the lights back up mid-film, they had a reason; the automation must not fight them. The guard template uses `this.attributes.last_triggered` deliberately: the obvious alternative — hardcoding `state_attr('automation.<slug>', 'last_triggered')` — breaks silently when the alias is renamed, because an automation's entity_id is derived from its alias.
- **mmWave beats PIR for viewers.** PIR sensors time out on motionless film-watchers and the lights creep back up mid-climax. mmWave (60 GHz radar) holds presence through stillness. No sensor at all? Delete the presence trigger/condition and let TV state drive it alone — you lose the "TV on but room empty" guard, which is usually acceptable.
- **Keep the master toggle on a dashboard.** `input_boolean.cinema_auto_scene` exists so the behaviour can be paused for ironing/background-telly days without hunting down and disabling the automation itself. It **ships ON** (`initial: true` in the package) so the auto-scene works from day one — the trade-off is that `initial:` re-asserts ON at every restart; delete that line if you'd rather your last manual state survive restarts.
