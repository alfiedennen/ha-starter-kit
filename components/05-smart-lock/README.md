# 05 — Smart Lock

## What it does

Production-grade front-door lock automations: a "door left unlocked" warning ladder (5-minute warning → curfew autolock with phone nudge → late-night spoken backup), a low-battery alert tuned for lithium cells, an **opt-in** auto-unlock-when-home convenience policy, and — the crown jewel — a **post-unlock verification** automation that catches the failure mode every smart lock eventually has: the integration says "unlocked", and the bolt never moved.

## Hardware needed

| Item | Rough UK price | Notes |
|---|---|---|
| Smart lock — e.g. Yale Linus L2, Nuki Smart Lock (4th gen), SwitchBot Lock Pro, Aqara U200 | £120–£250 | Prefer a lock that supports **remote locking** (`lock.lock`). All of the above do. |
| Yale Conexis L2-class lock | £130–£180 | Works, but is *remote-unlock-only* — see the unlock-re-arm gotcha below before buying. |
| Door contact sensor (optional, e.g. Aqara/Sonoff Zigbee) | £10–£15 | Not used by this package, but worth having: "locked" and "closed" are different facts. |

Lock-choice advice: the deciding features are (1) remote lock **and** unlock, (2) a local control path (Zigbee/Thread/Matter or BLE via a nearby proxy) rather than cloud-only, and (3) a battery sensor exposed to HA. A distinguishing-operator sensor (who/what locked it — manual press vs auto-relock) is rare but unlocks the best version of the auto-unlock policy.

## Install

1. Copy `package/smart_lock.yaml` into your `/config/packages/` directory.
2. Rename the entities per the table below (search-and-replace in the file).
3. Point `script.lock_announce` at your TTS entity and speaker (one edit, top of the file). No speaker? Replace its sequence with a `notify.notify` call.
4. Make sure `notify.notify` reaches your phone — install the HA companion app, or wire a Telegram/other notifier and swap the service name.
5. Restart Home Assistant (packages need a restart, not just an automation reload, because of the helpers).
6. Test the verification automation **now, on purpose**: engage the lock's manual override (or take its batteries out), tap unlock in HA, and confirm you get the alert within ~10 seconds. If you first meet this automation during a real failure, it's too late to discover a typo.
7. Only then, if you want the convenience policy: read the security notes below and switch on `input_boolean.lock_auto_unlock`.

## Rename these

| Placeholder in the package | What yours will be called |
|---|---|
| `lock.front_door` | Your lock entity |
| `sensor.front_door_battery` | Your lock's battery sensor |
| `sensor.front_door_operator` | Your lock's operator/diagnostic sensor (Yale Conexis L2-class). No equivalent? Read the section-4a comment before removing that condition. |
| `person.you` | Your person entity |
| `media_player.announce_speaker` | The speaker for spoken alerts |
| `tts.home_assistant_cloud` | Your TTS entity (e.g. `tts.piper`) |
| `notify.notify` | Your phone notifier (e.g. `notify.mobile_app_<your_phone>`) |

## secrets.yaml keys needed

None.

## Gotchas

These are the expensive lessons. Read them before trusting the lock.

### Why post-unlock verification is the single most valuable automation here

Smart-lock integrations can accept `lock.unlock`, return success, and **silently do nothing**. The automation's `last_triggered` updates, every config entry reports "loaded", nothing is red anywhere — and the bolt never moves. Documented causes: expired cloud auth, a manual thumb-turn override engaged from inside, lost Bluetooth, a dead battery. Without verification, this failure festers invisibly for weeks and you discover it with someone stood at the door in the rain. The verification automation turns an invisible failure into a 10-second loud one. It deliberately does **not** try to fix anything (a manual override can only be cleared by a human at the door) — it just makes sure the people inside know to go and help.

### 10 seconds, not 5

The verification delay is calibrated, not arbitrary. BLE lock unlock latency runs 4–8 s end-to-end (service call → Bluetooth round-trip → motor cycle → state report-back), and a cold Bluetooth path right after an integration reload hits the top of that range. A 5 s check false-alarms on unlocks that then succeed at 8 s. 5 s is only safe when the presser is physically at the door (best-case radio proximity).

### The auth-expiry trap (cloud-linked BLE locks)

Some vendors (Yale among them) rotate the lock's BLE offline key server-side. The cloud integration is supposed to push refreshes to the BLE integration, but its OAuth refresh token can stall. Symptoms: a Repair in **Settings → Repairs**, both config entries still "loaded", and every remote unlock silently no-oping. Recovery order matters: **reload the cloud config entry first** (fetches a fresh key), *then* the BLE entry (consumes it). If a Repair dialog offers "enter updated key" — that's a trap; you don't have that key, the cloud integration owns it. Worth pairing with an automation that pushes a notification on every new Repairs entry, so this class of failure surfaces the day it happens.

### The unlock-re-arm trick (Yale Conexis L2-class quirk)

On this hardware class, three motor paths behave differently: `lock.lock` is a **silent no-op**, the vendor app's own lock button reports "jammed", but the lock's internal auto-relock timer fires ~35 s after **any** unlock event and locks reliably. So the only remote-lock path is: call `lock.unlock`, and let the lock relock itself. The package implements this behind `input_boolean.lock_use_rearm_trick`. Be honest with yourself about it: **it's flaky in production**. The 90-second fallback phone nudge is the real safety net — treat the trick as best-effort and be prepared to walk to the door. If you haven't bought a lock yet, buy one with real remote locking instead.

The fallback nudge doubles as a detector: if your lock silently ignores `lock.lock`, the nudge is how you find out — the plain path no-ops and 90 s later your phone tells you.

### Auto-unlock is a policy choice — be honest about the trade-off

"If someone is home before curfew, the door should be unlocked" is genuinely pleasant to live with, and genuinely weaker security. Concretely: during that window, anyone can simply open your door; if your presence detection can be spoofed or wobbles, the door follows it; and some UK home-insurance policies require evidence of forced entry for theft claims — an unlocked door can complicate that. Mitigations built into this package: it's **off by default** (conscious opt-in via `input_boolean.lock_auto_unlock`), it's time-boxed to before curfew, and a deliberate manual lock from inside is respected (see next gotcha). If any of that makes you uneasy, leave the boolean off — everything else in the package works without it.

### Manual-lock respect needs an operator sensor

The auto-unlock-when-home automation only fires when the lock reports it relocked *itself* (auto-relock), not when someone pressed the physical lock button. That distinction comes from an operator/diagnostic sensor most locks don't have. If yours doesn't and you remove the condition, understand what you're choosing: **every** lock event while home gets reversed within 30 seconds — including one you did on purpose.

### Presence-based unlocking: prefer WiFi/router presence over GPS, always keep the settle delay

GPS-zone arrival triggers false-fire near the geofence edge — a bad trait in an automation that opens your door. Router/WiFi-based presence with hysteresis is far more trustworthy. Either way, keep the arrival automation's 10 s settle delay and the post-delay re-checks: trackers wobble for a few seconds after reconnecting, and re-checking stops a one-second blip from unlocking the house.

### The 30-second grace on auto-unlock-when-home

The "reopen after auto-relock" trigger waits 30 s in the locked state before acting. That's the leaving-the-house window: presence flips to away within it, the home condition then fails, and the door doesn't reopen behind you as you walk down the path.

### Battery chemistry: 20% is not a suggestion

Most smart locks run lithium primary cells (CR2 / CR123A), which hold near-flat voltage and then fall off a cliff — a reported 20% can mean days of life, not weeks, and cold snaps accelerate the drop. A dead battery is also one of the silent-unlock-failure causes above, so a stale battery quietly degrades two layers of this package at once. Replace on the alert, keep a spare in a drawer.

### Alert bursts collapse by design

The verification automation runs in `mode: restart`: four panicked unlock taps produce **one** alert 10 s after the last tap, not four alerts. If you change the mode, you change that behaviour.

### `initial:` on helpers resets at every restart

The curfew helper uses `initial: "21:00"`, which makes the YAML the source of truth — and means a value changed from the UI quietly reverts at the next HA restart. Change the curfew by editing the package file. This is a general HA behaviour worth knowing: any `input_*` helper with `initial:` set resets on restart.

### "Locked" and "closed" are different facts

This package verifies the *lock*. A door contact sensor (a few pounds, Zigbee) tells you the door is actually *shut* — a lock happily throws its bolt against an open door frame. A physical unlock button by the door (see component 09 for the ESPHome pattern) pairs well with this package: its unlock calls get verified by section 6 like every other caller.
