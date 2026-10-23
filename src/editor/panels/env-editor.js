// Scene environment editor — shown in the inspector slot when no
// entity is selected. Lets the user tune background, fog, ambient,
// sun, and ground without dropping into JSON. Edits write back to
// scene.env and call `onChange` so the viewport mirror + dirty flag
// stay in sync.

// Premade lighting / atmosphere presets. Each writes a complete env
// snapshot — picking one is meant to feel like flipping a switch on
// the whole mood, not a granular tweak. Pick one then nudge sliders.
const ENV_PRESETS = {
    "antarctic-noon": {
        label: "Antarctic noon",
        env: {
            background: 0xb3d3e8,
            ambient: { color: 0xcfe1ee, intensity: 0.65 },
            sun: { color: 0xfff4d6, intensity: 1.1, position: [20, 35, 12] },
            fog: { color: 0xb3d3e8, near: 40, far: 120 },
            sky: { kind: "gradient", top: 0x6fa6c8, bottom: 0xeaf3f8, exponent: 0.55, offset: 33 },
        },
    },
    "arctic-dusk": {
        label: "Arctic dusk",
        env: {
            background: 0x4d5970,
            ambient: { color: 0x6a7794, intensity: 0.4 },
            sun: { color: 0xffb27a, intensity: 0.7, position: [12, 8, 20] },
            fog: { color: 0x4d5970, near: 30, far: 90 },
            sky: { kind: "gradient", top: 0x2c3650, bottom: 0xff9a6e, exponent: 0.4, offset: 8 },
        },
    },
    "indoor-warm": {
        label: "Indoor warm",
        env: {
            background: 0x101216,
            ambient: { color: 0xb89866, intensity: 0.55 },
            sun: { color: 0xffe6b8, intensity: 0.5, position: [4, 8, 4] },
            fog: null,
            sky: null,
        },
    },
    "studio-neutral": {
        label: "Studio neutral",
        env: {
            background: 0x303338,
            ambient: { color: 0xffffff, intensity: 0.7 },
            sun: { color: 0xffffff, intensity: 0.9, position: [10, 14, 8] },
            fog: null,
            sky: null,
        },
    },
    "sunset": {
        label: "Sunset",
        env: {
            background: 0xe89464,
            ambient: { color: 0x8a4a3a, intensity: 0.45 },
            sun: { color: 0xff8048, intensity: 1.2, position: [25, 6, 8] },
            fog: { color: 0xe89464, near: 35, far: 110 },
            sky: { kind: "gradient", top: 0xa54a78, bottom: 0xffba70, exponent: 0.45, offset: 6 },
        },
    },
    "night": {
        label: "Night",
        env: {
            background: 0x0a0e1a,
            ambient: { color: 0x2a3450, intensity: 0.35 },
            sun: { color: 0x9eb0d8, intensity: 0.25, position: [20, 35, 12] },
            fog: { color: 0x0a0e1a, near: 28, far: 70 },
            sky: { kind: "gradient", top: 0x06091a, bottom: 0x1a2540, exponent: 0.7, offset: 33 },
        },
    },
};

function applyPreset(env, preset) {
    const p = ENV_PRESETS[preset]?.env;
    if (!p) return;
    // deep-merge — keep the ground definition (size, color) since it's
    // driven by the scene geometry, not the lighting mood.
    if (p.background != null) env.background = p.background;
    env.ambient = { ...p.ambient };
    env.sun = { ...p.sun, position: [...p.sun.position] };
    env.fog = p.fog ? { ...p.fog } : null;
    env.sky = p.sky ? { ...p.sky } : null;
}

export function makeEnvEditor({ getScene, onChange }) {
    return function build() {
        const scene = getScene();
        const wrap = document.createElement("div");
        wrap.className = "field-group";
        if (!scene) {
            wrap.innerHTML = `<p class="hint">No scene loaded.</p>`;
            return wrap;
        }
        const env = scene.env;

        // presets — pick one to swap the whole lighting/atmosphere mood
        wrap.appendChild(label("Lighting presets"));
        const presetsRow = document.createElement("div");
        presetsRow.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;padding-left:10px;";
        for (const [key, def] of Object.entries(ENV_PRESETS)) {
            const b = document.createElement("button");
            b.type = "button";
            b.textContent = def.label;
            b.style.cssText = "background:var(--bg);color:var(--fg-2);border:1px solid var(--border);border-radius:3px;padding:3px 8px;font:inherit;font-size:10px;cursor:pointer;";
            b.addEventListener("click", () => {
                applyPreset(env, key);
                onChange?.();
                const next = build();
                wrap.replaceWith(next);
            });
            presetsRow.appendChild(b);
        }
        wrap.appendChild(presetsRow);

        // background
        wrap.appendChild(colorRow("Background", env.background, (v) => {
            env.background = v;
            onChange?.();
        }));

        // ambient
        const ambientLab = label("Ambient");
        wrap.appendChild(ambientLab);
        wrap.appendChild(colorRow("color", env.ambient.color, (v) => {
            env.ambient.color = v;
            onChange?.();
        }, true));
        wrap.appendChild(slider("intensity", env.ambient.intensity, 0, 3, 0.05, (v) => {
            env.ambient.intensity = v;
            onChange?.();
        }));

        // sun
        wrap.appendChild(label("Sun"));
        wrap.appendChild(colorRow("color", env.sun.color, (v) => {
            env.sun.color = v;
            onChange?.();
        }, true));
        wrap.appendChild(slider("intensity", env.sun.intensity, 0, 3, 0.05, (v) => {
            env.sun.intensity = v;
            onChange?.();
        }));
        wrap.appendChild(vec3Row("position", env.sun.position, (v) => {
            env.sun.position = v;
            onChange?.();
        }));

        // fog
        const fogHead = label("Fog");
        wrap.appendChild(fogHead);
        const fogToggle = document.createElement("label");
        fogToggle.style.cssText = "display:flex;gap:6px;align-items:center;font-size:11px;color:var(--fg-2);margin-top:4px;";
        const fogCb = document.createElement("input");
        fogCb.type = "checkbox";
        fogCb.checked = !!env.fog;
        fogToggle.append(fogCb, document.createTextNode(" enabled"));
        wrap.appendChild(fogToggle);
        const fogBlock = document.createElement("div");
        fogBlock.style.cssText = env.fog ? "" : "display:none;";
        if (env.fog) {
            fogBlock.appendChild(colorRow("color", env.fog.color, (v) => {
                env.fog.color = v;
                onChange?.();
            }, true));
            fogBlock.appendChild(numField("near", env.fog.near, (v) => {
                env.fog.near = v;
                onChange?.();
            }));
            fogBlock.appendChild(numField("far", env.fog.far, (v) => {
                env.fog.far = v;
                onChange?.();
            }));
        }
        wrap.appendChild(fogBlock);
        fogCb.addEventListener("change", () => {
            if (fogCb.checked) {
                env.fog = { color: 0x808080, near: 30, far: 80 };
            } else {
                env.fog = null;
            }
            onChange?.();
            // rerender the env editor in place — easier than diffing
            const next = build();
            wrap.replaceWith(next);
        });

        // sky — optional gradient skydome behind the scene background
        wrap.appendChild(label("Sky"));
        const skyToggle = document.createElement("label");
        skyToggle.style.cssText = "display:flex;gap:6px;align-items:center;font-size:11px;color:var(--fg-2);margin-top:4px;";
        const skyCb = document.createElement("input");
        skyCb.type = "checkbox";
        skyCb.checked = !!env.sky;
        skyToggle.append(skyCb, document.createTextNode(" gradient dome"));
        wrap.appendChild(skyToggle);
        const skyBlock = document.createElement("div");
        skyBlock.style.cssText = env.sky ? "" : "display:none;";
        if (env.sky) {
            skyBlock.appendChild(colorRow("top", env.sky.top, (v) => {
                env.sky.top = v;
                onChange?.();
            }, true));
            skyBlock.appendChild(colorRow("bottom", env.sky.bottom, (v) => {
                env.sky.bottom = v;
                onChange?.();
            }, true));
            skyBlock.appendChild(slider("exponent", env.sky.exponent ?? 0.6, 0.1, 2, 0.05, (v) => {
                env.sky.exponent = v;
                onChange?.();
            }));
        }
        wrap.appendChild(skyBlock);
        skyCb.addEventListener("change", () => {
            if (skyCb.checked) {
                env.sky = { kind: "gradient", top: 0x77aaff, bottom: 0xffffff, exponent: 0.6, offset: 33 };
            } else {
                env.sky = null;
            }
            onChange?.();
            const next = build();
            wrap.replaceWith(next);
        });

        // ground
        wrap.appendChild(label("Ground"));
        if (env.ground) {
            wrap.appendChild(colorRow("color", env.ground.color, (v) => {
                env.ground.color = v;
                onChange?.();
            }, true));
            wrap.appendChild(numField("size", env.ground.size, (v) => {
                env.ground.size = v;
                onChange?.();
            }));
        }

        return wrap;
    };
}

function label(text) {
    const el = document.createElement("div");
    el.style.cssText = "font-size:10px;color:var(--fg-2);text-transform:uppercase;letter-spacing:0.04em;margin-top:8px;";
    el.textContent = text;
    return el;
}

function colorRow(name, hex, onInput, indent = false) {
    const row = document.createElement("div");
    row.style.cssText = `display:flex;align-items:center;gap:8px;margin-top:4px;${indent ? "padding-left:10px;" : ""}`;
    const inp = document.createElement("input");
    inp.type = "color";
    inp.value = "#" + (hex >>> 0).toString(16).padStart(6, "0");
    inp.style.cssText = "width:36px;height:24px;padding:0;border:1px solid var(--border);background:transparent;cursor:pointer;";
    inp.addEventListener("input", () => onInput(parseInt(inp.value.slice(1), 16)));
    const lab = document.createElement("span");
    lab.textContent = name;
    lab.style.cssText = "font-size:10px;color:var(--fg-2);";
    row.append(inp, lab);
    return row;
}

function slider(name, value, min, max, step, onInput) {
    const row = document.createElement("div");
    row.style.cssText = "display:grid;grid-template-columns:60px 1fr 36px;gap:6px;align-items:center;font-size:10px;color:var(--fg-2);margin-top:4px;padding-left:10px;";
    const lab = document.createElement("span");
    lab.textContent = name;
    const inp = document.createElement("input");
    inp.type = "range";
    inp.min = min; inp.max = max; inp.step = step;
    inp.value = value;
    const num = document.createElement("span");
    num.style.cssText = "color:var(--fg);text-align:right;font-variant-numeric:tabular-nums;";
    num.textContent = round(value);
    inp.addEventListener("input", () => {
        const v = parseFloat(inp.value);
        num.textContent = round(v);
        onInput(v);
    });
    row.append(lab, inp, num);
    return row;
}

function numField(name, value, onInput) {
    const row = document.createElement("div");
    row.style.cssText = "display:grid;grid-template-columns:60px 1fr;gap:6px;align-items:center;font-size:10px;color:var(--fg-2);margin-top:4px;padding-left:10px;";
    const lab = document.createElement("span");
    lab.textContent = name;
    const inp = document.createElement("input");
    inp.type = "number";
    inp.step = "0.1";
    inp.value = value;
    inp.style.cssText = "background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:2px;padding:3px 5px;font:inherit;font-size:11px;min-width:0;";
    inp.addEventListener("input", () => {
        const v = parseFloat(inp.value);
        if (Number.isFinite(v)) onInput(v);
    });
    row.append(lab, inp);
    return row;
}

function vec3Row(name, value, onInput) {
    const wrap = document.createElement("div");
    wrap.style.cssText = "margin-top:4px;padding-left:10px;";
    const lab = document.createElement("div");
    lab.textContent = name;
    lab.style.cssText = "font-size:10px;color:var(--fg-2);margin-bottom:2px;";
    wrap.appendChild(lab);
    const row = document.createElement("div");
    row.className = "field-row";
    const arr = [...value];
    for (let i = 0; i < 3; i++) {
        const inp = document.createElement("input");
        inp.type = "number";
        inp.step = "1";
        inp.value = arr[i];
        inp.addEventListener("input", () => {
            const v = parseFloat(inp.value);
            if (Number.isFinite(v)) {
                arr[i] = v;
                onInput([...arr]);
            }
        });
        row.appendChild(inp);
    }
    wrap.appendChild(row);
    return wrap;
}

function round(v) {
    return Math.round(v * 100) / 100;
}
