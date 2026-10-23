# Scene authoring

How scenes get from the legacy hand-written `THREE.Scene` of `main.js` /
`lab.js` to the engine's data-driven JSON, and how to keep editing them. Two
parallel pipelines exist; this document explains which one to use when.

## Two paths into a scene

```
src/outdoor.html → main.js   ── (legacy, ~2.7k lines of hand-authored Three)
src/lab.html     → lab.js    ── (legacy)
src/lab2.html    → lab2.js   ── (legacy)

src/play.html?scene=<id>     ── (engine, reads data/scenes/<id>.json)
src/editor/editor.html       ── (engine authoring UI)
```

The legacy pages run as their own Three apps. The engine path reads JSON,
builds meshes from a small primitive vocabulary (box / sphere / cylinder /
plane) plus asset-folder references, and runs rule effects from the
knowledge graph. Only the engine path is editable from the editor.

The welcome menu at `src/index.html` is the public landing page; "New Game"
goes to the legacy outdoor page, "Editor" goes to the engine editor,
"Museum" is a placeholder.

## Exporting a legacy scene to engine JSON

Every legacy page (`outdoor`, `lab`, `lab2`) has an **Export Scene** button
in its pause menu (Esc → Export Scene). One click produces two downloads:

| File | Purpose |
|---|---|
| `<id>.json` | Engine-format scene file. Drop into `data/scenes/` to make it editable in the editor and runnable via `play.html?scene=<id>`. |
| `<id>.glb` | Binary glTF 2.0. Open in Blender (`File → Import → glTF 2.0`), Unity, Godot, or any online glTF viewer. Full mesh + material fidelity. |

Both come from the same source — a runtime walk of the live `THREE.Scene`,
implemented in `src/engine/core/export.js`. The `.glb` is the universal
interchange format; the `.json` is our schema. Use the `.json` for editor
work, the `.glb` for everything else.

### How the JSON exporter handles each mesh

| Source geometry | JSON output |
|---|---|
| `BoxGeometry` | `{shape: "box", size: [w,h,d]}` |
| `PlaneGeometry` | `{shape: "plane", size: [w,h]}` |
| `SphereGeometry` | `{shape: "sphere", size: [diameter]}` |
| `CylinderGeometry` | `{shape: "cylinder", size: [diameter, height]}` |
| `ConeGeometry` | downgrade to `cylinder` (engine doesn't have cones) |
| `CapsuleGeometry` | downgrade to `cylinder` |
| `TorusGeometry` | downgrade to flat `box` with the outer ring as bounds |
| `RingGeometry` | downgrade to `plane` |
| Anything else (incl. OBJ-loaded meshes) | last-resort bounding-box fallback, marked with `approx: true` |
| Group with `userData.assetFolder` set | `{kind: "asset", folder: "...", targetSize: ...}` |

That last row is the hook for surfacing asset-loaded models as references
instead of bbox boxes. Every model that goes through `assets.js#loadFolder`
gets tagged automatically. Models loaded via the lower-level `loadOBJ` need
a manual tag at the placement site, e.g.:

```js
const wrap = new THREE.Group();
wrap.add(loadedObj);
fitToFloor(wrap, 5.5);
wrap.userData.assetFolder = "Antarctic Research Truck";
wrap.userData.targetSize = 5.5;
```

`main.js` already tags its ~5 OBJ-loaded heroes (containers, truck,
Antarctic Man, penguin colony) for this reason.

### Material fidelity

The exporter also captures `transparent`, `opacity`, and `side` so cloud
planes / windows / snow patches round-trip. Procedural canvas textures (the
floor in `lab.js`, the Spanish flag) come through as flat colours in JSON;
the `.glb` preserves them as embedded image textures. Behaviour
(penguins wandering, doors opening, weather) lives in the JS, not in the
export — it belongs in `data/rules.json` if you want it engine-side.

### Capturing the *initial* env, not runtime drift

Several pages animate `scene.background` / `scene.fog.color` /
`sun.intensity` after load. Reading those at export time captures
mid-drift values, not the player's first-frame view. Pages stash the
initial values:

```js
scene.userData.initialEnv = { background: 0x..., fog: { ... } };
sun.userData.initialIntensity = 0.25;
```

`sniffEnv()` in `export.js` prefers those over the live values when
present. `outdoor.html` does this for background, fog and sun.

### Re-exporting to overwrite `data/scenes/*.json`

The browser export drops files in your downloads folder. To replace the
canonical scene used by the editor:

```
~/Downloads/main.json  →  data/scenes/main.json
```

The editor reads from this path (with IndexedDB-saved edits taking
precedence). `lab1.json` and `main.json` were both regenerated this way
from the live legacy scenes.

## Editing scenes in the editor

`src/editor/editor.html`. The right-hand inspector, when nothing is
selected, shows a per-scene environment editor.

### Lighting presets

Six chips at the top of the env panel — pick one to swap the whole mood
(background, ambient, sun, fog, sky) in one click, then nudge sliders.
Defined in `panels/env-editor.js#ENV_PRESETS`:

- **Antarctic noon** — cold blue sky, white sun, near fog
- **Arctic dusk** — pink-purple sky, low warm sun
- **Indoor warm** — black bg, no sky, warm ambient (good for labs)
- **Studio neutral** — gray bg, balanced lights, no fog (good for asset previews)
- **Sunset** — orange sky, low orange sun
- **Night** — dark blue, moonlight intensity

Add presets by editing the `ENV_PRESETS` object. Each entry is a complete
env snapshot — applying a preset is a destructive overwrite of the
mood-related fields (background, ambient, sun, fog, sky), but leaves
ground geometry alone.

### Fog toggle

`≈` button in the gizmo toolbar (right of fly mode). One click hides
fog; the previous fog config is stashed, so a second click restores
exactly what the user had. Also reflected in the env panel's Fog
checkbox.

### Sky dome

`env.sky = { kind: "gradient", top: 0xRRGGBB, bottom: 0xRRGGBB, exponent, offset }`.
Implemented as a back-side sphere with a two-colour shader gradient. `null`
means no dome — the scene's `background` colour is what shows.

The shader and helper live in two places, one for each runtime:

- `src/editor/viewport.js#buildSky` — editor preview
- `src/engine/runtime/play.js#buildGradientSky` — `play.html`

Keep them in sync if you edit one.

### Workspace grid

The editor's reference grid is 200 m × 200 m with 1 m cells. Big enough
to author the outdoor scene (`env.ground.size = 100`) without the grid
clipping at the horizon, small enough to read at typical zoom. Tweak in
`viewport.js#GRID_SIZE` / `GRID_DIVS`.

## Scene JSON schema, in brief

```jsonc
{
  "version": 1,
  "id": "main",
  "name": "Antarctic Base",
  "env": {
    "background": 0x7a8693,
    "fog": { "color": 0x7a8693, "near": 28, "far": 58 },
    "ambient": { "color": 0xffffff, "intensity": 0.6 },
    "sun": { "color": 0x9eb0d8, "intensity": 0.25, "position": [20, 35, 12] },
    "ground": { "color": 0xe6edf2, "size": 80 },
    "sky": { "kind": "gradient", "top": 0x6fa6c8, "bottom": 0xeaf3f8,
             "exponent": 0.55, "offset": 33 }
  },
  "camera": { "spawn": [0, 0, 6], "yaw": 0 },
  "entities": [
    { "id": "lab-body", "name": "Lab body",
      "transform": { "pos": [0, 2.2, 0], "rot": [0,0,0], "scale": [1,1,1] },
      "mesh": { "kind": "primitive", "shape": "box", "size": [11, 4.4, 6],
                "color": 0xb84a3a, "roughness": 0.8 },
      "properties": { "metal": true } }
  ]
}
```

Every field is optional except `version`, `id`, `entities`. `env.fog` /
`env.sky` are nullable. `mesh` can be `{kind:"primitive"}` or
`{kind:"asset"}`. `properties` keys must exist in `data/properties.json`
or they're dispatched as no-ops.

## Round-trip checklist

When you ship a new scene-related feature, verify the round-trip:

1. **Editor preview** — does it apply via `viewport.applyEnv(scene.env)`?
2. **Engine runtime** — does `engine/runtime/play.js` consume the new
   field? (sky / fog / opacity etc. all need both sides.)
3. **Schema default** — does `engine/core/scene.js#makeScene` initialise
   the field so old JSONs still load?
4. **Exporter** — if it's a material/env property the legacy scenes might
   contain, does `engine/core/export.js` capture it?
5. **Save / load** — does `serialize.js` round-trip via plain JSON?
   (Today's schema is shape-flat enough that any plain object survives.)

Skip any of those and the feature works *somewhere* but breaks at the
boundary.
