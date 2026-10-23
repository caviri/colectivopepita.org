// Asset picker — primitives + asset-meta.json models. Click a card to
// spawn a new entity at the world origin via opts.onSpawn(meshDescriptor).

import { loadAssetMeta } from "../../assets.js";

const PRIMITIVES = [
    { ico: "▦", label: "Cube", mesh: { kind: "primitive", shape: "box", size: [1, 1, 1], color: 0xcccccc } },
    { ico: "●", label: "Sphere", mesh: { kind: "primitive", shape: "sphere", size: [1], color: 0xcccccc } },
    { ico: "▥", label: "Cylinder", mesh: { kind: "primitive", shape: "cylinder", size: [1, 1.5, 1], color: 0xcccccc } },
    { ico: "▭", label: "Plane", mesh: { kind: "primitive", shape: "plane", size: [2, 2], color: 0x888888 } },
    { ico: "▣", label: "Pillar", mesh: { kind: "primitive", shape: "box", size: [1, 3, 1], color: 0x808890 } },
    { ico: "◆", label: "Ice block", mesh: { kind: "primitive", shape: "box", size: [1.4, 1.2, 1.4], color: 0xcdf0ff, metalness: 0.1, roughness: 0.2 } },
];

export function makeAssetPicker(opts) {
    const tabs = document.getElementById("asset-tabs");
    const grid = document.getElementById("asset-grid");
    let activeTab = "primitives";

    tabs.querySelectorAll(".tab").forEach((t) => {
        t.addEventListener("click", () => {
            activeTab = t.dataset.tab;
            tabs.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === t));
            render();
        });
    });

    function render() {
        grid.innerHTML = "";
        if (activeTab === "primitives") {
            for (const p of PRIMITIVES) {
                grid.appendChild(card(p.ico, p.label, () =>
                    opts.onSpawn({
                        name: p.label,
                        mesh: { ...p.mesh, size: [...p.mesh.size] },
                    }),
                ));
            }
        } else {
            grid.innerHTML = `<div class="hint">Loading models…</div>`;
            loadAssetMeta().then((meta) => {
                // tab may have switched while the meta was loading — bail out
                // so we don't blow away the user's current (Primitives) view.
                if (activeTab !== "models") return;
                grid.innerHTML = "";
                const entries = Object.entries(meta);
                if (!entries.length) {
                    grid.innerHTML = `<div class="hint">No asset-meta.json found.</div>`;
                    return;
                }
                for (const [folder, m] of entries) {
                    const target = m.targetSize ?? 1;
                    grid.appendChild(card("◈", folder, () =>
                        opts.onSpawn({
                            name: folder,
                            mesh: { kind: "asset", folder, targetSize: target },
                        }),
                    ));
                }
            });
        }
    }

    function card(ico, label, onClick) {
        const el = document.createElement("div");
        el.className = "asset-card";
        el.innerHTML = `<div class="ico">${ico}</div><div>${escapeHtml(label)}</div>`;
        el.title = label;
        el.addEventListener("click", onClick);
        return el;
    }

    render();
    return { render };
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
    );
}
