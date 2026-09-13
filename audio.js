// audio.js
// ---------------------------------------------------------------------------
// All game sound. Every effect is synthesized live with the Web Audio API —
// there are no .mp3/.wav files to load, which keeps the game a single
// self-contained bundle of code + sprite images. `sfx` is the public surface
// the rest of the game calls (sfx.hit(), sfx.win(), ...); `audioSettings` is
// a shared mutable object so main.js can flip `.muted` from the UI without
// this module needing to expose a setter.
// ---------------------------------------------------------------------------

/**
 * Mutable, shared audio settings. Exported as an object (not a plain
 * boolean) so other modules can toggle `audioSettings.muted` and have every
 * function in this file see the update immediately — a plain exported
 * `let muted` would not work, since ES module bindings are read-only from
 * the importing side.
 */
export const audioSettings = { muted: false };

// Lazily-created AudioContext. Browsers refuse to start audio before a user
// gesture, so this stays null until ensureAudio() is called from a click
// handler (see main.js's Start button listener).
let audioCtx = null;

/**
 * Creates (once) and resumes the shared AudioContext. Must be called from
 * inside a user-initiated event handler (e.g. a click) the first time,
 * per browser autoplay policy — calling it any other time is a harmless
 * no-op if a context already exists.
 */
export function ensureAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
}

/**
 * Plays a single synthesized tone: a short oscillator note with a fast
 * attack and an exponential decay to near-silence, so it reads as a clean
 * "blip" rather than a clicky on/off square wave.
 *
 * @param {number} freq  Frequency in Hz.
 * @param {number} dur   Duration in seconds before the tone fades out.
 * @param {string} [type='square'] Oscillator waveform (square/sine/triangle/sawtooth).
 * @param {number} vol   Peak volume (0-1ish; these are all kept low/subtle).
 * @param {number} [delay=0] Seconds to wait before the tone starts — used to
 *                           stagger multiple notes into a tiny melody.
 */
function tone(freq, dur, type, vol, delay) {
    if (audioSettings.muted || !audioCtx) return;
    delay = delay || 0;
    const t0 = audioCtx.currentTime + delay;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
}

/**
 * Plays a short burst of filtered white noise — used for anything that
 * should sound like an impact/thud (base hits, deaths) rather than a
 * musical note. Builds a one-shot noise buffer, runs it through a lowpass
 * filter to soften the hiss into more of a "thump", and fades it out.
 *
 * @param {number} vol Peak volume.
 * @param {number} dur Duration in seconds.
 */
function noiseThud(vol, dur) {
    if (audioSettings.muted || !audioCtx) return;
    const bufferSize = audioCtx.sampleRate * dur;
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(vol, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(audioCtx.destination);
    src.start();
}

/**
 * Public sound-effect table. Each entry is a zero-argument function that
 * plays one game event's sound; the rest of the codebase never touches
 * `tone`/`noiseThud` directly, only `sfx.<name>()`. Keeping this as a flat
 * lookup table makes it trivial to see every sound the game makes in one
 * place, and to re-tune one event's sound without touching call sites.
 */
export const sfx = {
    spawnPlayer: () => tone(340, 0.09, 'square', 0.05),
    spawnEnemy: () => tone(120, 0.12, 'sawtooth', 0.035),
    hit: () => tone(180, 0.05, 'square', 0.03),
    baseDamage: () => noiseThud(0.18, 0.28),
    waveStart: () => { tone(220, 0.15, 'triangle', 0.06); tone(330, 0.15, 'triangle', 0.05, 0.12); },
    death: () => noiseThud(0.09, 0.15),
    win: () => { tone(392, 0.12, 'square', 0.06, 0); tone(523, 0.12, 'square', 0.06, 0.13); tone(659, 0.22, 'square', 0.06, 0.26); },
    lose: () => { tone(220, 0.2, 'sawtooth', 0.06, 0); tone(160, 0.3, 'sawtooth', 0.06, 0.18); }
};