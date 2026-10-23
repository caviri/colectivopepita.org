# 3D Modelling Guide

How to author, structure, and animate 3D content for this project, and the
reasons behind each choice. Read this before adding a new asset.

## Format

**Author and ship glTF/GLB. Do not author as OBJ.**

OBJ has none of: PBR materials, scene graph, lights, cameras, animation,
skeletal rigging, instancing, embedded textures. Every OBJ in this repo had
its materials reassigned manually in `main.js` / `lab.js`, which produced a
two-stage texture-coordinate bug we had to work around with `gltfpack -kv
-vtf`:

  1. gltfpack strips `TEXCOORD_0` by default when no source material
     references it (`-kv` keeps the channel).
  2. gltfpack also default-quantizes UVs to uint16 with bounds derived from
     active material references; with `-kv` and no material, those bounds
     collapse to [0,0] — the channel exists but every UV is zero, so all
     triangles sample one texel and the model looks flat-shaded (`-vtf`
     forces float32 UVs and bypasses the bounds calculation).

glTF authored properly (with materials referencing the UVs) avoids the entire
class of bug because materials, UVs, and meshes travel together.

- **Working format:** `.blend` (or `.fbx` if a tool requires it).
- **Export format:** glTF 2.0 binary (`.glb`).
- **Delivery format:** Meshopt-compressed `.glb` (produced by
  `src/preprocess/compress-meshes.mjs`).

OBJ is acceptable only as a third-party download you immediately convert
through Blender to GLB; do not commit new OBJs.

## Granularity: one GLB per *what*?

Split files by the **lifetime and authority** of their content, not by
artistic taste.

### One big GLB per scenario (scenery)

Anything the player walks past but never interacts with belongs in a single
scene file:

- The interior of the lab
- The exterior terrain and base buildings
- Static props lined up on shelves

One file means one HTTP request, one material setup pass in Blender, and no
per-asset wiring code in JS. The 86-part Laboratory 3D model and 35-part
Virtueel laboratorium today are the prime candidates for collapsing into one
GLB each.

### One GLB per interactable

Anything with its own gameplay identity stays as a separate file:

- Items the player picks up (petri dish, equipment)
- Doors, hatches, lids that open
- Vehicles you climb into
- Characters (penguin, antarctic researcher)
- Portal targets (shipping container that links to another scene)

This lets you swap, instance, hot-reload, attach colliders, and wire input
without surgery on a giant scene graph.

### Rule of thumb

> If a thing has its own update loop, its own collider, or its own user
> prompt — it's its own GLB. Otherwise, it joins the scenery file.

## Materials and UVs

- Set up materials **in Blender**, using the Principled BSDF. glTF maps
  Principled BSDF → `MeshStandardMaterial` cleanly.
- Bake roughness, metallic, normal, AO into combined or separate maps; the
  preprocess pipeline will convert them to WebP and cap the long edge at
  2048 px.
- Set the correct color space on textures in Blender:
  - Base color / emissive → sRGB
  - Normal / roughness / metallic / AO → Non-Color (Linear)
- When loading raw image files at runtime via `loadTexture()` (the OBJ-era
  texture path), pass `{ colorSpace: THREE.NoColorSpace }` for non-color
  data. The default is `SRGBColorSpace` which is right for albedo/emissive
  but wrong for normals/roughness/metallic — three.js applies an sRGB→linear
  conversion that throws lighting off otherwise.
- UV-unwrap before exporting. If you author in Blender you get this for free;
  if you import an OBJ that has UVs but no material, **make sure the GLB
  preprocess uses `-kv`** so they survive (already configured here).

## Animation

Two clean buckets — pick one per motion, don't mix.

### Bake in Blender, play with `AnimationMixer`

For motion that is **cyclic, character-driven, or hand-authored**:

- Skeletal: penguin walk/idle, person standing/walking
- Rigid TRS clips: door opening, container hatch hinging, drawer sliding
- Morph targets: facial expressions (rare here)

Workflow:

1. Rig and animate in Blender, name clips clearly (`walk`, `idle`, `open`).
2. Export GLB with animations enabled.
3. Runtime: `const mixer = new THREE.AnimationMixer(scene); mixer.clipAction(gltf.animations[0]).play();` and call `mixer.update(dt)` each frame.

Cost: ~2× geometry size for a rigged character (joints + per-frame
transforms). gltfpack with `-cc` already compresses these tracks; on-disk
cost is rarely the constraint, **rigging effort** is. Don't rig anything you
won't actually animate.

### Drive in code

For motion that is **procedural, responsive, or driven by gameplay state**:

- Flag waving, water ripples, foliage sway → vertex shader or noise-based JS
- Hover bob, breathing scale, idle drift → `mesh.position.y = ...` in update
- Wheel rotation tied to vehicle velocity → JS, not a baked clip
- Particle systems → JS / instanced meshes
- Camera framing, cinematic moves → JS, not glTF camera tracks

These are easier to parameterise (tune from a slider, react to inputs) and
don't bloat the GLB.

## Blueprints

`scripts/render-blueprints.py` produces a CAD-style PNG sheet for every asset
folder, plus a world-layout sheet for the outdoor scene. Useful for quick
size sanity-checks, level-design overviews, or screenshots when discussing
a model.

Each per-asset sheet is a 4-panel layout (front / right / top / iso) on a
dark navy background with cyan line art, a metric grid scaled to the asset
(1 cm minor for petri dishes, 2 m major for the lab), real-world dimensions
in metres, and a vertex / triangle count pulled from `data/asset-meta.json`.

The world sheet is a top-down schematic of the outdoor scene: play radius,
fog ring, ice-wall arc, lab footprint, prop footprints (containers, truck,
flag, antarctic man), penguin spawn points, and the player spawn marker —
positions hardcoded from `src/main.js` constants.

### Where to find them

```
data/_blueprints/
├── _world.png                            # outdoor scene layout
├── 20ft cargo container(White).png
├── Antarctic Research Truck.png
├── Emperor penguin chick.png
├── Laboratory 3D model.png               # the lab interior model
├── Virtueel laboratorium _ Virtual Laboratory.png   # container-lab interior
└── … one PNG per asset folder
```

View them in VS Code (click the file in the explorer), in the dev server at
`http://127.0.0.1:8888/data/_blueprints/<name>.png`, or with any image
viewer.

### Regenerating

```bash
python3 scripts/render-blueprints.py                # all assets + world
python3 scripts/render-blueprints.py --only "Antarctic Research Truck"
python3 scripts/render-blueprints.py --world-only   # just the world map
```

The script reads the original OBJ files for line geometry and pulls
`targetSize`, `partCount`, etc. from `data/asset-meta.json` — so always
regenerate `asset-meta.json` first if you've added or replaced an asset.

When the outdoor scene layout changes (props moved, ice zone resized, lab
dimensions changed), update the `WORLD` constants at the top of
`scripts/render-blueprints.py` to match `src/main.js`.

## Pipeline checklist for a new asset

1. Model and UV-unwrap in Blender.
2. Set up Principled BSDF materials with correctly tagged texture nodes.
3. Animate if needed; name clips.
4. Export `.glb` into `data/<asset name>/source.glb` (this raw export is the
   editable artifact and can stay tracked in LFS or external storage if it's
   large).
5. Run `node src/preprocess/run.mjs` — produces compressed copies under
   `data/optimized/` and updates `data/asset-meta.json`.
6. Reference the asset from `assets.js`'s `loadFolder` or `loadOBJ` (despite
   the name, it dispatches to GLTFLoader for `.glb` URLs).

## Things to avoid

- Hand-assigning textures in JS for new assets — set them up in Blender
  instead. The shipping-container / truck pattern in `main.js` is legacy
  from the OBJ era; new code shouldn't grow more of it.
- Re-exporting the same model with different texture sets — use glTF
  variants (`KHR_materials_variants`) or material switches.
- glTF camera and light tracks for gameplay cameras / dynamic lights —
  authoring those in code is almost always the right call.
- Hundreds of named nodes inside a scenery GLB — it inflates the JS scene
  graph for no benefit. Merge meshes that share a material.
