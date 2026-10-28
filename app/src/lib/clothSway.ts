// Cloth that moves when what it hangs on moves. Each piece of hanging fabric is
// a damped pendulum driven by the acceleration of its support: move a chair and
// its skirt and sash tails trail behind, swing past and settle; stop a curtain
// abruptly and it sways on. Small-angle pendulum physics:
//    o'' = −ω²(o + L·a/g) − 2ζω·o'
// where o is how far the hem has swung, a the support's acceleration, L the
// length of fabric, ω = √(g/L) (stiffened a little: cloth isn't a free string)
// and ζ the fabric's damping (satin swings on, felt-like polyester settles fast).

const G = 9.81, STEP = 1 / 120, MAX_A = 18;

export type Fabric = { length: number; damping: number; stiffness?: number };
/** A hem's swing: offset (x, z, in metres) and twist (radians), with their rates. */
export type Pendulum = { x: number; z: number; t: number; vx: number; vz: number; vt: number };
export const restingPendulum = (): Pendulum => ({ x: 0, z: 0, t: 0, vx: 0, vz: 0, vt: 0 });

/** How a support is moving, worked out from where it is each frame. */
export type Mover = { x: number; z: number; yaw: number; vx: number; vz: number; w: number; ax: number; az: number; alpha: number; seen: boolean };
export const newMover = (): Mover => ({ x: 0, z: 0, yaw: 0, vx: 0, vz: 0, w: 0, ax: 0, az: 0, alpha: 0, seen: false });

/** Update a mover from the support's place this frame. */
export function track(m: Mover, x: number, z: number, yaw: number, dt: number) {
  if (!m.seen || dt <= 0) { Object.assign(m, { x, z, yaw, vx: 0, vz: 0, w: 0, ax: 0, az: 0, alpha: 0, seen: true }); return; }
  let dyaw = yaw - m.yaw;
  dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
  const vx = (x - m.x) / dt, vz = (z - m.z) / dt, w = dyaw / dt;
  // a drag arrives in uneven steps: smooth the speed a little before taking its change
  const k = 0.5, svx = m.vx + (vx - m.vx) * k, svz = m.vz + (vz - m.vz) * k, sw = m.w + (w - m.w) * k;
  const clamp = (v: number) => Math.max(-MAX_A, Math.min(MAX_A, v));
  m.ax = clamp((svx - m.vx) / dt); m.az = clamp((svz - m.vz) / dt); m.alpha = clamp((sw - m.w) / dt);
  Object.assign(m, { x, z, yaw, vx: svx, vz: svz, w: sw });
}

/** Advance a pendulum by dt under its support's acceleration. Returns whether it is still moving. */
export function swing(p: Pendulum, f: Fabric, m: Mover, dt: number) {
  const om = Math.sqrt(G / f.length) * (f.stiffness ?? 1.3), z2 = 2 * f.damping * om, lag = f.length / G;
  const limit = f.length * 0.6;
  for (let left = Math.min(dt, 0.12); left > 1e-6; left -= STEP) {
    const h = Math.min(STEP, left);
    // the hem hangs back against the push, then swings
    p.vx += (-om * om * (p.x + lag * m.ax) - z2 * p.vx) * h;
    p.vz += (-om * om * (p.z + lag * m.az) - z2 * p.vz) * h;
    p.vt += (-om * om * (p.t + 0.3 * lag * m.alpha) - z2 * p.vt) * h;
    p.x = Math.max(-limit, Math.min(limit, p.x + p.vx * h));
    p.z = Math.max(-limit, Math.min(limit, p.z + p.vz * h));
    p.t = Math.max(-0.3, Math.min(0.3, p.t + p.vt * h));
  }
  return Math.abs(p.x) + Math.abs(p.z) + Math.abs(p.t) * 0.3 + (Math.abs(p.vx) + Math.abs(p.vz) + Math.abs(p.vt) * 0.3) * 0.1 > 1e-4;
}

/** The swing in the support's own frame (it may be turned): [x, z, twist]. */
export function local(p: Pendulum, yaw: number, out: number[], at = 0) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  out[at] = p.x * c - p.z * s; out[at + 1] = p.x * s + p.z * c; out[at + 2] = p.t;
}
