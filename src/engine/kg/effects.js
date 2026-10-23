// Effect registry — what rules actually do when they fire. Each effect
// is a function (ctx, params, event) where:
//   ctx    — engine context: { audio, visual, scene, three, log }
//   params — the rule's effect.params merged with the recipe's defaults
//   event  — the triggering event: { kind, a, b?, point?, dt? }
//
// Effects are registered, never serialized — when a user authors a new
// effect kind they're writing JS. Recipes (named parameter bundles for
// the "sound" effect) are the data-driven layer: rules pick a recipe
// id from a built-in catalog.

const _effects = new Map();
const _recipes = new Map();

export function registerEffect(kind, fn) {
    _effects.set(kind, fn);
}

export function getEffect(kind) {
    return _effects.get(kind) || null;
}

export function listEffects() {
    return [..._effects.keys()];
}

export function registerRecipe(category, id, recipe) {
    _recipes.set(`${category}:${id}`, recipe);
}

export function getRecipe(category, id) {
    return _recipes.get(`${category}:${id}`) || null;
}

export function listRecipes(category) {
    const prefix = `${category}:`;
    const out = [];
    for (const k of _recipes.keys()) {
        if (k.startsWith(prefix)) out.push(k.slice(prefix.length));
    }
    return out;
}

// ── built-in effects ────────────────────────────────────────────────────

registerEffect("log", (ctx, params, event) => {
    ctx.log?.(`[rule] ${params.message ?? event.kind}`, event);
});

registerEffect("sound", (ctx, params /* {recipe, vol?} */, event) => {
    if (!ctx.audio) return;
    const recipe = params.recipe || "tap";
    ctx.audio.play(recipe, { vol: params.vol ?? 0.7, ...params }, event);
});

registerEffect("flash", (ctx, params, event) => {
    if (!ctx.visual) return;
    ctx.visual.flash(event.a || event.entity, {
        color: params.color ?? 0xffffff,
        ms: params.ms ?? 200,
    });
});

registerEffect("particle", (ctx, params, event) => {
    if (!ctx.visual) return;
    ctx.visual.particles(event.point || null, {
        color: params.color ?? 0xffffff,
        count: params.count ?? 12,
        spread: params.spread ?? 0.6,
    });
});

registerEffect("modify-property", (ctx, params, event) => {
    const target = params.on === "b" ? event.b : event.a;
    if (!target) return;
    if (params.add) target.properties[params.add] = true;
    if (params.remove) delete target.properties[params.remove];
    ctx.scene?.markDirty?.();
});

registerEffect("popup", (ctx, params) => {
    if (!ctx.ui) return;
    ctx.ui.popup({
        title: params.title ?? "",
        body: params.body ?? "",
        html: params.html ?? "",
        ms: params.ms ?? 3500,
    });
});

registerEffect("examine", (ctx, params) => {
    if (!ctx.ui) return;
    ctx.ui.examine({
        title: params.title ?? "",
        html: params.html ?? "",
        htmlSrc: params.htmlSrc ?? "",
    });
});
