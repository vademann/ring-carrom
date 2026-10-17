"use strict";
// ═══════════════════════════════════════════════════════════
//  RCPhysics — headless-ядро Ring Carrom (без DOM).
//  Мир живёт в логических координатах поля [0..SIZE], SIZE = 720.
//  Одно и то же ядро обслуживает игру, бота (симуляции) и тесты —
//  физика на всех устройствах идентична независимо от DPI.
// ═══════════════════════════════════════════════════════════
(function (global) {

const SIZE = 720;

// ── Константы «ощущений»: вязкое трение сукна + постоянное качение ──
const P = {
    SUB_DT: 1 / 240,      // фиксированный подшаг интегрирования
    FRICTION_K: 1.05 / (1.3 * 1.15), // ещё +15% свободного пробега
    FRICTION_C: 26 / (1.3 * 1.15),
    STOP_EPS: 7,          // ниже — тело «засыпает», px/с
    E_STONE: 0.92,        // упругость камень-камень
    E_RING: 0.86,         // кольцо-камень (пластик о дерево)
    E_WALL: 0.72,         // борт
    WALL_TANGENT: 0.985,  // потеря касательной составляющей о борт
    MAX_SHOT_V: 900,      // скорость при 100% натяжения, px/с; снижена на 40%
    RING_MASS: 9.1,       // +30% к исходной массе 7
    STONE_MASS: 1,
    RING_INNER: 0.72,     // Ri/Ro — кольцо тонкое, как браслет (референс)
    POCKET_BLACK_RADIUS: 0.92, // видимый чёрный круг, без тени и ободка
    POCKET_AREA: 0.51,        // минимальная доля площади шайбы внутри лузы
    RING_POCKET_CAPTURE: 0.78, // прежнее правило падения кольца
    SLOP: 0.35,           // допустимое перекрытие без коррекции
    SPIN_GAIN: 0.0011,    // визуальный спин от касательных ударов
    SPIN_DECAY: 1.6,      // затухание спина, 1/с
};

function makeBody(x, y, r, m, type, color) {
    return {
        x, y, vx: 0, vy: 0, r,
        ri: type === "ring" ? r * P.RING_INNER : 0, // внутренний радиус кольца
        m, type,
        color: color || "b",  // цвет шашки: "w" | "b"
        sink: 0,        // 0 — на столе, (0..1) — падение в лузу, 1 — упала
        pocket: -1,
        done: false,
        spin: 0,        // визуальное вращение (декор на шайбе)
        spinA: Math.random() * Math.PI * 2,
    };
}

// ── Мир: геометрия фиксирована в логических единицах ──
function createWorld() {
    const wall = SIZE * 0.045;              // физический борт
    const stoneR = SIZE * 0.024 * 0.85;            // мелкие шайбы — масштаб референса
    const ringR = SIZE * 0.065 * 0.85;
    const pocketR = SIZE * 0.024 * 1.5 * 0.9;           // лузы маленькие — чуть больше шайбы
    const k = pocketR * 0.55;               // лузы чуть утоплены в угол
    const L = wall, T = wall, R = SIZE - wall, B = SIZE - wall;
    return {
        size: SIZE, wall, stoneR, ringR, pocketR, L, T, R, B,
        pockets: [
            { x: L + k, y: T + k }, { x: R - k, y: T + k },
            { x: L + k, y: B - k }, { x: R - k, y: B - k },
        ],
        stones: [],
        ring: null,
        time: 0,
        _all: [],
    };
}

function rebuild(w) {
    w._all = w.ring ? [w.ring].concat(w.stones) : w.stones.slice();
}

// y базовой линии игрока (0 — низ, 1 — верх)
function baselineY(w, turn) {
    return turn === 0
        ? w.B - w.ringR - w.size * 0.06
        : w.T + w.ringR + w.size * 0.06;
}

// Пределы скольжения кольца по базовой линии
function baselineRange(w) {
    // линия старта на 30% короче доступной ширины, по центру
    const m = w.ringR + w.size * 0.012;
    const cx = w.size / 2;
    const half = (w.R - w.L - 2 * m) * 0.35;
    return [cx - half, cx + half];
}

// ── Начальная расстановка: круг из 8 шайб вокруг 2 центральных ──
function rack(w, turn, rng) {
    rng = rng || Math.random;
    w.stones = [];
    const colors = [];
    for (let i = 0; i < 5; i++) colors.push("w", "b");
    for (let i = colors.length - 1; i > 0; i--) {   // детерминированное перемешивание
        const j = Math.floor(rng() * (i + 1));
        const t = colors[i]; colors[i] = colors[j]; colors[j] = t;
    }
    const cx = w.size / 2, cy = w.size / 2;
    const rotation = rng() * Math.PI * 2;
    const r = w.stoneR;
    // Smallest outer circle at this spacing that does not overlap the inner pair.
    const offset = Math.PI / 8;
    const radius = r * (Math.cos(offset) + Math.sqrt(4 - Math.sin(offset) ** 2));
    const positions = [[-r, 0], [r, 0]];
    for (let i = 0; i < 8; i++) {
        const angle = offset + i * Math.PI / 4;
        positions.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
    }
    const cos = Math.cos(rotation), sin = Math.sin(rotation);
    for (const [x, y] of positions) {
        w.stones.push(makeBody(cx + x * cos - y * sin, cy + x * sin + y * cos,
            r, P.STONE_MASS, "stone", colors[w.stones.length]));
    }
    w.ring = makeBody(cx, baselineY(w, turn), w.ringR, P.RING_MASS, "ring");
    w.ring.x = freeRingX(w, w.ring.x, turn);
    w.time = 0;
    rebuild(w);
}

// Ближайшее к x свободное место кольца на базовой линии (без шашек под кольцом).
// Гарантирует, что ход не начнётся с фишкой внутри кольца.
function freeRingX(w, x, turn) {
    const range = baselineRange(w);
    const y = baselineY(w, turn);
    const rr = w.ringR;
    const blocked = xx => w.stones.some(s =>
        !s.done && Math.abs(s.y - y) < rr + s.r + 1 && Math.abs(s.x - xx) < rr + s.r + 1);
    const px = Math.max(range[0], Math.min(range[1], x));
    if (!blocked(px)) return px;
    for (let d = 2; d < w.size; d += 2) {
        const a = px - d, b = px + d;
        if (a >= range[0] && !blocked(a)) return a;
        if (b <= range[1] && !blocked(b)) return b;
    }
    return px;
}

// ── Удар: мгновенная скорость кольцу ──
function applyShot(w, x, y, angle, speed) {
    if (!isFinite(x) || !isFinite(y) || !isFinite(angle) || !isFinite(speed)) return false;
    const v = Math.max(0, Math.min(speed, P.MAX_SHOT_V));
    w.ring.x = x; w.ring.y = y;
    w.ring.vx = Math.cos(angle) * v;
    w.ring.vy = Math.sin(angle) * v;
    w.ring.sink = 0; w.ring.done = false; w.ring.pocket = -1;
    return true;
}

function cloneWorld(w) {
    const c = createWorld();
    c.stones = w.stones.map(b => Object.assign({}, b));
    c.ring = w.ring ? Object.assign({}, w.ring) : null;
    c.time = w.time;
    rebuild(c);
    return c;
}

function allAsleep(w) {
    const bodies = w._all;
    for (let i = 0; i < bodies.length; i++) {
        const b = bodies[i];
        if (b.done) continue;
        if (b.sink > 0) return false;
        if (b.vx !== 0 || b.vy !== 0) return false;
    }
    return true;
}

// ── Столкновение кольца (аннулуса) с камнем ──
// Камень может пройти сквозь дыру; внутренняя кромка «щелкает» как борт.
function ringStone(ring, s, ev) {
    const Ro = ring.r, Ri = ring.ri, rs = s.r;
    const dx = s.x - ring.x, dy = s.y - ring.y;
    let d = Math.hypot(dx, dy);
    if (d + rs <= Ri) return;   // полностью в дыре — пролетает
    if (d - rs >= Ro) return;   // полностью снаружи
    if (d < 1e-6) d = 1e-6;
    const ux = dx / d, uy = dy / d;

    let pen, sign;
    if (d < Ri) {                       // центр в дыре: контакт с внутренней кромкой
        pen = d + rs - Ri;
        if (pen <= 0) return;
        sign = -1;                      // выталкиваем к центру кольца
    } else if (d > Ro) {                // контакт с внешней кромкой
        pen = Ro + rs - d;
        if (pen <= 0) return;
        sign = 1;
    } else {                            // центр внутри материала — куда мелче, туда и выталкиваем
        const pin = d + rs - Ri;
        const pout = Ro - (d - rs);
        if (pin <= pout) { pen = pin; sign = -1; } else { pen = pout; sign = 1; }
    }

    // нормаль контакта: куда разрешено двигаться камню
    const nX = ux * sign, nY = uy * sign;

    // позиционная коррекция: кольцо тяжёлое — почти всё смещение получает камень
    const totM = ring.m + s.m;
    const corr = Math.max(pen - P.SLOP, 0);
    s.x += nX * corr * (ring.m / totM);
    s.y += nY * corr * (ring.m / totM);
    ring.x -= nX * corr * (s.m / totM);
    ring.y -= nY * corr * (s.m / totM);

    // импульс по нормали
    const rvN = (s.vx - ring.vx) * nX + (s.vy - ring.vy) * nY;
    if (rvN >= 0) return;               // уже расходятся
    const j = -(1 + P.E_RING) * rvN / (1 / ring.m + 1 / s.m);
    ring.vx -= j * nX / ring.m; ring.vy -= j * nY / ring.m;
    s.vx += j * nX / s.m;       s.vy += j * nY / s.m;

    // визуальный спин от касательной составляющей
    const rvT = (s.vx - ring.vx) * -nY + (s.vy - ring.vy) * nX;
    s.spin += rvT * P.SPIN_GAIN;

    if (ev) {
        const vol = Math.min(0.5, Math.abs(rvN) / 900);
        if (Math.abs(rvN) > 40) ev.hit("ring", vol);
    }
}

// ── Столкновение двух дисков ──
function discDisc(a, b, ev) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    const minD = a.r + b.r;
    if (dist >= minD || dist < 1e-6) return;
    const nX = dx / dist, nY = dy / dist;

    const overlap = minD - dist;
    const totM = a.m + b.m;
    const corr = Math.max(overlap - P.SLOP, 0);
    a.x -= nX * corr * (b.m / totM); a.y -= nY * corr * (b.m / totM);
    b.x += nX * corr * (a.m / totM); b.y += nY * corr * (a.m / totM);

    const rvN = (b.vx - a.vx) * nX + (b.vy - a.vy) * nY;
    if (rvN >= 0) return;
    const j = -(1 + P.E_STONE) * rvN / (1 / a.m + 1 / b.m);
    a.vx -= j * nX / a.m; a.vy -= j * nY / a.m;
    b.vx += j * nX / b.m; b.vy += j * nY / b.m;

    const rvT = (b.vx - a.vx) * -nY + (b.vy - a.vy) * nX;
    b.spin += rvT * P.SPIN_GAIN;
    a.spin -= rvT * P.SPIN_GAIN;

    if (ev) {
        const vol = Math.min(0.5, Math.abs(rvN) / 900);
        if (Math.abs(rvN) > 40) ev.hit("stone", vol);
    }
}

function startSink(w, b, pi, ev) {
    b.sink = 0.0001;
    b.pocket = pi;
    b.vx *= 0.25; b.vy *= 0.25;
    if (ev) ev.pot(b, pi);
}

function wallHit(b, axis, ev) {
    const sp = axis === "x" ? Math.abs(b.vx) : Math.abs(b.vy);
    if (axis === "x") { b.vx = -b.vx * P.E_WALL; b.vy *= P.WALL_TANGENT; }
    else              { b.vy = -b.vy * P.E_WALL; b.vx *= P.WALL_TANGENT; }
    if (ev && sp > 60) ev.wall(sp);
}

// Exact intersection area of two discs, as a fraction of the piece's area.
function pocketOverlapFraction(pieceRadius, holeRadius, distance) {
    const r = pieceRadius, R = holeRadius, d = distance;
    if (d >= r + R) return 0;
    if (d <= Math.abs(R - r)) return Math.min(1, R * R / (r * r));
    const clamp = v => Math.max(-1, Math.min(1, v));
    const area = r * r * Math.acos(clamp((d * d + r * r - R * R) / (2 * d * r))) +
        R * R * Math.acos(clamp((d * d + R * R - r * r) / (2 * d * R))) -
        0.5 * Math.sqrt(Math.max(0, (-d + r + R) * (d + r - R) * (d - r + R) * (d + r + R)));
    return area / (Math.PI * r * r);
}
const captureDistances = new Map();
function pocketCaptureDistance(w, pieceRadius) {
    const R = w.pocketR * P.POCKET_BLACK_RADIUS;
    const key = `${R}|${pieceRadius}|${P.POCKET_AREA}`;
    if (captureDistances.has(key)) return captureDistances.get(key);
    let low = 0, high = R + pieceRadius;
    for (let i = 0; i < 40; i++) {
        const mid = (low + high) / 2;
        if (pocketOverlapFraction(pieceRadius, R, mid) >= P.POCKET_AREA) low = mid;
        else high = mid;
    }
    captureDistances.set(key, low);
    return low;
}

// ═══════════════ Один подшаг физики ═══════════════
function stepWorld(w, ev, dt) {
    dt = dt || P.SUB_DT;
    w.time += dt;
    const bodies = w._all;
    let anyMoving = false;

    // 1) падение в лузу, трение, интегрирование
    for (let i = 0; i < bodies.length; i++) {
        const b = bodies[i];
        if (b.done) continue;
        if (b.sink > 0) {
            const p = w.pockets[b.pocket];
            const kk = Math.min(1, dt * 14);
            b.x += (p.x - b.x) * kk;
            b.y += (p.y - b.y) * kk;
            const vd = Math.max(0, 1 - dt * 12);
            b.vx *= vd; b.vy *= vd;
            b.sink += dt * 4;
            if (b.sink >= 1) { b.sink = 1; b.done = true; b.vx = 0; b.vy = 0; }
            else anyMoving = true;
            continue;
        }
        const sp = Math.hypot(b.vx, b.vy);
        if (sp === 0) continue;
        if (!isFinite(sp)) { b.vx = 0; b.vy = 0; b.x = Math.min(Math.max(b.x, w.L + b.r), w.R - b.r); b.y = Math.min(Math.max(b.y, w.T + b.r), w.B - b.r); continue; }
        // комбинированное трение: вязкое + постоянное
        const dec = P.FRICTION_K * sp + P.FRICTION_C;
        const nsp = Math.max(0, sp - dec * dt);
        if (nsp <= P.STOP_EPS && sp < P.STOP_EPS * 4) {
            b.vx = 0; b.vy = 0;
        } else {
            const k2 = nsp / sp;
            b.vx *= k2; b.vy *= k2;
            b.x += b.vx * dt;
            b.y += b.vy * dt;
            if (b.spin) b.spinA += b.spin * dt;
            b.spin *= Math.max(0, 1 - P.SPIN_DECAY * dt);
            anyMoving = true;
        }
    }

    // 2) борта
    const L = w.L, R = w.R, T = w.T, B = w.B;
    for (let i = 0; i < bodies.length; i++) {
        const b = bodies[i];
        if (b.done || b.sink > 0) continue;
        if (b.x - b.r < L) { b.x = L + b.r; if (b.vx < 0) wallHit(b, "x", ev); }
        if (b.x + b.r > R) { b.x = R - b.r; if (b.vx > 0) wallHit(b, "x", ev); }
        if (b.y - b.r < T) { b.y = T + b.r; if (b.vy < 0) wallHit(b, "y", ev); }
        if (b.y + b.r > B) { b.y = B - b.r; if (b.vy > 0) wallHit(b, "y", ev); }
    }

    // 3) столкновения (тел мало — O(n²) с ранними отсечками)
    for (let i = 0; i < bodies.length; i++) {
        const a = bodies[i];
        if (a.done || a.sink > 0) continue;
        for (let j2 = i + 1; j2 < bodies.length; j2++) {
            const b = bodies[j2];
            if (b.done || b.sink > 0) continue;
            const dx = b.x - a.x, dy = b.y - a.y;
            const rr = a.r + b.r;
            if (dx * dx + dy * dy > rr * rr + 4) continue;
            if (a.type === "ring" || b.type === "ring") ringStone(a.type === "ring" ? a : b, a.type === "ring" ? b : a, ev);
            else discDisc(a, b, ev);
        }
    }

    // 4) No attraction: a stone falls only after >=51% enters the visible black disc.
    for (let i = 0; i < bodies.length; i++) {
        const b = bodies[i];
        if (b.done || b.sink > 0) continue;
        for (let pi = 0; pi < 4; pi++) {
            const p = w.pockets[pi];
            const dx = p.x - b.x, dy = p.y - b.y;
            const d = Math.hypot(dx, dy);
            const captured = b.type === "stone"
                ? pocketOverlapFraction(b.r, w.pocketR * P.POCKET_BLACK_RADIUS, d) >= P.POCKET_AREA
                : d < w.pocketR * P.RING_POCKET_CAPTURE;
            if (captured) { startSink(w, b, pi, ev); break; }
        }
    }

    return anyMoving;
}

// Симуляция до полной остановки (бот, тесты). Возвращает false по таймауту.
function simulate(w, ev, maxT) {
    maxT = maxT || 6;
    const endTime = w.time + maxT;
    while (w.time < endTime) {
        stepWorld(w, ev, P.SUB_DT);
        if (allAsleep(w)) return true;
    }
    return false;
}

global.RCPhysics = {
    P, SIZE,
    makeBody, createWorld, rebuild, baselineY, baselineRange,
    rack, freeRingX, applyShot, cloneWorld, allAsleep, stepWorld, simulate,
    pocketOverlapFraction, pocketCaptureDistance,
};

})(window);
