# 01 — Zigbee foundation

## What it does

Sets up Zigbee2MQTT (Z2M) properly — dongle, MQTT broker, radio channel, and
the pairing/naming discipline that every other Zigbee component in this kit
builds on. Ships a small package: a "pairing mode" toggle that opens the
network deliberately (with keep-alive and a 15-minute auto-close) plus a
notification when a new device joins. Get this component right once and the
rest of the Zigbee tiers are just shopping.

## Hardware needed

| Item | Rough UK price |
|---|---|
| Sonoff ZBDongle-E (EFR32MG21) | ~£20 |
| USB 2.0 extension cable, ~1m | ~£3 |

**Firmware note**: the ZBDongle-E ships with EmberZNet coordinator firmware
and works with Z2M's `ember` driver out of the box — no reflashing needed.
Only ever reflash if the official Z2M docs for your Z2M version tell you to.
(The "-P" sibling dongle is a different chip with different firmware; this kit
assumes the **-E**.)

**The extension cable is not optional.** USB 3 ports and SSD enclosures spray
RF noise across exactly the 2.4GHz band Zigbee lives in. A coordinator plugged
directly into the back of the machine gives you a weak, flaky mesh and weeks
of chasing phantom problems. One metre of cable, dongle away from the machine
(and not resting on the Wi-Fi router either): problem never exists.

## Install

1. **Mosquitto**: Settings → Add-ons → Add-on Store → *Mosquitto broker* →
   Install → Start, with *Start on boot* + *Watchdog* on. Then Settings →
   Devices & Services → the discovered MQTT integration → Configure → accept.
2. **Plug in the dongle** (on its extension cable). On Proxmox, pass the USB
   device through to the HAOS VM first (VM → Hardware → Add → USB Device).
3. **Zigbee2MQTT add-on**: Add-on Store → ⋮ → Repositories → add
   `https://github.com/zigbee2mqtt/hassio-zigbee2mqtt` → install *Zigbee2MQTT*.
4. In the add-on Configuration tab, set the serial port. Find the stable path
   under Settings → System → Hardware → All Hardware (use the
   `/dev/serial/by-id/...` form, which survives reboots; raw `/dev/ttyUSB0`
   style paths can shuffle).
5. **Pick your Zigbee channel BEFORE pairing anything** — see the next
   section. It lives in Z2M's own configuration, not the add-on options:
   either Z2M frontend → Settings → Settings → Advanced → *channel*, or in
   Z2M's `configuration.yaml` under `advanced:` → `channel: <n>`. Set it
   before the first device pairs, not after the fact.
6. In Z2M's own config, confirm `permit_join: false` — the network stays
   closed; this package's toggle is how you open it.
7. Start the add-on, check its log for a clean start, open the Z2M sidebar
   panel.
8. Copy `package/zigbee-foundation.yaml` into `/config/packages/`, check
   config, restart once (first package file needs a restart; after that,
   reloads suffice).
9. Pair your first device: flip **Zigbee pairing mode** on (it's a toggle
   entity — put it on a dashboard), wake the device (usually hold its button
   5s), watch it appear in the Z2M frontend, **rename it immediately**
   (below), toggle pairing mode off.

> **About the "Device paired" phone notification**: it's a bonus, not the
> record. The paired device *always* appears in the Z2M frontend regardless —
> that's what to watch during pairing. The notification needs the Companion
> app installed and signed in (see [docs/getting-started.md](../../docs/getting-started.md),
> which covers setting it up); until then the notify action is skipped
> harmlessly (`continue_on_error` in the package).

## Choosing the radio channel (do this first, it's a one-way door)

Zigbee and 2.4GHz Wi-Fi share the same spectrum. If they overlap, both limp —
and battery devices suffer most. Zigbee channels that dodge the standard Wi-Fi
channels:

| Your 2.4GHz Wi-Fi channel | Pick Zigbee channel |
|---|---|
| 1 | 20, 25 or 26 |
| 6 | 11, 15 or 26 |
| 11 | 11 or 15 |

Two rules that make the table work:

- **Fix your router's 2.4GHz channel** (1, 6 or 11) instead of leaving it on
  "auto" — an auto-hopping router will eventually hop onto your Zigbee
  channel, and you'll get a week of mystery dropouts months from now.
- **Changing the Zigbee channel later means re-pairing pain.** Z2M can migrate
  channels in place, but sleepy battery devices miss the memo and each needs a
  manual wake or re-pair. Ten minutes of thought now beats an evening on a
  stepladder later.

Channel 26 is quietest but a few devices have weak transmit power there; 25 is
the pragmatic "away from everything" pick if your Wi-Fi sits on channel 1.

## Pairing discipline

- **Network closed by default; open it on purpose.** The package's toggle
  opens the network, re-arms the join window every 4 minutes (Z2M caps a
  single request at 254 seconds — long enough to miss a sleepy device
  waking), and slams the door after 15 minutes if you forget. An open Zigbee
  network accepts *any* join request, including the neighbour's new bulbs.
- **Under the hood (Z2M 2.x API)**: the package publishes to
  `zigbee2mqtt/bridge/request/permit_join` with payload `{"time": 254}` to
  open the window, and `{"time": 0}` to close it early — that zero is the
  official "shut it now" form. (Z2M 1.x used a `"value"` field; that API is
  gone, and a `"value"`-style close on current Z2M silently does nothing,
  leaving the network open until the window expires on its own.)
- **Pair devices in their final location**, not next to the coordinator. The
  device joins via the best route it can hear *from where it is*; pairing on
  your desk then moving it to the far bathroom starts its life on a route
  that no longer exists.
- **Pair mains-powered devices first.** Bulbs and plugs are routers — they
  carry traffic for everything else. Build the skeleton of the mesh before
  adding battery devices, and the battery devices will find strong routes.
- **One device at a time** for anything fiddly. Bulk-pairing a bag of
  identical bulbs is fine; bulk-pairing TRVs is how you end up unsure which
  radiator is which.

## Friendly-name discipline (the five minutes that saves hours)

A freshly-joined device arrives named after its IEEE radio address — a long
hex string — and Home Assistant mints entity IDs from whatever name exists
**at creation time**. Entities created before you rename keep those
address-based IDs forever, and an address-based ID is device-bound: replace
the physical device and every automation referencing it breaks.

So: **rename in Z2M immediately after pairing, before touching anything
else.** Z2M frontend → the device → rename → tick *"update Home Assistant
entity ID"*. Use the `<room> <thing>` pattern (`Kitchen Pendant`,
`Bedroom TRV`) so entity IDs come out as `light.kitchen_pendant`.

If you slipped and built entities on the address-based IDs: rename the device
in Z2M, then delete the stale entities from HA's entity registry (Settings →
Devices & Services → Entities, search the hex fragment) and let Z2M
re-register clean ones. Do it early — every day you wait, more things
reference the wrong IDs.

## Z2M groups for multi-bulb rooms

When one switch-press should hit three bulbs, make a **Zigbee-level group**
(Z2M frontend → Groups → create, add the bulbs). The group appears in HA as a
single light entity, and commanding it sends **one multicast radio message**
that all bulbs act on simultaneously.

The alternative — an HA-side light group — fans out one command per bulb over
the radio, and you get the "popcorn effect": bulbs switching one after another
a beat apart. Harmless, but it makes an expensive system feel cheap. Z2M
group = one command, one instant. Groups are also handy voice targets: a
group named "Library Lamps" is exactly what "turn on the library lamps"
resolves to.

## Sleepy devices: TRVs, sensors, and the replacement procedure

Battery Zigbee devices sleep hard to save power. They pair reluctantly,
report on their own schedule, and take minutes to reappear after a Z2M
restart. Patience is a config value here.

**Pairing a sleepy device**: open pairing mode, then wake the device and
*keep it awake* (long-press per its manual; some TRVs need the button held
until a symbol blinks). If nothing happens for a minute, wake it again — the
keep-alive in this package holds the window open for you.

**Replacing a device while keeping its identity** (e.g. swapping a broken TRV
for a new one — the goal is the new device inheriting the old entity IDs so
no automation changes):

1. Pair the new device (pairing toggle + wake).
2. In Z2M, rename the **new** device's friendly name to exactly the **old**
   device's name. Two devices can't share a name, so first rename or remove
   the old one.
3. Remove the old device from Z2M — and if it's dead or absent, **force-remove
   it from the network** (Z2M frontend: remove with "force" checked; or MQTT
   topic `zigbee2mqtt/bridge/request/device/remove` with payload
   `{"id": "<old friendly name>", "force": true}`). A non-force remove of an
   unreachable device leaves a ghost that can **re-register itself later** and
   steal the name back.
4. Delete any stale entities from HA's entity registry — both the old
   device's leftovers and any address-based entities the new device created
   before the rename.
5. Restart the Z2M add-on and wait for the new device to report. Sleepy
   devices may need a button-press to wake before they do.

**Failure modes you will eventually meet** (all recoverable, none your fault):

- Interview fails with **"DatabaseEntry does not exist"**: Z2M's device DB got
  a stale entry. Force-remove the *new* device, restart Z2M, pair again from
  scratch. It works the second time.
- **Z2M reverts a fresh device's friendly name on its first restart after the
  rename.** Really. Check the name after the first restart; if it reverted,
  rename again, clean any address-based entities out of the HA registry, and
  restart Z2M a second time. It sticks the second time.
- **`leave_count > 0`** in a device's Z2M health data means the device has
  left the network and needs a re-pair — that's the diagnosis for "sensor
  silently stopped updating days ago".

## Binding basics

Binding is a direct Zigbee link between two devices that works **without Z2M,
HA, or even the coordinator being up** — a wall remote bound to a bulb keeps
working during a server reboot. Configure it in the Z2M frontend: the remote's
device page → *Bind* tab → bind its endpoint to the target bulb **or, better,
to a Z2M group** (multi-bulb, still one multicast).

Use bindings for the one or two controls that must never fail (the bedroom
light you reach for at 3am). Leave everything else to automations — bindings
are invisible to HA logic and easy to forget you configured.

## Rename these

This package's own entities are self-contained (it creates
`input_boolean.zigbee_permit_join` — no placeholders to rename). Two
assumptions to check:

| In the package | Change to |
|---|---|
| `zigbee2mqtt/...` MQTT topics | Your Z2M base topic, if you changed it from the default `zigbee2mqtt` |
| `notify.notify` | Your preferred notify service (e.g. `notify.mobile_app_<your_phone>` for the Companion app, or a Telegram notifier) |

## secrets.yaml keys needed

None. (MQTT credentials are handled add-on-to-add-on; the package itself
holds no secrets.)

## Gotchas

The hard-won list. Every one of these cost somebody an evening.

- **USB 3 murders Zigbee.** The coordinator goes on a USB *2* extension
  cable, away from the machine, its SSDs, and the Wi-Fi router. This is the
  first suspect for "my mesh has always been a bit rubbish".
- **Channel is a one-way door.** Pick the Zigbee channel away from your
  (fixed!) 2.4GHz Wi-Fi channel *before* pairing device one. Migrating later
  strands every sleepy battery device until it's individually woken or
  re-paired.
- **Rename before you build.** Entity IDs are minted from the name at
  creation time; address-based IDs are device-bound and rot the moment
  hardware is replaced. Renaming after automations exist means registry
  surgery.
- **Never leave permit-join permanently on.** It's tempting (no toggle dance
  when a new gadget arrives) and some people run that way for convenience —
  but an always-open network will happily adopt a neighbour's mis-pairing
  devices, and each accidental join is a mystery entity to clean up. The
  toggle costs two taps.
- **Ghost devices re-register.** Removing an unreachable device without
  `force: true` leaves it in the network's memory; weeks later it can pop
  back and reclaim its name. Force-remove anything that can't be woken to
  say goodbye properly.
- **Sleepy devices are late, not lost.** After a Z2M restart, TRVs and
  sensors can take minutes (or a button-press) to report. Don't start
  re-pairing until you've waited — a premature re-pair *creates* the mess it
  was trying to fix.
- **Phase-cut dimmers starve smart bulbs.** A bulb behind a trailing-edge
  dimmer is being under-fed even at "full", and its radio is the first
  casualty: won't pair, or pairs then drops off the mesh. Swap the dimmer for
  a plain on/off switch (COM ← permanent live, L1 ← switched live) and let
  the bulb dim itself. Electrician if in doubt.
- **A wall switch that cuts a smart bulb's power removes a router.** Every
  bulb someone physically switches off is a hole in the mesh until it's
  switched back on. Train the household onto the smart controls, or fit
  smart-bulb-friendly switch covers/relays where habits won't change.
- **Whole-mesh unresponsive? Restart the Z2M add-on first.** Coordinators
  occasionally wedge; a Z2M restart clears it in a minute and the mesh
  recovers on its own. Do that before power-cycling devices, re-pairing, or
  any deeper surgery — and if wedges become a habit, check the USB
  cable/interference gotcha above.
- **HA-side groups popcorn; Z2M groups don't.** If simultaneous switching
  matters (and in one room, it does), the group must live at the Zigbee
  level.
- **Z2M frontend health data is your friend.** Link quality (LQI) per device
  and the network map tell you *why* the far bathroom sensor is flaky
  (answer: it routed through the bulb someone switched off). Look there
  before blaming the device.
