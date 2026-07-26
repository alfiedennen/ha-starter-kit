# 13 — Warm Studio theme

## What it does

A warm, editorial dark theme for the whole Home Assistant frontend: warm off-black surfaces, parchment text, an amber accent, hairline card borders instead of shadows, and a four-font typography system (Newsreader for body text, Instrument Serif for headlines, IBM Plex Sans for labels and buttons, JetBrains Mono for code). It replaces HA's stock material look on every dashboard, dialog and sidebar — and can optionally become the system-wide default so users and devices that never picked a theme get it automatically.

No hardware needed. No entities referenced — this component is pure look-and-feel.

## Files

| File | Goes to | Purpose |
|---|---|---|
| `themes/warm-studio.yaml` | `/config/themes/warm-studio.yaml` | The theme itself (`warm_studio_dark` flat variant + `warm_studio` modes wrapper) |
| `www/studio-fonts.js` | `/config/www/studio-fonts.js` | Runtime Google Fonts loader (see the privacy note below) |

## Install

1. Copy `themes/warm-studio.yaml` into `/config/themes/` (create the folder if it doesn't exist).
2. Make sure `configuration.yaml` loads the themes folder:

   ```yaml
   frontend:
     themes: !include_dir_merge_named themes
   ```

3. Copy `www/studio-fonts.js` into `/config/www/` (create the folder if it doesn't exist — anything in `www/` is served at `/local/`).
4. Wire the font loader into the frontend, in the same `frontend:` block:

   ```yaml
   frontend:
     themes: !include_dir_merge_named themes
     extra_module_url:
       - /local/studio-fonts.js
   ```

5. Restart Home Assistant (`extra_module_url` is only read at startup — a config reload is not enough for this key).
6. Pick the theme: click your user name (bottom of the sidebar) → **Theme** → `warm_studio_dark`.
7. Iterating on colours later: edit the YAML, then call the **`frontend.reload_themes`** service (Developer Tools → Actions). Theme token changes apply instantly — no restart needed. Only the `extra_module_url` line needs a restart.

### Making it the system default

HA's built-in fallback theme is literally named `default`. The bottom of `warm-studio.yaml` contains a commented block:

```yaml
# default:
#   <<: *studio_dark
```

Uncomment it and reload themes: every user and dashboard that has **not** explicitly chosen a theme now gets the studio palette — including the login screen chrome, dialogs and settings pages. Explicit per-user and per-dashboard `theme:` choices still win.

**Rollback is instant and needs no deploy**: pick any other theme in your user profile, or re-comment the `default:` block and call `frontend.reload_themes`. It's worth keeping your previous theme file in `/config/themes/` untouched so rollback is one profile-toggle away rather than a restore job.

### Per-dashboard / per-view use

A dashboard view can pin the theme regardless of user choice — in the view's YAML (or the visual editor's view settings):

```yaml
theme: warm_studio_dark
```

Use the flat `warm_studio_dark` for this, not the modes wrapper — see Gotchas.

## Rename these

Nothing to rename. The theme references no entities, and both files work as shipped.

## secrets.yaml keys needed

None.

## Design rationale

**Why warm off-black (`#1a1814`) beats pure black.** Pure `#000` with light text produces halation — the text appears to glow and smear, especially on OLED panels — and gives you nowhere to go for elevation: cards on pure black either vanish or need heavy borders. A warm off-black reads like ink on unlit paper, leaves headroom for a one-step-lighter card surface (`#232019`) so hierarchy survives without box-shadows, and the warm cast keeps the amber accent looking intentional rather than stuck-on. The state colours follow the same logic: stock HA neon green/red/amber scream against a warm ground, so they're replaced with sage / gold / rust / grey-blue equivalents that keep the same semantic distance from each other.

**Why hairline borders instead of shadows.** `ha-card-box-shadow: none` plus a 1px warm rule reads as ruled print rather than floating material — and shadow-free cards are measurably cheaper to composite on the low-power tablets that tend to end up running wall dashboards.

**Why tabular numerals matter on dashboards.** Dashboards are full of live-updating numbers (temperatures, watts, percentages). Proportional figures — which serifs like Newsreader default to — have different widths per digit, so `19.8°` → `21.1°` makes the whole line jiggle and re-wrap on every update. Tabular (fixed-width) figures stop the jitter. A theme can't set `font-feature-settings`, so apply it per-card with [card-mod](https://github.com/thomasloven/lovelace-card-mod) wherever numbers live:

```yaml
card_mod:
  style: |
    ha-card { font-feature-settings: "tnum"; }
```

All four fonts in this system ship a `tnum` feature, so the snippet works everywhere.

**Font stack fallbacks.** Every `font-family` in the theme carries a full fallback chain (`Newsreader, "Iowan Old Style", Georgia, serif` and so on). If Google Fonts is unreachable — offline LAN, DNS-level ad-blocker, captive network — the frontend silently uses the nearest system serif/sans/mono. The loader also requests `display=swap`, so text renders immediately in the fallback and swaps when the webfont arrives; there is never a flash of invisible text.

## Privacy note — the font loader phones Google

`studio-fonts.js` injects a stylesheet from `fonts.googleapis.com` / `fonts.gstatic.com`, so **every browser and tablet viewing your HA makes a request to Google on each page load** (Google sees the client IP and user agent). On a purely local installation you may not want that. To self-host instead:

1. Download the four families as woff2 — the [google-webfonts-helper](https://gwfh.mranftl.com/fonts) makes this a two-minute job (pick each family, download the zip).
2. Put the woff2 files in `/config/www/fonts/` and write `/config/www/fonts/studio-fonts.css` with matching `@font-face` rules (google-webfonts-helper generates this CSS for you — set the folder prefix to `/local/fonts/`).
3. In `studio-fonts.js`: delete the two `preconnect` blocks and change `link.href` to `'/local/fonts/studio-fonts.css'`.
4. Restart HA. Fully offline, no third-party requests, identical rendering.

## Gotchas

- **The modes-wrapper trap.** A theme defined with `modes: { dark: …, light: … }` only applies the branch matching the viewing user's light/dark profile setting. A kiosk or wall-tablet account left on the default profile mode will silently render the *light* branch — which, for a dark-only theme with an empty light branch, means no theme at all. That's why this file ships a **flat** `warm_studio_dark` (no modes key, applies unconditionally) and why the `warm_studio` wrapper defines *both* branches as the same dark tokens. Use the flat variant for kiosks; keep the wrapper only for things that must reference a modes theme.
- **`frontend.reload_themes` vs restart.** Colour/token edits: reload the service, instant. `extra_module_url` additions or removals: full HA restart — that key is read once when the frontend index is generated.
- **Aggressive frontend caching.** The companion apps and some browsers cache the frontend hard. If the theme or fonts don't show after install: browser → hard refresh (Ctrl+Shift+R); companion app → close it fully and reopen, or Settings → Companion App → Debugging → *Reset frontend cache*.
- **Naming a theme `default` really does hijack the fallback.** It's the intended mechanism and it's powerful, but months later it can be confusing to find that "no theme selected" doesn't mean stock HA any more. Leave the breadcrumb comment in the YAML, and keep your previous theme file in the themes folder so rollback is a profile toggle, not an archaeology dig.
- **The YAML anchor is the single source of truth.** All variants merge `*studio_dark` with `<<:`. Edit tokens *only* in the anchored block — if you fork a variant by copy-pasting tokens, the variants will drift the first time you tweak a colour. HA resolves anchors at YAML parse time, so this costs nothing at runtime.
- **Third-party card variables are safe to ship.** The `mush-*` (Mushroom) and `fc-*` (calendar) variables do nothing if those cards aren't installed — unknown CSS custom properties are simply never read. They're included so the cards match the instant they're added, rather than landing in stock material blue.
- **Dark text on the accent.** Anywhere the amber accent becomes a filled block (calendar events, buttons), the text on it is set to the dark surface colour, not white — light-on-amber fails contrast; dark-on-amber passes comfortably. Keep that pairing if you re-accent the theme.
- **The font loader is idempotent by design.** It tags its `<link>` with a `data-studio-fonts` attribute and bails if one already exists, because `extra_module_url` scripts can be evaluated more than once per session (service-worker refreshes, cast receivers). Without the guard you'd stack duplicate stylesheet requests.
- **Re-accenting.** To change the signature colour, search-and-replace the amber pair: `#c08a4a` (accent) and `#8a5e2e` (its darker pressed/track shade). They always travel together — replacing only the first leaves mismatched slider tracks and switch trails.
