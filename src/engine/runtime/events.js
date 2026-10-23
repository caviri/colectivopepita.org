// Tiny event bus. Used internally by the runtime to surface collide /
// use / tick events to the rule dispatcher. Not exported to user code.

export function makeBus() {
    const listeners = new Map(); // type → Set<fn>
    return {
        on(type, fn) {
            let s = listeners.get(type);
            if (!s) {
                s = new Set();
                listeners.set(type, s);
            }
            s.add(fn);
            return () => s.delete(fn);
        },
        emit(type, payload) {
            const s = listeners.get(type);
            if (!s) return;
            for (const fn of s) {
                try { fn(payload); }
                catch (e) { console.error(`[bus:${type}]`, e); }
            }
        },
    };
}
