import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { config } from "./config.js";
import { q, one } from "./db.js";
import { usageContext } from "./usage.js";

export const signToken = (user) => jwt.sign({ id: user.id, name: user.name, email: user.email }, config.jwtSecret, { expiresIn: "30d" });

export function requireAuth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : req.query.token;
  if (!token) return res.status(401).json({ error: "Please sign in." });
  try {
    req.user = jwt.verify(token, config.jwtSecret);
    // AI calls made while serving this request are recorded against this user
    usageContext.run({ userId: req.user.id }, next);
  } catch {
    res.status(401).json({ error: "Your session has expired. Please sign in again." });
  }
}

export const authRouter = express.Router();

authRouter.post("/register", async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: "Name, email and password are required." });
  if (String(password).length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
  if (await one("SELECT id FROM users WHERE email = ?", [email.toLowerCase()])) return res.status(409).json({ error: "An account with this email already exists." });
  const hash = await bcrypt.hash(password, 10);
  const r = await q("INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)", [name.trim(), email.toLowerCase().trim(), hash]);
  const user = { id: r.insertId, name: name.trim(), email: email.toLowerCase().trim() };
  res.json({ token: signToken(user), user });
});

authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  const row = await one("SELECT * FROM users WHERE email = ?", [String(email || "").toLowerCase().trim()]);
  if (!row || !(await bcrypt.compare(String(password || ""), row.password_hash))) return res.status(401).json({ error: "Wrong email or password." });
  const user = { id: row.id, name: row.name, email: row.email };
  res.json({ token: signToken(user), user });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  res.json({ user: await one("SELECT id, name, email, role, created_at FROM users WHERE id = ?", [req.user.id]) });
});
