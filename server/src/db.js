import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { config } from "./config.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export let pool;

// Waits for MySQL (XAMPP may still be starting, or not started yet) instead of giving up.
async function connectWithRetry(opts) {
  for (let attempt = 1; ; attempt++) {
    try { return await mysql.createConnection(opts); }
    catch (e) {
      if (e.code !== "ECONNREFUSED" && e.code !== "ETIMEDOUT") throw e;
      if (attempt === 1 || attempt % 10 === 0) console.warn(`[novira] MySQL isn't reachable on ${opts.host}:${opts.port} (${e.code}). Start MySQL in XAMPP — retrying every 3 s…`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

// Creates the database if needed, then the tables from schema.sql.
export async function initDb() {
  const { host, port, user, password, name } = config.db;
  const admin = await connectWithRetry({ host, port, user, password });
  await admin.query(`CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await admin.end();

  pool = mysql.createPool({ host, port, user, password, database: name, connectionLimit: 10, multipleStatements: true });
  const schema = fs.readFileSync(path.join(here, "schema.sql"), "utf8");
  await pool.query(schema);
  // migrations for databases created by earlier versions
  await pool.query("ALTER TABLE assets MODIFY source VARCHAR(40) NOT NULL");
  await pool.query("ALTER TABLE assets ADD COLUMN IF NOT EXISTS size JSON NULL"); // real-world size, measured at import
  return pool;
}

export async function q(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

export async function one(sql, params = []) {
  const rows = await q(sql, params);
  return rows[0] || null;
}

// mysql2 returns JSON columns already parsed on MySQL, but as strings on MariaDB.
export function json(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return value;
}
