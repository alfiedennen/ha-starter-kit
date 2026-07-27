# 17 — Broadsheet: replace the frontend entirely

> **The graduation step.** Everything else in this kit works *inside* Home
> Assistant's own frontend — better dashboards, better automations, better
> rails. This component is the other direction entirely: keep HA as the
> engine room and put **your own application** in front of the household.
> It builds on everything, and it needs nothing but a working HA.

## What it is

[**Broadsheet**](https://github.com/alfiedennen/broadsheet) — *"Home
Assistant, rendered as a magazine."* An open-source (MIT) frontend, from the
same house this kit was extracted from, shaped like a publication instead of
a control panel: italic display serif, proper body typography, **pages not
screens, prose not specs**. The landing page isn't a grid of tiles — it's a
composed manifest of the moment: who's home, what the house is doing, what
electricity costs right now, written as sentences.

It adapts to whatever your HA already has — areas, lights, climates, locks,
media players, sensors. There is no `house.yaml` to write before it works:
install, point it at your HA, see your house.

## Why this is the endpoint

Dashboards — even the good ones in this kit — are HA-shaped: you arrange
HA's cards inside HA's chrome, and the household learns to operate software.
Broadsheet flips the relationship. Home Assistant keeps doing what it is
genuinely best at (devices, automations, history, integrations — everything
components 01–14 built), and stops being the thing your family looks at.
The SPA calls everything it needs from HA's WebSocket API and presents the
house on its own terms. That's the trajectory of this whole kit: start with
a £5 sensor and a light that turns itself on, end with a home whose
software feels designed rather than configured.

## What you get

- **The Moment** — the composed front page: presence, weather, energy,
  the house's current state as an editorial manifest, not a sensor dump.
- **Adaptive pages** for lights, heat, doors, media — generated from your
  real entities and areas (component 01's naming discipline pays off here).
- **Curation** — choose what appears and how it reads, without rebuilding.
- **A plugin system** — including `ghost-cloud`, which is the same radar
  time-tube renderer component 16 ships, productized with bundled demo
  data. If you built a radar node for 16, Broadsheet can hang its output
  on the wall of your own app.
- **A Lovelace escape hatch** — an embed block that renders any HA
  dashboard you can't reproduce (card-mod / Mushroom / HACS specials, e.g.
  component 11's wall dashboard) inside a Broadsheet page, chrome-free.

## Honest caveats

- **It's young and in an active early-testing soak.** The author runs it in
  production alongside HA's own frontend, not instead of it — treat it the
  same way while it bakes. Read
  [EARLY-TESTERS.md](https://github.com/alfiedennen/broadsheet/blob/main/docs/EARLY-TESTERS.md)
  before relying on it.
- **HA OS or Supervised only** (it ships as an add-on; no add-on store on
  HA Container/Core installs yet). HA 2024.4+.
- **amd64 is the tested architecture.** The aarch64 (Pi) image is published
  but experimental — reports welcome upstream.

## Install (two minutes)

1. Add the add-on repository in **Settings → Add-ons → Add-on Store → ⋮ →
   Repositories**:

   ```text
   https://github.com/alfiedennen/broadsheet-addon
   ```

2. Find **broadsheet** in the store, click **Install**.
3. Click **Start**, then **Open Web UI**. Your house is already there.

No credentials to paste — as an add-on it authenticates through the
Supervisor. Curation and settings live in the web UI itself.

## Where it fits with this kit

Everything you built keeps working — Broadsheet sits on top of it:

| Kit component | What Broadsheet does with it |
|---|---|
| 01 entity/area discipline | Drives page generation — clean areas = clean pages |
| 02 / 14 presence | Makes The Moment true ("both home, both downstairs") |
| 03 heating, 04 energy | Feed the manifest's numbers and the heat page |
| 06 scenes | Surface as actions in context, not a button wall |
| 11 wall dashboard | Embeddable via the Lovelace escape hatch |
| 13 theme | Same editorial register — the house reads as one design |
| 16 The Long Take | Lives on as the `ghost-cloud` plugin |

Issues → [broadsheet/issues](https://github.com/alfiedennen/broadsheet/issues) ·
conversation → [Discussions](https://github.com/alfiedennen/broadsheet/discussions)
