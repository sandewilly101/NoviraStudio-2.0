// Live collaboration. Everyone with a project open holds one Server-Sent Events
// stream (GET /api/projects/:id/live) and posts what they do (POST same path):
//  · ops       — the objects they added, changed or removed, and scene settings;
//                relayed to everyone else, who merge them object by object;
//  · presence  — who they are, what they have selected, where their camera is;
//  · snapshot  — the whole scene, sent by someone already in the room to a
//                newcomer, so they start from the live state, not the last save.
// Rooms live in memory: one server process, no extra infrastructure.
import crypto from "node:crypto";

const COLOURS = ["#E8590C", "#2F9E44", "#AE3EC9", "#1C7ED6", "#D6336C", "#0C8599", "#F08C00", "#5F3DC4"];
const rooms = new Map(); // projectId → Map(clientId → peer)

const peersOf = (room) => [...room.values()].map(({ id, user, colour, presence }) => ({ id, userId: user.id, name: user.name, colour, presence }));

function write(peer, event, data) {
  try { peer.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* gone: cleaned up on close */ }
}
function broadcast(room, from, event, data) {
  for (const peer of room.values()) if (peer.id !== from) write(peer, event, data);
}

export const live = {
  join(project, req, res) {
    const room = rooms.get(project.id) || new Map();
    rooms.set(project.id, room);
    const id = String(req.query.client || crypto.randomUUID()).slice(0, 64);
    room.get(id)?.res.end(); // the same tab reconnecting
    const used = new Set([...room.values()].map((p) => p.colour));
    const colour = COLOURS.find((c) => !used.has(c)) || COLOURS[room.size % COLOURS.length];
    const peer = { id, res, user: { id: req.user.id, name: req.user.name }, colour, presence: null, role: project.my_role };

    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.write("retry: 2000\n\n");
    room.set(id, peer);
    write(peer, "welcome", { you: { id, colour }, peers: peersOf(room).filter((p) => p.id !== id) });
    broadcast(room, id, "join", { id, userId: peer.user.id, name: peer.user.name, colour });
    // someone already here sends the newcomer the scene as it is now (edits not yet saved included)
    const host = [...room.values()].find((p) => p.id !== id && p.role !== "viewer");
    if (host) write(host, "need-snapshot", { for: id });

    const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch { /* closing */ } }, 20000);
    req.on("close", () => {
      clearInterval(ping);
      if (room.get(id) !== peer) return;
      room.delete(id);
      broadcast(room, id, "leave", { id });
      if (!room.size) rooms.delete(project.id);
    });
  },

  send(project, req, res) {
    const room = rooms.get(project.id), from = String(req.body?.client || "");
    const peer = room?.get(from);
    if (!peer) return res.status(409).json({ error: "Not connected to this project's live session." });
    const { kind, data, to } = req.body;
    if (kind === "presence") {
      peer.presence = data || null;
      broadcast(room, from, "presence", { id: from, presence: peer.presence });
    } else if (kind === "ops") {
      broadcast(room, from, "ops", { id: from, name: peer.user.name, ops: data });
    } else if (kind === "snapshot" && to && room.get(to)) {
      write(room.get(to), "snapshot", { id: from, scene: data });
    } else return res.status(400).json({ error: "Unknown message." });
    res.json({ ok: true });
  },
};
