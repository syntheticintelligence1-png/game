# AEGIS SPEAR — shared engineering conventions

Browser combat simulator. Plain ES modules in `src/`, bundled by esbuild into ONE html file at the end.
Only external import allowed: `import * as THREE from 'three';` (three r186, local copy at
`node_modules/three`). Addons are NOT available in the final build — do not import from
`three/addons/...`. If you need a merge helper, write it yourself (see `mergeParts` below).

## Units & axes
- Meters, seconds, kilograms, radians (degrees only in UI text).
- World: +Y up, +X east, -Z north. Sea level y = 0.
- Every vehicle/ship/aircraft/missile model faces **-Z** (nose/bow toward -Z), +Y up, +X = right side
  (starboard). Origin: aircraft = center of gravity; ships = waterline amidships (y=0 is the waterline,
  hull extends below to -draft); ground vehicles = ground contact center (y=0 is the ground).
- Rotations of moving parts: turrets yaw about local +Y; guns/barrels pitch about local +X
  (positive rotation.x = elevate barrel up, because barrels point along -Z); radars spin about +Y.

## Geometry / material rules (performance + thermal rendering)
- Merge all STATIC parts of a model that share a material into one BufferGeometry. Only parts that
  move (turret, gun, radar dish, control surfaces...) are separate meshes.
- Target: <= 6 draw calls per ground vehicle, <= 12 per ship (excluding moving parts), use
  MeshStandardMaterial (metalness/roughness PBR). Create NEW material instances per build call (the engine
  patches materials per-vehicle for thermal imaging), but CACHE geometries per model kind at module scope and
  reuse them across calls.
- Every geometry MUST carry these attributes: `position`, `normal`, `uv`, and `heat` (Float32, itemSize 1,
  range 0..1). heat = 1 on hot surfaces (engine exhaust grilles, funnels/stacks, gun muzzles = 0.3),
  0 elsewhere. The thermal camera reads it. Convert every part to non-indexed (`geo.toNonIndexed()`) before
  merging so attribute sets match.
- Vertex colors are allowed (attribute `color`, itemSize 3) for detail/variation; if one part of a merged
  mesh has color, all parts must (fill white). Set `vertexColors: true` on the material then.
- No external textures. Procedural CanvasTexture is allowed (set `tex.colorSpace = THREE.SRGBColorSpace`
  for color maps).
- Moving-part meshes are children placed at their pivot, so rotating them pivots correctly.

## Returned object shape for unit builders
```js
{
  root: THREE.Group,            // add to scene; position/rotate this
  nodes: { turret, gun, radar, muzzles:[Object3D], ciws:[{base, gun, muzzle}], ... }, // as specified
  info: {
    length, width, height,      // meters (bounding)
    radius,                     // bounding sphere radius about root origin
    hitSpheres: [{ c: THREE.Vector3 /*local*/, r }], // 1..8 spheres covering the hull for damage tests
    materials: [ ...all materials used ],            // engine patches them
    ...builder-specific extras
  }
}
```

## Mergeing helper (copy into your module, do not import addons)
```js
function mergeParts(parts) { // parts: array of non-indexed BufferGeometry with identical attribute names
  const names = Object.keys(parts[0].attributes);
  let count = 0; for (const g of parts) count += g.attributes.position.count;
  const out = new THREE.BufferGeometry();
  for (const n of names) {
    const size = parts[0].attributes[n].itemSize, arr = new Float32Array(count * size); let o = 0;
    for (const g of parts) { arr.set(g.attributes[n].array, o); o += g.attributes[n].array.length; }
    out.setAttribute(n, new THREE.BufferAttribute(arr, size));
  }
  out.computeBoundingSphere(); out.computeBoundingBox(); return out;
}
```

## Testing
`python3 test/run.py <page under /home/claude/aegis> --wait 4000 --shot /path/out.png` serves the project
over HTTP and runs headless Chromium (SwiftShader WebGL2 — slow but correct). Dev pages use an import map:
`<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js"}}</script>`.
Look at screenshots with the Read tool. Console errors are printed by run.py.
