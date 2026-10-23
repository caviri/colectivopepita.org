// requestAnimationFrame loop with a clamped delta. The play runner and
// the editor's preview both use this; centralising means we get the
// same frame budget and visibility-aware pause behaviour everywhere.

export function makeLoop(step) {
    let raf = 0;
    let last = 0;
    let running = false;

    function tick(now) {
        if (!running) return;
        const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
        last = now;
        try { step(dt, now); }
        catch (e) { console.error("[loop]", e); }
        raf = requestAnimationFrame(tick);
    }

    function start() {
        if (running) return;
        running = true;
        last = 0;
        raf = requestAnimationFrame(tick);
    }
    function stop() {
        running = false;
        cancelAnimationFrame(raf);
    }

    document.addEventListener("visibilitychange", () => {
        // pause delta accumulation when tab is hidden — otherwise the
        // first frame after returning hits with a multi-second dt.
        if (document.hidden) last = 0;
    });

    return { start, stop, get running() { return running; } };
}
