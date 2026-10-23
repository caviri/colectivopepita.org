// Rule editor — list every rule in the KG, edit, override built-ins,
// or author new ones. Saves go to the IndexedDB user overlay; the
// in-memory graph is recompiled and the editor refreshes.

import {
    addRule as gAddRule,
    removeRule as gRemoveRule,
} from "../../engine/kg/graph.js";
import { compile } from "../../engine/kg/compile.js";
import { saveUserRule, deleteUserRule } from "../../engine/kg/pool.js";
import { listEffects, listRecipes } from "../../engine/kg/effects.js";
import { openModal } from "../modal.js";

export function makeRuleEditor(opts) {
    const root = document.getElementById("rules-body");
    let _graph = null;

    function setGraph(g) { _graph = g; render(); }

    function render() {
        root.innerHTML = "";
        if (!_graph) return;
        const list = document.createElement("div");
        list.className = "kg-list";
        const byWhen = new Map();
        for (const r of _graph.rules.values()) {
            if (!byWhen.has(r.when)) byWhen.set(r.when, []);
            byWhen.get(r.when).push(r);
        }
        const order = ["collide", "use", "tick", "spawn"];
        for (const when of order) {
            const rules = byWhen.get(when);
            if (!rules?.length) continue;
            const h = document.createElement("div");
            h.className = "kg-cat-heading";
            h.textContent = when;
            list.appendChild(h);
            for (const r of rules.sort((a, b) => a.id.localeCompare(b.id))) {
                list.appendChild(rowFor(r));
            }
        }
        root.appendChild(list);

        const tools = document.createElement("div");
        tools.className = "kg-toolbar";
        const newBtn = document.createElement("button");
        newBtn.textContent = "+ New rule";
        newBtn.style.flex = "1";
        newBtn.addEventListener("click", () => openEditor(null));
        tools.appendChild(newBtn);
        root.appendChild(tools);
    }

    function rowFor(r) {
        const row = document.createElement("div");
        row.className = "kg-row" + (r.builtin ? " builtin" : "");
        const sig = `<span class="kw">${escapeHtml(r.lhs)}</span>${r.rhs ? `× <span class="kw">${escapeHtml(r.rhs)}</span>` : ""}`;
        const eff = `${escapeHtml(r.effect.kind)}${r.effect.recipe ? `(${escapeHtml(r.effect.recipe)})` : ""}`;
        row.innerHTML = `
            <span>${sig} → <span class="rule-effect">${eff}</span></span>
            <span class="kg-tag">${r.builtin ? "built-in" : "user"}</span>
            <span class="kg-actions"></span>
        `;
        const actions = row.querySelector(".kg-actions");
        const editBtn = document.createElement("button");
        editBtn.textContent = r.builtin ? "Override" : "Edit";
        editBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            openEditor(r);
        });
        actions.appendChild(editBtn);
        if (!r.builtin) {
            const delBtn = document.createElement("button");
            delBtn.textContent = "✕";
            delBtn.className = "danger";
            delBtn.addEventListener("click", async (e) => {
                e.stopPropagation();
                if (!confirm(`Delete rule "${r.id}"?`)) return;
                await deleteUserRule(r.id);
                gRemoveRule(_graph, r.id);
                compile(_graph);
                opts.onGraphChange?.();
            });
            actions.appendChild(delBtn);
        }
        row.addEventListener("click", () => openEditor(r));
        return row;
    }

    // — editor modal ——————————————————————————————————————————————

    function openEditor(rule, presets = {}) {
        const isNew = !rule;
        const seed = rule || {
            id: "",
            when: presets.when || "collide",
            lhs: presets.lhs || "",
            rhs: presets.rhs || "",
            effect: { kind: "sound", recipe: "tap", params: {} },
        };

        const propIds = [..._graph.properties.values()]
            .map((p) => p.id)
            .sort();
        const effectKinds = listEffects();
        const soundRecipes = listRecipes("sound");

        const form = document.createElement("div");
        form.innerHTML = `
            <div class="form-row">
                <label>ID</label>
                <input data-f="id" type="text" placeholder="auto" />
            </div>
            <div class="form-row">
                <label>When</label>
                <select data-f="when">
                    ${["collide", "use", "tick", "spawn"]
                        .map((w) => `<option value="${w}">${w}</option>`).join("")}
                </select>
            </div>
            <div class="form-row">
                <label>LHS property</label>
                <select data-f="lhs">
                    ${propIds.map((p) => `<option value="${escapeAttr(p)}">${escapeHtml(p)}</option>`).join("")}
                </select>
            </div>
            <div class="form-row">
                <label>RHS property</label>
                <select data-f="rhs">
                    <option value="">(any — wildcard)</option>
                    ${propIds.map((p) => `<option value="${escapeAttr(p)}">${escapeHtml(p)}</option>`).join("")}
                </select>
            </div>
            <div class="form-help">RHS only matters for "collide" rules. Leave empty for a single-sided rule that fires whenever LHS is involved.</div>
            <div class="form-row">
                <label>Effect kind</label>
                <select data-f="kind">
                    ${effectKinds.map((k) => `<option value="${escapeAttr(k)}">${escapeHtml(k)}</option>`).join("")}
                </select>
            </div>
            <div class="form-row" data-show-when-kind="sound">
                <label>Recipe</label>
                <select data-f="recipe">
                    ${soundRecipes.map((r) => `<option value="${escapeAttr(r)}">${escapeHtml(r)}</option>`).join("")}
                </select>
            </div>
            <div class="form-row">
                <label>Params (JSON)</label>
                <textarea data-f="params"
                  placeholder='{"vol":0.7}'></textarea>
            </div>
            <div class="form-help">e.g. <code>{"vol":0.7}</code> for sound, <code>{"color":16777215,"ms":150}</code> for flash, <code>{"add":"slippery","on":"a"}</code> for modify-property.</div>
        `;

        form.querySelector('[data-f="id"]').value = seed.id || "";
        form.querySelector('[data-f="when"]').value = seed.when;
        form.querySelector('[data-f="lhs"]').value = seed.lhs;
        form.querySelector('[data-f="rhs"]').value = seed.rhs || "";
        form.querySelector('[data-f="kind"]').value = seed.effect.kind;
        form.querySelector('[data-f="recipe"]').value = seed.effect.recipe || "tap";
        form.querySelector('[data-f="params"]').value = Object.keys(seed.effect.params || {}).length
            ? JSON.stringify(seed.effect.params)
            : "";

        function syncKindVisibility() {
            const kind = form.querySelector('[data-f="kind"]').value;
            form.querySelectorAll("[data-show-when-kind]").forEach((row) => {
                row.style.display = row.dataset.showWhenKind === kind ? "" : "none";
            });
        }
        form.querySelector('[data-f="kind"]').addEventListener("change", syncKindVisibility);
        syncKindVisibility();

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
            title: isNew ? "New rule" : `Edit "${rule.id}"`,
            body: form,
            footer,
        });
        cancel.addEventListener("click", modal.close);

        save.addEventListener("click", async () => {
            const id = form.querySelector('[data-f="id"]').value.trim()
                || (isNew ? autoId(form) : rule.id);
            const when = form.querySelector('[data-f="when"]').value;
            const lhs = form.querySelector('[data-f="lhs"]').value;
            const rhs = form.querySelector('[data-f="rhs"]').value || null;
            const kind = form.querySelector('[data-f="kind"]').value;
            const recipe = kind === "sound"
                ? form.querySelector('[data-f="recipe"]').value
                : null;
            const paramsRaw = form.querySelector('[data-f="params"]').value.trim();
            let params = {};
            if (paramsRaw) {
                try { params = JSON.parse(paramsRaw); }
                catch (e) { alert(`Params JSON parse error: ${e.message}`); return; }
            }
            if (!lhs) { alert("LHS is required."); return; }
            const next = {
                id, when, lhs, rhs,
                effect: { kind, recipe, params },
                builtin: false,
            };
            await saveUserRule(next);
            gAddRule(_graph, next);
            compile(_graph);
            modal.close();
            render();
            opts.onGraphChange?.();
        });
    }

    function autoId(form) {
        const lhs = form.querySelector('[data-f="lhs"]').value;
        const rhs = form.querySelector('[data-f="rhs"]').value || "any";
        const kind = form.querySelector('[data-f="kind"]').value;
        return `${lhs}-${rhs}-${kind}-${Date.now().toString(36).slice(-4)}`;
    }

    return { setGraph, render, openEditor };
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
    );
}
function escapeAttr(s) { return escapeHtml(s); }
