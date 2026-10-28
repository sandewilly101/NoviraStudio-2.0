// Run the agent in-process on a project's scene and print its tool calls.
process.env.DEBUG_AGENT = "1";
const { runAgent } = await import("../src/ai/agent.js");
const { initDb, one } = await import("../src/db.js");
const { roomFromVenue } = await import("../src/ai/layout.js");
const { json } = await import("../src/db.js");
await initDb();
const [pid, ...words] = process.argv.slice(2);
const p = await one("SELECT * FROM projects WHERE id = ?", [pid]);
const v = await one("SELECT * FROM scene_versions WHERE project_id = ? ORDER BY version DESC LIMIT 1", [pid]);
const venue = p.venue_id ? await one("SELECT * FROM venues WHERE id = ?", [p.venue_id]) : null;
const room = roomFromVenue(venue ? json(venue.analysis, null) : null);
const out = await runAgent(words.join(" "), json(v.scene, {}), { room, relayout: async (s) => s });
console.log("REPLY:", out.reply);
process.exit(0);
