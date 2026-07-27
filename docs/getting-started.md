# Getting started — from an empty box to a working smart home

This is the path from nothing to a house that quietly does the right thing. By the
end of your first weekend you should have: a controller running Home Assistant,
a Zigbee network with your first few bulbs paired, and one kit component installed
and working. Everything after that is adding components one at a time.

No step here requires programming. It does require reading carefully and copying
files into the right place — that's the whole skill.

---

## 1. Pick a controller

Home Assistant needs a small always-on computer. Two good options:

### Option A — Raspberry Pi 4 or 5 (the easy start)

**~£80–110 all in** (Pi 5 4GB ~£58, official PSU ~£12, case ~£10, storage — see below).

- Officially supported: flash a card, boot, done.
- Sips power (~4W idle) and is silent.
- **Do not run it from a microSD card long-term.** Home Assistant keeps a
  database (the "recorder") that writes constantly, and it eats SD cards —
  the classic failure is a corrupted card six months in. Boot from a USB SSD
  (~£25 for 250GB) or an NVMe HAT from day one.
- Honest limitation: no headroom. When you later want to run other services
  next to Home Assistant (a media server, a network tool), the Pi is full.

### Option B — a used mini-PC running Proxmox (my recommendation)

**~£100–150 used** for an HP ProDesk/EliteDesk-class or Dell OptiPlex-class
machine — look for an 8th-gen-or-newer Intel i5, 8–16GB RAM. Then install
[Proxmox VE](https://www.proxmox.com/) (free) and run Home Assistant OS as a
virtual machine.

- Far more headroom: you can later add containers and VMs alongside Home
  Assistant without touching it.
- Whole-VM snapshots: before any risky upgrade, snapshot the VM; if it goes
  wrong, roll back in seconds.
- Wired Ethernet and a proper SSD make the database side of HA noticeably
  snappier.
- **The honest trade-off**: you are now administering a hypervisor as well as
  Home Assistant. It's one more layer to learn, one more thing to update, and
  when something breaks you first have to work out *which* layer broke. Idle
  power is also higher (~10–15W vs ~4W).

If words like "VM" made your eyes glaze over, take Option A without guilt. A
Home Assistant backup restores cleanly onto different hardware, so you can
migrate to a mini-PC later with an afternoon's work, not a rebuild.

**Whichever you choose:**

- **Check the disk.** Ex-corporate machines sometimes ship with a mechanical
  5400rpm hard drive. Home Assistant's database will make it grind — slow
  history graphs, slow backups, mystery sluggishness that looks like a software
  problem but isn't. Fit an SSD. It is the single best-value upgrade.
- **Connect the controller by Ethernet, not Wi-Fi.** Your smart home should not
  depend on the same radio spectrum it's trying to control devices over.

## 2. Install Home Assistant OS

Use **Home Assistant OS (HAOS)** — the appliance version that manages its own
updates and gives you the add-on store. (You may see "Container" or "Core"
installs discussed online; skip them for now — they trade away the add-on
store for flexibility you don't need yet.)

- **Raspberry Pi**: use [Raspberry Pi Imager](https://www.raspberrypi.com/software/)
  → *Choose OS* → *Other specific-purpose OS* → *Home Assistants and home automation*
  → Home Assistant. Flash, boot, wait ~10 minutes, then browse to
  `http://homeassistant.local:8123`.
- **Proxmox**: install Proxmox from a USB stick first, then create the HAOS VM —
  the community "Proxmox VE Helper Scripts" HAOS script is the widely-used
  route, or import the official qcow2 image by hand. Give it 2 vCPUs, 4GB+ RAM,
  32GB+ disk. When your Zigbee dongle arrives, pass the USB device through to
  the VM (VM → Hardware → Add → USB Device).

Run through onboarding: create your account, set your home location (this
drives sunrise/sunset automations), and pick metric units.

**First thing after onboarding**: Settings → System → Backups → create a full
backup. Get in the habit now — see golden rule 4 below.

## 3. Install the Companion app on your phone

Install the **Home Assistant Companion app** (iOS or Android) and sign in to
your new instance. This isn't just for remote control: signing in is what
creates the `notify.notify` service that every kit component's alerts are
sent through. Without a signed-in phone, those `notify.notify` calls simply
error. Two minutes now, and the alerts work from the very first component
you install.

## 4. Zigbee: dongle, MQTT broker, Zigbee2MQTT

Zigbee is the backbone of this kit — cheap bulbs, plugs, radiator valves and
sensors that talk a local mesh protocol with no cloud and no per-vendor app.

You need:

- **Sonoff ZBDongle-E** (~£20) — the coordinator radio.
- **A USB 2.0 extension cable** (~£3) — not optional; see the gotchas in
  component 01.

Software, in order:

1. Settings → Add-ons → Add-on Store → install **Mosquitto broker** (the MQTT
   message bus), start it, tick *Start on boot* and *Watchdog*.
2. Install the **Zigbee2MQTT** add-on and configure it.

The full setup — dongle firmware note, **radio channel selection** (do this
*before* pairing anything; changing later means re-pairing the lot), pairing
discipline, naming discipline, and the sleepy-device procedures — lives in
[`components/01-zigbee-foundation`](../components/01-zigbee-foundation/README.md).
Go there now, do it properly once, and the rest of the kit builds on it.

## 5. Install HACS

[HACS](https://hacs.xyz/) is the community store for custom cards and
integrations. Several kit components use frontend cards from it (card-mod,
mushroom, apexcharts-card), and the theme component depends on it.

Follow the official install docs at hacs.xyz (the method changes occasionally,
so don't trust third-party tutorials): it's a one-line download into `/config`,
a restart, then *Settings → Devices & Services → Add Integration → HACS* and a
GitHub sign-in dance. GitHub account required (free).

## 6. Wire in this kit

The kit is built on **packages** — each component is one self-contained YAML
file you drop into a folder. To enable that:

1. Get file access to `/config`. Easiest routes: the **Samba share** add-on
   (mount it as a network drive) or the **Studio Code Server** add-on (edit in
   the browser). Either is fine; Studio Code Server also gives you YAML syntax
   checking as you type.
2. Merge this kit's `base/configuration.yaml` settings into your
   `/config/configuration.yaml`. The load-bearing line is:

   ```yaml
   homeassistant:
     packages: !include_dir_named packages
   ```

   **Careful here**: a stock HAOS config *already* contains
   `automation:`, `script:` and `scene:` include lines. Don't paste the
   kit file in wholesale — you'd end up with duplicate keys (the config
   check fails) or two competing automation blocks. Keep your existing
   include lines exactly as they are and add **only** the
   `homeassistant: packages:` block and the `frontend: themes:` line.
   The kit file's `automation ui:` / `script ui:` keys are for fresh
   configs built from the kit file alone.

   If you *are* building a fresh config from the kit file alone, also
   check that `automations.yaml`, `scripts.yaml` and `scenes.yaml` exist
   in `/config` — HAOS onboarding normally creates them for you. If any
   are missing, create each one containing just an empty list: a single
   line reading `[]`.

3. Create the folder: `/config/packages/`
4. Copy `base/secrets.yaml.example` to `/config/secrets.yaml` and fill in the
   values you have so far. Read
   [`docs/secrets-and-git-safety.md`](secrets-and-git-safety.md) — especially
   if you plan to keep your config in git (you should).
5. Validate: Developer Tools → YAML → *Check configuration*. If it's green,
   restart Home Assistant once (Settings → System → Restart) so the packages
   directory is picked up.

From here on you rarely need a full restart — see golden rule 3.

## 7. Install your first component

Pick an easy win:

- [`06-scenes`](../components/06-scenes/README.md) — needs nothing but the
  bulbs you've already paired. Starter scene set plus voice phrases, and a
  4-button controller if you bought one.
- [`02-presence-lighting`](../components/02-presence-lighting/README.md) — one
  mmWave presence sensor plus one light, and a room that greets you. This is
  the component that makes visitors ask how you did it.

The install ritual is the same for every component:

1. Copy `package/<name>.yaml` into `/config/packages/`.
2. Open it and rename the placeholder entity IDs to your real ones — every
   component README has a "Rename these" table.
3. Developer Tools → YAML → *Check configuration*, then reload (automations /
   scripts / template entities are all reloadable without a restart; adding a
   **new** package file needs one restart).
4. Trigger it and watch it work. Settings → Automations → the new automation →
   *Traces* shows you exactly what fired and why — learn to read traces early,
   they are the debugger.

## 8. The golden operational rules

Hard-won. Ignore them and the house will teach them to you the annoying way.

1. **Every entity goes in an Area.** Voice assistants and Home Assistant's
   intent matcher resolve "turn on the kitchen lights" through areas. An
   entity with no area — or a stale one after you move a device between rooms —
   is invisible to voice, or worse, controls the wrong room. When a voice
   command mysteriously fails, *check the area assignment first*; it is the
   single most common cause. This applies to the device entry as well as the
   entity, and to the voice satellite itself (its area is used as "the room
   you're speaking from").

2. **One YAML file per concern.** Never let a single `automations.yaml` grow
   into a thousand-line monolith. This kit's package structure enforces the
   habit: heating in one file, lock logic in another, presence lighting in a
   third. Future-you, debugging at 23:00, will be grateful.

3. **Reload beats restart.** Developer Tools → YAML lets you reload
   automations, scripts, scenes, template entities and most helpers
   individually, in about a second, without taking the house down. A full
   restart is only needed for: new integrations, changes to `configuration.yaml`
   structure (like adding the packages line), recorder/database settings, and
   newly added package files. Restarting drops every automation mid-flight and
   makes sleepy Zigbee devices take minutes to report back in — do it
   deliberately, not habitually.

4. **Take a backup before every upgrade.** Settings → System → Backups →
   full backup, *before* any Home Assistant core/OS update, and before any
   big config change. On Proxmox, snapshot the VM too — it's instant.
   Restoring a backup is easy; downgrading a half-broken upgrade without one
   is a miserable evening. While you're at it: turn on automatic daily
   backups, and periodically copy one off the machine — a backup that lives
   only on the disk that fails is a note to self.

5. **Rename devices before you build on them** — covered properly in
   [`docs/conventions.md`](conventions.md), which is the next thing to read.

---

*Next: [hardware shopping list](hardware-shopping-list.md) ·
[conventions](conventions.md) ·
[secrets & git safety](secrets-and-git-safety.md) ·
[component 01 — Zigbee foundation](../components/01-zigbee-foundation/README.md)*
