# 07 — Daily Rhythms

## What it does

Gives the house a gentle daily rhythm: a room light group that wakes up at
06:00 (unless you're away) and stands down at 21:00, a warm pool of light at
sunset, a bedside lamp that comes on for winding down and fades up like a
sunrise in the morning, a one-phrase "goodnight" macro, an empty-house deep
setback, and a warm welcome when you walk in after dark. It also includes the
voice-toggled-plug pattern — the two-automation trick that gives any dumb
light on a smart plug first-class voice control.

**The philosophy: schedules propose, humans dispose.** Every automation here
is pure time-of-day or a one-shot event. There are no presence loops fighting
you. Turn the lights off at 18:00 and they stay off until tomorrow; turn them
on at 22:00 and they stay on. The house suggests; you always win. This sounds
obvious but it is the single biggest difference between automations a
household loves and automations a household disables.

## Hardware needed

Nothing exotic — this component orchestrates devices you likely install with
other components. Everything below is optional; delete the automations for
hardware you don't have.

| Device | Used by | Rough UK price |
|---|---|---|
| 2+ smart bulbs (colour-temperature capable ideally) | room group, bedside, sunset, welcome | £10–20 each (Innr, Third Reality, IKEA) |
| Smart plug | worktop/dumb-light pattern | £10–15 (Sonoff S60, IKEA) |
| Smart TRVs | goodnight setback, empty-house setback | £25–35 each (e.g. Sonoff TRVZB) |
| Smart lock | goodnight lock check | £150–250 (optional — delete the lock step if none) |
| Phone with HA Companion App | person presence (away-skip, empty-house, welcome) | free |
| A voice assistant pipeline (HA Assist / Voice PE) | voice phrases, goodnight | £0 (Assist on your phone) – £55 (Voice Preview Edition) |

## Install

1. Copy `package/daily_rhythms.yaml` into `/config/packages/` (the kit's base
   `configuration.yaml` already loads that folder).
2. Work through the rename table below — every placeholder entity id needs to
   point at one of *your* entities. Use Developer Tools → States to find your
   real ids. Delete any block for hardware you don't have (e.g. the lock
   check inside the goodnight script, or the TRV steps).
3. Edit the `light:` group at the top to list your actual bulbs, and rename
   the group if "Study" isn't your room (renaming the group changes its
   entity id — update every `light.study_lights` reference in the file to
   match).
4. Adjust the times if 06:00 / 21:00 / 22:00 aren't your household's rhythm —
   they're plain `at:` values on the time triggers.
5. Edit the voice `command:` word lists to the words your household actually
   says (the `(study|office)` and `(work|worktop|bench|...)` alternations).
6. Restart Home Assistant (or Developer Tools → YAML → reload everything
   relevant). Check Settings → Automations — you should see twelve new
   automations and one script.

## Rename these

| Placeholder in the package | What yours will be called |
|---|---|
| `light.study_lamp` | your room's first bulb (member of the group) |
| `light.study_pendant` | your room's second bulb (member of the group) |
| `light.study_lights` | the group itself — auto-derived from the group `name:` |
| `light.living_room_lamps` | your living-space lamp (or lamp group) for the sunset warm-on |
| `light.living_room_pendant` | your main living-room light (welcome palette, goodnight) |
| `light.hallway_lights` | your hallway light/group (welcome palette, goodnight) |
| `light.bedside_lamp` | your bedside bulb |
| `switch.floor_lamp` | any dumb lamp on a smart plug (goodnight/empty-house off-list) |
| `switch.worktop_lights` | the voice-toggled plug (bench/worktop/fairy lights…) |
| `lock.front_door` | your smart lock (or delete the lock step) |
| `climate.living_room_trv`, `climate.kitchen_trv`, `climate.hallway_trv`, `climate.study_trv`, `climate.bathroom_trv`, `climate.bedroom_trv` | your TRVs — used by the goodnight script and the empty-house setback; edit both lists to your real set (bedroom appears only in the empty-house list, deliberately) |
| `person.you` | your own person entity (Settings → People) |
| `person.partner` | second household member (single household: delete their conditions/triggers) |

## secrets.yaml keys needed

None.

## Gotchas

These are the production lessons baked into this package — the reasons it is
shaped the way it is.

- **`color_temp_kelvin`, never `kelvin`, when targeting a light group.** The
  deprecated `kelvin` parameter works on a single light entity, but the HA
  group platform silently rejects it with an HTTP 400 when fanning the call
  out to members — the automation trace reports success and the lights never
  turn on. This exact bug has eaten real scheduled mornings. Always use the
  canonical `color_temp_kelvin`.

- **YAML platform groups have no entity-registry entry.** They can't carry
  Assist voice aliases, can't be renamed from the UI in a way that sticks,
  and can't be assigned an area from the entity settings dialogue. The
  built-in voice intent will match the group's exact friendly name and
  nothing else — "study lamp", "my study lights", "study lighting" all
  bounce with *no valid targets*. Don't fight it with aliases (there's
  nowhere to put them): use conversation-trigger automations, which is
  exactly what the voice-toggled-plug pattern in this package demonstrates.

- **The built-in intent matcher has parsing quirks around room-named
  entities.** Multi-word names can be mis-parsed as `<area> <entity>` — a
  request for the "study table lamp" may fail with "no area called study
  table". Singular vs plural also matters: the grammar may match "study
  lights off" but reject "study light off". Conversation triggers sidestep
  the whole class of problem: your sentence, your target, deterministic.

- **Cover BOTH word orders in every voice command.** "Turn on the worktop
  lights" and "worktop lights on" are different sentences to the matcher.
  Every voice automation in this package carries both patterns; when you add
  your own, copy that habit or half your household's phrasing will bounce.
  Sentence syntax reminder: `[word]` optional, `(a|b)` required choose-one,
  `[(a|b)]` optional choose-one, `light[s]` matches both forms.

- **Fail towards consistency on the away-skip.** The 06:00 turn-on skips only
  when the person tracker *positively* reports `not_home`. If the tracker is
  `unknown`/`unavailable` (phone rebooting, integration down) the lights come
  on anyway. A morning that's occasionally lit while you're away is a minor
  waste; a morning that's randomly dark while you're home feels broken and
  erodes trust in the whole system.

- **The two-step bedside fade is deliberate.** Many bulbs "transition" from
  off by first snapping to their remembered last brightness, which ruins the
  sunrise effect. Pin the start point at 1% explicitly, wait one second for
  the bulb to settle, *then* request the 90-second transition. Skip the pin
  and you get a flash-bang alarm clock.

- **Mixed-capability groups are safe — with the right parameter.** A
  warm-white-only bulb in a group ignores a colour-temperature value outside
  its range but still turns on at the requested brightness. Fanning
  brightness + `color_temp_kelvin` across a mixed group Just Works.

- **The evening-off is a single check, not a loop.** It conditions on the
  group being `on` (idempotent, no-op otherwise) and fires exactly once. That
  one design choice is what makes "manual wins" true: turn the lights back on
  at 21:05 and nothing fights you.

- **Debounce arrivals: require a real absence before welcoming.** Phone GPS
  flickers — a phone on the sofa can briefly report `not_home`. The welcome
  palette requires more than 2 hours in the away state before treating an
  arrival as a return, which filters flicker without delaying a genuine
  welcome. The empty-house setback uses the same logic in the other
  direction: a 2-hour dwell means popping to the shops never freezes the
  house.

- **The welcome is a moment, not a state.** The bright hallway welcome
  auto-reverts after 5 minutes. Without the revert, the automation ends up
  overriding scenes and manual choices made once you're in and settled —
  the "helpful" automation becomes the annoying one.

- **5°C is frost protection, not "off".** Heat-only TRVs have no useful off
  state. Setting 5°C keeps the valve managed and the pipes safe in a cold
  snap while being effectively off the rest of the time. Both setbacks (and
  the goodnight macro) use it.

- **Goodnight excludes the bedroom TRV; empty-house includes it.** You're
  about to sleep in the bedroom in one case and not in the other. Small
  asymmetries like this are what make automations feel considered rather
  than blunt.

- **Some smart locks no-op on remote `lock.lock`.** The command is accepted,
  the bolt never moves — but the same locks often have a reliable internal
  auto-relock timer that arms after *any* unlock event. The workaround (the
  "unlock-re-arm trick"): call `lock.unlock`, and the lock's own timer locks
  it ~35 seconds later. If your goodnight lock check doesn't move the bolt,
  test that path — and consider a verification step that waits ~10 seconds
  after any lock/unlock command and checks the state actually changed
  (Bluetooth locks routinely take 4–8 seconds end-to-end, so don't check too
  early or you'll false-alarm).

- **Conversation triggers target entity ids, so renames don't break voice.**
  You can rename a device's friendly name freely; the voice automations keep
  working because they point at the entity id. Corollary: if you *repurpose*
  a plug (heater → worktop lights), you don't have to rename its entity id —
  renaming an entity id can cascade through integrations and dashboards.
  Rename the device, update the automation's word list, leave the slug alone
  if changing it is disruptive.

- **Adding a bulb to the group inherits everything.** New study bulb? Add
  one line to the group's `entities:` list. It's now part of the 06:00
  wake-up, the 21:00 stand-down, the voice phrases, the goodnight macro and
  the empty-house setback. Automations target the group, never individual
  bulbs — keep it that way.

- **Put macros in scripts, trigger them from automations.** The goodnight
  sequence lives in `script.goodnight`; the voice automation just calls it.
  That means a dashboard button, a bedside NFC tag, or a test run from
  Developer Tools all execute the identical sequence — one definition, no
  drift.

- **`mode: single` + `max_exceeded: silent` on event-ish automations.** If a
  welcome palette is mid-sequence (it holds a 5-minute delay) and the second
  person walks in, the second trigger is dropped silently instead of spamming
  the log with warnings. For automations holding delays, always decide what a
  re-trigger should do; the default warning-spam is never what you want.

- **Wire a real notifier when ready.** The empty-house setback uses
  `persistent_notification.create` because it works on a fresh install with
  zero setup. Once you've connected the HA Companion App (or a Telegram
  bot), add a `notify.notify` action alongside it so the "house is now in
  setback" note reaches your phone.
