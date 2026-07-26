# 12 — Guardrails (safety rails + monitoring)

## What it does

Three safety rails in one package: a **protected-entity guard** that instantly reverts any automation, script, or voice agent that switches off a critical plug (your server, router, NAS, aquarium…); a **Repairs monitor** that pushes a notification the moment Home Assistant registers a new Repair issue; and a **low-battery sweep** that sends one daily digest of every battery below your threshold. Together they catch the three ways a smart home quietly hurts you: an automation doing something dumb, an integration failing silently, and a device dying without telling you.

## The philosophy

Your automations *will* eventually do something dumb. Not because you wrote them badly, but because the system grows: an intent matcher greedy-matches "turn off the office plug" against the wrong entity, a new "everything off" scene sweeps up the plug feeding your router, an upgrade changes how a service call behaves. You cannot review your way out of this — you build the rails **before** it matters, while everything still works. A guard automation that never fires costs nothing; the first time it does fire, it pays for the whole kit.

The same goes for monitoring. Home Assistant's Repairs screen is where integrations report that they are broken — and it is a screen nobody visits. A real-world failure mode: a smart-lock integration's cloud OAuth expires, the Repair sits unread for two weeks, and every remote unlock silently does nothing while the integration still shows "loaded". The fix is one automation: push every new Repair to your phone the second it is created.

## Hardware needed

None — this component is pure software. The protected-plug guard assumes you already have *some* smart plug on critical kit (any Zigbee or WiFi plug, ~£10–15, e.g. a Sonoff S60 or an IKEA Tretakt).

> One deliberate choice: put your **router/server on a smart plug at all** only if you want remote power-cycling. If you do, this guard is not optional — it is the price of admission.

## Install

1. Copy `package/guardrails.yaml` into your `/config/packages/` directory (the kit's base config already loads `packages: !include_dir_named packages`).
2. Rename the placeholder entities (table below) to match your devices.
3. Make sure you have at least one working notifier so `notify.notify` resolves (the companion app on your phone is enough; Telegram setup is below).
4. Restart Home Assistant (packages with new helpers need a restart, not just an automation reload).
5. **Test the guard**: create a throwaway automation that calls `switch.turn_off` on your critical plug, run it, and confirm the plug comes back within ~1 second and your phone gets the alert. Delete the throwaway. Then toggle the plug from the dashboard by hand and confirm the guard *doesn't* fire.
6. **Voice-unexpose the protected entity** (see below) — the guard is the second layer, not the first.

## Voice-unexpose: the first layer of protection

The guard reverts an unauthorised turn-off within about a second — **but the power still cuts for that second**, which is enough to kill a running PC, reboot a router, or corrupt a NAS write. So the real fix is making sure voice assistants and conversation agents can never target the entity at all:

1. Go to **Settings → Voice assistants → Expose** tab.
2. Find your critical plug, untick it for every assistant (Assist, Google, Alexa — whichever you use).
3. From then on, Assist replies "Sorry, I couldn't find that" instead of acting, and the guard never needs to fire for voice at all.

The guard remains as insurance against the things you *can't* unexpose your way out of: YAML automations, scripts, scenes and "all off" service calls.

## Telegram notifications in 5 steps

Every component in this kit calls `notify.notify`. The companion app works out of the box, but Telegram is faster, free, and works on every device. Setup:

1. **Create the bot**: message [@BotFather](https://t.me/botfather) on Telegram, send `/newbot`, follow the prompts. You get an API token like `110201543:AAHdqTcv...`.
2. **Get your chat id**: message your new bot first (bots can't message you until you do), then open `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in a browser — your numeric chat id is in the reply under `"chat":{"id":...}`.
3. **Add the secrets** to `/config/secrets.yaml`:
   ```yaml
   telegram_api_key: "110201543:AAHdqTcv..."
   telegram_chat_id: 123456789
   ```
4. **Configure the bot** in `configuration.yaml` (or a package):
   ```yaml
   telegram_bot:
     - platform: polling
       api_key: !secret telegram_api_key
       allowed_chat_ids:
         - !secret telegram_chat_id
   ```
5. **Add the notifier**:
   ```yaml
   notify:
     - platform: telegram
       name: telegram
       chat_id: !secret telegram_chat_id
   ```
   Restart, then test in Developer Tools → Actions with `notify.telegram`. To make it the kit-wide default, either replace `notify.notify` in the packages with `notify.telegram`, or leave `notify.notify` (it dispatches to your configured notify platform).

*Newer Home Assistant versions also offer Telegram setup through the UI (Settings → Devices & Services → Add Integration → Telegram bot) — either path works; the YAML path above keeps the token in `secrets.yaml`.*

## Rename these

| Placeholder | Replace with |
|---|---|
| `switch.critical_plug` | Your protected plug (e.g. `switch.server_plug`, `switch.aquarium_pump`) — appears 3× in the guard automation |
| `notify.notify` | Your real notifier if `notify.notify` doesn't resolve (e.g. `notify.telegram`, `notify.mobile_app_yourphone`) |
| `sensor.example_spare_remote_battery` | Any battery entities you want the sweep to ignore (or leave the example — a non-existent id is harmlessly skipped) |
| `10:00:00` (sweep trigger) | Whatever time of day you want the battery digest |

## secrets.yaml keys needed

None required by the package itself. If you follow the Telegram setup above:

| Key | Value |
|---|---|
| `telegram_api_key` | Bot token from BotFather |
| `telegram_chat_id` | Your numeric Telegram chat id |

## Gotchas

- **`context.parent_id` is the whole trick.** Every state change in HA carries a context. When a human taps a dashboard toggle or presses a physical button, `parent_id` is `None`. When an automation, script, scene, or conversation agent causes the change, `parent_id` points at the causing context. The guard's single condition — `trigger.to_state.context.parent_id is not none` — is what lets manual control through while blocking everything programmatic. Don't "improve" it by listing allowed automations; the null-check is the robust form.
- **The revert is not protection — the ~1s cut still happens.** The guard limits the damage window; it cannot make the plug uninterruptible. Voice-unexpose the entity (above), and never write any automation, script, or template that calls `switch.turn_off` (or `homeassistant.turn_off`, which fans out to every domain) against the protected entity. `homeassistant.turn_off` on a whole area or `entity_id: all` is the classic way to hit it by accident.
- **Intentional programmatic off needs an escape hatch.** If you ever build a graceful-shutdown flow, disable the guard automation in the UI first, do the work, re-enable. If you skip that step the guard will re-power the device seconds after your shutdown flow cuts it — the worst of both worlds.
- **`mode: single` + `max_exceeded: silent` on the guard is deliberate.** If a broken automation retries the turn-off in a loop, you get one clean revert per cycle without the log filling with "already running" warnings.
- **Repairs monitor: filter `action: create` only.** The `repairs_issue_registry_updated` event also fires for `update` and `remove` as issues re-evaluate and resolve — those are pure noise and will train you to ignore the notification. Create-only keeps the signal meaningful.
- **Repairs arrive in bursts** — an HA core upgrade can register several deprecation issues within a second. That's why the monitor runs `mode: queued` with `max: 20`; `mode: single` would silently drop all but the first.
- **A Repair can exist while everything "looks fine".** Integrations with an expired auth token routinely stay `loaded`, keep their entities, and accept service calls that then no-op at the cloud boundary. The Repairs screen is often the *only* place the failure is visible — which is exactly why it needs to come to you.
- **Battery sensors read `unknown`/`unavailable` constantly and legitimately.** Sleepy Zigbee devices report on wake; phone-app sensors sync in batches. The sweep's `is_number` filter plus the `float(101)` fallback ("unparsable = treat as full") stops those states false-positiving as flat batteries. If you copy the template pattern elsewhere, keep both.
- **Build digest strings, not Jinja lists.** HA converts template output back to native types via a literal eval; a device name containing an apostrophe breaks that round-trip and silently turns your "list" into a plain string (whose `count` is its character count). The sweep joins to a newline-separated string inside the template for exactly this reason.
- **Binary battery sensors are inverted logic**: `device_class: battery` on a `binary_sensor` means `on` = *battery low*. The sweep handles both kinds; don't add binary ones to a numeric comparison.
- **Some devices lie about battery.** Cheap sensors sit at 100% for a year then die at 60%; others bounce between two values as voltage sags under load. When a device turns out to be a liar, put it in the `ignore_list` rather than raising the global threshold.
- **Test the guard once a year** (or after big HA upgrades). It's an automation you hope never fires, which means a regression can hide indefinitely. The throwaway-automation test from the install steps takes two minutes.
