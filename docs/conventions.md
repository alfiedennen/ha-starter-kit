# Conventions — the discipline that keeps a config maintainable

A Home Assistant config starts as three automations and, unattended, becomes a
thousand-line haunted house where renaming one bulb breaks the heating. These
conventions are what keep it from happening. They cost minutes now and save
evenings later.

---

## 1. Packages, one per concern

All configuration for one concern — its automations, scripts, helpers,
template sensors — lives together in one package file:

```
/config/packages/
  zigbee-foundation.yaml
  presence-lighting.yaml
  heating-trv.yaml
  smart-lock.yaml
  ...
```

loaded by one line in `configuration.yaml`:

```yaml
homeassistant:
  packages: !include_dir_named packages
```

Why this beats one big `automations.yaml`: when the heating misbehaves, you
open *one file* and everything relevant is in it. When you retire a component,
you delete *one file* and nothing dangles. And it's what makes this kit
possible — each component is a package you can drop in or pull out.

(Automations you create through the UI still land in `automations.yaml` —
that's fine as a scratchpad. Move anything you intend to keep into the right
package file when convenient.)

## 2. Stable automation `id:` slugs

Every automation gets an explicit, human-readable, **permanent** `id:`:

```yaml
- id: hallway_presence_lights_evening
  alias: "Hallway: presence lights (evening)"
```

The `id` is what Home Assistant uses to track an automation's traces, its
enabled/disabled state, and its identity across reloads. Rules:

- Pick a slug that describes the job, not the implementation
  (`front_door_battery_low_alert`, not `automation_17`).
- **Never change it** once created — you'd orphan its history and its
  enabled/disabled setting.
- **Never reuse** an old id for a new automation — you'd inherit the ghost of
  the old one's state.

Renaming the `alias` (the display name) is always safe; that's what it's for.

## 3. `!secret` everything

Any value you would not read aloud in a pub goes in `/config/secrets.yaml` and
is referenced as `!secret key_name`. That means: passwords, tokens, API keys —
and also your latitude/longitude, Wi-Fi SSID, and any URL containing
credentials. Full discipline (plus git protection) in
[secrets-and-git-safety.md](secrets-and-git-safety.md).

## 4. Naming, areas, aliases

**Rename devices the moment they're paired, before anything references them.**
A freshly-paired Zigbee device arrives named after its radio address; entities
created before you rename it keep ugly device-bound IDs forever (see component
01 for the clean-up procedure). Decide the name at pairing time and everything
downstream inherits it.

Naming pattern that works: `<room>_<thing>` — `light.kitchen_pendant`,
`climate.bedroom_trv`, `binary_sensor.hallway_presence`. Boring and
predictable beats clever.

**Every entity gets an Area** — and check the *device's* area too, since
entities inherit from it. Voice control and Home Assistant's built-in intent
matcher resolve "turn on the office lights" through areas; a missing or stale
area assignment is the number-one cause of "voice suddenly doesn't work for
this device". When you physically move a device between rooms, updating its
area is part of the move.

**Add voice aliases for multi-word names.** The intent matcher parses
sentences area-first, and a multi-word entity name whose first words *look
like* an area name can fail bizarrely — asking for the "Office Table Lamp"
can be parsed as a hunt for an area called "Office Table". Fix: give the
entity short aliases ("desk lamp", "table lamp") via Settings → the entity →
Voice assistants. Aliases are cheap; sprinkle every natural phrasing the
household actually uses.

**Group entities for group phrases.** If "kitchen lights" should mean three
bulbs, make a group entity called exactly that and let voice target the group.
(For Zigbee bulbs, prefer a Zigbee-level group — one radio command, no popcorn
effect; see component 01.) Note that YAML-defined light groups don't have a
registry entry, so they can't carry voice aliases — if a group needs multiple
spoken names, either name it the most-spoken phrase or add small
conversation-trigger automations for the variants.

## 5. An alias layer over integration-generated IDs

Some integrations generate entity IDs you don't control, and re-pairing or
re-adding a device can mint *new* IDs — silently breaking every automation
that referenced the old ones.

Two-layer defence:

1. **First choice**: rename the entity ID itself in the registry (Settings →
   the entity → cog icon) to your stable `<room>_<thing>` name, and re-apply
   the name if you ever re-pair.
2. **For flaky or often-re-paired sources**: wrap the raw entity in a template
   sensor with your stable name, and point all automations at the wrapper:

   ```yaml
   template:
     - sensor:
         - name: "Hallway temperature"
           unique_id: hallway_temperature_stable
           unit_of_measurement: "°C"
           state: "{{ states('sensor.some_integration_generated_id') }}"
   ```

   When the underlying ID changes, you update *one line* instead of hunting
   through every automation, dashboard and script.

## 6. Schedules propose, humans dispose

Every schedule in this kit is a **time-of-day nudge, not a state enforcer**.
The 06:00 automation turns the lights on; the 21:00 automation turns them off;
in between, a human's manual change *wins* — nothing loops in the background
re-asserting what the schedule thinks should be true.

This is a design stance, not an accident. State-enforcer loops ("every 5
minutes, make sure X is on") fight the humans who live in the house, and the
humans always notice. If you find yourself writing one, you usually want
either a manual-override helper (an `input_boolean` the automation checks) or
just the two fire-once edges. Manual control must always win *somewhere*
obvious.

The corollary: schedules should be **self-limiting**. A "turn off at 21:00 if
still on" edge is a polite safety net; it fires once and goes away.

## 7. Guard rails before they're needed

If an entity being wrongly switched would cause real damage — the plug feeding
your computer, a freezer, an aquarium pump — protect it *before* the first
accident, because the first accident is how you'll otherwise discover the
need. An over-eager intent matcher greedily matching "turn everything off",
a bulk scene, or a fat-fingered dashboard tap will eventually reach it.

The pattern (built out fully in component 12):

- **Hide it from voice**: set the entity's *Expose to voice assistants* off.
- **A guard automation**: trigger on the entity turning off; if the change was
  programmatic (an automation/script did it, i.e. the trigger context has a
  parent), turn it straight back on and notify. Direct human taps and physical
  button presses pass through — the guard only blocks robots.
- **A standing rule for yourself**: never write an automation that targets a
  protected entity, and never point a bulk "everything off" at a domain
  without excluding them.

## 8. Dashboard URL slugs MUST contain a hyphen

If you define dashboards in YAML, every key under `lovelace: dashboards:` is a
URL slug — and Home Assistant's validator **rejects single-word slugs**
("Url path needs to contain a hyphen"). The nasty part: this is only checked
during startup, so a bad slug doesn't fail config check — it fails *boot*, and
HA comes up in **recovery mode** (empty sidebar, red banner, integrations not
loaded). Convention: always noun-noun (`wall-tablet`, `cast-display`,
`family-home`). After touching the dashboards block, do a full restart and
confirm HA came up normally — don't just check config and walk away.

## 9. `ha core check` — trust it, but know its blind spots

Always validate before restarting: Developer Tools → YAML → *Check
configuration* (or `ha core check` over SSH). It catches YAML syntax errors,
unknown keys, and malformed platform config — the majority of self-inflicted
wounds.

It does **not** catch:

- the dashboard-slug rule above (only enforced at startup);
- references to entities that don't exist (automations fire and log errors at
  runtime instead);
- template errors that only appear with real state (`unknown`/`unavailable`
  values breaking a `float` filter — always write templates with defaults,
  e.g. `| float(0)`);
- integration/auth problems (an expired token passes config check fine);
- logic errors — it validates grammar, not meaning.

So the full ritual for a non-trivial change is: check config → reload (or
restart) → **watch the logs for a minute** (Settings → System → Logs) →
trigger the changed automation once and read its trace. Two minutes, and
you've actually verified it rather than hoped.
