// Send one instruction to the scene agent for a project and summarise what changed.
const API = "http://localhost:4150/api", [pid, ...words] = process.argv.slice(2);
const { token } = await (await fetch(API + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "demo@novira.studio", password: "novira-demo" }) })).json();
const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
const p = await (await fetch(`${API}/projects/${pid}`, { headers: H })).json();
const scene = p.scene || p.current?.scene;
const t = Date.now();
const r = await (await fetch(`${API}/projects/${pid}/ai-edit`, { method: "POST", headers: H, body: JSON.stringify({ instruction: words.join(" "), scene }) })).json();
console.log(`(${Math.round((Date.now() - t) / 1000)} s, ${r.source}) ${r.reply || r.error}`);
const before = new Map(scene.objects.map((o) => [o.id, o]));
for (const o of r.scene?.objects || []) {
  const b = before.get(o.id);
  if (!b) console.log("+", o.id, o.type, o.variant || "", o.color, "pos", o.position, "rot", Math.round((o.rotation?.[1] || 0) * 57.3), "size", o.size, JSON.stringify(o.spec || {}), o.content ? JSON.stringify(o.content) : "");
  else if (JSON.stringify(b) !== JSON.stringify(o)) console.log("~", o.id, o.type, "pos", b.position, "->", o.position, JSON.stringify(o.spec || {}), o.content ? JSON.stringify(o.content) : "");
}
for (const id of before.keys()) if (!r.scene?.objects.find((o) => o.id === id)) console.log("-", id);
if (process.env.SAVE) { await fetch(`${API}/projects/${pid}/versions`, { method: "POST", headers: H, body: JSON.stringify({ scene: r.scene, label: "Agent test" }) }); console.log("saved"); }
