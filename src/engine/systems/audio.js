// Audio system — a tiny synthesizer-on-demand layer. Recipes are named
// procedural patches (chime, thunk, tap…) extracted from the patterns
// in src/main.js (chime, mining hit, footstep) and src/manual.js
// (page-turn burst). The "sound" effect handler in kg/effects.js calls
// audio.play(recipeId, params).
//
// All recipes share the same envelope vocabulary: pull a fresh
// AudioContext lazily, schedule one-shot oscillators / buffer sources,
// route through a master gain so a global mute is one line.

import { registerRecipe } from "../kg/effects.js";

export function makeAudio() {
    let ctx = null;
    let master = null;

    function ensure() {
        if (ctx) return ctx;
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        ctx = new Ctx();
        master = ctx.createGain();
        master.gain.value = 1;
        master.connect(ctx.destination);
        return ctx;
    }

    function setVolume(v) {
        if (master) master.gain.value = Math.max(0, Math.min(1, v));
    }

    function resume() {
        ensure();
        if (ctx?.state === "suspended") ctx.resume();
    }

    // Recipe lookup is dynamic so user-authored recipes can be added at
    // runtime by the editor without restart. Built-in recipes are
    // registered below.
    function play(recipeId, params = {}) {
        ensure();
        if (!ctx) return;
        if (ctx.state === "suspended") ctx.resume();
        const recipe = RECIPES[recipeId];
        if (!recipe) {
            console.warn(`[audio] unknown recipe "${recipeId}"`);
            return;
        }
        const vol = params.vol ?? 0.7;
        recipe(ctx, master, vol, params);
    }

    return { play, setVolume, resume, get ctx() { return ctx; } };
}

// ── built-in recipes ────────────────────────────────────────────────────
// All recipes signature: (ctx, dest, vol, params)

const RECIPES = {};

function noiseBuffer(ctx, durationSec) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
}

// chime — bright two-tone bell, used for "pickup" / metallic strike
RECIPES.chime = function (ctx, dest, vol) {
    const t = ctx.currentTime;
    [[880, 0], [1320, 0.09]].forEach(([freq, delay]) => {
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.value = freq;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t + delay);
        g.gain.linearRampToValueAtTime(vol * 0.3, t + delay + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + delay + 0.55);
        o.connect(g).connect(dest);
        o.start(t + delay);
        o.stop(t + delay + 0.6);
    });
};

// thunk — filtered noise burst + low square pitch drop. Mining-hit recipe.
RECIPES.thunk = function (ctx, dest, vol) {
    const t = ctx.currentTime;
    const dur = 0.18;
    const buf = noiseBuffer(ctx, dur);
    // shape with envelope baked into the buffer (cheap)
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
        data[i] *= Math.pow(1 - i / data.length, 2.5);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1200;
    const ng = ctx.createGain();
    ng.gain.value = vol * 0.55;
    src.connect(lp).connect(ng).connect(dest);
    src.start(t);

    const o = ctx.createOscillator();
    o.type = "square";
    o.frequency.setValueAtTime(190, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.09);
    const og = ctx.createGain();
    og.gain.setValueAtTime(vol * 0.22, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(og).connect(dest);
    o.start(t);
    o.stop(t + 0.14);
};

// tap — short lowpassed noise click. Soft impact.
RECIPES.tap = function (ctx, dest, vol) {
    const t = ctx.currentTime;
    const buf = noiseBuffer(ctx, 0.06);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
        data[i] *= Math.pow(1 - i / data.length, 2);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 800;
    const g = ctx.createGain();
    g.gain.value = vol * 0.35;
    src.connect(lp).connect(g).connect(dest);
    src.start(t);
};

// pop — descending triangle, cartoon "mwah" lite.
RECIPES.pop = function (ctx, dest, vol) {
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(720, t);
    o.frequency.exponentialRampToValueAtTime(230, t + 0.09);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 600;
    bp.Q.value = 2.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol * 0.38, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(bp).connect(g).connect(dest);
    o.start(t);
    o.stop(t + 0.18);
};

// woodKnock — bandpass burst with distinct woody centre frequency.
RECIPES.woodKnock = function (ctx, dest, vol) {
    const t = ctx.currentTime;
    const buf = noiseBuffer(ctx, 0.15);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
        data[i] *= Math.pow(1 - i / data.length, 3);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 420;
    bp.Q.value = 5;
    const g = ctx.createGain();
    g.gain.value = vol * 0.7;
    src.connect(bp).connect(g).connect(dest);
    src.start(t);
};

// iceCrack — bright high band noise + tiny chirp. Cold, sharp.
RECIPES.iceCrack = function (ctx, dest, vol) {
    const t = ctx.currentTime;
    const buf = noiseBuffer(ctx, 0.12);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
        data[i] *= Math.pow(1 - i / data.length, 4);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 2200;
    const g = ctx.createGain();
    g.gain.value = vol * 0.5;
    src.connect(hp).connect(g).connect(dest);
    src.start(t);

    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(2400, t);
    o.frequency.exponentialRampToValueAtTime(800, t + 0.08);
    const og = ctx.createGain();
    og.gain.setValueAtTime(vol * 0.2, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    o.connect(og).connect(dest);
    o.start(t);
    o.stop(t + 0.12);
};

// expose recipe registry to the kg/effects layer for editor browsing
for (const id of Object.keys(RECIPES)) {
    registerRecipe("sound", id, { id });
}
