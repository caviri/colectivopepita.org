// Space of possibles — fullscreen modal with a property × property
// grid. Each cell shows whether at least one collide rule fires for
// that pair. Click an empty cell to author a new rule with lhs/rhs
// preset; click a filled cell to see/edit existing rules.
//
// Properties listed: those that appear as lhs or rhs in any rule, plus
// all "leaf" properties (no descendants). Adjustable via a checkbox.

import { openModal } from "../modal.js";

export function openMatrix({ graph, ruleEditor, onGraphChange }) {
    const wrap = document.createElement("div");
    wrap.className = "matrix-wrap";

    let showAll = false;
    function render() {
        wrap.innerHTML = "";

        const propIds = pickProps(graph, showAll);
        const cols = ["*", ...propIds]; // wildcard column first
        const rows = propIds;

        const tools = document.createElement("div");
        tools.style.cssText = "padding:6px 0 10px;display:flex;gap:10px;align-items:center;font-size:12px;";
        tools.innerHTML = `
            <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;">
                <input type="checkbox" ${showAll ? "checked" : ""} />
                <span>show all properties (incl. abstract)</span>
            </label>
            <span style="color:var(--fg-2);">${rows.length} × ${cols.length} cells · click empty cell to author rule</span>
        `;
        tools.querySelector("input").addEventListener("change", (e) => {
            showAll = e.target.checked;
            render();
        });
        wrap.appendChild(tools);

        const table = document.createElement("table");
        table.className = "matrix-table";
        const thead = document.createElement("thead");
        const trh = document.createElement("tr");
        const corner = document.createElement("th");
        corner.className = "corner";
        corner.textContent = "lhs ╲ rhs";
        trh.appendChild(corner);
        for (const c of cols) {
            const th = document.createElement("th");
            if (c === "*") th.classList.add("wild");
            const lab = document.createElement("span");
            lab.className = "lab";
            lab.textContent = c;
            th.appendChild(lab);
            trh.appendChild(th);
        }
        thead.appendChild(trh);
        table.appendChild(thead);

        const tbody = document.createElement("tbody");
        for (const r of rows) {
            const tr = document.createElement("tr");
            const th = document.createElement("th");
            th.textContent = r;
            tr.appendChild(th);
            for (const c of cols) {
                tr.appendChild(cell(r, c));
            }
            tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        wrap.appendChild(table);
    }

    function cell(lhsId, rhsId) {
        const td = document.createElement("td");
        const div = document.createElement("div");
        div.className = "matrix-cell";
        if (lhsId === rhsId) div.classList.add("diag");
        const rules = rulesFor(graph, lhsId, rhsId);
        if (rules.length) {
            div.classList.add("has-rule");
            div.textContent = rules.length === 1 ? "●" : String(rules.length);
            div.title = rules.map((r) => `${r.id}: ${r.effect.kind}${r.effect.recipe ? `(${r.effect.recipe})` : ""}`).join("\n");
        } else {
            div.title = `${lhsId} × ${rhsId === "*" ? "(any)" : rhsId} — click to author`;
        }
        div.addEventListener("click", () => {
            if (rules.length === 1) {
                ruleEditor.openEditor(rules[0]);
            } else if (rules.length > 1) {
                pickFrom(rules);
            } else {
                ruleEditor.openEditor(null, {
                    when: "collide",
                    lhs: lhsId,
                    rhs: rhsId === "*" ? "" : rhsId,
                });
            }
        });
        td.appendChild(div);
        return td;
    }

    function pickFrom(rules) {
        const body = document.createElement("div");
        const list = document.createElement("div");
        list.className = "kg-list";
        for (const r of rules) {
            const row = document.createElement("div");
            row.className = "kg-row";
            row.innerHTML = `<span><strong>${r.id}</strong> · ${r.effect.kind}${r.effect.recipe ? `(${r.effect.recipe})` : ""}</span>`;
            row.addEventListener("click", () => {
                modal.close();
                ruleEditor.openEditor(r);
            });
            list.appendChild(row);
        }
        body.appendChild(list);
        const modal = openModal({ title: "Select rule to edit", body });
    }

    const modal = openModal({
        title: "Space of possibles",
        body: wrap,
        kind: "matrix",
    });

    // recompute on graph-change events fired by the editor
    const onChange = () => render();
    window.addEventListener("graph-change", onChange);
    const origClose = modal.close;
    modal.close = () => {
        window.removeEventListener("graph-change", onChange);
        origClose();
    };
    // close on Escape via the modal's own handler — but we also need to
    // detach the listener if the user closes by clicking outside, which
    // triggers origClose directly. Use a MutationObserver fallback.
    const observer = new MutationObserver(() => {
        if (!document.body.contains(modal.overlay)) {
            window.removeEventListener("graph-change", onChange);
            observer.disconnect();
        }
    });
    observer.observe(document.getElementById("modal-root"), { childList: true });

    render();
}

function pickProps(graph, all) {
    if (all) return [...graph.properties.keys()].sort();
    // default: leaves (no descendants beyond self) ∪ properties referenced by rules
    const leaves = [];
    for (const [id, ds] of graph.descendants) {
        if (ds.size === 1) leaves.push(id);
    }
    const referenced = new Set();
    for (const r of graph.rules.values()) {
        referenced.add(r.lhs);
        if (r.rhs) referenced.add(r.rhs);
    }
    const out = new Set([...leaves, ...referenced]);
    return [...out].sort();
}

function rulesFor(graph, lhs, rhs) {
    const out = [];
    if (rhs === "*") {
        // single-sided rules where lhs matches exactly
        for (const r of graph.rules.values()) {
            if (r.when !== "collide") continue;
            if (!r.rhs && r.lhs === lhs) out.push(r);
        }
        return out;
    }
    for (const r of graph.rules.values()) {
        if (r.when !== "collide") continue;
        if (!r.rhs) continue;
        if ((r.lhs === lhs && r.rhs === rhs) || (r.lhs === rhs && r.rhs === lhs)) {
            out.push(r);
        }
    }
    return out;
}
