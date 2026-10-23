// Hierarchy panel — flat list of entities in the current scene. Click
// to select; Delete key (when the panel is focused) removes.

export function makeHierarchy(opts) {
    const list = document.getElementById("hierarchy-list");

    let _scene = null;
    let _selectedId = null;

    function setScene(scene) {
        _scene = scene;
        render();
    }

    function setSelected(id) {
        _selectedId = id;
        // re-paint without rebuilding (cheap for ~100 entities)
        for (const row of list.querySelectorAll(".row")) {
            row.classList.toggle(
                "selected",
                row.dataset.entityId === id,
            );
        }
    }

    function render() {
        list.innerHTML = "";
        if (!_scene) return;
        for (const e of _scene.entities) {
            const row = document.createElement("div");
            row.className = "row";
            row.dataset.entityId = e.id;
            if (e.id === _selectedId) row.classList.add("selected");
            const propCount = Object.keys(e.properties || {}).length;
            row.innerHTML = `
                <span>${escapeHtml(e.name || e.id)}</span>
                <span class="row-tag">${propCount} props</span>
            `;
            row.addEventListener("click", () => opts.onSelect(e.id));
            list.appendChild(row);
        }
    }

    window.addEventListener("keydown", (e) => {
        if (e.key !== "Delete" && e.key !== "Backspace") return;
        if (!_selectedId) return;
        // ignore typing into inputs
        const tag = document.activeElement?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        opts.onDelete(_selectedId);
    });

    return { setScene, setSelected, render };
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
    );
}
