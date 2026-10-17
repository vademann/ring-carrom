"use strict";
// ═══════════════════════════════════════════════════════════
//  tests.js — самопроверка физического ядра.
//  Запуск: game.html?selftest=1 → результаты в #testlog и консоли.
// ═══════════════════════════════════════════════════════════
(function (global) {

const PHY = global.RCPhysics;

// детерминированный ГПСЧ для воспроизводимости тестов
function lcg(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

function run(log) {
    let pass = 0, fail = 0;
    const t0 = performance.now();
    function check(name, ok, detail) {
        if (ok) { pass++; log(`PASS  ${name}`); }
        else { fail++; log(`FAIL  ${name}${detail ? " — " + detail : ""}`); }
    }

    // ── 1. Случайные удары: тела не покидают поле, всё останавливается ──
    (function containment() {
        const rng = lcg(42);
        let worst = null;
        for (let shot = 0; shot < 25; shot++) {
            const w = PHY.createWorld();
            PHY.rack(w, 0, rng);
            const angle = -Math.PI / 2 + (rng() * 2 - 1) * 1.35;
            const speed = (0.3 + rng() * 0.7) * PHY.P.MAX_SHOT_V;
            PHY.applyShot(w, w.size / 2, PHY.baselineY(w, 0), angle, speed);
            const settled = PHY.simulate(w, null, 8);
            if (!settled) { worst = { shot, why: "не у успокоилось за 8с" }; continue; }
            for (const b of w._all) {
                if (b.done) continue;
                const eps = 0.6;
                if (b.x - b.r < w.L - eps || b.x + b.r > w.R + eps ||
                    b.y - b.r < w.T - eps || b.y + b.r > w.B + eps) {
                    worst = { shot, why: `тело вне поля: (${b.x.toFixed(1)}, ${b.y.toFixed(1)})` };
                }
            }
        }
        check("удержание в бортах и остановка (25 ударов)", !worst, worst && worst.why);
    })();

    // ── 2. Дыра кольца: поимка камня и отбой бандажом ──
    (function holeCapture() {
        const w = PHY.createWorld();
        const cx = w.size / 2, cy = w.size / 2;
        // неподвижное кольцо; камень уже в дыре и скользит через центр
        w.ring = PHY.makeBody(cx, cy, w.ringR, PHY.P.RING_MASS, "ring");
        const s = PHY.makeBody(cx - 20, cy, w.stoneR, PHY.P.STONE_MASS, "stone");
        w.stones.push(s);
        PHY.rebuild(w);
        s.vx = 350;
        PHY.simulate(w, null, 6);
        // кольцо дрейфует от толчков — мерим от его финального центра
        const d = Math.hypot(s.x - w.ring.x, s.y - w.ring.y);
        check("камень остаётся пойманным в дыре кольца",
              !s.done && d <= w.ring.ri - s.r + 0.6 && s.vx === 0 && s.vy === 0,
              `d=${d.toFixed(1)}, предел ${(w.ring.ri - s.r).toFixed(1)}`);

        // а материал кольца (бандаж) отталкивает камень
        const w2 = PHY.createWorld();
        w2.ring = PHY.makeBody(cx, cy, w2.ringR, PHY.P.RING_MASS, "ring");
        const s2 = PHY.makeBody(cx + 200, cy, w2.stoneR, PHY.P.STONE_MASS, "stone");
        w2.stones.push(s2);
        PHY.rebuild(w2);
        s2.vx = -800;                     // строго в бандаж по линии центров
        PHY.simulate(w2, null, 4);
        check("бандаж кольца отбивает камень",
              s2.done || s2.x > cx + s2.r,
              `x=${s2.x.toFixed(0)} (центр кольца ${cx})`);
    })();

    // ── 3. Лузa захватывает камень ──
    (function pocketCapture() {
        const w = PHY.createWorld();
        const p = w.pockets[2]; // нижняя левая
        const s = PHY.makeBody(p.x + 120, p.y - 120, w.stoneR, PHY.P.STONE_MASS, "stone", "w");
        w.stones.push(s);
        w.ring = PHY.makeBody(w.size / 2, PHY.baselineY(w, 0), w.ringR, PHY.P.RING_MASS, "ring");
        PHY.rebuild(w);
        const dx = p.x - s.x, dy = p.y - s.y;
        s.vx = dx / Math.hypot(dx, dy) * 700;
        s.vy = dy / Math.hypot(dx, dy) * 700;
        PHY.simulate(w, null, 5);
        check("камень, посланный в лузу, падает", s.done, `pos=(${s.x.toFixed(0)},${s.y.toFixed(0)})`);
    })();

    // ── 3b. Расстановка: поровну цветов, кольцо без шашек под ним ──
    (function rackColors() {
        const rng = lcg(555);
        const w = PHY.createWorld();
        PHY.rack(w, 0, rng);
        const whites = w.stones.filter(s => s.color === "w").length;
        const blacks = w.stones.filter(s => s.color === "b").length;
        check("в расстановке 5 белых и 5 чёрных", whites === 5 && blacks === 5,
              `w=${whites} b=${blacks}`);
        const y = PHY.baselineY(w, 0);
        const underRing = w.stones.some(s =>
            !s.done && Math.abs(s.x - w.ring.x) < w.ringR + s.r &&
            Math.abs(s.y - y) < w.ringR + s.r);
        check("кольцо на старте без шашек под ним", !underRing);
    })();

    // ── 3c. freeRingX уводит кольцо из-под шашки ──
    (function freeRingX() {
        const w = PHY.createWorld();
        const y = PHY.baselineY(w, 0);
        // шашка ровно в центре базовой линии — туда кольцо встать не должно
        const s = PHY.makeBody(w.size / 2, y, w.stoneR, PHY.P.STONE_MASS, "stone", "w");
        w.stones.push(s);
        w.ring = PHY.makeBody(w.size / 2, y, w.ringR, PHY.P.RING_MASS, "ring");
        PHY.rebuild(w);
        const x = PHY.freeRingX(w, w.size / 2, 0);
        const d = Math.hypot(s.x - x, s.y - y);
        check("freeRingX находит свободное место", d >= w.ringR + s.r - 0.5,
              `d=${d.toFixed(1)}, нужно ≥ ${(w.ringR + s.r).toFixed(1)}`);
        // свободный запрос идемпотентен
        check("freeRingX не двигает свободное кольцо",
              Math.abs(PHY.freeRingX(w, x, 0) - x) < 1e-6);
    })();

    // ── 4. Упругость борта ──
    (function wallRestitution() {
        const w = PHY.createWorld();
        w.ring = PHY.makeBody(w.size / 2, PHY.baselineY(w, 0), w.ringR, PHY.P.RING_MASS, "ring");
        PHY.rebuild(w);
        PHY.applyShot(w, w.R - w.ringR - 60, w.size / 2, 0, 800);
        let vIn = 0;
        while (w.time < 2) {
            if (w.ring.x > w.R - w.ringR - 30 && w.ring.vx > 0 && vIn === 0) vIn = w.ring.vx;
            PHY.stepWorld(w, null);
            if (vIn > 0 && w.ring.vx < 0) break;
        }
        const ratio = Math.abs(w.ring.vx) / vIn;
        check("отскок от борта с потерей энергии",
              ratio > 0.6 && ratio < 0.8, `ratio=${ratio.toFixed(2)}`);
    })();

    // ── 5. Детерминизм ──
    (function determinism() {
        function play() {
            const rng = lcg(777);
            const w = PHY.createWorld();
            PHY.rack(w, 0, rng);
            PHY.applyShot(w, w.size / 2, PHY.baselineY(w, 0), -Math.PI / 2 + 0.3, 1200);
            PHY.simulate(w, null, 8);
            return w.stones.map(s => `${s.done ? 1 : 0}:${s.x.toFixed(3)}:${s.y.toFixed(3)}`).join("|");
        }
        check("одинаковый удар → одинаковый исход", play() === play());
    })();

    // ── 6. Бот: план удара валиден и безопасен ──
    (function botPlan() {
        const rng = lcg(1234);
        const w = PHY.createWorld();
        PHY.rack(w, 1, rng);
        const gen = global.RCBot.planShots(w, 2);
        let r, plan = null, steps = 0;
        do { r = gen.next(); steps++; } while (!r.done && steps < 1e5);
        plan = r.value;
        const range = PHY.baselineRange(w);
        const okPlan = plan &&
            Math.abs(plan.y - PHY.baselineY(w, 1)) < 1e-6 &&
            plan.x >= range[0] - 1e-6 && plan.x <= range[1] + 1e-6 &&
            plan.speed > 0 && plan.speed <= PHY.P.MAX_SHOT_V * 1.001;
        check("бот выдаёт корректный удар", !!okPlan,
              plan ? JSON.stringify(plan) : "план не найден");
        if (okPlan) {
            const c = PHY.cloneWorld(w);
            PHY.applyShot(c, plan.x, plan.y, plan.angle, plan.speed);
            PHY.simulate(c, null, 8);
            let outside = false;
            for (const b of c._all) {
                if (b.done) continue;
                if (b.x - b.r < c.L - 0.6 || b.x + b.r > c.R + 0.6 ||
                    b.y - b.r < c.T - 0.6 || b.y + b.r > c.B + 0.6) outside = true;
            }
            check("удар бота не выбрасывает тела за борта", !outside);
            // место удара не накрывает шашки
            const overlapped = w.stones.some(s =>
                Math.hypot(s.x - plan.x, s.y - plan.y) < w.ringR + s.r - 0.5);
            check("бот ставит кольцо без шашек под ним", !overlapped);
            check("сложный бот забивает свою чёрную со стандартной расстановки",
                  plan.potted >= 1, `potted=${plan.potted}`);
        }
    })();

    // ── 6b. Bot must make progress in positions with no easy opening pot ──
    (function botUsefulShots() {
        const positions = [
            [[360, 540, "b"], [280, 460, "w"], [440, 460, "w"]],
            [[360, 225, "b"], [360, 340, "w"], [420, 400, "w"]],
            [[140, 360, "b"], [580, 360, "w"]],
        ];
        let useful = true, safe = true;
        for (const position of positions) {
            const w = PHY.createWorld();
            w.stones = position.map(([x, y, color]) =>
                PHY.makeBody(x, y, w.stoneR, PHY.P.STONE_MASS, "stone", color));
            w.ring = PHY.makeBody(w.size / 2, PHY.baselineY(w, 1),
                w.ringR, PHY.P.RING_MASS, "ring");
            PHY.rebuild(w);
            const gen = global.RCBot.planShots(w, 2, [0, 0]);
            let step;
            do { step = gen.next(); } while (!step.done);
            const plan = step.value;
            const result = global.RCBot.tryShot(w, plan.x, plan.y, plan.angle,
                plan.speed, 2, [0, 0]);
            useful = useful && result.useful;
            safe = safe && !result.ringPotted && result.opp === 0;
        }
        check("бот не тратит ход впустую в сложных позициях", useful);
        check("бот не выбирает фол или чужую лузу", safe);
    })();

    // ── 7. Внешняя кромка кольца толкает камень ──
    (function outerContact() {
        const w = PHY.createWorld();
        const cy = PHY.baselineY(w, 0);
        const s = PHY.makeBody(w.size / 2 + 160, cy, w.stoneR, PHY.P.STONE_MASS, "stone");
        w.stones.push(s);
        w.ring = PHY.makeBody(w.size / 2, cy, w.ringR, PHY.P.RING_MASS, "ring");
        PHY.rebuild(w);
        const x0 = s.x;
        PHY.applyShot(w, w.ring.x, cy, 0, 900); // строго вправо — в камень
        PHY.simulate(w, null, 4);
        check("кольцо передаёт импульс камню внешней кромкой",
              s.done || s.x > x0 + 25, `dx=${(s.x - x0).toFixed(1)}`);
    })();

    log(`────`);
    log(`Итого: ${pass} OK, ${fail} FAIL · ${(performance.now() - t0).toFixed(0)} мс`);
    return { pass, fail };
}

global.RCSelftest = { run };

})(window);
