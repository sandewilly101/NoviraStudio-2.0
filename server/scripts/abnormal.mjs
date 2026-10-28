// Look for physically odd placements in solved layouts: overlaps, objects off the floor, through the ceiling, facing away.
import { solveLayout } from "../src/ai/layout.js";
const room = { minX: -17.18, maxX: 26.31, minZ: -13.88, maxZ: 1.24, floorY: 0, height: 5.88 };
const box = (o) => { const a = o.rotation?.[1] || 0, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a)); const hx = (o.size[0] * c + o.size[2] * s) / 2, hz = (o.size[0] * s + o.size[2] * c) / 2; return { x0: o.position[0] - hx, x1: o.position[0] + hx, z0: o.position[2] - hz, z1: o.position[2] + hz, y0: o.position[1], y1: o.position[1] + o.size[1] }; };
const ok = (a, b) => a.type === "lectern" || b.type === "lectern" || (a.type === "chair" && /table/.test(b.type)) || (b.type === "chair" && /table/.test(a.type)) || a.type === "centrepiece" || b.type === "centrepiece" || a.type === "dance_floor" && b.type === "dance_floor";
for (const layout of ["banquet", "feast", "theater", "cocktail"]) for (const guests of [60, 120, 250]) {
  const { objects, checks } = solveLayout({ guests, layout, include: { danceFloor: true, bar: true, lectern: true } }, room);
  const issues = [];
  const B = objects.map(box);
  for (let i = 0; i < objects.length; i++) {
    const o = objects[i], b = B[i];
    if (b.y1 > room.height) issues.push(`${o.name} pokes through ceiling (${b.y1.toFixed(2)})`);
    if (b.y0 < -0.01) issues.push(`${o.name} below floor`);
    for (let j = i + 1; j < objects.length; j++) {
      const p = objects[j], c = B[j];
      if (ok(o, p)) continue;
      const ix = Math.min(b.x1, c.x1) - Math.max(b.x0, c.x0), iz = Math.min(b.z1, c.z1) - Math.max(b.z0, c.z0), iy = Math.min(b.y1, c.y1) - Math.max(b.y0, c.y0);
      if (ix > 0.05 && iz > 0.05 && iy > -0.01) issues.push(`${o.name} overlaps ${p.name} (${ix.toFixed(2)}×${iz.toFixed(2)})`);
    }
  }
  const chairs = objects.filter((o) => o.type === "chair");
  // chairs should face their table / the stage
  const counts = {};
  for (const s of issues) { const k = s.replace(/\d+/g, "#"); counts[k] = (counts[k] || 0) + 1; }
  console.log(`${layout} ${guests}: ${objects.length} objects, ${chairs.length} chairs, ${issues.length} issues`, JSON.stringify(counts).slice(0, 600), checks.filter((c) => c.level !== "ok").map((c) => c.text).join(" | "));
}
