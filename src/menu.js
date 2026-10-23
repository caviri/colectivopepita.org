// Shared pause / settings menu used by every page. Build once via
// `createMenu({...})`; the returned controller exposes open/close/toggle.
// Pages wire Esc themselves so per-page modals (inspect, petri, intro)
// can keep first dibs on the key.
import * as controls from "./controls.js";

const KEY_HELP = [
    ["W A S D", "Move"],
    ["Shift", "Sprint"],
    ["Space", "Jump"],
    ["Mouse", "Look"],
    ["Right-click", "First-person / zoom"],
    ["E", "Interact"],
    ["Q", "Throw"],
    ["1 – 0", "Hotbar slot"],
    ["V", "Toggle first person"],
    ["Tab", "Toggle orbit camera"],
    ["Esc", "Open / close menu"],
];

export function createMenu(opts = {}) {
    const {
        title = "Antarctic Sampler",
        subtitle = "Paused",
        primaryActions = [],
        sliders = [],
        onResume = null,
    } = opts;

    const root = document.createElement("div");
    root.id = "pause-menu";
    root.innerHTML = `
        <div class="pause-backdrop"></div>
        <div class="pause-card">
            <div class="pause-title">${title}</div>
            <div class="pause-subtitle">${subtitle}</div>
            <div class="pause-actions"></div>
            <div class="pause-grid">
                <section class="pause-section pause-section-keys">
                    <h4>Controls</h4>
                    <div class="pause-keys"></div>
                </section>
                <section class="pause-section pause-section-sliders">
                    <h4>Settings</h4>
                    <div class="pause-sliders"></div>
                </section>
            </div>
            <div class="pause-footer">Press <kbd>Esc</kbd> to resume</div>
        </div>
    `;
    document.body.appendChild(root);

    // primary actions: Resume always first, then page-specific buttons
    const actionsHost = root.querySelector(".pause-actions");
    actionsHost.append(makeButton({
        label: "Resume",
        hotkey: "Esc",
        primary: true,
        onClick: () => close(),
    }));
    for (const a of primaryActions) {
        actionsHost.append(makeButton({
            ...a,
            onClick: () => {
                close();
                a.onClick?.();
            },
        }));
    }

    // controls cheat sheet
    const keysHost = root.querySelector(".pause-keys");
    for (const [k, v] of KEY_HELP) {
        const row = document.createElement("div");
        row.className = "key-row";
        const keys = k.split(" ").map((p) => `<kbd>${p}</kbd>`).join("");
        row.innerHTML = `<span class="keys">${keys}</span><span class="desc">${v}</span>`;
        keysHost.append(row);
    }

    // settings sliders
    const slidersHost = root.querySelector(".pause-sliders");
    if (sliders.length === 0) {
        const empty = document.createElement("div");
        empty.className = "pause-empty";
        empty.textContent = "No tunables on this page.";
        slidersHost.append(empty);
    }
    const sliderRefresh = [];
    for (const def of sliders) {
        const { row, refresh } = makeSlider(def);
        slidersHost.append(row);
        sliderRefresh.push(refresh);
    }

    // backdrop click closes the menu (a forgiving target on small screens)
    root.querySelector(".pause-backdrop").addEventListener("click", () => close());

    let isOpen = false;
    function open() {
        if (isOpen) return;
        isOpen = true;
        // sync slider readouts in case external code mutated params
        for (const r of sliderRefresh) r();
        root.classList.add("visible");
        controls.pause("menu");
        controls.keys.clear();
    }
    function close() {
        if (!isOpen) return;
        isOpen = false;
        root.classList.remove("visible");
        controls.unpause("menu");
        onResume?.();
    }
    function toggle() {
        if (isOpen) close();
        else open();
    }

    return {
        open,
        close,
        toggle,
        get isOpen() { return isOpen; },
        root,
    };
}

function makeButton({ label, primary = false, danger = false, onClick, hotkey }) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pause-btn";
    if (primary) b.classList.add("primary");
    if (danger) b.classList.add("danger");
    const left = document.createElement("span");
    left.textContent = label;
    b.append(left);
    if (hotkey) {
        const hk = document.createElement("kbd");
        hk.textContent = hotkey;
        b.append(hk);
    }
    b.addEventListener("click", onClick);
    return b;
}

function makeSlider(def) {
    const row = document.createElement("label");
    row.className = "pause-slider";
    const name = document.createElement("span");
    name.className = "slider-label";
    name.textContent = def.label;
    const input = document.createElement("input");
    input.type = "range";
    input.min = def.min;
    input.max = def.max;
    input.step = def.step;
    input.value = def.get();
    const readout = document.createElement("span");
    readout.className = "readout";
    readout.textContent = formatVal(input.value, def.step);
    input.addEventListener("input", () => {
        const v = parseFloat(input.value);
        def.set(v);
        readout.textContent = formatVal(v, def.step);
    });
    row.append(name, input, readout);
    function refresh() {
        input.value = def.get();
        readout.textContent = formatVal(input.value, def.step);
    }
    return { row, refresh };
}

function formatVal(v, step) {
    const n = parseFloat(v);
    // pick decimals from step magnitude — 0.05 → 2 decimals, 1 → 0 decimals
    if (step >= 1) return n.toFixed(0);
    if (step >= 0.1) return n.toFixed(1);
    return n.toFixed(2);
}
