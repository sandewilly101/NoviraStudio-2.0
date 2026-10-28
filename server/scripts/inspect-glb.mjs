// Print every node/mesh of a GLB with its world bounds.
import { NodeIO } from "@gltf-transform/core";
import { getBounds } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import draco3d from "draco3dgltf";
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "draco3d.decoder": await draco3d.createDecoderModule() }).read(process.argv[2]);
for (const scene of doc.getRoot().listScenes()) scene.traverse((n) => {
  const m = n.getMesh();
  if (!m) return;
  const b = getBounds(n);
  const tris = m.listPrimitives().reduce((t, p) => t + (p.getIndices()?.getCount() ?? p.getAttribute("POSITION").getCount()) / 3, 0);
  console.log(JSON.stringify(n.getName()), "mesh", JSON.stringify(m.getName()), "mats", m.listPrimitives().map((p) => p.getMaterial()?.getName()).join(","), "tris", tris, "min", b.min.map((v) => v.toFixed(3)).join(","), "max", b.max.map((v) => v.toFixed(3)).join(","));
});
