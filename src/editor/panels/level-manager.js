// Level manager panel — list IndexedDB-saved scenes + bundled
// data/scenes/ files, plus actions: New, Duplicate, Delete, Export,
// Import. The currently-loaded scene id is highlighted.

import * as store from "../store.js";

export function makeLevelManager(opts) {
    const list = document.getElementById("level-list");
    const btnNew = document.getElementById("lvl-new");
    const btnDup = document.getElementById("lvl-dup");
    const btnDel = document.getElementById("lvl-del");
    const btnExport = document.getElementById("lvl-export");
    const inputImport = document.getElementById("lvl-import");

    let activeId = null;

    async function refresh() {
        const [user, builtin] = await Promise.all([
            store.listScenes(),
            store.listBuiltinScenes(),
        ]);
        // user-saved scenes shadow built-ins of the same id
        const userIds = new Set(user.map((s) => s.id));
        const all = [
            ...user.map((s) => ({ ...s, source: "user" })),
            ...builtin
                .filter((s) => !userIds.has(s.id))
                .map((s) => ({ ...s, source: "builtin" })),
        ];
        list.innerHTML = "";
        for (const s of all) {
            const row = document.createElement("div");
            row.className = "row";
            if (s.id === activeId) row.classList.add("selected");
            row.innerHTML = `
                <span>${escapeHtml(s.name || s.id)}</span>
                <span class="row-tag">${s.source === "builtin" ? "built-in" : "saved"}</span>
            `;
            row.addEventListener("click", () => opts.onLoad(s.id, s.source));
            list.appendChild(row);
        }
        btnDup.disabled = !activeId;
        btnDel.disabled = !activeId;
        btnExport.disabled = !activeId;
    }

    function setActive(id) {
        activeId = id;
        refresh();
    }

    btnNew.addEventListener("click", () => opts.onNew());
    btnDup.addEventListener("click", () => activeId && opts.onDuplicate(activeId));
    btnDel.addEventListener("click", async () => {
        if (!activeId) return;
        if (!confirm(`Delete scene "${activeId}"? This cannot be undone.`)) return;
        await store.deleteScene(activeId);
        activeId = null;
        opts.onDeleted();
        refresh();
    });
    btnExport.addEventListener("click", () => activeId && opts.onExport(activeId));
    inputImport.addEventListener("change", (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            opts.onImport(String(reader.result));
            inputImport.value = "";
        };
        reader.readAsText(file);
    });

    return { refresh, setActive };
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
    );
}
