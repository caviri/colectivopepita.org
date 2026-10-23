// Pool browser — lists every property in the KG, lets the user
// override a built-in or define a new one. Saves go to the IndexedDB
// user overlay (kg/pool.js). After every change the in-memory graph is
// recompiled and the rest of the editor is told to refresh.

import {
    addProperty as gAddProperty,
    removeProperty as gRemoveProperty,
} from "../../engine/kg/graph.js";
import { compile } from "../../engine/kg/compile.js";
import { saveUserProperty, deleteUserProperty } from "../../engine/kg/pool.js";
import { openModal } from "../modal.js";

export function makePoolBrowser(opts) {
    const root = document.getElementById("pool-body");
    let _graph = null;

    function setGraph(g) { _graph = g; render(); }

    function render() {
        root.innerHTML = "";
        if (!_graph) return;
        const list = document.createElement("div");
        list.className = "kg-list";

        const byCat = new Map();
        for (const p of _graph.properties.values()) {
            if (!byCat.has(p.category)) byCat.set(p.category, []);
            byCat.get(p.category).push(p);
        }
        const cats = [...byCat.keys()].sort();
        for (const cat of cats) {
            const h = document.createElement("div");
            h.className = "kg-cat-heading";
            h.textContent = cat;
            list.appendChild(h);
            for (const p of byCat.get(cat).sort((a, b) => a.id.localeCompare(b.id))) {
                list.appendChild(rowFor(p));
            }
        }
        root.appendChild(list);

        const tools = document.createElement("div");
        tools.className = "kg-toolbar";
        const newBtn = document.createElement("button");
        newBtn.textContent = "+ New property";
        newBtn.style.flex = "1";
        newBtn.addEventListener("click", () => openEditor(null));
        tools.appendChild(newBtn);
        root.appendChild(tools);
    }

    function rowFor(p) {
        const row = document.createElement("div");
        row.className = "kg-row" + (p.builtin ? " builtin" : "");
        const parents = p.parents?.length ? ` ◂ ${p.parents.join(", ")}` : "";
        row.innerHTML = `
            <span><strong>${escapeHtml(p.label)}</strong>
              <span class="rule-effect">${escapeHtml(p.id)}${escapeHtml(parents)}</span></span>
            <span class="kg-tag">${p.builtin ? "built-in" : "user"}</span>
            <span class="kg-actions"></span>
        `;
        const actions = row.querySelector(".kg-actions");
        const editBtn = document.createElement("button");
        editBtn.textContent = p.builtin ? "Override" : "Edit";
        editBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            openEditor(p);
        });
        actions.appendChild(editBtn);
        if (!p.builtin) {
            const delBtn = document.createElement("button");
            delBtn.textContent = "✕";
            delBtn.title = "Delete";
            delBtn.className = "danger";
            delBtn.addEventListener("click", async (e) => {
                e.stopPropagation();
                if (!confirm(`Delete property "${p.id}"?`)) return;
                await deleteUserProperty(p.id);
                gRemoveProperty(_graph, p.id);
                compile(_graph);
                opts.onGraphChange?.();
            });
            actions.appendChild(delBtn);
        }
        row.addEventListener("click", () => openEditor(p));
        return row;
    }

    // — editor modal ——————————————————————————————————————————————

    function openEditor(prop) {
        const isNew = !prop;
        const seed = prop || {
            id: "",
            label: "",
            category: "misc",
            parents: [],
            data: {},
            infer: [],
        };

        const form = document.createElement("div");
        form.innerHTML = `
            <div class="form-row">
                <label>ID</label>
                <input data-f="id" type="text" placeholder="metal" />
            </div>
            <div class="form-help">lowercase, no spaces. Used as the property key.</div>
            <div class="form-row">
                <label>Label</label>
                <input data-f="label" type="text" placeholder="Metal" />
            </div>
            <div class="form-row">
                <label>Category</label>
                <input data-f="category" type="text" placeholder="material" list="cat-list" />
                <datalist id="cat-list">
                    ${[...new Set([..._graph.properties.values()].map((p) => p.category))]
                        .map((c) => `<option value="${escapeAttr(c)}"></option>`)
                        .join("")}
                </datalist>
            </div>
            <div class="form-row">
                <label>Parents</label>
                <input data-f="parents" type="text" placeholder="solid, collidable" />
            </div>
            <div class="form-help">comma-separated property ids. Inheritance — a Metal IS a Solid.</div>
            <div class="form-row">
                <label>Infer rules</label>
                <textarea data-f="infer"
                  placeholder='[{"if":["wet","cold"],"add":["frozen","slippery"]}]'></textarea>
            </div>
            <div class="form-help">JSON array. Conditions under which this property is auto-added.</div>
        `;
        form.querySelector('[data-f="id"]').value = seed.id || "";
        form.querySelector('[data-f="label"]').value = seed.label || "";
        form.querySelector('[data-f="category"]').value = seed.category || "misc";
        form.querySelector('[data-f="parents"]').value = (seed.parents || []).join(", ");
        form.querySelector('[data-f="infer"]').value = seed.infer?.length
            ? JSON.stringify(seed.infer)
            : "";
        if (!isNew && prop.builtin) {
            form.querySelector('[data-f="id"]').readOnly = true;
        }

        const footer = document.createElement("div");
        const cancel = document.createElement("button");
        cancel.textContent = "Cancel";
        const save = document.createElement("button");
        save.textContent = isNew ? "Create" : "Save";
        save.style.background = "var(--accent)";
        save.style.color = "#1a1d22";
        save.style.borderColor = "var(--accent)";
        footer.append(cancel, save);

        const modal = openModal({
            title: isNew ? "New property" : `Edit "${prop.label}"`,
            body: form,
            footer,
        });
        cancel.addEventListener("click", modal.close);

        // auto-slug id from label when creating new
        const idInp = form.querySelector('[data-f="id"]');
        const labelInp = form.querySelector('[data-f="label"]');
        if (isNew) {
            labelInp.addEventListener("input", () => {
                if (!idInp.dataset.dirty) {
                    idInp.value = labelInp.value
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, "-")
                        .replace(/^-|-$/g, "");
                }
            });
            idInp.addEventListener("input", () => { idInp.dataset.dirty = "1"; });
        }

        save.addEventListener("click", async () => {
            const id = form.querySelector('[data-f="id"]').value.trim();
            const label = form.querySelector('[data-f="label"]').value.trim() || id;
            const category = form.querySelector('[data-f="category"]').value.trim() || "misc";
            const parentsRaw = form.querySelector('[data-f="parents"]').value;
            const parents = parentsRaw
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
            const inferRaw = form.querySelector('[data-f="infer"]').value.trim();
            let infer = [];
            if (inferRaw) {
                try { infer = JSON.parse(inferRaw); }
                catch (e) { alert(`Infer JSON parse error: ${e.message}`); return; }
                if (!Array.isArray(infer)) { alert("Infer must be a JSON array."); return; }
            }
            if (!id) { alert("ID is required."); return; }
            if (!/^[a-z][a-z0-9-]*$/.test(id)) {
                alert("ID must be lowercase letters, digits, hyphens.");
                return;
            }
            // preserve any existing per-property defaults (the form
            // doesn't expose them today; resetting to {} would silently
            // wipe e.g. metal.data.hardness when overriding a built-in).
            const next = {
                id, label, category, parents,
                data: { ...(seed.data || {}) },
                infer, builtin: false,
            };
            await saveUserProperty(next);
            gAddProperty(_graph, next);
            compile(_graph);
            modal.close();
            render();
            opts.onGraphChange?.();
        });
    }

    return { setGraph, render };
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
    );
}
function escapeAttr(s) { return escapeHtml(s); }
