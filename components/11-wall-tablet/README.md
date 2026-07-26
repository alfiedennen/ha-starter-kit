# 11 — Wall Tablet: kiosk dashboard + battery care

## What it does

Turns a cheap Android tablet into a wall-mounted control panel: a portrait, finger-sized, three-view dashboard (Home / Heat / Lights) built on Mushroom cards with a reusable card-mod "anchor" sizing system, plus a battery-care package that charge-cycles the tablet between 40% and 80% via a smart plug and dims the screen overnight. The battery care is not optional polish — a tablet held at 100% charge 24/7 cooks its lithium cell, and swollen batteries inside wall mounts are a genuine hazard.

## Hardware needed

| Item | Rough UK price | Notes |
|---|---|---|
| Android tablet | £40–£90 used | A used Amazon Fire HD 10 (~£40–60) works well **but see the Fully Kiosk version caveat in Gotchas** — old Fire models run Android 5 and cannot install current Fully Kiosk. A used Samsung Galaxy Tab (e.g. Tab A9, ~£90) runs modern Android, a modern WebView, and has a built-in "Protect battery" mode (see Gotchas) that makes the whole charge-cycle package optional. |
| Smart plug, ideally with power monitoring | £10–£15 | Any HA-supported plug (Zigbee or WiFi). Power monitoring is genuinely useful here: it tells you whether the charger is actually delivering (see Gotchas). |
| Wall mount | £10–£20 | Simple adhesive/screw tablet mounts are fine; leave the USB port reachable. |
| USB charger + long cable | £10 | Get a decent 2A+ charger — weak chargers lose the race against the screen (see Gotchas). |

## Install

1. **HACS frontend dependencies** — in HACS → *Frontend*, search for and download each of:
   - **Mushroom** (`lovelace-mushroom`) — the card set the dashboard is built from
   - **card-mod** — lets the dashboard resize/restyle cards (the anchor system depends on it)
   - **layout-card** — pixel-level grid control for the fixed portrait screen
   - **kiosk-mode** — hides the HA header/sidebar on the tablet

   HACS registers the Lovelace resources automatically. Hard-refresh the browser (Ctrl+F5) after installing.
2. **Dashboard** — copy `dashboard/wall-tablet.yaml` to `/config/dashboards/wall-tablet.yaml`, then register it in `configuration.yaml`:

   ```yaml
   lovelace:
     mode: storage
     dashboards:
       wall-tablet:            # the URL slug — MUST contain a hyphen, see Gotchas
         mode: yaml
         title: Wall Tablet
         icon: mdi:tablet
         show_in_sidebar: true
         filename: dashboards/wall-tablet.yaml
   ```

   Restart HA fully (not just a YAML reload) and confirm it did **not** boot into recovery mode (no warning banner, sidebar intact).
3. **Battery-care package** — copy `package/tablet-care.yaml` to `/config/packages/`. If you're using this kit's base config, packages are already loaded; otherwise make sure `configuration.yaml` contains:

   ```yaml
   homeassistant:
     packages: !include_dir_named packages
   ```

4. **Fully Kiosk on the tablet** — install Fully Kiosk Browser from the Play Store (or sideload on a Fire). In Fully's settings:
   - *Web Content Settings → Start URL*: `http://homeassistant.local:8123/wall-tablet/home?kiosk=true`
   - *Remote Administration → Enable Remote Administration (PLUS)* + set an admin password — the HA integration needs this. Remote admin is a one-off ~£6 PLUS licence per device, worth every penny.
   - *Device Management → Keep Screen On*: enabled.
5. **Fully Kiosk integration in HA** — Settings → Devices & Services → Add Integration → *Fully Kiosk Browser*. Enter the tablet's IP and the remote-admin password. This creates the battery sensor, plugged-in binary sensor and screen-brightness number entity the package uses.
6. **Rename entities** — work through the table below in both files.
7. Reload automations (Developer Tools → YAML → *Automations*) or restart, and check the five automations appear under Settings → Automations.

## Rename these

Placeholders in `dashboard/wall-tablet.yaml`:

| Placeholder | What yours will be called |
|---|---|
| `light.living_room` | Your living-room light or light group |
| `light.kitchen` | Your kitchen light or light group |
| `light.hallway` | Your hallway light or light group |
| `light.bedroom` | Your bedroom light |
| `switch.floor_lamp` | A lamp on a smart plug (delete the card if you haven't one) |
| `climate.living_room` | Your living-room TRV/thermostat |
| `climate.kitchen` | Your kitchen TRV/thermostat |
| `climate.hallway` | Your hallway TRV/thermostat |
| `climate.bedroom` | Your bedroom TRV/thermostat |
| `scene.evening` / `scene.bright` / `scene.relax` / `scene.movie` | Your scenes (Settings → Automations → Scenes; or repoint the tiles at scripts) |
| `sensor.wall_tablet_battery` | Fully Kiosk battery sensor (e.g. `sensor.<tablet_name>_battery`) |
| `binary_sensor.wall_tablet_plugged_in` | Fully Kiosk plugged-in sensor |

Placeholders in `package/tablet-care.yaml`:

| Placeholder | What yours will be called |
|---|---|
| `switch.tablet_charger` | The smart plug feeding the tablet's charger |
| `sensor.wall_tablet_battery` | Fully Kiosk battery sensor |
| `number.wall_tablet_screen_brightness` | Fully Kiosk screen-brightness number entity |

Helpers (`input_number.wall_tablet_*`, `input_datetime.wall_tablet_*`) are created by the package itself — no renaming needed.

## secrets.yaml keys needed

None. The Fully Kiosk admin password is entered in the integration's UI config flow and stored encrypted by HA — keep it out of YAML.

## Gotchas

These are the production lessons — read them before you deviate.

- **Dashboard URL slugs MUST contain a hyphen.** HA's lovelace validator rejects single-word dashboard keys ("Url path needs to contain a hyphen (-)") — and when lovelace setup fails, HA boots into **recovery mode**: empty sidebar, warning banner, all dashboards gone. Worse, `ha core check` does **not** catch it — the per-key slug validation only runs during full setup, so the config "validates" and then the restart breaks the frontend. Always use a hyphenated slug (`wall-tablet`, not `walltablet`), always full-restart after touching the `lovelace: dashboards:` block, and confirm recovery mode is off before walking away.
- **card-mod has two `style:` forms and picking the wrong one silently does nothing.** A plain `style: |` block scalar styles the card root only. To reach anything inside a card's shadow DOM you need the mapping form: `.: |` for the root plus `<element>$: |` entries (the `$` pierces that element's shadow root). Mushroom renders its labels *inside* the shadow DOM, so every rule targeting `.chip`, `.primary` or `.secondary` must use the mapping form — with the scalar form the rules are simply ignored, no error, nothing.
- **Mushroom sizing variables go on the mushroom card host, not `ha-card`.** `--card-primary-font-size`, `--icon-size` and friends must be set on `mushroom-template-card` (the host element) — set on `ha-card` they don't cascade into the component and you'll stare at an unchanged card wondering why.
- **The anchor system is the whole point.** Define each sizing treatment once (`wall_chips`, `wall_hero`, `wall_action`, `wall_climate`, `wall_light`), attach with `*aliases`. When the tablet feels too small/too big you change one anchor, not forty cards — and matched `min-height` between the light and climate anchors is what keeps the two Home columns row-aligned.
- **Chip-width maths before adding nav tabs.** At 2em text a six-letter chip label lands around 230px wide; five chips plus gaps ≈ 1214px, which already overflows a 1200px portrait panel. Keep nav labels short ("Heat", not "Heating") and be sceptical past five tabs.
- **Old Fire tablets have a Fully Kiosk version floor.** Fire HD models up to roughly the 7th generation run Android 5, and current Fully Kiosk releases (v1.60+) won't install there — the last working line is v1.49.x, which still supports remote admin and the HA integration but has an old WebView, so keep the dashboard free of cutting-edge CSS if you go this route. A used tablet with Android 9+ avoids the whole problem.
- **Why charge-cycle at all: 100% float kills the cell.** Lithium cells age fastest held at full charge, permanently, warm — exactly a wall tablet's life. Cycling 40–80% via the smart plug typically fires once or twice a day and multiplies battery lifespan; the failure you're avoiding is a swollen cell pushing the screen out of a wall mount.
- **Samsung "Protect battery" is the zero-effort alternative.** Modern Samsung tablets cap charging at 85% in firmware (Settings → Battery). If your tablet has this (or any vendor equivalent), turn it on, leave the plug always-on, and skip the charge-cycle automations entirely — keep the stale-telemetry and overnight-dim ones, they're still useful.
- **Daytime brightness competes with the charger — and can win.** At high brightness a tablet panel can draw more than a modest USB charger delivers, so the battery drains *while plugged in and "charging"* (a production tablet went 39% → flat in 24 hours this way). The day-brightness default of 120/255 is a power cap, not a taste choice. If battery sags while the plug is on, lower brightness first; a power-monitoring plug makes the diagnosis trivial — watch the wattage climb as you dim.
- **The cycle logic is blind to two failures — hence two safety nets.** (1) If the tablet stops reporting (kiosk app crash, WiFi drop, tablet dead), no numeric trigger ever fires again; the stale-telemetry kick forces the plug on after 30 minutes of silence so a recovering tablet finds power waiting. (2) If the plug is on but the charger/cable has failed, the battery drains with everything looking normal; the sub-10% emergency automation catches that and tells you to check the charger.
- **Staleness = `last_reported`, not `last_updated`.** A healthy battery sensor re-reporting the same percentage bumps only `last_reported` — `last_updated` goes stale on perfectly healthy sensors and will false-alarm your staleness check. Also note the template only re-evaluates because it contains `now()` (HA re-renders those once a minute); without `now()` it would never tick.
- **`initial:` on helpers resets the value on every restart.** As shipped, the package's thresholds/times are YAML-authoritative: edit the file to retune. If you'd rather tune from the UI persistently, delete the `initial:` lines — but then set each helper once after first boot, because they'll start at the slider minimum.
- **Thermostat cards: mode is not action.** HA's native thermostat card labels the hvac *mode* ("heat"), not the hvac *action* ("heating"/"idle") — misleading on heat-only TRVs that idle most of the day. The Mushroom climate card plus `tap → more-info` gives you the dial *and* a truthful heating/idle badge in the popup; inline controls on the glance cards just duplicate it and eat vertical space.
- **kiosk-mode plus `?kiosk=true` is belt-and-braces on purpose.** The `kiosk_mode:` block in the dashboard hides HA chrome, and the URL parameter in Fully's start URL does it again — if the HACS plugin ever fails to load (update, resource glitch), the tablet still doesn't show a sidebar your guests can wander into.
- **Confirmation dialogs on whole-house actions.** Wall tablets collect accidental taps — cleaning, elbows, children. Anything that changes every room (all lights off, all TRVs to frost) gets a `confirmation:` on the tap action. Cheap insurance.
- **Triggers can reference helpers directly.** `numeric_state` accepts an `input_number` entity in `above:`/`below:`, and time triggers accept an `input_datetime` in `at:` — that's what makes the thresholds and dim times tunable without touching the automations.
- **Panel mode + layout-card, not masonry.** A wall tablet is a fixed screen; HA's default masonry view reflows cards unpredictably. `type: panel` with layout-card's explicit grid gives deterministic placement, and `view_layout: { grid-column: 1 / -1 }` is how a card spans the full width.
