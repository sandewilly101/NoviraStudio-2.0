// Brief -> event plan, and chat instruction -> scene edits.
// Uses GPT-4o when OPENAI_API_KEY is set, otherwise a rule-based fallback,
// so the app works end to end without any key.
import { BUILD_SCHEMA, normalizeBuild } from "./build.js";
import { chat, openai } from "./openai.js";
import { config } from "../config.js";
import { DEFAULT_PLAN, mergePlan } from "./layout.js";
import { stylesForPrompt } from "./styles.js";

const client = openai;
export const aiEnabled = () => !!client;

const PLAN_SCHEMA = `{
  "eventName": string,               // short title for the LED screen
  "eventType": "gala"|"wedding"|"conference"|"exhibition"|"launch"|"party"|"dinner",
  "guests": integer,
  "layout": "banquet"|"theater"|"feast"|"cocktail",
  "seatsPerTable": 6|8|10|12,
  "walkway": number,                 // metres between chair backs, 1.2-2.5
  "include": { "stage": bool, "ledScreen": bool, "lectern": bool, "speakers": bool, "bar": bool, "danceFloor": bool },
  "stage": { "width": number, "depth": number, "height": number },   // metres, 0 = auto
  "colors": { "linen": "#hex", "chair": "#hex", "accent": "#hex", "stage": "#hex", "uplight": "#hex" },
  "screenText": string,
  "mode": "day"|"night"             // "day" unless the brief clearly asks for evening/night lighting
}`;

// What the designer adds on top of the seating plan: the creative concept, and
// concrete production steps the scene agent carries out in 3D.
const DESIGN_SCHEMA = `{
  "venueMention": string|null,       // a venue, hotel or place named in the brief ("Rotana", "Safari Park Hotel"), else null
  "setting": "indoor"|"outdoor",     // outdoor for open-air events: garden, lawn, beach, poolside, park, rooftop, festival grounds, safari/bush
  "ground": "grass"|"sand"|"paving"|null,  // outdoors: what the guests stand on
  "concept": string,                 // 1-2 sentences: the design idea, as a designer would pitch it
  "theme": { "name": string, "palette": [{ "name": string, "hex": "#hex" }] },   // 4-6 real colours of the theme
  "dressing": [string],              // 6-10 concrete production steps for the 3D scene (see rules)
  "screenArt": string,               // a prompt for an AI-painted graphic for the LED wall (no text in it unless names/titles are given)
  "screenTitle": string,             // short words for the LED wall, e.g. the couple's names or the event title
  "lighting": string,                // 2-3 search words for the lighting environment, e.g. "indoor warm", "night city", "sunset"
  ${stylesForPrompt()},
  "build": ${BUILD_SCHEMA}             // the design as it is built in 3D (see rules) — every idea of the concept, made real
}`;
const PRODUCTION = "stage (decks, skirting, stairs), LED wall, truss (goalpost, arch, square grid, circle, straight), lights (moving heads, washes, par cans, uplighters along walls, pinspots on centrepieces, gobo projectors, strip battens), dance floor (checker, white gloss, black gloss, oak, starlit), pipe-and-drape curtains (black, ivory, white sheer, navy, burgundy, gold), signs (easel poster, roll-up banner, step-and-repeat backdrop, backlit media wall, hanging banner, TV on a stand), screen layouts (one LED wall, main + angled side screens, triptych, ultrawide, LED columns, curved wall), stage front branding (printed skirt or LED fascia), chandeliers (crystal waterfall, gold candle, crystal sphere), ceiling drapes (fabric swags, parallel or a radiating canopy), wedding arches (draped canopy, round, hexagon, with flowers), chair covers and sashes, lounge sofas, bar counter, speakers, lectern, and real PBR materials (fabrics, woods, stone, leather, metal) on the stage deck/skirt, dance floor, curtains, tablecloths and venue floor/walls";

async function chatJson(system, user, feature = "Design planning") {
  const res = await chat(feature, {
    model: config.openai.model,
    temperature: 0.4,
    response_format: { type: "json_object" },
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
  });
  return JSON.parse(res.choices[0].message.content || "{}");
}

export { normalizeBuild };
export async function planFromBrief(brief, hints = {}) {
  let plan;
  if (client) {
    try {
      const out = await chatJson(
        `You are a senior event designer and production planner at Novira Studio. Read the brief like a professional would — ` +
        `understand the occasion even if it is misspelt or brief ("masaai weding" is a Maasai wedding), the culture, the mood, the guest count and the venue — ` +
        `and return ONLY one JSON object with two keys: "plan" matching\n${PLAN_SCHEMA}\nand "design" matching\n${DESIGN_SCHEMA}\n` +
        `Rules for the plan: realistic values; a solver places the furniture, so give no positions. Weddings get a dance floor and banquet or feast seating; ` +
        `conferences theatre rows; cocktails high tables. Colours must be real event materials, never web primaries ` +
        `(gold #C9A227, champagne #E8D9B5, ivory #F7F3E8, navy #1B2538, black #1B1B1F, blush #F0C9CF, burgundy #7A1E2C, emerald #1E7A5A, terracotta #B5553C, ochre #C8892B…), and must come from the theme.\n` +
        `Rules for the design: be genuinely creative and specific to this event and culture, but buildable by real event production. ` +
        `Each "dressing" step names real items from this production kit and where they go relative to the stage, dance floor, tables or walls: ${PRODUCTION}. ` +
        `Good steps read like "Ivory sheer pipe-and-drape 8 m wide behind the stage, layered in front of the LED wall's sides", "Warm red uplighters evenly along every wall", ` +
        `"Red tartan-check fabric (like a Maasai shuka) on the stage skirting", "A goalpost truss over the stage lip with 6 warm moving-head washes". ` +
        `The screenArt describes a rich, culturally respectful artwork in the theme palette. ` +
        `Rules for "build" — it IS the design: the 3D scene is built from it and the concept picture is then rendered from that scene, so anything not in "build" will not exist. ` +
        `Make it complete and specific to this theme: every colour from the palette given a role (linen, chair covers or sashes, drapes, uplights, stage skirt, ceiling); ` +
        `the centrepiece a real thing (a "model" with plain search words when candelabras don't fit the theme); 1-3 theme props that make the theme unmistakable, as real objects a prop-hire company would bring ` +
        `(e.g. for a Formula One night: "race car" at the entrance, "tyre stack" flanking the stage, "checkered flag" along the walls; for a Maasai wedding: "maasai shield", "spear", "calabash"), with real heights; ` +
        `branding where a real production would put it (a step-and-repeat at the entrance, roll-ups flanking the stage, hanging banners over it), each with a graphic brief in the theme; ` +
        `drapes, ceiling and lighting that create the mood. Never people, food or anything you cannot buy or hire. ` +
        `Props and furniture are sourced from real 3D libraries (BlenderKit, Sketchfab, Poly Haven) by their plain names, so name real, specific objects ("djembe drum", "maasai shield", "rattan chair"), not ideas. ` +
        `Sizes are real: height_m is the object's true height (a race car 1.0, a motorbike 1.1, a tyre stack 1.0, a flag on its pole 2.5, a potted palm 1.8, a floor vase 1.0); a centrepiece is 0.3-0.7 m tall. ` +
        `Fit the theme: chandeliers and ceiling swags suit elegant, romantic or formal events, not sport, tech or club nights (use moving heads, haze and gobos there). ` +
        `Branding graphics: describe imagery, colours and shapes only — never logos, brands or sponsors (they would be invented). ` +
        `Outdoor events ("setting": "outdoor") have no walls or ceiling: no wall or ceiling drapes, no chandeliers; drapes only as a backdrop behind the stage; ` +
        `the environment words describe the sky ("sunny park", "golden hour field", "night sky"). ` +
        `Chairs: pick the chairStyle whose own colours suit the palette; if none does, give the chairs covers (and sashes if fitting) in the palette, so no off-theme colour shows.`,
        JSON.stringify({ brief, userChoices: hints }),
      );
      plan = mergePlan(DEFAULT_PLAN, { ...(out.plan || out), ...cleanHints(hints) });
      // celebrations are evening events unless the brief says otherwise; conferences and expos run by day
      const daytime = /\b(day ?time|morning|brunch|breakfast|lunch|afternoon|by day|daylight)\b/i.test(brief);
      plan.mode = out.plan?.mode === "night" || wantsNight(brief) || (!daytime && ["wedding", "gala", "dinner", "party", "launch"].includes(plan.eventType)) ? "night" : "day";
      // weddings, galas and dinners are seated unless the brief itself asks for a standing / cocktail event
      if (["wedding", "gala", "dinner"].includes(plan.eventType) && plan.layout === "cocktail" && !hints.layout && !/cocktail|standing|mingl|reception drinks/i.test(brief)) plan.layout = "banquet";
      const d = out.design || {};
      plan.design = {
        venueMention: typeof d.venueMention === "string" && d.venueMention.trim() ? d.venueMention.trim() : null,
        // the designer's call; the words of the brief only when it didn't make one ("Safari Park Hotel" is indoors)
        setting: d.setting === "outdoor" || (d.setting !== "indoor" && OUTDOOR.test(brief)) ? "outdoor" : "indoor",
        ground: ["grass", "sand", "paving"].includes(d.ground) ? d.ground : /beach|sand/i.test(brief) ? "sand" : /rooftop|terrace|courtyard|plaza/i.test(brief) ? "paving" : "grass",
        concept: String(d.concept || ""), theme: { name: String(d.theme?.name || ""), palette: Array.isArray(d.theme?.palette) ? d.theme.palette.filter((c) => /^#[0-9a-f]{6}$/i.test(c?.hex)).slice(0, 6) : [] },
        dressing: Array.isArray(d.dressing) ? d.dressing.map(String).slice(0, 10) : [],
        screenArt: String(d.screenArt || ""), screenTitle: String(d.screenTitle || plan.eventName || ""), lighting: String(d.lighting || ""),
        chairStyle: String(d.chairStyle || ""), tableStyle: String(d.tableStyle || ""),
      };
      plan.design.build = normalizeBuild(d.build || {}, plan.design.theme.palette);
      if (plan.design.screenTitle) plan.screenText = plan.design.screenTitle;
      return { plan, source: "gpt" };
    } catch (e) {
      console.warn("[ai] planFromBrief fell back to rules:", e.message);
    }
  }
  plan = mergePlan(DEFAULT_PLAN, { ...rulePlan(brief), ...cleanHints(hints) });
  return { plan, source: "rules" };
}

// words that put an event in the open air
export const OUTDOOR = /\b(outdoors?|open[- ]air|garden|lawn|beach|seaside|poolside|park|rooftop|terrace|courtyard|field|grounds|safari|bush|festival|under the stars|al fresco)\b/i;
const wantsNight = (brief = "") => /\b(night|evening|after dark|uplighting|uplights?|candlelit)\b/i.test(brief);

function cleanHints(h) {
  const out = {};
  if (h.guests) out.guests = Number(h.guests);
  if (h.eventName) out.eventName = h.eventName;
  if (h.eventType) out.eventType = h.eventType;
  if (h.layout) out.layout = h.layout;
  if (h.colors) out.colors = h.colors;
  if (h.include) out.include = h.include;
  return out;
}


// Three genuinely different layouts for the "pick a design" screen — all of them
// right for the occasion: a wedding or dinner is always seated (rounds of 8, long
// feast tables, grand rounds of 10), never a standing cocktail.
const SEATED = ["wedding", "gala", "dinner"];
export function variantsOf(plan) {
  const seated = SEATED.includes(plan.eventType) && plan.layout !== "cocktail" && plan.layout !== "theater";
  const order = seated
    ? [[plan.layout, {}], [plan.layout === "feast" ? "banquet" : "feast", {}], ["banquet", { seatsPerTable: plan.seatsPerTable === 10 ? 8 : 10, walkway: Math.max(plan.walkway, 1.8) }]]
    : ({ banquet: ["banquet", "feast", "cocktail"], feast: ["feast", "banquet", "cocktail"], theater: ["theater", "banquet", "cocktail"], cocktail: ["cocktail", "banquet", "feast"] }[plan.layout] || ["banquet", "feast", "cocktail"]).map((l) => [l, {}]);
  return order.map(([layout, extra], i) => mergePlan(plan, { layout, include: layout === "cocktail" ? { danceFloor: false } : {}, walkway: i === 1 ? Math.max(plan.walkway, 1.8) : plan.walkway, ...extra }));
}

// ---------- chat edits ----------
// Returns { reply, planPatch?, ops: [...] } — ops act on scene objects.
export async function editFromInstruction(instruction, scene) {
  if (client) {
    try {
      const summary = summarise(scene);
      const out = await chatJson(
        `You edit a 3D event layout. Current plan and objects are given. Return ONLY JSON:\n` +
        `{"reply": "one short sentence of what you changed",\n "planPatch": partial plan object or null (use for layout, guests, seats, walkway, include, colors, stage size, mode, screenText — the room is re-laid out),\n` +
        ` "ops": [ {"op":"update","match":{"id"?:string,"type"?:string},"set":{"color"?: "#hex","material"?: "matte|gloss|fabric|metal|wood","scale"?: number,"size"?: [w,h,d],"move"?: [dx,0,dz],"text"?: {"content": string}}},\n` +
        `          {"op":"remove","match":{...}} ]}\n` +
        `Prefer ops for small changes to existing objects; use planPatch for structural changes. Plan schema:\n${PLAN_SCHEMA}`,
        JSON.stringify({ instruction, ...summary }),
        "AI assistant",
      );
      return { reply: out.reply || "Done.", planPatch: out.planPatch || null, ops: Array.isArray(out.ops) ? out.ops : [], source: "gpt" };
    } catch (e) {
      console.warn("[ai] edit fell back to rules:", e.message);
    }
  }
  return { ...ruleEdit(instruction, scene), source: "rules" };
}

function summarise(scene) {
  const counts = {};
  const notable = [];
  for (const o of scene.objects || []) {
    counts[o.type] = (counts[o.type] || 0) + 1;
    if (!["chair", "centrepiece"].includes(o.type) && notable.length < 40) notable.push({ id: o.id, type: o.type, name: o.name, size: o.size, color: o.color, position: o.position.map((v) => Math.round(v * 10) / 10) });
  }
  return { plan: scene.plan, counts, objects: notable };
}

// ---------- rule-based fallbacks ----------
const COLORS = { gold: "#C9A227", white: "#F7F7F5", ivory: "#F7F3E8", cream: "#F3EAD3", black: "#1B1B1F", navy: "#1B2538", blue: "#006AB1", red: "#B3263A", burgundy: "#7A1E2C", pink: "#E7A3B4", blush: "#F0C9CF", silver: "#AEB8C4", green: "#2F7D4F", emerald: "#1E7A5A", purple: "#6E3FB0", violet: "#8B5CF6", rose: "#C76B7E", champagne: "#E8D9B5", teal: "#127A7A" };

export function rulePlan(brief = "") {
  const t = brief.toLowerCase();
  const p = {};
  const g = t.match(/(\d{2,4})\s*(guests|people|pax|attendees|persons)/) || t.match(/for\s+(\d{2,4})/);
  if (g) p.guests = Number(g[1]);
  const s = t.match(/tables? of (\d{1,2})/);
  if (s) p.seatsPerTable = Number(s[1]);
  if (/theat|conference|summit|keynote|seminar|rows/.test(t)) p.layout = "theater";
  else if (/long table|feast|family style|banquet table/.test(t)) p.layout = "feast";
  else if (/cocktail|lounge|standing|mingl/.test(t)) p.layout = "cocktail";
  else p.layout = "banquet";
  p.eventType = /wedding/.test(t) ? "wedding" : /conference|summit/.test(t) ? "conference" : /launch/.test(t) ? "launch" : /party|concert/.test(t) ? "party" : /dinner/.test(t) ? "dinner" : "gala";
  const found = Object.keys(COLORS).filter((k) => new RegExp(`\\b${k}\\b`).test(t));
  if (found.length) p.colors = { accent: COLORS[found[0]], chair: COLORS[found[0]], linen: COLORS[found.find((k) => ["white", "ivory", "cream", "champagne", "blush"].includes(k))] || DEFAULT_PLAN.colors.linen };
  p.include = { danceFloor: /danc/.test(t), bar: !/no bar/.test(t), stage: !/no stage/.test(t), ledScreen: !/no (led|screen)/.test(t) };
  if (p.eventType === "wedding") Object.assign(p.colors ||= {}, { chair: p.colors?.chair || "#F5F2EC" });
  const name = brief.match(/"([^"]{3,40})"/) || brief.match(/(?:called|named|for the)\s+([A-Z][\w&' ]{2,40})/);
  p.eventName = name ? name[1].trim() : titleFor(p.eventType);
  p.mode = /\b(night|evening|dinner party|after dark)\b/.test(t) ? "night" : "day"; // light by default
  return p;
}

const titleFor = (type) => ({ wedding: "Welcome", conference: "Annual Summit", launch: "Launch Night", party: "Let's Celebrate", dinner: "Gala Dinner" }[type] || "Gala Dinner");

export function ruleEdit(instruction, scene) {
  const t = instruction.toLowerCase();
  const ops = [], planPatch = {}, done = [];
  const plan = scene.plan || DEFAULT_PLAN;
  const colourIn = () => Object.keys(COLORS).find((k) => new RegExp(`\\b${k}\\b`).test(t));

  const m = t.match(/(\d+(?:\.\d+)?)\s*m\s*(wider|bigger|larger|narrower|smaller)/);
  if (/stage/.test(t) && /(wider|bigger|larger|narrower|smaller)/.test(t)) {
    const stage = scene.objects.find((o) => o.type === "stage");
    if (stage) {
      const grow = /(narrower|smaller)/.test(t) ? -1 : 1;
      const dw = m ? Number(m[1]) * grow : stage.size[0] * 0.2 * grow;
      planPatch.stage = { ...plan.stage, width: Math.max(3, Math.round((stage.size[0] + dw) * 1000) / 1000), depth: stage.size[2], height: stage.size[1] };
      done.push(`stage is now ${planPatch.stage.width} m wide`);
    }
  }
  if (/bar/.test(t) && /(move|put|place)/.test(t) && /(left|right)/.test(t)) {
    const bar = scene.objects.find((o) => o.type === "bar");
    if (bar && /right/.test(t)) {
      const xs = scene.objects.map((o) => o.position[0]);
      ops.push({ op: "update", match: { type: "bar" }, set: { move: [Math.max(...xs) - bar.position[0], 0, 0] } });
      done.push("moved the bar to the right wall");
    } else done.push("the bar is on the left wall");
  }
  if (/(add|include|want).*(dance)/.test(t)) { planPatch.include = { ...(planPatch.include || {}), danceFloor: true }; done.push("added a dance floor"); }
  if (/(remove|no|without).*(dance)/.test(t)) { planPatch.include = { ...(planPatch.include || {}), danceFloor: false }; done.push("removed the dance floor"); }
  if (/(remove|no|without).*\bbar\b/.test(t)) { planPatch.include = { ...(planPatch.include || {}), bar: false }; done.push("removed the bar"); }
  if (/(more|wider).*(walkway|space|aisle)/.test(t)) { planPatch.walkway = plan.walkway + 0.3; done.push("widened walkways"); }
  const gm = t.match(/(\d{2,4})\s*(guests|people|seats)/);
  if (gm) { planPatch.guests = Number(gm[1]); done.push(`resized for ${gm[1]} guests`); }
  for (const [kw, layout] of [["long table", "feast"], ["feast", "feast"], ["round table", "banquet"], ["banquet", "banquet"], ["theater", "theater"], ["theatre", "theater"], ["cocktail", "cocktail"], ["lounge", "cocktail"]]) {
    if (t.includes(kw) && /(switch|change|make|use|turn)/.test(t)) { planPatch.layout = layout; done.push(`switched to ${layout} layout`); break; }
  }
  if (/\b(night|evening)\b/.test(t)) { planPatch.mode = "night"; done.push("switched to evening lighting"); }
  else if (/\b(day|daylight)\b/.test(t)) { planPatch.mode = "day"; done.push("switched to daylight"); }
  const col = colourIn();
  if (col) {
    const targets = [["chair", "chair"], ["linen", "round_table"], ["table", "round_table"], ["stage", "stage"], ["uplight", null], ["light", null]];
    const hit = targets.find(([k]) => t.includes(k));
    if (hit && hit[1]) { ops.push({ op: "update", match: { type: hit[1] }, set: { color: COLORS[col] } }); done.push(`made the ${hit[0]}s ${col}`); }
    else if (hit) { planPatch.colors = { ...(planPatch.colors || {}), uplight: COLORS[col] }; done.push(`uplights are now ${col}`); }
  }
  const txt = instruction.match(/(?:screen|led|wall)[^"']*["']([^"']{1,60})["']/i);
  if (txt) { ops.push({ op: "update", match: { type: "led_screen" }, set: { text: { content: txt[1] } } }); done.push(`screen now says "${txt[1]}"`); }
  if (/premium|luxur|elegant|fancy/.test(t)) { planPatch.colors = { ...(planPatch.colors || {}), accent: "#C9A227", chair: "#C9A227", linen: "#F7F3E8" }; planPatch.mode = "night"; done.push("gold accents, ivory linen and evening lighting"); }

  const reply = done.length ? `Done: ${done.join(", ")}.` : "I couldn't map that to a change yet. Try “make the stage 2 m wider”, “add a dance floor”, or “make the chairs gold”. Add an OpenAI key for free-form edits.";
  return { reply, planPatch: Object.keys(planPatch).length ? planPatch : null, ops };
}

// Apply ops to a scene's object list (mutates a copy).
export function applyOps(objects, ops = []) {
  const out = objects.map((o) => ({ ...o, position: [...o.position], size: [...o.size], rotation: [...(o.rotation || [0, 0, 0])] }));
  const matches = (o, m = {}) => (m.id ? o.id === m.id : true) && (m.type ? o.type === m.type : true) && (m.id || m.type);
  let result = out;
  for (const op of ops) {
    if (op.op === "remove") result = result.filter((o) => !matches(o, op.match));
    if (op.op === "update") for (const o of result) {
      if (!matches(o, op.match)) continue;
      const s = op.set || {};
      if (s.color) { o.color = s.color; if (o.type !== "round_table") o.tint = true; } // round tables: colour = linen
      if (s.material) o.material = s.material;
      if (Array.isArray(s.size)) o.size = s.size.map(Number);
      if (s.scale) o.size = o.size.map((v) => Math.round(v * s.scale * 100) / 100);
      if (Array.isArray(s.move)) o.position = o.position.map((v, i) => v + (Number(s.move[i]) || 0));
      if (s.text) o.text = { ...(o.text || {}), ...s.text };
    }
  }
  return result;
}
