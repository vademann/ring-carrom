"use strict";
// ═══════════════════════════════════════════════════════════
//  RCBot — соперник «как живой человек».
//  Все уровни ищут полезный контакт со своей шашкой. Просчитываются
//  прямые удары, подготовка позиции и отскоки от борта.
//  Разница уровней — в наборе кандидатов и точности силы удара.
//
//  Все уровни сохраняют случайную погрешность прицеливания ±5%.
//  Лёгкий — меньше вариантов и умеренная погрешность силы.
//  Средний — больше точек удара и осторожнее исполнение.
//  Сложный — широкий поиск, отскоки и проверка устойчивости удара.
// ═══════════════════════════════════════════════════════════
(function (global) {

const PHY = global.RCPhysics;
const D2R = Math.PI / 180;
const AIM_ERROR = 0.05;

// Distance under the same linear + constant friction used by the live game.
function stoppingDistance(speed) {
    const k = PHY.P.FRICTION_K, c = PHY.P.FRICTION_C;
    return speed / k - c / (k * k) * Math.log1p(k * speed / c);
}
function speedForDistance(distance) {
    let low = 0, high = PHY.P.MAX_SHOT_V * 2;
    for (let i = 0; i < 24; i++) {
        const mid = (low + high) / 2;
        if (stoppingDistance(mid) < distance) low = mid;
        else high = mid;
    }
    return (low + high) / 2;
}
function shotPower(w, approach, travel, alignment = 1) {
    const ringMass = w.ring ? w.ring.m : PHY.P.RING_MASS;
    const transfer = (1 + PHY.P.E_RING) * ringMass / (ringMass + PHY.P.STONE_MASS);
    const impactSpeed = speedForDistance(Math.max(0, travel - PHY.pocketCaptureDistance(w, w.stoneR))) /
        (transfer * Math.max(0.3, alignment));
    const speed = speedForDistance(Math.max(0, approach) + stoppingDistance(impactSpeed));
    return Math.max(0.12, Math.min(1, speed / PHY.P.MAX_SHOT_V));
}
function contactOffset(w) {
    return (Math.max(0, w.ringR * PHY.P.RING_INNER - w.stoneR) + w.ringR + w.stoneR) / 2;
}

// Apply once after planning, on every difficulty. Never retry a bad roll.
// Example: a planned 90-degree shot is executed between 85.5 and 94.5 degrees.
function aimingError(angle) {
    return angle * (1 + (Math.random() * 2 - 1) * AIM_ERROR);
}

// Оценка исхода удара. level влияет на учёт безопасности (у сложного).
function tryShot(w, x, y, angle, speed, level, matchScores) {
    const c = PHY.cloneWorld(w);
    PHY.applyShot(c, x, y, angle, speed);
    // At reduced friction, allow enough time for the strongest legal shot to settle.
    const maxSpeed = PHY.P.MAX_SHOT_V * (1 + PHY.P.E_RING);
    const horizon = Math.log1p(PHY.P.FRICTION_K * maxSpeed / PHY.P.FRICTION_C) / PHY.P.FRICTION_K + 2;
    const settled = PHY.simulate(c, null, horizon);

    const cnt = (world, color) => world.stones.filter(s => s.done && s.color === color).length;
    const own = cnt(c, "b") - cnt(w, "b");
    const opp = cnt(c, "w") - cnt(w, "w");
    const ringPotted = !w.ring.done && !!c.ring.done;

    // Compare positions before and after the shot. Absolute closeness rewards
    // doing nothing when a stone already happens to be near a pocket.
    const pocketValue = s => {
        let d = Infinity;
        for (const p of w.pockets) d = Math.min(d, Math.hypot(p.x - s.x, p.y - s.y));
        return Math.max(0, 1 - d / (w.size * 0.48));
    };
    let ownProgress = 0, oppProgress = 0, ownMotion = 0, oppMotion = 0;
    for (let i = 0; i < w.stones.length; i++) {
        const before = w.stones[i], after = c.stones[i];
        if (before.done || after.done) continue;
        const moved = Math.hypot(after.x - before.x, after.y - before.y);
        if (before.color === "b") {
            ownMotion += Math.min(moved, 120);
            ownProgress += pocketValue(after) - pocketValue(before);
        } else {
            oppMotion += Math.min(moved, 120);
            oppProgress += pocketValue(after) - pocketValue(before);
        }
    }
    const ownLeft = c.stones.filter(s => !s.done && s.color === "b").length;
    const oppLeft = c.stones.filter(s => !s.done && s.color === "w").length;
    const finalOwn = Math.max(0, (matchScores ? matchScores[1] : cnt(w, "b")) + own - (ringPotted ? 2 : 0));
    const finalOpp = (matchScores ? matchScores[0] : cnt(w, "w")) + opp;
    const winner = ownLeft === 0 && oppLeft === 0
        ? (finalOwn === finalOpp ? -1 : finalOwn > finalOpp ? 1 : 0)
        : ownLeft === 0 ? 1 : oppLeft === 0 ? 0 : null;
    const keepsTurn = own > 0 && opp === 0 && !ringPotted;
    let score = own * 150 - opp * 185 + (keepsTurn ? 48 : 0)
        + ownProgress * 75 - oppProgress * 65;
    if (own === 0 && ownMotion < 3) score -= 300;
    if (own === 0 && ownMotion < 3 && (opp > 0 || oppMotion > 3)) score -= 220;
    if (own === 0 && ownMotion >= 3) score += Math.min(25, ownMotion * 0.12);
    if (winner !== null) score += winner === 1 ? 10000 : winner === 0 ? -10000 : -100;

    // сложный ещё и не подставляет лузы под чужие шашки
    const safety = level >= 2 ? 18 : level === 1 ? 9 : 0;
    if (safety) {
        for (const s of c.stones) {
            if (s.done || s.color !== "w") continue;
            let md = Infinity;
            for (const p of c.pockets) md = Math.min(md, Math.hypot(p.x - s.x, p.y - s.y));
            if (md < c.pocketR * 1.3) score -= safety;
        }
    }

    if (ringPotted) score -= 320;
    else if (c.ring) {
        let rd = Infinity;
        for (const p of c.pockets) rd = Math.min(rd, Math.hypot(p.x - c.ring.x, p.y - c.ring.y));
        score -= 12 * Math.max(0, 1 - rd / (c.size * 0.22));
    }
    if (!settled) score -= 200;
    return { score, potted: own, opp, ringPotted, keepsTurn, winner, settled,
             useful: own > 0 || ownMotion >= 3, ownMotion, ownProgress };
}

// Касается ли луч броска своей шашки (с учётом дыры кольца:
// шашка строго по центру луча проскакивает через дыру — это не контакт)
function rayTouchesOwn(w, x, y, angle) {
    const ux = Math.cos(angle), uy = Math.sin(angle);
    const Ri = w.ringR * PHY.P.RING_INNER, Ro = w.ringR;
    for (const s of w.stones) {
        if (s.done || s.color !== "b") continue;
        const dx = s.x - x, dy = s.y - y;
        const proj = dx * ux + dy * uy;
        if (proj <= 0) continue;
        const perp = Math.abs(dx * uy - dy * ux);
        if (perp > Ri - s.r && perp < Ro + s.r) return true;
    }
    return false;
}

function* planShots(w, level, matchScores) {
    const by = PHY.baselineY(w, 1);
    const range = PHY.baselineRange(w);
    const seen = new Set();
    const cands = [];
    const add = (x, a, pf) => {
        const key = Math.round(x) + "|" + a.toFixed(3) + "|" + pf.toFixed(2);
        if (seen.has(key)) return;
        seen.add(key);
        cands.push({ x, a, pf });
    };

    const own = w.stones.filter(s => !s.done && s.color === "b");
    const bottom = w.pockets.filter(p => p.y > by + 30);

    // ── 1. Прицельные: своя шашка → луза ──
    for (const s of own) {
        for (const p of bottom) {
            if (p.y <= s.y + 10) continue;
            const k = (s.y - by) / (p.y - s.y);
            const rawX = s.x - k * (p.x - s.x);
            if (rawX < range[0] - 40 || rawX > range[1] + 40) continue;
            const x = PHY.freeRingX(w, rawX, 1);
            const ang = Math.atan2(s.y - by, s.x - x);
            const base = shotPower(w, Math.max(0, Math.hypot(s.x - x, s.y - by) - w.ringR - s.r),
                Math.hypot(p.x - s.x, p.y - s.y));
            // сила зависит от уровня: лёгкий играет одним-двумя размахами
            const powers = level === 0 ? [base * 1.0]
                         : level === 1 ? [base * 0.88, base * 1.0, base * 1.1]
                         : [base * 0.82, base * 0.92, base * 1.0, base * 1.1];
            for (const pf of powers) add(x, ang, Math.min(1, pf));
            // The ring is hollow: a line through the stone's centre often
            // misses it. Try both edges of the ring along the same pocket line.
            const distance = Math.hypot(s.x - x, s.y - by);
            for (const side of [-1, 1]) {
                const touch = ang + side * Math.asin(Math.min(0.99, contactOffset(w) / distance));
                for (const factor of level === 0 ? [1] : [0.82, 1.03])
                    add(x, touch, Math.min(1, base * factor));
            }
            // разведка углов: средний ±1.5°, сложный ±3°
            const spread = level === 1 ? 1.5 : level === 2 ? 1.5 : 0;
            if (spread) {
                add(x, ang - spread * D2R, Math.min(1, base * 1.02));
                add(x, ang + spread * D2R, Math.min(1, base * 1.02));
                if (level === 2) {
                    add(x, ang - 3 * D2R, Math.min(1, base * 1.04));
                    add(x, ang + 3 * D2R, Math.min(1, base * 1.04));
                }
            }
        }
    }

    // Aim from several legal starting positions at the two contact edges.
    // This also produces sensible breakup and setup shots when no pot is open.
    for (const s of own) {
        for (const fraction of level === 0 ? [0.25, 0.75] : [0, 0.25, 0.5, 0.75, 1]) {
            const x = PHY.freeRingX(w, range[0] + (range[1] - range[0]) * fraction, 1);
            const distance = Math.hypot(s.x - x, s.y - by);
            const center = Math.atan2(s.y - by, s.x - x);
            if (distance < w.ringR + s.r) continue;
            for (const side of [-1, 1]) {
                const a = center + side * Math.asin(Math.min(0.99, contactOffset(w) / distance));
                for (const power of level === 0 ? [0.5] : [0.38, 0.68]) add(x, a, power);
            }
        }
    }

    // Direct contacts and soft setup shots cover blocked pocket lines.
    for (const s of own) {
        const x = PHY.freeRingX(w, s.x, 1);
        const a = Math.atan2(s.y - by, s.x - x);
        for (const power of level === 0 ? [0.55] : [0.32, 0.55, 0.8]) add(x, a, power);
        if (level === 2) {
            // Mirror the target across each side wall for one-cushion candidates.
            for (const wallX of [w.L + w.ringR, w.R - w.ringR]) {
                const targetX = 2 * wallX - s.x;
                for (const startX of [range[0], (range[0] + range[1]) / 2, range[1]])
                    add(startX, Math.atan2(s.y - by, targetX - startX), 0.8);
            }
        }
    }

    // Aim at the actual outer-edge contact point, not the hollow ring's centre.
    // These candidates include top pockets and soft shots close to a pocket.
    for (const stone of own) {
        for (const pocket of w.pockets) {
            const travel = Math.hypot(pocket.x - stone.x, pocket.y - stone.y);
            if (travel < 1) continue;
            const ux = (pocket.x - stone.x) / travel, uy = (pocket.y - stone.y) / travel;
            const gx = stone.x - ux * (w.ringR + stone.r);
            const gy = stone.y - uy * (w.ringR + stone.r);
            for (const fraction of level === 0 ? [0.25, 0.75] : [0, 0.25, 0.5, 0.75, 1]) {
                const x = PHY.freeRingX(w, range[0] + (range[1] - range[0]) * fraction, 1);
                const approach = Math.hypot(gx - x, gy - by);
                if (approach < 1) continue;
                const angle = Math.atan2(gy - by, gx - x);
                const alignment = Math.cos(angle) * ux + Math.sin(angle) * uy;
                if (alignment < 0.4) continue;
                const power = shotPower(w, approach, travel, alignment);
                for (const factor of level === 0 ? [1] : [0.85, 1, 1.15])
                    add(x, angle, Math.min(1, power * factor));
            }
        }
    }

    // ── 3. Запасной перебор углов с возможным касанием своей шашки ──
    if (cands.length === 0) {
        for (let ip = 0; ip < 3; ip++) {
            const x = PHY.freeRingX(w, range[0] + (range[1] - range[0]) * ip / 2, 1);
            for (let ia = 0; ia < 14; ia++) {
                const a = Math.PI / 2 - 1.25 + (2.5 * ia) / 13;
                if (rayTouchesOwn(w, x, by, a)) add(x, a, 0.55 + 0.3 * (ia % 2));
            }
        }
    }

    // ── 4. Просчёт кандидатов ──
    const total = cands.length;
    const scored = [];
    let n = 0;
    for (const c of cands) {
        const res = tryShot(w, c.x, by, c.a, c.pf * PHY.P.MAX_SHOT_V, level, matchScores);
        scored.push({ ...c, res });
        if (++n % 10 === 0) yield { n, total };
    }

    // Search broader whenever direct plans are weak, not only when none exist.
    if (!scored.length || Math.max(...scored.map(s => s.res.score)) < 90) {
        const broad = [];
        for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
            const x = PHY.freeRingX(w, range[0] + (range[1] - range[0]) * fraction, 1);
            const count = level === 2 ? 20 : 12;
            for (let i = 0; i <= count; i++) {
                const a = 0.25 + i * (Math.PI - 0.5) / count;
                if (!rayTouchesOwn(w, x, by, a)) continue;
                for (const pf of [0.45, 0.75]) {
                    const key = Math.round(x) + "|" + a.toFixed(3) + "|" + pf.toFixed(2);
                    if (!seen.has(key)) { seen.add(key); broad.push({ x, a, pf }); }
                }
            }
        }
        for (const c of broad) {
            scored.push({ ...c, res: tryShot(w, c.x, by, c.a, c.pf * PHY.P.MAX_SHOT_V, level, matchScores) });
            if (++n % 10 === 0) yield { n, total: total + broad.length };
        }
    }

    // Select the best simulated result, then check its tolerance to error.
    let pool = scored;
    pool.sort((A, B) => B.res.score - A.res.score);

    // полный тупик: мягкая попытка дотянуться до ближайшей своей шашки
    if (!pool.length || !pool[0]) {
        let best = null, bd = Infinity;
        for (const s of w.stones) {
            if (s.done || s.color !== "b") continue;
            const x = PHY.freeRingX(w, s.x, 1);
            const d = Math.hypot(s.x - x, s.y - by);
            if (d < bd) { bd = d; best = { x, a: Math.atan2(s.y - by, s.x - x) }; }
        }
        if (!best) best = { x: w.size / 2, a: Math.PI / 2 };
        return { x: best.x, y: by, angle: aimingError(best.a), speed: 0.55 * PHY.P.MAX_SHOT_V,
                 slide: 0.6, overshoot: 0, score: 0, potted: 0 };
    }

    // ── 5. Устойчивый выбор и ограниченная ошибка исполнения ──
    // Prefer a shot that survives a small aiming error over a brittle trick
    // shot, provided its ideal result is close to the best one.
    let pick = pool[0], bestReliable = -Infinity;
    for (const candidate of pool.slice(0, 5)) {
        if (candidate.res.score < pool[0].res.score - 60) break;
        let worst = candidate.res.score;
        for (const sign of [-1, 1]) {
            const outcome = tryShot(w, candidate.x, by, candidate.a * (1 + sign * AIM_ERROR),
                candidate.pf * PHY.P.MAX_SHOT_V, level, matchScores);
            worst = Math.min(worst, outcome.score);
        }
        const reliable = candidate.res.score * 0.65 + worst * 0.35;
        if (reliable > bestReliable) { bestReliable = reliable; pick = candidate; }
    }

    const noiseP = [[0.93, 1.07], [0.975, 1.025], [0.995, 1.005]][level];
    const angle = aimingError(pick.a);
    let speed = pick.pf * PHY.P.MAX_SHOT_V *
                (noiseP[0] + Math.random() * (noiseP[1] - noiseP[0]));
    speed = Math.min(PHY.P.MAX_SHOT_V, speed);
    // Execution errors stand even when they cause a miss or foul.

    // характер скольжения кольца к точке удара
    const slide = [0.5, 0.65, 0.8][level];
    const overshoot = level === 0 ? (Math.random() < 0.5 ? -1 : 1) * (8 + Math.random() * 12)
                    : level === 1 ? (Math.random() - 0.5) * 8
                    : 0;

    const plan = {
        x: pick.x, y: by, angle, speed,
        slide, overshoot,
        score: pick.res.score, potted: pick.res.potted,
    };
    yield plan;
    return plan;
}

global.RCBot = { planShots, tryShot, rayTouchesOwn };

})(window);
