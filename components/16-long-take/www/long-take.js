// The Long Take — 24 hours of radar-tracked movement in one room, rendered
// as a single continuous translucent "time-tube" you can orbit, scrub and
// replay. A living Muybridge strip of the room.
//
// Architecture:
//   scene X = TIME (oldest left, newest right)
//   The tube is ONE mesh along X. Its cross-section at each 30-second bin
//   encodes what happened then: quiet bins are slim and smooth; bins with a
//   moving body swell and grow asymmetric lobes. Playback sweeps a cursor
//   along the time axis; the camera dollies with it, and the future part of
//   the tube "grows in" at a fading leading edge.
//
// Rendering:
//   alpha-blended translucent membrane (NOT additive) so the tube reads as a
//   real solid object floating in a void. A custom shader does low-diffuse /
//   tight-specular water shading (Schlick Fresnel, F0 = 0.02), dominated by
//   image-based environment reflection from a procedural room lightprobe,
//   plus animated ripple normals, a faint iridescent rim, and soft ring
//   joints. UnrealBloom + ACES tonemapping on top.
//
// Audio:
//   an ambient drone (detuned sines through an LFO-swept lowpass) plus a
//   pentatonic "water drop" pluck fired as the cursor crosses each active
//   bin — pitch from movement speed, loudness from activity — all through a
//   synthetic convolution reverb. Browsers refuse to auto-start audio, so
//   nothing sounds until the first tap/click (see the toggle wiring below).
//
// Data:
//   fetches ./data/<room>.json (produced by scripts/precompute_radar.py —
//   that file's docstring is the canonical data contract). Room label and
//   window metadata come FROM the JSON — there is no room registry in this
//   file. Pick the room with ?r=<room_slug> in the URL.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

// ─── CONFIG — everything you might reasonably want to tweak ──────────────

// Room slug: taken from the ?r= URL parameter; falls back to this default.
// Must match a JSON file written by scripts/precompute_radar.py into ./data/.
const DEFAULT_ROOM = "living_room";
const ROOM = new URLSearchParams(location.search).get("r") || DEFAULT_ROOM;

// Where the data lives, relative to this page: ./data/<room>.json, with the
// URL built fresh inside load() on every fetch. Freshness is primarily the
// fetch's cache: "no-store" (bypasses the browser HTTP cache); the ?cb=
// token — recomputed per fetch, stepping every 30 s — only helps
// intermediary caches (proxies etc.) that ignore no-store.
const REFRESH_MS = 5 * 60 * 1000;       // re-fetch cadence — match the precompute timer

const TIME_SCALE = 14 / 86400;          // 24 h of data = 14 scene units along X

// Time-tube shape. The activity signal lives in BULGES, not raw radius —
// radius stays in a tight band (quiet → active is only a modest swell) and
// the visual difference comes from circumferential perturbation: smooth
// tube = empty room, lobed tube = movement.
const TUBE_BIN_SEC = 30;                // one ring of the tube per 30 s of history
const TUBE_RADIAL_SEGMENTS = 64;
const TUBE_RADIUS_QUIET = 0.55;
const TUBE_RADIUS_FULL  = 0.90;
const TUBE_SMOOTH_WIN = 5;              // moving-average window over bins
const TUBE_PRESENCE_WEIGHT = 0.35;      // how much "someone was there" contributes
const TUBE_SPEED_WEIGHT    = 0.65;      // how much "they were moving fast" contributes
const TUBE_PEAK_SPEED_MMS  = 1500;      // mm/s that counts as "full speed"

// Asymmetric contour bulges — these CARRY the activity signal.
const BULGE_QUIET_AMP  = 0.02;          // near-smooth when the room is empty
const BULGE_ACTIVE_AMP = 0.75;          // dramatic lobes when someone moves
const BULGE_AXIAL_FREQ = 0.55;
const BULGE_RADIAL_FREQ = 1.0;

// Cursor + fade
const CURSOR_GLOW_RANGE = 0.5;
const PAST_FADE_RANGE = 14.0;           // how far behind the cursor the past stays visible
const LEADING_EDGE_WIDTH = 0.25;        // scene-units of "fading-in" frontier ahead of cursor
const LEADING_EDGE_GLOW = 1.6;

// Idle pulse — quiet stretches of tube breathe very softly so an empty
// night still reads as alive rather than frozen.
const IDLE_PULSE_AMP   = 0.06;
const IDLE_PULSE_SPEED = 0.7;
const IDLE_PULSE_FREQ  = 1.4;

// Auto-playback: how many seconds of history pass per real second.
// 720× ≈ the full 24 h replays in two minutes.
const PLAYBACK_SPEEDUP = 720;

// Audio
const AUDIO_DRONE_GAIN = 0.07;          // ambient hum loudness (0..1)
const AUDIO_NOTE_GAIN  = 0.13;          // per-note peak gain
const AUDIO_REVERB_S   = 4.5;           // reverb tail length in seconds
const AUDIO_NOTES_PER_S_LIMIT = 14;     // throttle so a busy hour doesn't machine-gun

// Camera framing relative to the cursor
const CAM_INITIAL_OFFSET = new THREE.Vector3(-1.0, 0.7, 4.2);

// ─── Boot ────────────────────────────────────────────────────────────────

const root = document.getElementById("root");
const scrubRange = document.getElementById("scrub-range");
const scrubLabel = document.getElementById("scrub-label");
const sRoom = document.getElementById("s-room");
const sN = document.getElementById("s-n");
const sWindow = document.getElementById("s-window");
const scrubEl = document.getElementById("scrub");

const renderer = new THREE.WebGLRenderer({
  antialias: true, alpha: false, powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
root.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000); // pure void

// ─── IBL — image-based lighting from a procedural room environment ──────
// PMREMGenerator turns a scene/HDRI into a pre-filtered mipmapped cubemap
// that the shader can sample for plausible environment reflections. We use
// three.js's built-in RoomEnvironment as the source — a procedural neutral
// indoor lightprobe. Cheap, and no texture asset to ship.
const pmremGen = new THREE.PMREMGenerator(renderer);
pmremGen.compileEquirectangularShader();
const envScene = new RoomEnvironment();
const envRT = pmremGen.fromScene(envScene, 0.04);
const envMap = envRT.texture;
scene.environment = envMap;

const camera = new THREE.PerspectiveCamera(
  46, window.innerWidth / window.innerHeight, 0.05, 200
);
camera.position.copy(CAM_INITIAL_OFFSET);
camera.lookAt(0, 0, 0);

// ─── Post-processing: UnrealBloomPass + ACES tonemap ────────────────────
// Real bloom around the brightest parts of the membrane (specular hot
// spots, leading-edge pulse, iridescent rim). This is what lifts the look
// from "coloured mesh" to "lit object" — the highlights bleed light.
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.40,   // strength — water has soft highlight bloom, not neon glow
  0.55,
  0.55,   // threshold low enough that env-reflection speculars actually bloom
);
composer.addPass(bloomPass);
const outputPass = new OutputPass();
composer.addPass(outputPass);

// ─── OrbitControls — target tracks the cursor along time ────────────────

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.10;
controls.minDistance = 0.5;
controls.maxDistance = 25;
controls.enablePan = false;             // orbit + zoom only
controls.target.set(0, 0, 0);

// Last-applied cursor X — we dolly the camera + target by the delta each frame
let lastDollyX = 0;

// ─── Lighting ────────────────────────────────────────────────────────────
// The custom shader uses these uniform values directly (we don't rely on
// three.js's auto-uniforms because we want full control of the membrane).

const KEY_LIGHT_DIR = new THREE.Vector3(0.35, 0.7, 0.6).normalize();
const FILL_LIGHT_DIR = new THREE.Vector3(-0.4, -0.2, -0.6).normalize();

// ─── Tube shader uniforms ────────────────────────────────────────────────

const tubeUniforms = {
  uCursor:        { value: 0.0 },
  uPastFade:      { value: PAST_FADE_RANGE },
  uGlow:          { value: CURSOR_GLOW_RANGE },
  uTime:          { value: 0.0 },
  uLeadEdge:      { value: LEADING_EDGE_WIDTH },
  uLeadGlow:      { value: LEADING_EDGE_GLOW },
  uKeyLightDir:   { value: KEY_LIGHT_DIR },
  uFillLightDir:  { value: FILL_LIGHT_DIR },
  uEnvMap:        { value: envMap },                        // IBL probe
  // Water palette — the membrane is nearly CLEAR, with the slightest
  // blue-green absorption tint. Most of the colour comes from REFLECTING
  // and TRANSMITTING the environment, not from self-emission.
  uKeyLightColor: { value: new THREE.Color(0xeaf2ff) },
  uFillLightColor:{ value: new THREE.Color(0x2858a0) },
  uAmbient:       { value: new THREE.Color(0x040810) },     // very dim, cool
  uMembraneTint:  { value: new THREE.Color(0xdce8ec) },     // near-white, faintest blue
};

const tubeMat = new THREE.ShaderMaterial({
  transparent: true,
  blending: THREE.NormalBlending,
  // depthWrite: false is the standard for transparent meshes — it fixes the
  // black-square artifacts that appear when looking at the tube face-on.
  // (With depthWrite on + DoubleSide, the back wall can self-occlude
  // bizarrely against discarded fragments near the leading edge.)
  depthWrite: false,
  side: THREE.DoubleSide,
  uniforms: tubeUniforms,

  vertexShader: /* glsl */ `
    attribute float aTime;
    attribute float aSpeed;
    attribute float aActivity;
    uniform float uTime;

    varying float vTime;
    varying float vSpeed;
    varying float vActivity;
    varying vec3 vNormalView;
    varying vec3 vNormalWorld;
    varying vec3 vViewDir;
    varying vec3 vWorldPos;
    varying float vRadialAngle;

    void main() {
      vTime = aTime;
      vSpeed = aSpeed;
      vActivity = aActivity;

      // Idle pulse — quiet sections breathe softly, active sections stay firm.
      float idleness = 1.0 - aActivity;
      float pulse = sin(uTime * ${IDLE_PULSE_SPEED.toFixed(2)} + aTime * ${IDLE_PULSE_FREQ.toFixed(2)}) * ${IDLE_PULSE_AMP.toFixed(3)} * idleness;
      vec3 displaced = position;
      displaced.y += normal.y * pulse;
      displaced.z += normal.z * pulse;

      vec4 worldPos = modelMatrix * vec4(displaced, 1.0);
      vWorldPos = worldPos.xyz;
      vec4 mvP = viewMatrix * worldPos;
      gl_Position = projectionMatrix * mvP;

      vNormalWorld = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
      vNormalView  = normalize(normalMatrix * normal);
      vViewDir     = normalize(cameraPosition - worldPos.xyz);
      vRadialAngle = atan(normal.z, normal.y);
    }
  `,

  fragmentShader: /* glsl */ `
    uniform float uCursor;
    uniform float uPastFade;
    uniform float uGlow;
    uniform float uLeadEdge;
    uniform float uLeadGlow;
    uniform float uTime;
    uniform vec3 uKeyLightDir;
    uniform vec3 uFillLightDir;
    uniform vec3 uKeyLightColor;
    uniform vec3 uFillLightColor;
    uniform vec3 uAmbient;
    uniform vec3 uMembraneTint;
    uniform sampler2D uEnvMap;       // PMREM-generated equirectangular IBL

    varying float vTime;
    varying float vSpeed;
    varying float vActivity;
    varying vec3 vNormalView;
    varying vec3 vNormalWorld;
    varying vec3 vViewDir;
    varying vec3 vWorldPos;
    varying float vRadialAngle;

    // ── Hash + value noise ──────────────────────────────────────────────
    vec3 hash3(vec3 p) {
      p = vec3(dot(p, vec3(127.1, 311.7,  74.7)),
               dot(p, vec3(269.5, 183.3, 246.1)),
               dot(p, vec3(113.5, 271.9, 124.6)));
      return -1.0 + 2.0 * fract(sin(p) * 43758.5453);
    }
    float noise3(vec3 p) {
      vec3 i = floor(p);
      vec3 f = fract(p);
      vec3 u = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(mix(dot(hash3(i), f),
                dot(hash3(i + vec3(1,0,0)), f - vec3(1,0,0)), u.x),
            mix(dot(hash3(i + vec3(0,1,0)), f - vec3(0,1,0)),
                dot(hash3(i + vec3(1,1,0)), f - vec3(1,1,0)), u.x), u.y),
        mix(mix(dot(hash3(i + vec3(0,0,1)), f - vec3(0,0,1)),
                dot(hash3(i + vec3(1,0,1)), f - vec3(1,0,1)), u.x),
            mix(dot(hash3(i + vec3(0,1,1)), f - vec3(0,1,1)),
                dot(hash3(i + vec3(1,1,1)), f - vec3(1,1,1)), u.x), u.y),
        u.z);
    }
    float fbm(vec3 p) {
      float v = 0.0, a = 0.5;
      for (int i = 0; i < 3; i++) {
        v += a * noise3(p);
        p *= 2.07;
        a *= 0.5;
      }
      return v;
    }

    // ── Equirectangular envmap sampling helpers ─────────────────────
    // PMREMGenerator output is an equirectangular texture; sample it by
    // converting a 3D direction to UV.
    vec2 dirToEquirectUV(vec3 dir) {
      vec2 uv;
      uv.x = atan(dir.z, dir.x) * 0.15915494 + 0.5;       // / (2π) + 0.5
      uv.y = asin(clamp(dir.y, -1.0, 1.0)) * 0.31830989 + 0.5; // / π + 0.5
      return uv;
    }
    vec3 sampleEnv(vec3 dir) {
      return texture2D(uEnvMap, dirToEquirectUV(dir)).rgb;
    }

    void main() {
      // ── Time frontier: hide far-future, fade-in leading edge ───────
      // Softer discard: hard cutoff at 1.6× leadEdge instead of 1.0× so
      // triangles spanning the boundary fade out smoothly instead of
      // creating sharp triangle-shaped holes.
      float timeAhead = vTime - uCursor;
      if (timeAhead > uLeadEdge * 1.6) discard;
      float emerge = 1.0 - smoothstep(0.0, uLeadEdge, max(timeAhead, 0.0));

      vec3 N = normalize(vNormalWorld);
      vec3 V = normalize(vViewDir);

      // ── Animated ripple — perturb the normal slightly for a water-
      //    surface feel. Tiny noise-driven bumps travel along the tube. ─
      vec3 rippleSeed = vec3(vWorldPos.x * 3.0 - uTime * 0.4,
                             vRadialAngle * 2.0,
                             vWorldPos.z * 3.0 + uTime * 0.25);
      float rippleX = fbm(rippleSeed) * 0.12;
      float rippleY = fbm(rippleSeed + vec3(7.3, 11.7, 19.1)) * 0.12;
      // Add the ripple offset in the surface tangent plane (approximated
      // by taking arbitrary perpendiculars to N).
      vec3 t1 = normalize(cross(N, vec3(0.0, 1.0, 0.0)));
      vec3 t2 = normalize(cross(N, t1));
      N = normalize(N + t1 * rippleX + t2 * rippleY);

      // ── Schlick Fresnel — water-correct F0 ─────────────────────────
      float NdotV = max(dot(N, V), 0.0);
      float F0 = 0.020;                              // water IOR ~1.33 → F0=0.02
      float fresnel = F0 + (1.0 - F0) * pow(1.0 - NdotV, 5.0);

      // ── Direct lighting: low diffuse, tight specular ───────────────
      // Water has very little diffuse — it's mostly specular + transmission.
      float keyN  = max(dot(N, uKeyLightDir),  0.0);
      float fillN = max(dot(N, uFillLightDir), 0.0);
      vec3 keyHalf = normalize(uKeyLightDir + V);
      float NdotH = max(dot(N, keyHalf), 0.0);
      float roughness = 0.10;
      float a2 = roughness * roughness;
      float denom = (NdotH * NdotH) * (a2 - 1.0) + 1.0;
      float D = a2 / (3.14159 * denom * denom);
      float keySpec = D * fresnel;

      // Diffuse very minimal — water absorbs little, mostly transmits/reflects
      vec3 diffuse = uMembraneTint * (1.0 - fresnel) *
        (uAmbient + uKeyLightColor * keyN * 0.25 + uFillLightColor * fillN * 0.18);
      vec3 lit = diffuse + uKeyLightColor * keySpec * 0.7;

      // ── IBL — water reflects the environment hard ──────────────────
      // This is the dominant colour source. Strong reflection at glancing
      // angles, weaker face-on (mostly transmits there), plus a soft
      // sky/irradiance term.
      vec3 reflVec = reflect(-V, N);
      vec3 envRefl = sampleEnv(reflVec);
      vec3 envIrr  = sampleEnv(N);
      vec3 envTint = vec3(0.62, 0.78, 1.0);                   // cool reflection tint
      lit += envRefl * fresnel * 1.5 * envTint;               // strong reflection
      lit += envIrr * uMembraneTint * 0.28;                   // sky/irradiance

      // ── Subtle iridescent rim ──────────────────────────────────────
      float irisT = pow(1.0 - NdotV, 2.5);
      vec3 irisColor = vec3(0.88, 0.94, 1.0);
      lit += irisColor * fresnel * 0.12;

      // ── Subtle vein noise (soft linear contrast on the surface) ────
      vec3 noiseP = vec3(vWorldPos.x * 0.5, vRadialAngle * 0.9,
                         vWorldPos.y * 0.7 + vWorldPos.z * 0.7);
      float vein = pow(abs(fbm(noiseP)), 0.7);
      float surface = mix(0.86, 1.0, vein);   // narrow contrast band
      lit *= surface;

      // ── Ring joints along the time axis (rare + soft) ──────────────
      float ringPhase = fract(vWorldPos.x * 0.6);
      float ringDark = smoothstep(0.0, 0.06, ringPhase) * smoothstep(1.0, 0.94, ringPhase);
      lit *= mix(0.95, 1.0, ringDark);

      // ── Past distance fade (the far past dims into the void) ───────
      float distPast = max(uCursor - vTime, 0.0);
      float pastNear = 1.0 - smoothstep(0.0, uPastFade, distPast);
      float pastFade = mix(0.5, 1.0, pastNear);
      lit *= pastFade;

      // ── Leading-edge marker — subtle (water doesn't glow) ──────────
      // A faint brightness lift right at the cursor + a slight lift
      // through the emerge zone, NOT a self-emissive halo.
      float dt = abs(uCursor - vTime);
      float halo = exp(-pow(dt / uGlow, 2.0));
      lit += uMembraneTint * halo * 0.10;
      lit *= mix(1.0, mix(uLeadGlow, 1.0, 0.7), (1.0 - emerge) * step(0.0, timeAhead));

      // ── Translucent alpha ──────────────────────────────────────────
      // Thicker at fresnel angles, modulated by emerge + past fade so the
      // far past dissolves into the void and the leading edge crisps in.
      float alpha = mix(0.45, 0.92, fresnel) * pastFade * emerge;

      gl_FragColor = vec4(lit, alpha);
    }
  `,
});

// ─── Audio engine ────────────────────────────────────────────────────────
//
// Architecture:
//   AudioContext
//     ├── master (gain) → destination
//     ├── dryGain (gain) → master
//     ├── reverbGain (gain) → reverb (convolver) → master
//     ├── drone (5 detuned sines + LFO-modulated lowpass) → dry+reverb
//     └── triggerNote() — water-drop pluck (sine + harmonic, fast attack,
//                          exponential decay, downward pitch glide) → dry+reverb
//
// Scheduling: tickPlayback computes the cursor's current time-bin index and
// calls audio.onCursorAdvance(binIdx, peakSpeed, activity). When the bin
// index advances past one with presence, a note fires with pitch driven by
// speed (slow → low, fast → high; A-minor pentatonic across three octaves).
//
// Gesture rule: browsers refuse to auto-start an AudioContext. The first
// user click/tap anywhere triggers init(); until then, silence.

const A_MINOR_PENTATONIC = [
  // A2..G3..A4 — three-octave A-minor pentatonic
  110.00, 130.81, 146.83, 164.81, 196.00,
  220.00, 261.63, 293.66, 329.63, 391.99,
  440.00, 523.25, 587.33, 659.25, 783.99,
];

class LongTakeAudio {
  constructor() {
    this.ready = false;
    this.muted = false;             // user-controlled mute
    this.visibilityMuted = false;   // auto-mute when the iframe is hidden
    this.lastBinFired = -1;
    this.lastNoteAt = 0;
    // Per-room localStorage key — each room's page (?r=<room>) keeps its own
    // user-mute preference, surviving reloads.
    this._lsKey = `long-take:${ROOM}:muted`;
    const saved = localStorage.getItem(this._lsKey);
    if (saved !== null) this.muted = saved === "true";
  }

  async init() {
    if (this.ready) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) {
      console.error("[long-take audio] No AudioContext support in this browser");
      return;
    }
    this.ctx = new Ctx();
    // Some browsers create the context suspended even from a user gesture —
    // explicitly resume.
    if (this.ctx.state === "suspended") {
      try { await this.ctx.resume(); } catch (e) { console.warn("resume failed", e); }
    }

    // Master bus + dry/reverb sends
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(this.ctx.destination);

    this.dryGain = this.ctx.createGain();
    this.dryGain.gain.value = 0.45;
    this.dryGain.connect(this.master);

    // Synthetic reverb impulse — exponential-decay white noise
    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = this._makeReverbBuffer(AUDIO_REVERB_S);
    this.reverbGain = this.ctx.createGain();
    this.reverbGain.gain.value = 0.55;
    this.reverbGain.connect(this.reverb);
    this.reverb.connect(this.master);

    this._startDrone();
    this.ready = true;
    console.log("[long-take audio] AudioContext live");
  }

  _makeReverbBuffer(seconds) {
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const buf = this.ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        // Exponential decay × white noise → cathedral-like tail
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
      }
    }
    return buf;
  }

  _startDrone() {
    // Layered low oscillators, slightly detuned against each other
    const baseFreq = 55; // A1
    const droneFilter = this.ctx.createBiquadFilter();
    droneFilter.type = "lowpass";
    droneFilter.frequency.value = 600;
    droneFilter.Q.value = 0.7;

    // Slow LFO modulating the filter cutoff — an underwater swell
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.05; // ~20 s cycle
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 250;
    lfo.connect(lfoGain);
    lfoGain.connect(droneFilter.frequency);
    lfo.start();

    const droneGain = this.ctx.createGain();
    droneGain.gain.value = AUDIO_DRONE_GAIN;
    droneFilter.connect(droneGain);
    droneGain.connect(this.dryGain);
    droneGain.connect(this.reverbGain);

    const partials = [
      { freq: baseFreq,         detune:  0   },
      { freq: baseFreq,         detune:  4   },  // 4 cents up — beats with the first
      { freq: baseFreq * 2,     detune: -2   },
      { freq: baseFreq * 3,     detune:  3   },
      { freq: baseFreq * 1.5,   detune:  0   },  // perfect fifth (3:2)
    ];
    for (const p of partials) {
      const o = this.ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = p.freq;
      o.detune.value = p.detune;
      o.connect(droneFilter);
      o.start();
    }
  }

  triggerNote(freq, durationS, peakGain) {
    if (!this.ready || this.muted) return;
    const now = this.ctx.currentTime;

    // Water-drop / pluck synth — sharp transient onset (perceptually
    // coincident with the visual perturbation) + short body. A slight
    // downward pitch glide gives the "plonk" character.
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq * 1.35, now);
    osc.frequency.exponentialRampToValueAtTime(freq, now + 0.045);

    // Subtle 2nd-harmonic shimmer at low amplitude, slightly detuned
    const harm = this.ctx.createOscillator();
    harm.type = "sine";
    harm.frequency.setValueAtTime(freq * 2.7, now);
    harm.frequency.exponentialRampToValueAtTime(freq * 2.005, now + 0.06);
    const harmGain = this.ctx.createGain();
    harmGain.gain.value = 0.22;
    harm.connect(harmGain);

    // Ultra-fast attack (2 ms) — perceptually instant — then exponential decay.
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(peakGain, now + 0.002);
    env.gain.exponentialRampToValueAtTime(0.0001, now + durationS);

    osc.connect(env);
    harmGain.connect(env);

    // Dry-heavy keeps the percussive transient legible; a reduced reverb
    // send keeps it from washing out.
    env.connect(this.dryGain);
    const sendGain = this.ctx.createGain();
    sendGain.gain.value = 0.5;
    env.connect(sendGain);
    sendGain.connect(this.reverbGain);

    osc.start(now);
    harm.start(now);
    osc.stop(now + durationS + 0.05);
    harm.stop(now + durationS + 0.05);
  }

  onCursorAdvance(binIdx, peakSpeedMms, activity) {
    if (!this.ready || this.muted) return;
    if (binIdx === this.lastBinFired) return;
    this.lastBinFired = binIdx;

    // Only fire on bins that actually saw a body
    if (activity < 0.05) return;

    // Throttle — never more than N notes per second
    const now = this.ctx.currentTime;
    if (now - this.lastNoteAt < 1 / AUDIO_NOTES_PER_S_LIMIT) return;
    this.lastNoteAt = now;

    // Pitch from speed: fast = high notes
    const speedNorm = Math.min(1, peakSpeedMms / 1500);
    const noteIdx = Math.floor(speedNorm * (A_MINOR_PENTATONIC.length - 1));
    const freq = A_MINOR_PENTATONIC[noteIdx];

    // Volume from activity. Duration short for percussive feel — the
    // reverb tail provides the lingering ambient bed.
    const peak = AUDIO_NOTE_GAIN * (0.5 + activity * 0.7);
    const dur  = 0.6 + (1 - speedNorm) * 0.8;

    this.triggerNote(freq, dur, peak);
  }

  setMuted(m) {
    this.muted = m;
    localStorage.setItem(this._lsKey, m ? "true" : "false");
    this._applyGain();
  }

  // Called by the visibility listeners — silently mutes/unmutes without
  // touching the user's saved preference.
  setVisibilityMuted(m) {
    this.visibilityMuted = m;
    this._applyGain();
  }

  _applyGain() {
    if (!this.master) return;
    const target = (this.muted || this.visibilityMuted) ? 0.0 : 0.7;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.linearRampToValueAtTime(target, now + 0.15);
  }
}

const audio = new LongTakeAudio();

// ─── Audio toggle wiring ─────────────────────────────────────────────────
// Module scripts are deferred — by the time this runs, the DOM is parsed.
// The toggle is the gateway to audio: the first click inits the context
// (satisfying the browser's user-gesture rule); later clicks toggle mute.

function updateAudioToggleUI() {
  const t = document.getElementById("audio-toggle");
  if (!t) return;
  t.classList.remove("waiting", "muted");
  if (!audio.ready) {
    t.classList.add("waiting");
    t.innerHTML = `<span class="dot"></span>TAP TO ENABLE SOUND`;
  } else if (audio.muted) {
    t.classList.add("muted");
    t.innerHTML = `<span class="dot"></span>SOUND OFF`;
  } else {
    t.innerHTML = `<span class="dot"></span>SOUND ON`;
  }
}

(function wireAudioToggle() {
  const t = document.getElementById("audio-toggle");
  if (!t) {
    // Retry on the next tick — DOM may not be parsed yet in some embeds
    setTimeout(wireAudioToggle, 50);
    return;
  }
  updateAudioToggleUI();   // set the initial label
  t.addEventListener("click", async (e) => {
    e.stopPropagation();   // don't bubble to the canvas / scene
    if (!audio.ready) {
      await audio.init();
    } else {
      audio.setMuted(!audio.muted);
    }
    updateAudioToggleUI();
  });
})();

// Convenience: clicking the canvas (3D scene) also satisfies the user
// gesture if audio isn't ready yet — so the user doesn't have to hunt for
// the toggle. After init, canvas clicks do nothing audio-related.
renderer.domElement.addEventListener("click", () => {
  if (!audio.ready) {
    audio.init().then(updateAudioToggleUI);
  }
}, { passive: true });

// ─── Visibility-aware pause + mute ──────────────────────────────────────
// When this page goes hidden (the dashboard switches to a different room
// tab, or the browser tab loses focus), silently mute audio AND stop
// rendering. When it becomes visible again, both resume from where they
// were. Switching between room tabs therefore never leaves ghost audio
// playing from a room you've left, and hidden tabs cost zero GPU.
//
// The Page Visibility API fires `visibilitychange` on the iframe document
// when the parent tab's visibility changes OR when the iframe is CSS-hidden
// via display:none — both of which match HA's panel-mode tab switching.

document.addEventListener("visibilitychange", () => {
  pageVisible = document.visibilityState !== "hidden";
  audio.setVisibilityMuted(!pageVisible);
});

// IntersectionObserver fallback — covers cases where the iframe stays
// "visible" per the visibility API but is actually scrolled away / hidden
// behind other UI. Watches whether the canvas is in the viewport.
const visObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    canvasVisible = entry.isIntersecting;
    audio.setVisibilityMuted(!canvasVisible || !pageVisible);
  }
}, { threshold: 0.01 });
visObserver.observe(renderer.domElement);

// ─── Time-tube builder ───────────────────────────────────────────────────
// Bin the events by time, compose an activity value per bin, then build a
// single continuous tube along +X with per-bin radius and baked bulges.

let timeTube = null;
let firstActivitySceneX = 0;
let dataExtents = null;
// Per-bin arrays kept at module scope so the playback tick can look up
// "what's at the cursor's bin" for the audio scheduler.
let binActivity = null;     // Float32Array
let binPeakSpeed = null;    // Float32Array
let binSecCached = 0;

function disposeTimeTube() {
  if (timeTube) {
    scene.remove(timeTube);
    timeTube.geometry.dispose();
    timeTube = null;
  }
}

function buildTimeTube(data) {
  disposeTimeTube();
  const { n, ts, s, window_end_ts, window_start_ts } = data;
  if (!n) return;

  const windowSec = window_end_ts - window_start_ts;
  dataExtents = { tMax: windowSec * TIME_SCALE };

  const nBins = Math.max(8, Math.floor(windowSec / TUBE_BIN_SEC));
  const binSec = windowSec / nBins;

  const presence = new Float32Array(nBins);
  const peakSpeed = new Float32Array(nBins);
  for (let i = 0; i < n; i++) {
    const b = Math.min(nBins - 1, Math.floor(ts[i] / binSec));
    presence[b] = 1;
    if (s[i] > peakSpeed[b]) peakSpeed[b] = s[i];
  }

  const activityRaw = new Float32Array(nBins);
  for (let b = 0; b < nBins; b++) {
    const speedNorm = Math.min(1, peakSpeed[b] / TUBE_PEAK_SPEED_MMS);
    activityRaw[b] = TUBE_PRESENCE_WEIGHT * presence[b]
                   + TUBE_SPEED_WEIGHT    * speedNorm;
  }
  const activity = movingAverage(activityRaw, TUBE_SMOOTH_WIN);

  // Stash for the audio scheduler
  binActivity = activity;
  binPeakSpeed = peakSpeed;
  binSecCached = binSec;

  let firstBin = nBins;
  for (let b = 0; b < nBins; b++) {
    if (presence[b] > 0) { firstBin = b; break; }
  }
  firstActivitySceneX = Math.max(0, firstBin * binSec * TIME_SCALE - 0.05);

  const ringSize = TUBE_RADIAL_SEGMENTS + 1;
  const ringCount = nBins;
  const vertCount = ringCount * ringSize;
  const positions = new Float32Array(vertCount * 3);
  const aTime     = new Float32Array(vertCount);
  const aSpeed    = new Float32Array(vertCount);
  const aActivity = new Float32Array(vertCount);
  const normals   = new Float32Array(vertCount * 3);

  // Bake an asymmetric per-vertex radius from fbm noise so the cross-
  // section is lobed, not circular. Wraps theta seamlessly by sampling the
  // noise in (axial, sin θ, cos θ) — C∞-continuous around the ring, so no
  // seam at θ = 0 / 2π.
  function bulgeAt(sceneX, theta, act) {
    const x = sceneX * BULGE_AXIAL_FREQ;
    const y = Math.sin(theta) * BULGE_RADIAL_FREQ;
    const z = Math.cos(theta) * BULGE_RADIAL_FREQ;
    const n = fbm3(x, y, z);                  // approximately ±0.7
    const amp = BULGE_QUIET_AMP + act * BULGE_ACTIVE_AMP;
    return n * amp;
  }

  for (let b = 0; b < ringCount; b++) {
    const sceneX = (b + 0.5) * binSec * TIME_SCALE;
    const baseRadius = TUBE_RADIUS_QUIET
                     + activity[b] * (TUBE_RADIUS_FULL - TUBE_RADIUS_QUIET);
    for (let r = 0; r < ringSize; r++) {
      const theta = (r / TUBE_RADIAL_SEGMENTS) * Math.PI * 2;
      const radius = Math.max(0.05, baseRadius + bulgeAt(sceneX, theta, activity[b]));
      const cy = Math.cos(theta) * radius;
      const cz = Math.sin(theta) * radius;
      const idx = b * ringSize + r;
      positions[idx * 3 + 0] = sceneX;
      positions[idx * 3 + 1] = cy;
      positions[idx * 3 + 2] = cz;
      const nLen = Math.max(1e-6, Math.hypot(cy, cz));
      normals[idx * 3 + 0] = 0;
      normals[idx * 3 + 1] = cy / nLen;
      normals[idx * 3 + 2] = cz / nLen;
      aTime[idx]     = sceneX;
      aSpeed[idx]    = peakSpeed[b];
      aActivity[idx] = activity[b];
    }
    // Snap the seam-duplicate vertex (r = TUBE_RADIAL_SEGMENTS) to be
    // bit-identical to vertex 0 — otherwise sin(2π) ≈ 1e-16 drift creates a
    // thin gap visible as a seam stripe along the tube.
    const idx0 = b * ringSize + 0;
    const idxSeam = b * ringSize + TUBE_RADIAL_SEGMENTS;
    positions[idxSeam * 3 + 0] = positions[idx0 * 3 + 0];
    positions[idxSeam * 3 + 1] = positions[idx0 * 3 + 1];
    positions[idxSeam * 3 + 2] = positions[idx0 * 3 + 2];
  }

  // ── Smooth normals from finite differences ─────────────────────────
  // Now that all positions exist, recompute the normal at each vertex as
  // normalize(cross(tangentAlongTube, tangentAroundRing)). This makes the
  // bulges catch lighting properly — without it, lighting still uses the
  // perfect-circle radial normal and the bulges read as silhouette-only.
  function vAt(b, r) {
    const i = b * ringSize + r;
    return [positions[i*3], positions[i*3+1], positions[i*3+2]];
  }
  function sub(a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
  function cross(a, b) {
    return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  }
  function norm(v) {
    const L = Math.max(1e-6, Math.hypot(v[0], v[1], v[2]));
    return [v[0]/L, v[1]/L, v[2]/L];
  }
  for (let b = 0; b < ringCount; b++) {
    const bPrev = Math.max(0, b - 1);
    const bNext = Math.min(ringCount - 1, b + 1);
    for (let r = 0; r < ringSize; r++) {
      // SEAM FIX: index neighbours modulo TUBE_RADIAL_SEGMENTS (the count
      // of unique angles), NOT ringSize (which is +1 for the seam
      // duplicate). This way vertex 0 and its duplicate get identical
      // neighbours and therefore identical normals — no seam stripe.
      const rUnique = r % TUBE_RADIAL_SEGMENTS;
      const rPrev = (rUnique - 1 + TUBE_RADIAL_SEGMENTS) % TUBE_RADIAL_SEGMENTS;
      const rNext = (rUnique + 1) % TUBE_RADIAL_SEGMENTS;
      const ta = sub(vAt(bNext, r), vAt(bPrev, r));
      const tb = sub(vAt(b, rNext), vAt(b, rPrev));
      // Outward normal = cross(axial, circumferential). If the cross points
      // inward, flip it — test against the position's YZ direction (which
      // points outward from the centreline by construction).
      const n = norm(cross(ta, tb));
      const pos = vAt(b, r);
      const outwardYZ = norm([0, pos[1], pos[2]]);
      const dot = n[1]*outwardYZ[1] + n[2]*outwardYZ[2];
      const sign = dot < 0 ? -1 : 1;
      const idx = b * ringSize + r;
      normals[idx * 3 + 0] = n[0] * sign;
      normals[idx * 3 + 1] = n[1] * sign;
      normals[idx * 3 + 2] = n[2] * sign;
    }
  }

  const indices = new Uint32Array((ringCount - 1) * TUBE_RADIAL_SEGMENTS * 6);
  let ii = 0;
  for (let b = 0; b < ringCount - 1; b++) {
    for (let r = 0; r < TUBE_RADIAL_SEGMENTS; r++) {
      const a = b       * ringSize + r;
      const c = (b + 1) * ringSize + r;
      const d = (b + 1) * ringSize + r + 1;
      const e = b       * ringSize + r + 1;
      indices[ii++] = a; indices[ii++] = c; indices[ii++] = d;
      indices[ii++] = a; indices[ii++] = d; indices[ii++] = e;
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position",  new THREE.BufferAttribute(positions,  3));
  geom.setAttribute("normal",    new THREE.BufferAttribute(normals,    3));
  geom.setAttribute("aTime",     new THREE.BufferAttribute(aTime,      1));
  geom.setAttribute("aSpeed",    new THREE.BufferAttribute(aSpeed,     1));
  geom.setAttribute("aActivity", new THREE.BufferAttribute(aActivity,  1));
  geom.setIndex(new THREE.BufferAttribute(indices, 1));
  geom.computeBoundingSphere();

  timeTube = new THREE.Mesh(geom, tubeMat);
  timeTube.frustumCulled = false;
  scene.add(timeTube);

  console.log(
    `[long-take] built time-tube: ${nBins} bins (${binSec.toFixed(0)}s) ` +
    `from ${n} events; first activity at scene-X ${firstActivitySceneX.toFixed(2)}`
  );
}

function movingAverage(arr, win) {
  const out = new Float32Array(arr.length);
  const half = Math.floor(win / 2);
  for (let i = 0; i < arr.length; i++) {
    let sum = 0, count = 0;
    for (let j = -half; j <= half; j++) {
      const k = i + j;
      if (k >= 0 && k < arr.length) { sum += arr[k]; count++; }
    }
    out[i] = sum / count;
  }
  return out;
}

// ── JS-side fbm noise (for baking bulges into the geometry at build time) ──
// Mirrors the GLSL hash3/noise3/fbm in the shader. Deterministic, so the
// tube has the same shape on every load of the same data.
function _hash3(x, y, z) {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return (h - Math.floor(h)) * 2 - 1;
}
function _noise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);
  const c000 = _hash3(ix,   iy,   iz);
  const c100 = _hash3(ix+1, iy,   iz);
  const c010 = _hash3(ix,   iy+1, iz);
  const c110 = _hash3(ix+1, iy+1, iz);
  const c001 = _hash3(ix,   iy,   iz+1);
  const c101 = _hash3(ix+1, iy,   iz+1);
  const c011 = _hash3(ix,   iy+1, iz+1);
  const c111 = _hash3(ix+1, iy+1, iz+1);
  const x00 = c000 + (c100 - c000) * ux;
  const x10 = c010 + (c110 - c010) * ux;
  const x01 = c001 + (c101 - c001) * ux;
  const x11 = c011 + (c111 - c011) * ux;
  const y0 = x00 + (x10 - x00) * uy;
  const y1 = x01 + (x11 - x01) * uy;
  return y0 + (y1 - y0) * uz;
}
function fbm3(x, y, z) {
  let v = 0, a = 0.5;
  for (let i = 0; i < 3; i++) {
    v += a * _noise3(x, y, z);
    x *= 2.07; y *= 2.07; z *= 2.07;
    a *= 0.5;
  }
  return v;
}

function setCursor(sceneX) {
  tubeUniforms.uCursor.value = sceneX;
}

// ─── Playback ────────────────────────────────────────────────────────────

let playing = true;
let cursorSceneX = 0;
let lastRealMs = performance.now();

function togglePlay() {
  playing = !playing;
  scrubEl.classList.add("touched");
  if (dataExtents) updateScrubLabel(scrubToUnixTs(cursorSceneX));
}

document.addEventListener("keydown", (e) => {
  if (e.code === "Space" || e.key === " ") {
    e.preventDefault();
    togglePlay();
  }
}, { capture: true });
renderer.domElement.addEventListener("dblclick", togglePlay);
scrubLabel.style.cursor = "pointer";
scrubLabel.addEventListener("click", togglePlay);

scrubRange.oninput = () => {
  if (!dataExtents) return;
  playing = false;
  const t = +scrubRange.value / 1000;
  cursorSceneX = t * dataExtents.tMax;
  setCursor(cursorSceneX);
  updateScrubLabel(scrubToUnixTs(cursorSceneX));
  scrubEl.classList.add("touched");
};

function tickPlayback(nowMs) {
  if (!dataExtents) return;
  if (playing) {
    const dt = (nowMs - lastRealMs) / 1000;
    cursorSceneX += dt * PLAYBACK_SPEEDUP * TIME_SCALE;
    if (cursorSceneX > dataExtents.tMax) cursorSceneX = firstActivitySceneX;
    setCursor(cursorSceneX);
    scrubRange.value = Math.round((cursorSceneX / dataExtents.tMax) * 1000);
    updateScrubLabel(scrubToUnixTs(cursorSceneX));
  }
  // Fire audio when the cursor crosses a bin's CENTRE (where the visual
  // perturbation peaks), not its leading edge — this aligns the audio
  // onset with the perceived visual event.
  if (binActivity) {
    const cursorSec = (cursorSceneX / TIME_SCALE);
    const binIdx = Math.min(binActivity.length - 1,
      Math.floor((cursorSec - binSecCached * 0.5) / binSecCached)
    );
    if (binIdx >= 0) {
      audio.onCursorAdvance(binIdx, binPeakSpeed[binIdx], binActivity[binIdx]);
    }
  }
  lastRealMs = nowMs;
}

function scrubToUnixTs(sceneX) {
  if (!currentData || !dataExtents) return Date.now() / 1000;
  const t = sceneX / dataExtents.tMax;
  return currentData.window_start_ts + t * (currentData.window_end_ts - currentData.window_start_ts);
}

function updateScrubLabel(unixTs) {
  const d = new Date(unixTs * 1000);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const day = d.toLocaleDateString(undefined, { weekday: "short" });
  scrubLabel.textContent = `${day} ${hh}:${mm}` + (playing ? "  ▶" : "  ⏸");
}

// ─── Camera dolly along time ─────────────────────────────────────────────
// Each frame, slide both camera + orbit-target by the cursor delta. This
// preserves the user's orbit angle / zoom and just translates along time.

function updateCameraDolly(nowMs) {
  const dx = cursorSceneX - lastDollyX;
  if (Math.abs(dx) > 1e-5) {
    camera.position.x += dx;
    controls.target.x += dx;
    lastDollyX = cursorSceneX;
  }
  controls.update();
  tubeUniforms.uTime.value = nowMs / 1000;
}

// ─── Render loop ─────────────────────────────────────────────────────────
// Combined visibility flag — false when EITHER the Page Visibility API
// reports hidden OR the IntersectionObserver shows the canvas off-viewport.
// When false: no playback advance, no GPU work, no audio scheduling.

let pageVisible = true;
let canvasVisible = true;

function frame(nowMs) {
  if (pageVisible && canvasVisible) {
    tickPlayback(nowMs);
    updateCameraDolly(nowMs);
    composer.render();
  } else {
    // Reset the timing reference so the cursor doesn't fast-forward on resume
    lastRealMs = nowMs;
  }
  requestAnimationFrame(frame);
}

window.addEventListener("resize", () => {
  const W = window.innerWidth, H = window.innerHeight;
  renderer.setSize(W, H);
  composer.setSize(W, H);
  bloomPass.resolution.set(W, H);
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
});

// ─── Data load + refresh ─────────────────────────────────────────────────

let currentData = null;

async function load() {
  try {
    // Build the URL per fetch so the ?cb= token is current for THIS request
    // — as a module-level const it would be frozen at page load and a
    // long-lived kiosk tab would replay the same token forever.
    const url = `./data/${ROOM}.json?cb=${Math.floor(Date.now() / 30000)}`;
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    currentData = data;
    buildTimeTube(data);
    cursorSceneX = firstActivitySceneX;
    setCursor(cursorSceneX);
    // Reposition the camera alongside first-activity, looking in
    camera.position.set(
      firstActivitySceneX + CAM_INITIAL_OFFSET.x,
      CAM_INITIAL_OFFSET.y,
      CAM_INITIAL_OFFSET.z
    );
    controls.target.set(firstActivitySceneX, 0, 0);
    lastDollyX = firstActivitySceneX;

    sRoom.textContent = data.label || data.room;
    document.title = `The Long Take — ${data.label || data.room}`;
    sN.textContent = `${data.n.toLocaleString()} of ${data.n_original.toLocaleString()}`;
    sWindow.textContent = `${data.window_hours.toFixed(0)}h ending ${
      new Date(data.window_end_ts * 1000).toLocaleString(undefined, {
        weekday: "short", hour: "2-digit", minute: "2-digit"
      })
    }`;
  } catch (e) {
    console.error("[long-take] load error:", e);
    sN.textContent = "(no data)";
  }
}

await load();
setInterval(load, REFRESH_MS);
requestAnimationFrame(frame);
