// Diagnose room detection on a venue file outside the browser.
// node scripts/room-debug.mjs uploads/venues/<file>.glb
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import draco3d from "draco3dgltf";
import { pathToFileURL } from "node:url";
const appMods = new URL("../../app/node_modules/", import.meta.url);
const THREE = await import(new URL("three/build/three.module.js", appMods));
const bvh = await import(new URL("three-mesh-bvh/build/index.module.js", appMods));
THREE.BufferGeometry.prototype.computeBoundsTree = bvh.computeBoundsTree;
THREE.Mesh.prototype.raycast = bvh.acceleratedRaycast;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "draco3d.decoder": await draco3d.createDecoderModule() });
const doc = await io.read(process.argv[2]);
const root = new THREE.Group();
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh(); if (!mesh) continue;
  const m = new THREE.Matrix4().fromArray(node.getWorldMatrix());
  for (const p of mesh.listPrimitives()) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(p.getAttribute("POSITION").getArray(), 3));
    if (p.getIndices()) g.setIndex(new THREE.BufferAttribute(p.getIndices().getArray(), 1));
    g.applyMatrix4(m); g.computeVertexNormals(); g.computeBoundsTree();
    root.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })));
  }
}
root.updateMatrixWorld(true);
const box = new THREE.Box3().setFromObject(root), raw = box.getSize(new THREE.Vector3());
console.log("bbox min", box.min.toArray().map((v) => v.toFixed(2)), "size", raw.toArray().map((v) => v.toFixed(2)));

// floor (same as app)
const ray = new THREE.Raycaster(); ray.firstHitOnly = true;
const hits = [];
for (let i = 0; i < 6; i++) for (let k = 0; k < 6; k++) {
  ray.set(new THREE.Vector3(box.min.x + raw.x * (0.2 + 0.6 * i / 5), box.min.y + raw.y * 0.6, box.min.z + raw.z * (0.2 + 0.6 * k / 5)), new THREE.Vector3(0, -1, 0)); ray.far = raw.y;
  const h = ray.intersectObject(root, true)[0]; if (h) hits.push(+h.point.y.toFixed(2));
}
console.log("floor ray hits", hits.join(" "));
const buckets = new Map(); for (const y of hits) { const b = Math.round(y / 0.05); buckets.set(b, (buckets.get(b) || 0) + 1); }
const floorY = [...buckets.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0] * 0.05;
console.log("floorY", floorY);

// room scan
const y = floorY + 1.2;
let onFloor = 0, enclosedish = 0;
const step = Math.max(raw.x, raw.z) / 28;
const grid = [];
for (let z = box.min.z + step / 2; z < box.max.z; z += step) {
  let row = "";
  for (let x = box.min.x + step / 2; x < box.max.x; x += step) {
    ray.set(new THREE.Vector3(x, y, z), new THREE.Vector3(0, -1, 0)); ray.far = 2;
    const h = ray.intersectObject(root, true)[0];
    const ok = h && Math.abs(h.point.y - floorY) < 0.5;
    if (!h) row += " "; else if (ok) { row += "."; onFloor++; } else row += h.point.y > floorY ? "^" : "v";
  }
  grid.push(row);
}
console.log(`samples on floor: ${onFloor}`);

// same search as the app
const cast = (x, z, dx, dz) => { ray.set(new THREE.Vector3(x, y, z), new THREE.Vector3(dx, 0, dz)); ray.far = Math.max(raw.x, raw.z); const h = ray.intersectObject(root, true)[0]; return h ? h.distance : null; };
const reach = (x, z, dx, dz) => cast(x, z, dx, dz) ?? (dx > 0 ? box.max.x - x : dx < 0 ? x - box.min.x : dz > 0 ? box.max.z - z : z - box.min.z);
const around = (x, z) => { const l = reach(x, z, -1, 0), r = reach(x, z, 1, 0), b = reach(x, z, 0, -1), f = reach(x, z, 0, 1); return { x0: x - l, x1: x + r, z0: z - b, z1: z + f }; };
const cands = [];
for (let x = box.min.x + step / 2; x < box.max.x; x += step) for (let z = box.min.z + step / 2; z < box.max.z; z += step) {
  const r = around(x, z), w = r.x1 - r.x0, d = r.z1 - r.z0;
  cands.push({ x: +x.toFixed(1), z: +z.toFixed(1), w: +w.toFixed(1), d: +d.toFixed(1), score: w * d * Math.min(1, Math.min(w, d) / (0.45 * Math.max(w, d))) });
}
cands.sort((a, b) => b.score - a.score);
console.log("top rooms:"); for (const c of cands.slice(0, 8)) console.log(" ", JSON.stringify(c));

// refine: walls are where most rays across the room stop (lower third ignores doorways)
const refine = (best) => {
  for (let pass = 0; pass < 2; pass++) {
    const cx = (best.x0 + best.x1) / 2, cz = (best.z0 + best.z1) / 2;
    const xs = [0.2, 0.35, 0.5, 0.65, 0.8].map((t) => best.x0 + (best.x1 - best.x0) * t);
    const zs = [0.2, 0.35, 0.5, 0.65, 0.8].map((t) => best.z0 + (best.z1 - best.z0) * t);
    const pick = (v) => { const k = v.filter((d) => d != null).sort((a, b) => a - b); return k.length ? k[Math.floor(k.length / 3)] : null; };
    const r = pick(zs.map((z) => cast(cx, z, 1, 0))), l = pick(zs.map((z) => cast(cx, z, -1, 0)));
    const f = pick(xs.map((x) => cast(x, cz, 0, 1))), b = pick(xs.map((x) => cast(x, cz, 0, -1)));
    best = { x0: l != null ? cx - l : best.x0, x1: r != null ? cx + r : best.x1, z0: b != null ? cz - b : best.z0, z1: f != null ? cz + f : best.z1 };
  }
  return best;
};
const refined = cands.map((c) => {
  const r = refine(around(c.x, c.z)), w = r.x1 - r.x0, d = r.z1 - r.z0;
  const inside = c.x > r.x0 && c.x < r.x1 && c.z > r.z0 && c.z < r.z1;
  return { seed: [c.x, c.z], rect: [r.x0, r.x1, r.z0, r.z1].map((v) => +v.toFixed(1)), w: +w.toFixed(1), d: +d.toFixed(1), score: inside ? w * d * Math.min(1, Math.min(w, d) / (0.45 * Math.max(w, d))) : 0 };
}).sort((a, b) => b.score - a.score);
console.log("after refining:"); for (const c of refined.slice(0, 6)) console.log(" ", JSON.stringify(c));
// map of open-box sizes (area/10) to see the rooms
const lines = [];
for (let z = box.min.z + step / 2; z < box.max.z; z += step) {
  let row = "";
  for (let x = box.min.x + step / 2; x < box.max.x; x += step) { const c = cands.find((k) => k.x === +x.toFixed(1) && k.z === +z.toFixed(1)); row += c ? String.fromCharCode(48 + Math.min(42, Math.round((c.w * c.d) / 40))) : " "; }
  lines.push(row);
}
console.log(lines.join("\n"));
