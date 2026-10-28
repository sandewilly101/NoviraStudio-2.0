// Creates a demo account and adds the Rotana venue file to it.
//   npm run seed
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { config } from "./config.js";
import { initDb, q, one, pool } from "./db.js";
import { ensureDir, publicUrl } from "./files.js";

const EMAIL = "demo@novira.studio", PASSWORD = "novira-demo";

await initDb();
let user = await one("SELECT * FROM users WHERE email = ?", [EMAIL]);
if (!user) {
  const r = await q("INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)", ["Demo Designer", EMAIL, await bcrypt.hash(PASSWORD, 10)]);
  user = { id: r.insertId };
  console.log(`Created demo user ${EMAIL} / ${PASSWORD}`);
} else console.log(`Demo user exists: ${EMAIL}`);

const src = config.seedVenuePath;
if (src && fs.existsSync(src)) {
  const already = await one("SELECT id FROM venues WHERE user_id = ? AND file_name = ?", [user.id, path.basename(src)]);
  if (already) console.log("Venue already added.");
  else {
    const name = `seed-${Date.now()}.glb`;
    fs.copyFileSync(src, path.join(ensureDir("venues"), name));
    await q("INSERT INTO venues (user_id, name, file_url, file_name, file_size) VALUES (?, ?, ?, ?, ?)",
      [user.id, "Rotana — Apoli Ballroom", publicUrl("venues", name), path.basename(src), fs.statSync(src).size]);
    console.log(`Added venue from ${src}`);
  }
} else console.log(`Skipped venue: SEED_VENUE_PATH not found (${src || "not set"})`);

await pool.end();
