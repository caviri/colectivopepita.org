// Inspector panel — name, transform fields, and property checklist
// driven by the loaded KG pool. Edits write back to the entity object
// and to the live mesh; the gizmo also writes back through the same
// path so the two stay in sync.
//
// Rotation is shown in **degrees** for human ergonomics — the entity
// stores radians, conversion happens at the input boundary.
// Scale has a chain-link toggle: when on, editing one axis updates
// the other two to match (uniform scale).

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

export function makeInspector(opts) {
    const body = document.getElementById("inspector-body");
    let _entity = null;
    let _graph = null;
    let _scaleLocked = true;

    function setGraph(g) { _graph = g; rerender(); }
    function setEntity(entity) {
        _entity = entity;
        rerender();
    }
    function clear() {
        _entity = null;
        rerender();
    }

    // Called by the editor whenever the gizmo moved something so we can
    // refresh the numeric inputs without losing focus.
    function syncFromMesh(mesh) {
        if (!_entity || !mesh) return;
        _entity.transform.pos = [mesh.position.x, mesh.position.y, mesh.position.z];
        _entity.transform.rot = [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z];
        _entity.transform.scale = [mesh.scale.x, mesh.scale.y, mesh.scale.z];
        const focused = document.activeElement;
        for (const inp of body.querySelectorAll("input[data-bind]")) {
            if (inp === focused) continue;
            const [field, axis] = inp.dataset.bind.split(".");
            const idx = { x: 0, y: 1, z: 2 }[axis];
            const v = _entity.transform[field][idx];
            inp.value = round(field === "rot" ? v * RAD2DEG : v);
        }
    }

    function rerender() {
        body.innerHTML = "";
        if (!_entity) {
            body.innerHTML = `<p class="hint">No selection — showing scene env.</p>`;
            if (opts.envEditor) body.appendChild(opts.envEditor());
            return;
        }
        body.appendChild(nameField(_entity));
        body.appendChild(transformGroup(_entity, "pos", "Position"));
        body.appendChild(transformGroup(_entity, "rot", "Rotation (deg)"));
        body.appendChild(scaleGroup(_entity));
        if (_entity.mesh?.kind === "primitive") {
            body.appendChild(materialGroup(_entity));
        }
        body.appendChild(propertiesGroup(_entity));
    }

    function materialGroup(entity) {
        const wrap = document.createElement("div");
        wrap.className = "field-group";
        wrap.innerHTML = `<label>Material</label>`;
        const m = entity.mesh;

        const colorRow = document.createElement("div");
        colorRow.style.cssText = "display:flex;align-items:center;gap:8px;";
        const colorInp = document.createElement("input");
        colorInp.type = "color";
        colorInp.value = "#" + ((m.color ?? 0xcccccc).toString(16).padStart(6, "0"));
        colorInp.style.cssText = "width:36px;height:24px;padding:0;border:1px solid var(--border);background:transparent;cursor:pointer;";
        colorInp.addEventListener("input", () => {
            m.color = parseInt(colorInp.value.slice(1), 16);
            opts.onChange?.(entity, { kind: "material" });
        });
        const colorLab = document.createElement("span");
        colorLab.style.cssText = "font-size:10px;color:var(--fg-2);";
        colorLab.textContent = "color";
        colorRow.append(colorInp, colorLab);
        wrap.appendChild(colorRow);

        wrap.appendChild(slider("roughness", m.roughness ?? 0.6, 0, 1, 0.01, (v) => {
            m.roughness = v;
            opts.onChange?.(entity, { kind: "material" });
        }));
        wrap.appendChild(slider("metalness", m.metalness ?? 0.1, 0, 1, 0.01, (v) => {
            m.metalness = v;
            opts.onChange?.(entity, { kind: "material" });
        }));
        return wrap;
    }

    function slider(label, value, min, max, step, onInput) {
        const row = document.createElement("div");
        row.style.cssText = "display:grid;grid-template-columns:60px 1fr 36px;gap:6px;align-items:center;font-size:10px;color:var(--fg-2);margin-top:4px;";
        const lab = document.createElement("span");
        lab.textContent = label;
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

    function nameField(entity) {
        const wrap = document.createElement("div");
        wrap.className = "field-group";
        wrap.innerHTML = `<label>Name</label>`;
        const inp = document.createElement("input");
        inp.type = "text";
        inp.value = entity.name || "";
        inp.addEventListener("input", () => {
            entity.name = inp.value;
            opts.onChange?.(entity);
        });
        wrap.appendChild(inp);
        return wrap;
    }

    function transformGroup(entity, field, label) {
        const wrap = document.createElement("div");
        wrap.className = "field-group";
        wrap.innerHTML = `<label>${label}</label>`;
        const row = document.createElement("div");
        row.className = "field-row";
        for (const axis of ["x", "y", "z"]) {
            const idx = { x: 0, y: 1, z: 2 }[axis];
            const inp = document.createElement("input");
            inp.type = "number";
            inp.step = field === "rot" ? "1" : "0.1";
            const stored = entity.transform[field][idx];
            inp.value = round(field === "rot" ? stored * RAD2DEG : stored);
            inp.dataset.bind = `${field}.${axis}`;
            inp.addEventListener("input", () => {
                const v = parseFloat(inp.value);
                if (!Number.isFinite(v)) return;
                const stored = field === "rot" ? v * DEG2RAD : v;
                entity.transform[field][idx] = stored;
                opts.onChange?.(entity);
            });
            row.appendChild(inp);
        }
        wrap.appendChild(row);
        return wrap;
    }

    function scaleGroup(entity) {
        const wrap = document.createElement("div");
        wrap.className = "field-group";
        const head = document.createElement("div");
        head.style.cssText = "display:flex;align-items:center;gap:6px;";
        head.innerHTML = `<label style="margin:0;">Scale</label>`;
        const lockBtn = document.createElement("button");
        lockBtn.textContent = _scaleLocked ? "🔒" : "🔓";
        lockBtn.title = _scaleLocked ? "Uniform: editing any axis updates all three" : "Per-axis: edit independently";
        lockBtn.style.cssText = "padding:1px 6px;font-size:10px;margin-left:auto;";
        lockBtn.addEventListener("click", () => {
            _scaleLocked = !_scaleLocked;
            rerender();
        });
        head.appendChild(lockBtn);
        wrap.appendChild(head);

        const row = document.createElement("div");
        row.className = "field-row";
        const inputs = [];
        for (const axis of ["x", "y", "z"]) {
            const idx = { x: 0, y: 1, z: 2 }[axis];
            const inp = document.createElement("input");
            inp.type = "number";
            inp.step = "0.1";
            inp.min = "0.01";
            inp.value = round(entity.transform.scale[idx]);
            inp.dataset.bind = `scale.${axis}`;
            inp.addEventListener("input", () => {
                const v = parseFloat(inp.value);
                if (!Number.isFinite(v) || v <= 0) return;
                if (_scaleLocked) {
                    entity.transform.scale = [v, v, v];
                    inputs.forEach((other) => {
                        if (other !== inp && other !== document.activeElement) {
                            other.value = round(v);
                        }
                    });
                } else {
                    entity.transform.scale[idx] = v;
                }
                opts.onChange?.(entity);
            });
            inputs.push(inp);
            row.appendChild(inp);
        }
        wrap.appendChild(row);

        // quick uniform-scale slider — drags all three axes together,
        // useful when you've just dropped an asset and want to size it.
        if (_scaleLocked) {
            const slider = document.createElement("input");
            slider.type = "range";
            slider.min = "0.05";
            slider.max = "10";
            slider.step = "0.01";
            slider.value = entity.transform.scale[0];
            slider.style.cssText = "width:100%;margin-top:4px;";
            slider.addEventListener("input", () => {
                const v = parseFloat(slider.value);
                entity.transform.scale = [v, v, v];
                inputs.forEach((inp) => { if (inp !== document.activeElement) inp.value = round(v); });
                opts.onChange?.(entity);
            });
            wrap.appendChild(slider);
        }
        return wrap;
    }

    function propertiesGroup(entity) {
        const wrap = document.createElement("div");
        wrap.className = "field-group";
        wrap.innerHTML = `<label>Properties</label>`;
        const list = document.createElement("div");
        list.className = "prop-list";
        if (!_graph) {
            list.innerHTML = `<span class="hint">Pool not loaded</span>`;
            wrap.appendChild(list);
            return wrap;
        }
        const byCategory = new Map();
        for (const p of _graph.properties.values()) {
            if (!byCategory.has(p.category)) byCategory.set(p.category, []);
            byCategory.get(p.category).push(p);
        }
        const categories = [...byCategory.keys()].sort();
        for (const cat of categories) {
            const heading = document.createElement("div");
            heading.style.cssText = "width:100%;font-size:9px;color:var(--fg-2);text-transform:uppercase;letter-spacing:0.04em;margin-top:4px;";
            heading.textContent = cat;
            list.appendChild(heading);
            for (const p of byCategory.get(cat)) {
                const chip = document.createElement("span");
                chip.className = "prop-chip";
                chip.textContent = p.label;
                chip.title = p.id;
                if (entity.properties[p.id]) chip.classList.add("on");
                chip.addEventListener("click", () => {
                    const before = !!entity.properties[p.id];
                    const after = !before;
                    if (after) entity.properties[p.id] = true;
                    else delete entity.properties[p.id];
                    chip.classList.toggle("on", after);
                    opts.onChange?.(entity, {
                        kind: "property", propId: p.id, before, after,
                    });
                });
                list.appendChild(chip);
            }
        }
        wrap.appendChild(list);
        return wrap;
    }

    return { setEntity, setGraph, clear, syncFromMesh, rerender };
}

function round(v) {
    return Math.round(v * 1000) / 1000;
}
