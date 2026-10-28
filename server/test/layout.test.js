import { test } from "node:test";
import assert from "node:assert/strict";
import { solveLayout } from "../src/ai/layout.js";
import { rulePlan, ruleEdit, applyOps } from "../src/ai/planner.js";

const room = { minX: -15, maxX: 15, minZ: -15, maxZ: 15, floorY: 0 };
const inside = (o) => o.position[0] > room.minX && o.position[0] < room.maxX && o.position[2] > room.minZ && o.position[2] < room.maxZ;

test("banquet seats every guest inside the room", () => {
  const { objects, stats } = solveLayout({ guests: 128, layout: "banquet", seatsPerTable: 8 }, room);
  assert.equal(stats.seats, 128);
  assert.equal(stats.tables, 16);
  assert.ok(objects.every(inside));
});

test("round tables never overlap", () => {
  const tables = solveLayout({ guests: 200, layout: "banquet" }, room).objects.filter((o) => o.type === "round_table");
  for (let i = 0; i < tables.length; i++) for (let j = i + 1; j < tables.length; j++) {
    const d = Math.hypot(tables[i].position[0] - tables[j].position[0], tables[i].position[2] - tables[j].position[2]);
    assert.ok(d >= 2.9, `tables ${i} and ${j} are ${d.toFixed(2)} m apart`);
  }
});

test("tables form a balanced block in a wide room, not one long row", () => {
  const wide = { minX: -27, maxX: 27, minZ: -20, maxZ: 20, floorY: 0 };
  const tables = solveLayout({ guests: 128, layout: "banquet" }, wide).objects.filter((o) => o.type === "round_table");
  const rows = new Set(tables.map((t) => t.position[2].toFixed(1))).size;
  assert.equal(tables.length, 16);
  assert.ok(rows >= 3, `only ${rows} rows`);
});

test("tables stay clear of the stage", () => {
  const { objects } = solveLayout({ guests: 128, layout: "banquet" }, room);
  const stage = objects.find((o) => o.type === "stage");
  const front = stage.position[2] + stage.size[2] / 2;
  for (const t of objects.filter((o) => o.type === "round_table")) assert.ok(t.position[2] - 0.9 > front);
});

test("too many guests narrows walkways and warns", () => {
  const { checks, stats } = solveLayout({ guests: 2000, layout: "banquet" }, room);
  assert.ok(stats.seats < 2000);
  assert.ok(checks.some((c) => c.level === "warn"));
});

test("theater, feast and cocktail layouts produce objects", () => {
  for (const layout of ["theater", "feast", "cocktail"]) {
    const { objects, stats } = solveLayout({ guests: 150, layout }, room);
    assert.ok(objects.length > 5, layout);
    assert.ok(stats.seats > 0, layout);
    assert.ok(objects.every(inside), layout);
  }
});

test("long tables are split into segments no longer than ~10 m", () => {
  const { objects, stats } = solveLayout({ guests: 96, layout: "feast" }, room);
  const tables = objects.filter((o) => o.type === "long_table");
  assert.equal(stats.seats, 96);
  assert.ok(tables.length >= 2);
  assert.ok(tables.every((t) => t.size[0] <= 10.5), "a table is longer than 10.5 m");
});

test("a wedding reception is seated, not a cocktail party", () => {
  assert.equal(rulePlan("Wedding reception for 96 guests, round tables of 8").layout, "banquet");
});

test("replacement models survive a re-layout", async () => {
  const { carryAssets } = await import("../src/routes/projects.js");
  const before = solveLayout({ guests: 32 }, room).objects.map((o) => (o.type === "chair" ? { ...o, asset: { url: "/uploads/assets/x.glb", name: "Tiffany" } } : o));
  const after = carryAssets(before, solveLayout({ guests: 64 }, room).objects);
  const chairs = after.filter((o) => o.type === "chair");
  assert.equal(chairs.length, 64);
  assert.ok(chairs.every((c) => c.asset?.name === "Tiffany"));
  assert.ok(after.filter((o) => o.type === "round_table").every((t) => !t.asset));
});

test("stage is whole 4 ft decks and the LED wall stands behind it, inside the room and under the ceiling", () => {
  const r = { ...room, height: 5 };
  const { objects } = solveLayout({ guests: 100 }, r);
  const stage = objects.find((o) => o.type === "stage"), led = objects.find((o) => o.type === "led_screen");
  for (const v of [stage.size[0], stage.size[2]]) assert.ok(Math.abs(v / 1.219 - Math.round(v / 1.219)) < 0.01, `${v} is not whole decks`);
  assert.ok(led.position[2] < stage.position[2] - stage.size[2] / 2, "LED wall is behind the stage");
  assert.ok(led.position[2] - 1.0 > r.minZ, "room for the LED frame behind it");
  assert.ok(led.position[1] + led.size[1] <= r.height - 0.4, "LED wall fits under the ceiling");
  assert.ok(Math.abs(led.size[0] / 0.5 - Math.round(led.size[0] / 0.5)) < 1e-6, "LED width is whole 0.5 m cabinets");
});

test("in a wide, shallow ballroom every object stays inside the walls and tables wrap around the dance floor", () => {
  const ballroom = { minX: -17.2, maxX: 26.3, minZ: -13.9, maxZ: 1.2, floorY: 0, height: 5.9 }; // the Rotana ballroom
  for (const layout of ["banquet", "feast", "theater", "cocktail"]) {
    const { objects } = solveLayout({ guests: 120, layout, include: { danceFloor: layout !== "cocktail" } }, ballroom);
    for (const o of objects) {
      const a = o.rotation?.[1] || 0, hx = (Math.abs(Math.cos(a)) * o.size[0] + Math.abs(Math.sin(a)) * o.size[2]) / 2, hz = (Math.abs(Math.sin(a)) * o.size[0] + Math.abs(Math.cos(a)) * o.size[2]) / 2;
      assert.ok(o.position[0] - hx >= ballroom.minX - 1e-6 && o.position[0] + hx <= ballroom.maxX + 1e-6, `${layout}: ${o.name} outside left/right walls`);
      assert.ok(o.position[2] - hz >= ballroom.minZ - 1e-6 && o.position[2] + hz <= ballroom.maxZ + 1e-6, `${layout}: ${o.name} outside front/back walls`);
    }
    const dance = objects.find((o) => o.type === "dance_floor");
    if (dance && layout === "banquet") {
      for (const t of objects.filter((o) => o.type === "round_table")) {
        const inside = Math.abs(t.position[0] - dance.position[0]) < dance.size[0] / 2 + 0.9 && Math.abs(t.position[2] - dance.position[2]) < dance.size[2] / 2 + 0.9;
        assert.ok(!inside, `${t.name} is on the dance floor`);
      }
      assert.ok(objects.filter((o) => o.type === "chair").length >= 100, "most guests still seated");
    }
  }
});

test("rule planner reads a brief", () => {
  const p = rulePlan("Corporate gala for 120 guests, round tables of 10, gold and white, dance floor");
  assert.equal(p.guests, 120);
  assert.equal(p.seatsPerTable, 10);
  assert.equal(p.layout, "banquet");
  assert.equal(p.include.danceFloor, true);
  assert.equal(p.colors.accent, "#C9A227");
});

test("rule edit widens the stage and recolours chairs", () => {
  const scene = solveLayout({ guests: 64 }, room);
  const s = { plan: scene.plan, objects: scene.objects };
  const e1 = ruleEdit("Make the stage 2 m wider", s);
  const stageW = scene.objects.find((o) => o.type === "stage").size[0];
  assert.equal(e1.planPatch.stage.width, stageW + 2);
  const e2 = ruleEdit("make the chairs silver", s);
  const out = applyOps(s.objects, e2.ops);
  assert.ok(out.filter((o) => o.type === "chair").every((c) => c.color === "#AEB8C4"));
});
