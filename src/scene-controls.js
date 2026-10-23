// scene-controls.js — opinionated wrapper around controls.js so every
// scene in the project gets the same first-person feel for free.
//
// What controls.js gives you:
//   - mode state (follow/orbit/isometric/fp-temp/fp-persistent)
//   - WASD movement, jump, mouse-look, pointer-lock, Tab/V cycling
//   - createPlayer(), updateCamera(), syncFP(), tryLeftClickZoom()
//
// What scenes have historically had to wire up themselves
// (and which the engine path was missing entirely):
//   - calling syncFP() each frame so the orange nose hides in FP and
//     the held-item hand toggles in/out of view
//   - walk-bob (body + head sinusoid keyed to movement & sprint)
//   - hand-bob (idle held-item bob)
//   - left-click → tryLeftClickZoom() in fp-temp, with a hook for
//     scene-specific raycast interactions before falling through
//   - hooking up the `body.fp-zoom` CSS class via the controls module
//     (controls.js does this; scenes just need a #vignette in HTML)
//
// Usage in a scene:
//
//   import * as sc from "./scene-controls.js";
//   const { rig, player, update, wireClicks } = sc.attach(canvas, three, camera);
//   wireClicks({ onLeftClick: (e) => raycastInteract(e) });
//   makeLoop((dt) => update(dt));
//
// All controls.js exports are re-exported as `controls` for direct
// access (mode checks, params, pause/unpause, etc.).
//
// Legacy scenes (main.js, lab.js, lab2.js) that already inline these
// calls keep working unchanged — this module is purely additive.

import * as controls from "./controls.js";

export { controls };

const DEFAULTS = {
    walkBob: true,
    handBob: true,
    handVisible: () => false,
    spawn: null, // [x, y, z]; null = leave at player.position
    sprint: true,
    jump: true,
};

// Bob constants matched to legacy main.js / lab.js:
//   phase advance is 9 rad/s walking, 14 rad/s sprinting; vertical
//   amplitude is 0.06 on body, 0.05 on head. On stop we ease back to
//   the rig's resting position over ~125 ms.
const BOB_WALK = 9;
const BOB_SPRINT = 14;
const BOB_BODY = 0.06;
const BOB_HEAD = 0.05;
const HAND_BOB_RATE = 2.4;   // rad/s for idle hand bob
const HAND_BOB_AMP = 0.05;

export function attach(canvas, three, camera, opts = {}) {
    const cfg = { ...DEFAULTS, ...opts };

    const rig = controls.createPlayer();
    const player = rig.group;
    if (cfg.spawn) player.position.set(...cfg.spawn);
    controls.setPlayer(player);
    three.add(player);
    controls.init(canvas);

    // Resting positions captured AT attach time so the bob restores to
    // whatever the rig was authored at, even if a scene retunes the rig.
    const baseBodyY = rig.body.position.y;
    const baseHeadY = rig.head.position.y;
    const baseHandY = rig.hand?.position?.y ?? 0;

    const playerJump = { vy: 0, grounded: true };
    let walkPhase = 0;
    const handBobOffset = baseHandY;

    function update(dt, hooks = {}) {
        // --- input → motion ----------------------------------------
        const move = controls.applyMovement(dt, player, {
            sprint: cfg.sprint,
            ...hooks.movement,
        });
        if (cfg.jump) {
            controls.applyJump(dt, player, playerJump, hooks.jump);
        }
        controls.updateCamera(dt, player, camera, hooks.camera);

        // --- FP visibility (the line every scene forgets) -----------
        controls.syncFP(rig, cfg.handVisible);

        // --- walk-bob ----------------------------------------------
        if (cfg.walkBob) {
            const moving = move.moved && playerJump.grounded;
            if (moving) {
                walkPhase += dt * (move.sprinting ? BOB_SPRINT : BOB_WALK);
                rig.body.position.y = baseBodyY + Math.sin(walkPhase) * BOB_BODY;
                rig.head.position.y = baseHeadY + Math.sin(walkPhase) * BOB_HEAD;
                // Footstep callback fires on each phase crossing
                // (every π radians of phase). Optional — if `onStep`
                // isn't passed we just don't emit anything.
                if (hooks.onStep) {
                    const step = Math.floor(walkPhase / Math.PI);
                    if (step > update._lastStep) {
                        hooks.onStep({
                            sprinting: move.sprinting,
                            step,
                            player,
                            yaw: player.rotation.y,
                        });
                        update._lastStep = step;
                    }
                }
            } else {
                walkPhase = 0;
                update._lastStep = 0;
                const k = Math.min(1, dt * 8);
                rig.body.position.y +=
                    (baseBodyY - rig.body.position.y) * k;
                rig.head.position.y +=
                    (baseHeadY - rig.head.position.y) * k;
            }
        }

        // --- hand-bob ----------------------------------------------
        if (cfg.handBob && rig.hand?.visible) {
            const t = performance.now() / 1000;
            rig.hand.position.y =
                handBobOffset + Math.sin(t * HAND_BOB_RATE) * HAND_BOB_AMP;
        }

        return { move, jump: playerJump };
    }
    update._lastStep = 0;

    // Wire canvas mouse handling. The right-click and middle-click
    // logic already lives in controls.js (entering fp-temp, orbit,
    // zoom). All we add here is left-click: scene-defined raycast or
    // interaction handler runs first, and if it returns falsy AND we're
    // in fp-temp, we fall through to tryLeftClickZoom().
    function wireClicks(clickOpts = {}) {
        canvas.addEventListener("mousedown", (e) => {
            if (e.button !== 0) return;
            let consumed = false;
            if (clickOpts.onLeftClick) {
                consumed = !!clickOpts.onLeftClick(e);
            }
            if (!consumed && controls.cameraState.mode === "fp-temp") {
                controls.tryLeftClickZoom();
            }
        });
        if (clickOpts.onRightClick) {
            canvas.addEventListener("mousedown", (e) => {
                if (e.button === 2) clickOpts.onRightClick(e);
            });
        }
    }

    function destroy() {
        // Currently nothing scene-controls owns is hot-attached past
        // the canvas; pages reload to swap scenes. Stub kept for API
        // symmetry — future scene-swap work can hang cleanup here.
    }

    return { rig, player, jump: playerJump, update, wireClicks, destroy };
}
