// UI system — minimal in-world overlay layer for rule-driven popups
// and examine ("kiosk") panels.
//
//   popup({ title, body | html, ms })
//     small auto-dismissing card anchored bottom-centre. New popups
//     replace any prior card rather than stacking.
//
//   examine({ title, html | htmlSrc, onClose })
//     fullscreen panel with point-and-click HTML — used for exhibit
//     terminals, screens, and any rich interaction the player should
//     be able to mouse around in. World is paused while open. Escape
//     or the close button dismisses.

export function makeUI(opts = {}) {
    const onPause = opts.onPause || (() => {});
    const onResume = opts.onResume || (() => {});

    const host = document.createElement("div");
    host.className = "engine-ui";
    host.style.cssText =
        "position:fixed;inset:0;pointer-events:none;z-index:9999";
    document.body.appendChild(host);

    let activeCard = null;
    let activeTimer = null;

    function popup({ title = "", body = "", html = "", ms = 3500 } = {}) {
        if (activeCard) {
            activeCard.remove();
            clearTimeout(activeTimer);
            activeCard = null;
        }
        const card = document.createElement("div");
        card.style.cssText = [
            "position:absolute",
            "left:50%",
            "bottom:8vh",
            "transform:translateX(-50%) translateY(8px)",
            "background:rgba(18,22,30,0.92)",
            "color:#f4ead5",
            "font:14px/1.55 system-ui,-apple-system,sans-serif",
            "padding:14px 22px",
            "border-radius:10px",
            "border:1px solid rgba(170,200,240,0.18)",
            "box-shadow:0 8px 32px rgba(0,0,0,0.55)",
            "max-width:480px",
            "min-width:260px",
            "backdrop-filter:blur(10px)",
            "-webkit-backdrop-filter:blur(10px)",
            "opacity:0",
            "transition:opacity 220ms ease,transform 220ms ease",
        ].join(";");
        if (title) {
            const h = document.createElement("div");
            h.textContent = title;
            h.style.cssText =
                "font-size:11px;text-transform:uppercase;letter-spacing:1.6px;color:#9bb6dc;margin-bottom:6px";
            card.appendChild(h);
        }
        if (html) {
            const p = document.createElement("div");
            p.innerHTML = html;
            card.appendChild(p);
        } else if (body) {
            const p = document.createElement("div");
            p.textContent = body;
            card.appendChild(p);
        }
        host.appendChild(card);
        requestAnimationFrame(() => {
            card.style.opacity = "1";
            card.style.transform = "translateX(-50%) translateY(0)";
        });
        activeCard = card;
        activeTimer = setTimeout(() => {
            card.style.opacity = "0";
            card.style.transform = "translateX(-50%) translateY(8px)";
            setTimeout(() => card.remove(), 240);
            if (activeCard === card) {
                activeCard = null;
                activeTimer = null;
            }
        }, ms);
    }

    // Examine ("kiosk") panel — fullscreen, point-and-click. Pauses the
    // world for as long as it's open. Returns a `close()` handle so the
    // caller can dismiss programmatically.
    let activeKiosk = null;

    async function examine({
        title = "",
        html = "",
        htmlSrc = "",
        onClose = null,
    } = {}) {
        // Only one kiosk at a time. New examine call replaces.
        if (activeKiosk) activeKiosk.close();

        // Backdrop covers the canvas, captures clicks, dims the world.
        const backdrop = document.createElement("div");
        backdrop.style.cssText = [
            "position:absolute",
            "inset:0",
            "background:rgba(8,11,18,0.78)",
            "backdrop-filter:blur(6px)",
            "-webkit-backdrop-filter:blur(6px)",
            "pointer-events:auto",
            "display:flex",
            "align-items:center",
            "justify-content:center",
            "padding:4vmin",
            "box-sizing:border-box",
            "opacity:0",
            "transition:opacity 280ms ease",
        ].join(";");

        // Frame mimics a piece of hardware — a chunky bezel around the
        // content. The exhibit decides what goes inside.
        const frame = document.createElement("div");
        frame.style.cssText = [
            "position:relative",
            "width:min(960px,92vw)",
            "max-height:88vh",
            "background:#0d1018",
            "border:14px solid #1c1f29",
            "border-radius:14px",
            "box-shadow:0 30px 80px rgba(0,0,0,0.7),inset 0 0 0 1px rgba(255,255,255,0.04)",
            "overflow:hidden",
            "display:flex",
            "flex-direction:column",
            "transform:scale(0.96)",
            "transition:transform 280ms cubic-bezier(0.2,0.8,0.2,1)",
        ].join(";");

        if (title) {
            const bar = document.createElement("div");
            bar.style.cssText = [
                "padding:8px 14px",
                "background:linear-gradient(180deg,#171a23,#0f1219)",
                "color:#9bb6dc",
                "font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace",
                "letter-spacing:1.4px",
                "text-transform:uppercase",
                "border-bottom:1px solid rgba(255,255,255,0.06)",
                "display:flex",
                "justify-content:space-between",
                "align-items:center",
                "flex-shrink:0",
            ].join(";");
            const titleEl = document.createElement("span");
            titleEl.textContent = title;
            const hint = document.createElement("span");
            hint.textContent = "[Esc] disengage";
            hint.style.cssText = "color:#5a6680;font-size:10px";
            bar.append(titleEl, hint);
            frame.appendChild(bar);
        }

        const content = document.createElement("div");
        content.style.cssText = [
            "flex:1 1 auto",
            "overflow:auto",
            "color:#d8e2f1",
            "font:14px/1.55 system-ui,-apple-system,sans-serif",
            "min-height:200px",
        ].join(";");
        frame.appendChild(content);

        // Resolve content: fetched URL takes precedence over inline HTML.
        let body = html;
        if (htmlSrc) {
            try {
                const r = await fetch(htmlSrc);
                if (r.ok) body = await r.text();
                else
                    body = `<div style="padding:24px;color:#e08080">Failed to load <code>${htmlSrc}</code> (HTTP ${r.status})</div>`;
            } catch (e) {
                body = `<div style="padding:24px;color:#e08080">Error loading <code>${htmlSrc}</code>: ${e.message}</div>`;
            }
        }
        // innerHTML by design — exhibit content is author-controlled. Inline
        // event attributes (onclick, etc.) are preserved by the parser.
        content.innerHTML = body || "<div style=\"padding:24px\">(no content)</div>";

        backdrop.appendChild(frame);
        host.appendChild(backdrop);
        host.style.pointerEvents = "auto";
        document.exitPointerLock?.();
        onPause();

        requestAnimationFrame(() => {
            backdrop.style.opacity = "1";
            frame.style.transform = "scale(1)";
        });

        function close() {
            backdrop.style.opacity = "0";
            frame.style.transform = "scale(0.96)";
            setTimeout(() => {
                backdrop.remove();
                host.style.pointerEvents = "none";
            }, 280);
            window.removeEventListener("keydown", onKey, true);
            if (activeKiosk?.close === close) activeKiosk = null;
            onResume();
            onClose?.();
        }
        function onKey(e) {
            if (e.code === "Escape") {
                e.stopPropagation();
                e.preventDefault();
                close();
            }
        }
        window.addEventListener("keydown", onKey, true);

        // Click outside the frame closes (only first-party clicks; ignore
        // bubbled clicks from inside).
        backdrop.addEventListener("click", (e) => {
            if (e.target === backdrop) close();
        });

        activeKiosk = { close, frame, content };
        return activeKiosk;
    }

    function destroy() {
        if (activeCard) activeCard.remove();
        if (activeKiosk) activeKiosk.close();
        clearTimeout(activeTimer);
        host.remove();
    }

    return { popup, examine, destroy };
}
