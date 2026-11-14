// @ts-nocheck
import { HL } from './kernel'

const { open, poly, rrect, fade, reducedMotion, tdone, tset, tval, tween, disposer, mk, pointer, register } = HL;

const SCALE = 1.45, TOP = 14;
const at = ([u, v]) => [200 + (u - 200) * SCALE, TOP + v * SCALE];
const PHONE = [138, 0, 262, 276], R = 22, BEZEL = 6;
const BADGE = { cx: 200, cy: 58, r: 16 };
const KEY_TOP = 136, KEY_H = 20, LIP = 2.5;
const KEYS = [{ name: "deny", u: [156, 190] }, { name: "approve", u: [198, 244] }];
const MOVE = 180, PRESSED = 520, RELEASED = 760;

const box = (u0, v0, u1, v1, r) => poly(rrect(u0, v0, u1, v1, r, 6).map((q) => at([q.u, q.v])));
const line = (...pts) => open(pts.map(at));

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let travel = value;

  const [x0, y0, x1, y1] = PHONE;
  const g = mk("g", { mask: fade(svg, 252, 318, 1) }, svg);
  mk("path", { class: "sil", d: box(x0, y0, x1, y1, R) }, g);
  mk("path", { class: "nf lo", d: box(x0 + BEZEL, y0 + BEZEL, x1 - BEZEL, y1 - BEZEL, R - BEZEL) }, g);
  mk("path", { class: "nf", d: box(186, 14, 214, 21, 3.5) }, g);

  const [bx, by] = at([BADGE.cx, BADGE.cy]);
  mk("ellipse", { class: "lo", cx: bx, cy: by, rx: BADGE.r * SCALE, ry: BADGE.r * SCALE }, g);
  const lock = mk("path", { class: "nf lo", d: box(194, 56, 206, 65, 2) + line([196.5, 56], [196.5, 52], [203.5, 52], [203.5, 56]) }, g);
  const check = mk("path", { class: "nf hi", d: line([192, 58], [198, 64], [208, 52]) }, g);
  for (const el of [lock, check]) el.style.transition = `opacity ${MOVE}ms cubic-bezier(.32,.72,0,1)`;

  mk("path", { class: "nf", d: line([170, 92], [230, 92]) }, g);
  mk("path", { class: "nf lo", d: line([160, 106], [240, 106]) + line([174, 117], [226, 117]) }, g);

  const keys = KEYS.map((k) => {
    mk("path", { class: "lo", d: box(k.u[0], KEY_TOP + LIP, k.u[1], KEY_TOP + KEY_H + LIP, 6) }, g);
    return { ...k, el: mk("path", {}, g), drop: tween(0, MOVE) };
  });

  let drawn = "";
  function draw(drops) {
    const sig = drops.join();
    if (sig === drawn) return;
    drawn = sig;
    keys.forEach((k, i) => k.el.setAttribute("d", box(k.u[0], KEY_TOP + drops[i], k.u[1], KEY_TOP + KEY_H + drops[i], 6)));
  }

  const B = register(stage, (_dt, now) => {
    draw(keys.map((k) => tval(k.drop, now)));
    return keys.some((k) => !tdone(k.drop, now));
  });
  bag.add(B.unregister);

  const [rowLeft, rowTop] = at([KEYS[0].u[0], KEY_TOP]), [rowRight, rowBottom] = at([KEYS[1].u[1], KEY_TOP + KEY_H]);
  const split = at([(KEYS[0].u[1] + KEYS[1].u[0]) / 2, 0])[0];

  function hit([x, y]) {
    if (y < rowTop - 20 || y > rowBottom + 20 || x < rowLeft - 10 || x > rowRight + 10) return -1;
    return x < split ? 0 : 1;
  }

  let act = null;
  function press(a) {
    if (a === act) return;
    const now = performance.now(), down = a >= 0;
    act = a;
    keys.forEach((k, i) => {
      tset(k.drop, i === a ? travel : 0, now, 0);
      k.el.classList.toggle("hi", down ? i === a : i === 1);
    });
    const approved = a === 1;
    check.style.opacity = approved ? "1" : "0";
    lock.style.opacity = approved ? "0" : "1";
    read.textContent = down ? KEYS[a].name : "rest";
    B.wake();
  }

  let hand = false, timer = 0;
  function beat(down) {
    if (!hand) press(down ? 1 : -1);
    timer = window.setTimeout(() => beat(!down), down ? PRESSED : RELEASED);
  }
  if (!reducedMotion()) timer = window.setTimeout(() => beat(true), RELEASED);
  bag.add(() => window.clearTimeout(timer));

  press(-1);
  bag.add(pointer(stage, {
    move: (p) => { hand = true; press(hit(p)); },
    leave: () => { hand = false; press(-1); },
  }));
  bag.add(() => svg.replaceChildren());

  return {
    set: (v) => { travel = v; const a = act; act = null; press(a); },
    destroy: bag.dispose,
  };
}

export const approve = {
  name: "approve",
  means: "A phone shows a sign-in request: the key under the pointer sinks, and pressing approve turns the lock into a check.",
  range: [1.5, 2.5, 2.5],
  tour: [],
  mount,
}
