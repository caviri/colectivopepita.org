// KG force-directed graph view. Properties are nodes; parent edges are
// solid lines; rule references are dashed lines. Pure SVG + a tiny
// Fruchterman-Reingold-ish layout — no external deps.

import { openModal } from "../modal.js";

const W = 1100;
const H = 720;
const ITERS = 240;
const REPULSE = 6500;
const SPRING = 0.04;
const SPRING_LEN = 90;
const DAMPING = 0.85;

const CATEGORY_COLORS = {
    physics: "#5cb8d0",
    material: "#ff7043",
    thermal: "#88c0d0",
    moisture: "#5cb8d0",
    surface: "#7ed957",
    audio: "#eec96a",
    interaction: "#ffd633",
    visual: "#c8302e",
    composite: "#a070d0",
    misc: "#8a929c",
};

export function openGraphView({ graph }) {
    const wrap = document.createElement("div");
    wrap.style.cssText = "height:100%;display:flex;flex-direction:column;";
    wrap.innerHTML = `
        <div style="padding:6px 0 8px;display:flex;gap:14px;align-items:center;font-size:11px;color:var(--fg-2);">
            <span><span style="display:inline-block;width:10px;height:2px;background:#888;vertical-align:middle;"></span> parent</span>
            <span><span style="display:inline-block;width:10px;border-top:2px dashed #888;vertical-align:middle;"></span> rule reference</span>
            <span style="margin-left:auto;">drag to pin · scroll to zoom</span>
        </div>
        <svg viewBox="0 0 ${W} ${H}" style="flex:1;background:#1a1d22;border-radius:4px;cursor:grab;"></svg>
    `;
    const svg = wrap.querySelector("svg");

    const nodes = [];
    const nodeIndex = new Map();
    let i = 0;
    const cx = W / 2, cy = H / 2;
    const r0 = Math.min(cx, cy) * 0.7;
    for (const p of graph.properties.values()) {
        const angle = (i++ / graph.properties.size) * Math.PI * 2;
        nodes.push({
            id: p.id,
            label: p.label,
            category: p.category,
            x: cx + Math.cos(angle) * r0,
            y: cy + Math.sin(angle) * r0,
            vx: 0, vy: 0,
            pinned: false,
        });
        nodeIndex.set(p.id, nodes[nodes.length - 1]);
    }

    const parentEdges = [];
    for (const p of graph.properties.values()) {
        for (const par of p.parents || []) {
            const a = nodeIndex.get(p.id);
            const b = nodeIndex.get(par);
            if (a && b) parentEdges.push({ a, b });
        }
    }
    const ruleEdges = [];
    for (const r of graph.rules.values()) {
        const a = nodeIndex.get(r.lhs);
        if (!a) continue;
        if (r.rhs) {
            const b = nodeIndex.get(r.rhs);
            if (b) ruleEdges.push({ a, b, rule: r });
        }
    }

    function step() {
        // repulsion
        for (let i = 0; i < nodes.length; i++) {
            const a = nodes[i];
            if (a.pinned) continue;
            for (let j = i + 1; j < nodes.length; j++) {
                const b = nodes[j];
                let dx = a.x - b.x;
                let dy = a.y - b.y;
                let d2 = dx * dx + dy * dy;
                if (d2 < 1) d2 = 1;
                const f = REPULSE / d2;
                const d = Math.sqrt(d2);
                const fx = (dx / d) * f;
                const fy = (dy / d) * f;
                a.vx += fx;
                a.vy += fy;
                if (!b.pinned) { b.vx -= fx; b.vy -= fy; }
            }
        }
        // springs (parent edges + rule edges, all attract)
        for (const list of [parentEdges, ruleEdges]) {
            for (const e of list) {
                const a = e.a, b = e.b;
                let dx = b.x - a.x;
                let dy = b.y - a.y;
                let d = Math.sqrt(dx * dx + dy * dy) || 1;
                const f = SPRING * (d - SPRING_LEN);
                const fx = (dx / d) * f;
                const fy = (dy / d) * f;
                if (!a.pinned) { a.vx += fx; a.vy += fy; }
                if (!b.pinned) { b.vx -= fx; b.vy -= fy; }
            }
        }
        // integrate + damp
        for (const n of nodes) {
            if (n.pinned) { n.vx = 0; n.vy = 0; continue; }
            n.vx *= DAMPING;
            n.vy *= DAMPING;
            n.x += n.vx;
            n.y += n.vy;
            // soft container
            n.x = Math.max(20, Math.min(W - 20, n.x));
            n.y = Math.max(20, Math.min(H - 20, n.y));
        }
    }

    function render() {
        // edges first, then nodes on top
        let html = "";
        for (const e of parentEdges) {
            html += `<line x1="${e.a.x}" y1="${e.a.y}" x2="${e.b.x}" y2="${e.b.y}" stroke="#5a6068" stroke-width="1.5" />`;
        }
        for (const e of ruleEdges) {
            html += `<line x1="${e.a.x}" y1="${e.a.y}" x2="${e.b.x}" y2="${e.b.y}" stroke="#5cb8d0" stroke-width="1.2" stroke-dasharray="4 3" opacity="0.7" />`;
        }
        for (const n of nodes) {
            const color = CATEGORY_COLORS[n.category] || CATEGORY_COLORS.misc;
            html += `
                <g data-id="${escAttr(n.id)}" style="cursor:grab">
                    <circle cx="${n.x}" cy="${n.y}" r="${n.pinned ? 9 : 7}"
                            fill="${color}" stroke="#1a1d22" stroke-width="2" />
                    <text x="${n.x + 10}" y="${n.y + 4}" font-size="11" fill="#d8dde3" font-family="system-ui">
                        ${escHtml(n.label)}
                    </text>
                </g>`;
        }
        svg.innerHTML = html;
        wireDrag();
    }

    function wireDrag() {
        for (const g of svg.querySelectorAll("g[data-id]")) {
            g.addEventListener("pointerdown", (e) => {
                e.preventDefault();
                const id = g.dataset.id;
                const n = nodeIndex.get(id);
                n.pinned = true;
                const onMove = (ev) => {
                    const pt = svgPoint(ev);
                    n.x = pt.x;
                    n.y = pt.y;
                    // light re-layout while dragging
                    for (let i = 0; i < 5; i++) step();
                    render();
                };
                const onUp = () => {
                    window.removeEventListener("pointermove", onMove);
                    window.removeEventListener("pointerup", onUp);
                };
                window.addEventListener("pointermove", onMove);
                window.addEventListener("pointerup", onUp);
            });
        }
    }

    function svgPoint(ev) {
        const pt = svg.createSVGPoint();
        pt.x = ev.clientX;
        pt.y = ev.clientY;
        const ctm = svg.getScreenCTM().inverse();
        return pt.matrixTransform(ctm);
    }

    // initial settle
    for (let i = 0; i < ITERS; i++) step();
    render();

    openModal({
        title: `Knowledge graph — ${graph.properties.size} properties · ${graph.rules.size} rules`,
        body: wrap,
        kind: "matrix",
    });
}

function escHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
    );
}
function escAttr(s) { return escHtml(s); }
