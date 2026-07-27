# 15 — Custom wake word training

> **Advanced extension of component 10 (voice satellites).** That component's
> Atom Echo config ships with the stock `okay_nabu` wake word. This one
> replaces it with a wake word you trained yourself. Get component 10 working
> end-to-end with the stock word *first* — you cannot debug a custom model on
> a pipeline you haven't proven.

## Should you even do this?

Honestly: maybe not. The stock on-device wake words (`okay_nabu`,
`hey_jarvis`, `hey_mycroft`) are trained on enormous datasets, tuned by
people who do this for a living, and work well. Training your own is a
half-day project the first time and an ongoing tuning commitment after that.

It is worth it when at least one of these is true:

- **The stock word collides with your household's speech.** A name, a pet, a
  phrase that comes up in normal conversation keeps tripping the stock model
  — or the stock word keeps waking a phone assistant (or vice versa) in the
  same room.
- **You want a named assistant.** "Hey Jeeves, lights off" lands differently
  from a generic wake word — a household genuinely talks to an assistant
  with a name more readily than to a product. This is a soft reason, but it
  is the most common real one.
- **Non-US-English accents misfire.** The stock models are trained
  predominantly on US-English speech. If household members speak English
  with a strong regional or non-native accent and the stock word needs two
  or three attempts, a custom model trained with accent-matched samples
  (see `bundle` mode below) measurably improves recall.

If none of those apply, stop here and enjoy `okay_nabu`. The rest of this
README assumes you've decided it's worth it.

## What it does

Trains a ~60 KB TensorFlow Lite wake-word model in a Google Colab notebook
(~45 minutes on the required GPU), producing two files — `hey_jeeves.tflite`
(the model) and `hey_jeeves.json` (its manifest) — which you drop into your
ESPHome config directory and reference from component 10's satellite YAML.
Detection runs entirely on the ESP32: no audio leaves the device until
*after* the wake word fires.

The running example throughout is **"Hey Jeeves"**. Substitute your own word
everywhere you see it.

## What you need

| Item | Notes |
|---|---|
| A working component 10 satellite | Proven with the stock wake word first |
| A Google account + Colab **Pro** | The training run needs an **A100 GPU + High-RAM runtime** — that combination is effectively a paid-tier feature. One month of Colab Pro (~£10) covers many training runs; cancel after. |
| ~1 hour, mostly waiting | ~45 min training + deploy time |
| (optional, `bundle` mode) a phone voice-memo app | For recording real samples of your household saying the word |

No new hardware. No new HA package — this component is a model swap inside
component 10's ESPHome config.

## The recommended tool

Use the community trainer at
**<https://github.com/alfiedennen/microwakeword-trainer>** — a
Colab-notebook wrapper around the underlying
[kahrendt/microWakeWord](https://github.com/kahrendt/microWakeWord)
framework with the known Colab failure modes (module-path breakage, kernel
restart traps, TensorFlow API drift, OOM-prone defaults) already patched.
The official upstream notebook is where the science lives; the wrapper is
the one that runs end-to-end with **Runtime → Run all** and no babysitting.

## Choosing the word itself

Ten minutes here saves weeks of tuning:

- **Three-plus syllables, distinct phonemes.** "Hey Jeeves" works because
  "Jeeves" contains an unusual consonant cluster. Short or phonetically
  common words ("Hey Sam") sit too close to everyday speech and will
  false-fire forever, no matter how you tune.
- **Not a word said in normal conversation.** If the name you pick is also a
  household member's name, every mention of them is a potential wake.
- **Say it out loud twenty times before committing.** If it feels awkward in
  the mouth, nobody will use it, and the whole project is moot.

## Training — the Colab route

1. **Get the IPA pronunciation** of your word. The sample generator needs a
   phonetic string, not spelling:
   ```
   espeak-ng -q --ipa "Hey Jeeves"
   # → hˈeɪ dʒˈivz
   ```
   (`apt install espeak-ng` on Linux/WSL, or use an online IPA reader.) For
   invented or foreign-derived names, hand-write the IPA — the generator
   consumes it verbatim, so if the IPA is right the samples will be too.
2. **Open the trainer notebook in Colab** (link in the repo README).
3. **Runtime → Change runtime type → A100 GPU + High-RAM.** Non-negotiable —
   see Gotchas. If you skip this the run dies late, after you've already
   waited half an hour.
4. **Edit the single config cell**:
   ```python
   WAKE_WORD = "Hey Jeeves"
   OUTPUT_NAME = "hey_jeeves"
   WAKE_WORD_IPA_US = "hˈeɪ dʒˈivz"
   MODE = "generate"
   ```
5. **Curate the confusables list** in the same cell — this is the single
   highest-leverage input you control (see Gotchas). For "Hey Jeeves" you'd
   want phonetic neighbours ("hey Steve", "hey Jeff", "hey cheese"), the
   bare name alone ("Jeeves"), other assistants' wake words (so yours
   doesn't steal them), and generic hey-phrases ("hey there", "hey you").
6. **Runtime → Run all. Walk away ~45 minutes.** The notebook generates
   ~30,000 positive samples, augments them against noise datasets, trains,
   validates, and exports.
7. **Collect the outputs from your Drive folder**: `hey_jeeves.tflite` +
   `hey_jeeves.json`. That pair is the entire deliverable.

### The two modes

| | `generate` (start here) | `bundle` (bring your own samples) |
|---|---|---|
| Positive samples | Piper TTS synthesises ~30k inside Colab from your IPA string | You build a zip locally: TTS samples, **real recordings of your household**, hand-curated confusables |
| Effort | Config cell only | An evening of sample prep |
| Accent coverage | US-English synthetic voices only | Whatever you put in — accent-matched TTS voices, real mic audio |
| When | First model, common English words | v2 iteration, accent problems, or when `generate` plateaus |

The `bundle` path is documented in the trainer repo. The headline: **real
recordings beat synthetic roughly 10:1 for the people who actually live in
the house.** Even 50–100 real samples — one long voice memo of someone
saying the word repeatedly, sliced by the repo's helper script — noticeably
shifts recall for that speaker. If anyone in the household has an accent the
first model struggles with, this is the fix.

## Deployment into component 10

1. **Put the model files in your ESPHome config directory**, in a
   per-model folder:
   ```
   /config/esphome/wakewords/hey_jeeves/hey_jeeves.tflite
   /config/esphome/wakewords/hey_jeeves/hey_jeeves.json
   ```
   (That's the ESPHome add-on's directory — the same place as its
   `secrets.yaml`.)
2. **Edit the manifest before first flash.** The `.json` carries the
   detection parameters the device will actually use, and **the as-trained
   values are a starting point, not the answer** — see the first gotcha.
   Recommended first-deploy values: `probability_cutoff: 0.85`,
   `sliding_window_size: 5`, `tensor_arena_size: 50000`.
3. **Swap the model reference** in `voice-satellite.yaml` — see
   [`esphome/custom-wake-word.yaml`](esphome/custom-wake-word.yaml) for the
   exact block and the reasoning comments.
4. **Reflash ONE satellite** (the model is compiled into the firmware, so
   any model or manifest change means a rebuild + flash — OTA is fine).
   Leave the rest of the fleet on the stock word during the trial.
5. **Run the testing battery** (below) on that one satellite for a few days.
6. **Roll out to the fleet** once you're happy — same file edit per
   satellite, OTA each one.

### The testing battery

Wake-word models fail in two opposite directions, and you must test both:

- **Recall** — stand at realistic distances (2 m, 4 m, across the room) and
  say the word ten times at each, at normal volume. Note the hit rate.
  Everyone in the household does this, not just you — models are always best
  for the voice that resembles the training data.
- **False fires** — the adversarial half everyone skips. Put the TV or music
  on **in the same room** at normal volume for an evening and count blue
  flashes. TV dialogue is the single richest source of wake-word-shaped
  audio your house will ever produce. A model that survives film night is
  deployable; one that only survives silence is not.

### The iteration loop

Your first model is v1, and there will be a v2. When the deployed model
false-fires, **write down what was being said** (check what the TV subtitle
was, or what phrase someone had just spoken). Those exact phrases are your
next confusables: add them to the list (or, in `bundle` mode, record/
generate samples of them into the hard-negatives folder) and retrain.
Version the output name (`hey_jeeves_v2`) so the folder tells you what each
puck is running and rollback is a one-line YAML change.

## Rename these

| Placeholder | Change to |
|---|---|
| `Hey Jeeves` / `hey_jeeves` (everywhere) | your wake word and its slug |
| `wakewords/hey_jeeves/hey_jeeves.json` | your model's path under `/config/esphome/` |
| `hˈeɪ dʒˈivz` | your word's IPA string |
| the confusables list | phrases phonetically near **your** word |

## secrets.yaml keys needed

None beyond component 10's. The model files are not secrets — but the
training bundle in `bundle` mode contains recordings of your household's
voices, so treat that zip as private and keep it out of any repo.

## Gotchas

The production lessons. The first one is the whole reason this component
exists as a README rather than a link.

- **The as-trained manifest is a starting point, not the answer.** The
  trainer writes detection parameters into the `.json` that reflect the
  *validation set* — synthetic audio, clean conditions. Real hardware in a
  real room has a different confidence distribution: far-field reverb, a
  tiny PDM microphone, aggressive auto-gain, the fridge. A model whose
  manifest shipped as-trained with `probability_cutoff: 0.5` and
  `tensor_arena_size: 30000` ended up deployed at **`0.85` / window `5` /
  arena `50000`** after real-world tuning — the as-trained cutoff
  false-fired on television constantly, and the as-trained arena wouldn't
  even load on the device. Deploy strict and tune from there:
  1. Start at `probability_cutoff: 0.85`.
  2. Live with it for a full day — normal conversation, TV, music, cooking.
  3. If the wake word needs repeating, **loosen** in steps (0.85 → 0.80 →
     0.75), one step per day.
  4. If it fires on things nobody said, **tighten** (0.85 → 0.92 → 0.95) —
     and log what tripped it for the v2 confusables.
  5. The value you converge on is *yours* — it depends on your rooms, your
     voices, your background noise. There is no universally correct number.

- **A100 + High-RAM is non-negotiable, and the failure is late.** On the
  free-tier T4 runtime, training *appears* to work and then OOMs during
  validation — after ~30 minutes of your life. The notebook can't fix a
  too-small runtime; it can only fail honestly. Set the runtime type before
  Run all, every session (Colab resets it).

- **The pipeline has no audio lookback — the model must fire fast.** When
  the wake word fires, `voice_assistant` starts capturing *from that moment
  forward*; audio from before the fire is gone forever. A model that
  detects late (large sliding window) triggers after you've already started
  the command, so STT receives "…the kitchen lights" and fails with
  `stt-no-text-recognized` — the LED fires, nothing happens. This is why
  `sliding_window_size: 5` is the right value: it's a *latency* setting
  wearing a smoothing-setting's clothes. Resist raising it to fight false
  fires — that's what `probability_cutoff` and confusables are for.

- **`Failed to allocate tensors` in the device log = arena too small.**
  The model loaded from flash but couldn't get working memory. Raise
  `tensor_arena_size` in the manifest (50000, then 80000) and reflash. No
  retraining needed — this is purely a runtime allocation number.

- **The bare name is the number-one confusables gap.** A model trained only
  on "Hey Jeeves" happily fires on "Jeeves" alone — which comes up in
  conversation far more often than the full phrase. Always include the bare
  name in the confusables. Second most common gap: rhyming hey-phrases
  ("hey, please…").

- **Test with the television, not with silence.** A quiet-room test proves
  nothing. TV and music are adversarial input generators running for hours
  a day in the same acoustic space as the satellite — they *will* find your
  model's weaknesses. Better it happens during your one-satellite trial
  than after fleet rollout.

- **OTA usually works; keep a USB-C cable in the drawer anyway.** Model and
  manifest changes are firmware changes — every tuning iteration is a
  rebuild + reflash. OTA over wifi handles this fine *most* of the time,
  but expect the occasional puck to refuse: an upload that times out
  mid-transfer, or a device that's been up for months and wedges during the
  handoff. A USB-C reflash is the reliable fallback, not a sign anything is
  wrong with your model. (Windows note from component 10 still applies:
  compile from a path without spaces.)

- **One puck first, then the fleet.** Trial the custom model on a single
  satellite while the others stay on the stock word. You keep working voice
  control in the rest of the house while the new model proves itself, and
  the comparison ("the kitchen one hears me, the office one doesn't")
  isolates model problems from pipeline problems for free.

- **Two models on one Atom Echo is asking too much.** ESPHome's
  `micro_wake_word` supports listening for multiple models simultaneously,
  and on bigger boards (ESP32-S3 with PSRAM) running your custom word
  alongside `okay_nabu` during a trial is a nice safety net. The base
  Atom Echo has 320 KB of SRAM and no PSRAM — two tensor arenas plus the
  voice pipeline's buffers generally will not fit, failing as allocation
  errors or a boot loop rather than anything self-explanatory. Use the
  one-puck-trial strategy above instead; it achieves the same thing without
  fighting the RAM ceiling.

- **Retrain rather than endlessly tune.** If you're below ~0.75 on the
  cutoff and recall is still poor, the model itself is weak for your
  voices/rooms — no threshold fixes that. Go to `bundle` mode, add real
  recordings from the people it mishears, and train v2. Threshold tuning
  moves the trade-off *along* the curve; better training data moves the
  whole curve.

- **A wake-word model is never "done" — but v2 usually is.** The realistic
  arc: v1 in `generate` mode teaches you the failure modes; v2 with real
  recordings and targeted confusables fixes them; after that, diminishing
  returns. Budget for two training runs and you'll rarely need a third.
