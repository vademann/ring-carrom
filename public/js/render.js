"use strict";
// ═══════════════════════════════════════════════════════════
//  RCRender — рендер поля и шайб с настраиваемыми стилями:
//  5 расцветок стола и 5 видов шайб (магазин за монеты).
//  Все координаты — логические единицы мира [0..720].
// ═══════════════════════════════════════════════════════════
(function (global) {

const PHY = global.RCPhysics;

// ── 5 расцветок стола ──
const THEMES = [
    {
        id: "classic", ru: "Классика", en: "Classic",
        wood1: "#167e88", wood2: "#063b50",
        felt1: "#ffe1a1", felt2: "#edb86e", vignette: "rgba(150,75,18,0.10)",
        mark: "rgba(178,58,46,0.78)",
        markRgb: "178,58,46", markSoft: "rgba(178,58,46,0.45)",
        baseline: "rgba(70,55,40,0.38)",
        aim: "rgba(60,50,45,0.6)", aimHot: "rgba(217,72,64,0.9)",
        hole: "#101210", holeRim: "rgba(60,48,36,0.55)", holeHi: "rgba(255,255,255,0.12)",
        pocketShadow: "rgba(90,70,50,0.35)",
        shadow: "rgba(70,55,35,0.40)", frameHi: "rgba(255,255,255,0.08)",
        trail: "rgba(70,55,35,0.07)",
        trailRgb: "70,55,35",
    },
    {
        id: "emerald", ru: "Изумруд", en: "Emerald",
        wood1: "#6d4d31", wood2: "#4e3822",
        felt1: "#19a877", felt2: "#087958", vignette: "rgba(0,20,12,0.18)",
        mark: "rgba(255,255,255,0.78)",
        markRgb: "255,255,255", markSoft: "rgba(255,255,255,0.42)",
        baseline: "rgba(255,255,255,0.40)",
        aim: "rgba(255,255,255,0.80)", aimHot: "rgba(248,113,113,0.9)",
        hole: "#0b0d0c", holeRim: "rgba(255,255,255,0.55)", holeHi: "rgba(255,255,255,0.14)",
        pocketShadow: "rgba(0,0,0,0.45)",
        shadow: "rgba(0,0,0,0.42)", frameHi: "rgba(255,255,255,0.08)",
        trail: "rgba(255,255,255,0.09)",
        trailRgb: "255,255,255",
        trailRgb: "255,255,255",
    },
    {
        id: "night", ru: "Ночь", en: "Night",
        wood1: "#262833", wood2: "#15161d",
        felt1: "#45408a", felt2: "#27245b", vignette: "rgba(0,0,10,0.25)",
        mark: "rgba(126,164,255,0.72)",
        markRgb: "126,164,255", markSoft: "rgba(126,164,255,0.40)",
        baseline: "rgba(126,164,255,0.35)",
        aim: "rgba(198,216,255,0.78)", aimHot: "rgba(255,120,120,0.9)",
        hole: "#07080d", holeRim: "rgba(126,164,255,0.45)", holeHi: "rgba(126,164,255,0.16)",
        pocketShadow: "rgba(0,0,0,0.55)",
        shadow: "rgba(0,0,0,0.55)", frameHi: "rgba(126,164,255,0.10)",
        trail: "rgba(126,164,255,0.10)",
        trailRgb: "126,164,255",
    },
    {
        id: "cherry", ru: "Вишня", en: "Cherry",
        wood1: "#3a1e22", wood2: "#2a1418",
        felt1: "#af2855", felt2: "#771938", vignette: "rgba(20,0,6,0.22)",
        mark: "rgba(233,196,120,0.78)",
        markRgb: "233,196,120", markSoft: "rgba(233,196,120,0.45)",
        baseline: "rgba(233,196,120,0.40)",
        aim: "rgba(255,240,210,0.82)", aimHot: "rgba(255,120,110,0.9)",
        hole: "#170a0d", holeRim: "rgba(233,196,120,0.5)", holeHi: "rgba(255,235,190,0.14)",
        pocketShadow: "rgba(0,0,0,0.45)",
        shadow: "rgba(0,0,0,0.45)", frameHi: "rgba(233,196,120,0.10)",
        trail: "rgba(233,196,120,0.09)",
        trailRgb: "233,196,120",
    },
    {
        id: "sapphire", ru: "Сапфир", en: "Sapphire",
        wood1: "#22303c", wood2: "#16222c",
        felt1: "#137cb6", felt2: "#09568e", vignette: "rgba(0,8,18,0.22)",
        mark: "rgba(255,255,255,0.75)",
        markRgb: "255,255,255", markSoft: "rgba(255,255,255,0.42)",
        baseline: "rgba(255,255,255,0.38)",
        aim: "rgba(255,255,255,0.80)", aimHot: "rgba(255,170,90,0.9)",
        hole: "#080d13", holeRim: "rgba(255,255,255,0.5)", holeHi: "rgba(190,225,255,0.15)",
        pocketShadow: "rgba(0,0,0,0.5)",
        shadow: "rgba(0,0,0,0.5)", frameHi: "rgba(190,225,255,0.10)",
        trail: "rgba(255,255,255,0.09)",
    },
];

// ── 5 видов шайб ──
const PUCKS = [
    {
        id: "classic", ru: "Классика", en: "Classic",
        lightFill: "#f7f3ea", lightRim: "rgba(120,105,85,0.55)", lightEngrave: "rgba(120,105,85,0.28)", lightHi: "rgba(255,255,255,0.70)",
        darkFill: "#24272c", darkRim: "rgba(255,255,255,0.30)", darkEngrave: "rgba(255,255,255,0.13)", darkHi: "rgba(255,255,255,0.22)",
    },
    {
        id: "crimson", ru: "Красные", en: "Crimson",
        lightFill: "#f3e6cf", lightRim: "rgba(150,110,70,0.55)", lightEngrave: "rgba(150,110,70,0.30)", lightHi: "rgba(255,255,255,0.65)",
        darkFill: "#c23b30", darkRim: "rgba(255,215,195,0.45)", darkEngrave: "rgba(255,235,225,0.28)", darkHi: "rgba(255,255,255,0.38)",
    },
    {
        id: "marble", ru: "Мрамор", en: "Marble",
        lightFill: "#e9eaef", lightRim: "rgba(96,106,135,0.50)", lightEngrave: "rgba(96,106,135,0.30)", lightHi: "rgba(255,255,255,0.85)",
        darkFill: "#3b4256", darkRim: "rgba(205,215,245,0.40)", darkEngrave: "rgba(205,215,245,0.22)", darkHi: "rgba(255,255,255,0.30)",
    },
    {
        id: "neon", ru: "Неон", en: "Neon",
        lightFill: "#eafff5", lightRim: "rgba(56,224,160,0.80)", lightEngrave: "rgba(20,180,125,0.45)", lightHi: "rgba(255,255,255,0.85)",
        darkFill: "#132a3d", darkRim: "rgba(76,201,255,0.75)", darkEngrave: "rgba(76,201,255,0.40)", darkHi: "rgba(160,235,255,0.45)",
    },
    {
        id: "metal", ru: "Металл", en: "Metal",
        lightFill: "#dadfe5", lightRim: "rgba(70,80,95,0.60)", lightEngrave: "rgba(70,80,95,0.32)", lightHi: "rgba(255,255,255,0.90)",
        darkFill: "#495059", darkRim: "rgba(235,240,248,0.45)", darkEngrave: "rgba(235,240,248,0.25)", darkHi: "rgba(255,255,255,0.40)",
    },
];

// ── Активный стиль (индексы читаются из localStorage) ──
let themeIdx = Math.min(Math.max(+(localStorage.getItem("rc_theme") || 0) || 0, 0), THEMES.length - 1);
let puckIdx = Math.min(Math.max(+(localStorage.getItem("rc_puck") || 0) || 0, 0), PUCKS.length - 1);
let themeOverride = null;

function refreshStyle() {
    themeIdx = Math.min(Math.max(+(localStorage.getItem("rc_theme") || 0) || 0, 0), THEMES.length - 1);
    puckIdx = Math.min(Math.max(+(localStorage.getItem("rc_puck") || 0) || 0, 0), PUCKS.length - 1);
}

function currentTheme() { return themeOverride || THEMES[themeIdx]; }
function currentPuck() { return PUCKS[puckIdx]; }

// производные цвета ринга и прицела
function ringColors() {
    const t = THEMES[themeIdx];
    return {
        ringP1: t.id === "night" ? "#ff6150" : "#f33342",
        ringP2: t.id === "cherry" ? "#65fbc0" : "#12bf83",
        aim: t.aim, aimHot: t.aimHot,
    };
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}


// ═══════════════ Персонажи: аватары игрока и ботов ═══════════════
// Детальный рисовальщик в мультяшном стиле: объёмная причёска,
// глаза с радужкой и бликами, нос с тенью, щетина/борода штрихами,
// вязка/клетка на одежде. Единый стиль для игрока и всех ботов.
const AVATARS = [
    {
        id: "nick", ru: "Николай", en: "Nick",
        skin: "#f2c9a0", shade: "#dda87c", light: "#fbdcb8",
        hair: "#6b4a2a", hairHi: "#8f6a3e", hairStyle: "sidepart",
        brows: "#4a2f18", eye: "#5b7a3a", face: "stubble",
        shirt: "#3f6ea5", shirtShade: "#2f5378", collar: "#7a5c3a",
        knit: true, female: false,
    },
    {
        id: "amina", ru: "Амина", en: "Amina",
        skin: "#8a5433", shade: "#6e3f24", light: "#a06a40",
        hair: "#15100c", hairHi: "#2e2418", hairStyle: "afro",
        brows: "#100c08", eye: "#4a3a2a", face: "none",
        shirt: "#c2801f", shirtShade: "#9a6512", collar: "#e0b060",
        earrings: true, female: true,
    },
    {
        id: "kenji", ru: "Кенджи", en: "Kenji",
        skin: "#e8c08e", shade: "#cf9f6c", light: "#f5d9ae",
        hair: "#141210", hairHi: "#332e28", hairStyle: "short",
        brows: "#141210", eye: "#3a3a3a", face: "glasses",
        shirt: "#a53a34", shirtShade: "#7d2a26", collar: "#7d2a26",
        knit: false, female: false,
    },
];

AVATARS.push(
    {...AVATARS[0], id:"elena", ru:"Елена", en:"Elena", female:true},
    {...AVATARS[2], id:"mei", ru:"Мэй", en:"Mei", female:true},
    {...AVATARS[0], id:"mateo", ru:"Матео", en:"Mateo", female:false}
);

function drawPerson(ctx, b, cx, cy, s) {
    const u = s / 100;                       // масштаб: s ≈ 100 → пиксельные меры в u
    const hy = cy - 8 * u;                   // центр головы
    const hw = 24 * u, hh = 30 * u;          // полуоси головы
    const C = (a) => b.skin;
    const jaw = (w2, c2) => { ctx.strokeStyle = c2; ctx.lineWidth = w2 * u; ctx.lineCap = "round"; };

    // ── шея с тенью ──
    ctx.fillStyle = b.shade;
    roundRect(ctx, cx - 9 * u, cy + 8 * u, 18 * u, 22 * u, 6 * u);
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,.18)";
    roundRect(ctx, cx - 9 * u, cy + 8 * u, 18 * u, 8 * u, 4 * u);
    ctx.fill();

    // ── одежда ──
    ctx.fillStyle = b.shirt;
    roundRect(ctx, cx - 46 * u, cy + 27 * u, 92 * u, 44 * u, 16 * u);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,.2)"; ctx.lineWidth = 1.2 * u; ctx.stroke();
    ctx.save();
    roundRect(ctx, cx - 46 * u, cy + 27 * u, 92 * u, 44 * u, 16 * u);
    ctx.clip();
    if (b.knit) {
        // вязка: волнистые вертикальные косы
        ctx.lineWidth = 2 * u;
        for (let i = -4; i <= 4; i++) {
            ctx.strokeStyle = i % 2 ? "rgba(255,255,255,.10)" : "rgba(0,0,0,.12)";
            ctx.beginPath();
            for (let yy = cy + 27 * u; yy < cy + 74 * u; yy += 6 * u) {
                const xx = cx + i * 10 * u + Math.sin(yy * 0.5 + i) * 1.6 * u;
                if (yy === cy + 27 * u) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
            }
            ctx.stroke();
        }
    } else if (b.plaid) {
        ctx.lineWidth = 3.4 * u;
        ctx.strokeStyle = "rgba(255,255,255,.16)";
        for (let i = -2; i <= 2; i++) {
            ctx.beginPath(); ctx.moveTo(cx + i * 16 * u, cy + 27 * u); ctx.lineTo(cx + i * 16 * u, cy + 74 * u); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(cx - 46 * u, cy + 40 * u + i * 12 * u); ctx.lineTo(cx + 46 * u, cy + 40 * u + i * 12 * u); ctx.stroke();
        }
    }
    ctx.restore();
    // воротник
    if (b.collar) {
        ctx.fillStyle = b.collar;
        ctx.beginPath();
        ctx.moveTo(cx - 13 * u, cy + 27 * u);
        ctx.lineTo(cx, cy + 40 * u);
        ctx.lineTo(cx + 13 * u, cy + 27 * u);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,.15)"; ctx.lineWidth = 0.8 * u; ctx.stroke();
    } else {
        // круглый вырез
        ctx.strokeStyle = "rgba(0,0,0,.22)"; ctx.lineWidth = 2 * u;
        ctx.beginPath(); ctx.arc(cx, cy + 30 * u, 10 * u, Math.PI, Math.PI * 2); ctx.stroke();
    }

    // ── уши ──
    ctx.fillStyle = b.shade;
    ctx.beginPath(); ctx.ellipse(cx - hw - 2 * u, hy + 2 * u, 3.5 * u, 5.5 * u, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx + hw + 2 * u, hy + 2 * u, 3.5 * u, 5.5 * u, 0, 0, Math.PI * 2); ctx.fill();
    if (b.earrings) {
        ctx.fillStyle = "#7fe3ff";
        ctx.beginPath(); ctx.arc(cx - hw - 2 * u, hy + 9 * u, 1.8 * u, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx + hw + 2 * u, hy + 9 * u, 1.8 * u, 0, Math.PI * 2); ctx.fill();
    }

    // ── голова: база + объём ──
    ctx.fillStyle = b.skin;
    ctx.beginPath(); ctx.ellipse(cx, hy, hw, hh, 0, 0, Math.PI * 2); ctx.fill();
    // тень по челюсти/щеке
    ctx.fillStyle = b.shade;
    ctx.beginPath();
    ctx.ellipse(cx + hw * 0.34, hy + hh * 0.34, hw * 0.55, hh * 0.5, 0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = b.skin;
    ctx.beginPath(); ctx.ellipse(cx - hw * 0.1, hy - hh * 0.06, hw * 0.8, hh * 0.86, 0, 0, Math.PI * 2); ctx.fill();
    // блик на лбу
    ctx.fillStyle = b.light || "rgba(255,255,255,.25)";
    ctx.beginPath(); ctx.ellipse(cx - hw * 0.25, hy - hh * 0.45, hw * 0.42, hh * 0.22, -0.2, 0, Math.PI * 2); ctx.fill();

    // ── причёска ──
    const top = hy - hh * 0.72;
    if (b.hairStyle === "afro") {
        ctx.fillStyle = b.hair;
        ctx.beginPath(); ctx.arc(cx, hy - hh * 0.30, hh * 0.88, 0, Math.PI * 2); ctx.fill();
        for (const d of [[-0.95, -0.5], [-0.55, -0.92], [0, -1.1], [0.55, -0.92], [0.95, -0.5], [-0.75, 0.1], [0.75, 0.12]]) {
            ctx.beginPath(); ctx.arc(cx + d[0] * hh * 0.72, hy - hh * 0.3 + d[1] * hh * 0.72, hh * 0.30, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = b.skin;
        ctx.beginPath(); ctx.ellipse(cx, hy + hh * 0.05, hw * 0.82, hh * 0.8, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = b.hairHi;
        ctx.beginPath(); ctx.arc(cx - hh * 0.3, hy - hh * 0.75, hh * 0.16, 0, Math.PI * 2); ctx.fill();
    } else if (b.hairStyle === "sidepart") {
        ctx.fillStyle = b.hair;
        ctx.beginPath();
        ctx.moveTo(cx - hw * 1.02, hy - hh * 0.05);
        ctx.bezierCurveTo(cx - hw * 1.05, hy - hh * 0.95, cx + hw * 1.05, hy - hh * 0.98, cx + hw * 1.0, hy - hh * 0.02);
        ctx.bezierCurveTo(cx + hw * 0.7, hy - hh * 0.55, cx - hw * 0.2, hy - hh * 0.5, cx - hw * 1.02, hy - hh * 0.05);
        ctx.fill();
        ctx.strokeStyle = b.hairHi || "rgba(255,255,255,.3)"; ctx.lineWidth = 1.6 * u;
        ctx.beginPath(); ctx.moveTo(cx - hw * 0.5, hy - hh * 0.62);
        ctx.bezierCurveTo(cx, hy - hh * 0.8, cx + hw * 0.5, hy - hh * 0.72, cx + hw * 0.9, hy - hh * 0.3);
        ctx.stroke();
        // бакенбарды
        ctx.fillStyle = b.hair;
        roundRect(ctx, cx - hw - 1 * u, hy - hh * 0.2, 3 * u, hh * 0.4, 1.5 * u); ctx.fill();
        roundRect(ctx, cx + hw - 2 * u, hy - hh * 0.2, 3 * u, hh * 0.4, 1.5 * u); ctx.fill();
    } else if (b.hairStyle === "short") {
        ctx.fillStyle = b.hair;
        ctx.beginPath();
        ctx.arc(cx, hy - hh * 0.16, hw * 1.02, Math.PI * 1.05, Math.PI * 1.95);
        ctx.fill();
        roundRect(ctx, cx - hw - 1 * u, hy - hh * 0.24, 3 * u, hh * 0.46, 1.5 * u); ctx.fill();
        roundRect(ctx, cx + hw - 2 * u, hy - hh * 0.24, 3 * u, hh * 0.46, 1.5 * u); ctx.fill();
        ctx.strokeStyle = b.hairHi || "rgba(255,255,255,.25)"; ctx.lineWidth = 1.2 * u;
        ctx.beginPath(); ctx.arc(cx, hy - hh * 0.2, hw * 0.8, Math.PI * 1.25, Math.PI * 1.6); ctx.stroke();
    } else if (b.hairStyle === "cap") {
        ctx.fillStyle = b.capColor || b.shirt;
        ctx.beginPath(); ctx.arc(cx, hy - hh * 0.22, hw * 1.04, Math.PI, Math.PI * 2); ctx.fill();
        roundRect(ctx, cx - hw * 1.25, hy - hh * 0.30, hw * 2.5, hh * 0.14, 3 * u); ctx.fill();
        roundRect(ctx, cx + hw * 0.9, hy - hh * 0.28, hw * 0.5, hh * 0.10, 2 * u); ctx.fill();
        ctx.fillStyle = "rgba(0,0,0,.2)";
        ctx.beginPath(); ctx.arc(cx, hy - hh * 0.22, hw * 1.04, Math.PI * 1.1, Math.PI * 1.9); ctx.fill();
    } else if (b.hairStyle === "bald") {
        ctx.strokeStyle = "rgba(255,255,255,.30)"; ctx.lineWidth = 2 * u;
        ctx.beginPath(); ctx.arc(cx - hw * 0.15, hy - hh * 0.3, hw * 0.55, Math.PI * 1.15, Math.PI * 1.75); ctx.stroke();
    }

    // ── брови ──
    jaw(3.2, b.brows || "#2a2018");
    ctx.beginPath();
    ctx.moveTo(cx - hw * 0.55, hy - hh * 0.26);
    ctx.quadraticCurveTo(cx - hw * 0.34, hy - hh * 0.34, cx - hw * 0.14, hy - hh * 0.28);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + hw * 0.14, hy - hh * 0.28);
    ctx.quadraticCurveTo(cx + hw * 0.34, hy - hh * 0.34, cx + hw * 0.55, hy - hh * 0.26);
    ctx.stroke();

    // ── глаза ──
    for (const dx of [-0.36, 0.36]) {
        const ex = cx + dx * hw, ey = hy - hh * 0.05;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath(); ctx.ellipse(ex, ey, 6.4 * u, 5 * u, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,.12)"; ctx.lineWidth = 0.7 * u; ctx.stroke();
        ctx.fillStyle = b.eye || "#4a3a2a";
        ctx.beginPath(); ctx.arc(ex + 0.6 * u, ey + 0.3 * u, 3.1 * u, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#0a0a0a";
        ctx.beginPath(); ctx.arc(ex + 0.6 * u, ey + 0.3 * u, 1.5 * u, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,.95)";
        ctx.beginPath(); ctx.arc(ex - 0.6 * u, ey - 1.1 * u, 1.2 * u, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(ex + 1.4 * u, ey + 1.2 * u, 0.6 * u, 0, Math.PI * 2); ctx.fill();
        // верхнее веко
        ctx.strokeStyle = "rgba(0,0,0,.18)"; ctx.lineWidth = 0.8 * u;
        ctx.beginPath(); ctx.arc(ex, ey - 0.6 * u, 6.2 * u, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
    }
    if (b.face === "glasses") {
        jaw(1.4 * u, "#1a1a1a");
        roundRect(ctx, cx - hw * 0.62, hy - hh * 0.16, hw * 0.56, hh * 0.17, 3 * u);
        ctx.stroke();
        roundRect(ctx, cx + hw * 0.06, hy - hh * 0.16, hw * 0.56, hh * 0.17, 3 * u);
        ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx - hw * 0.06, hy - hh * 0.09); ctx.lineTo(cx + hw * 0.06, hy - hh * 0.09); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx - hw * 0.62, hy - hh * 0.10); ctx.lineTo(cx - hw * 0.94, hy - hh * 0.16); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx + hw * 0.62, hy - hh * 0.10); ctx.lineTo(cx + hw * 0.94, hy - hh * 0.16); ctx.stroke();
    }

    // ── нос ──
    jaw(1.6 * u, b.shade);
    ctx.beginPath();
    ctx.moveTo(cx + 0.5 * u, hy + 2 * u);
    ctx.quadraticCurveTo(cx + 2.4 * u, hy + 9 * u, cx - 1 * u, hy + 11 * u);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.lineWidth = 1.2 * u;
    ctx.beginPath(); ctx.moveTo(cx + 1 * u, hy + 5 * u); ctx.lineTo(cx + 1.6 * u, hy + 9 * u); ctx.stroke();

    // ── рот ──
    jaw(1.8 * u, "#8a4432");
    ctx.beginPath();
    ctx.arc(cx, hy + hh * 0.24, 9 * u, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,.3)"; ctx.lineWidth = 1 * u;
    ctx.beginPath();
    ctx.arc(cx, hy + hh * 0.27, 8.4 * u, 0.3 * Math.PI, 0.62 * Math.PI);
    ctx.stroke();

    // ── щетина / борода / усы ──
    if (b.face === "stubble") {
        ctx.save();
        ctx.beginPath(); ctx.ellipse(cx, hy + hh * 0.42, hw * 0.78, hh * 0.46, 0, 0, Math.PI); ctx.clip();
        ctx.fillStyle = "rgba(90,58,31,.26)";
        ctx.fillRect(cx - hw, hy, hw * 2, hh);
        ctx.restore();
        jaw(1 * u, "rgba(90,58,31,.5)");
        for (let i = -3; i <= 3; i++) {
            ctx.beginPath();
            ctx.moveTo(cx + i * 4 * u, hy + hh * 0.34);
            ctx.lineTo(cx + i * 4 * u + 1 * u, hy + hh * 0.42);
            ctx.stroke();
        }
    } else if (b.face === "mustache" || b.face === "beard") {
        ctx.fillStyle = b.hair;
        ctx.beginPath();
        ctx.moveTo(cx - 9 * u, hy + hh * 0.20);
        ctx.quadraticCurveTo(cx, hy + hh * 0.14, cx + 9 * u, hy + hh * 0.20);
        ctx.quadraticCurveTo(cx, hy + hh * 0.26, cx - 9 * u, hy + hh * 0.20);
        ctx.fill();
        if (b.face === "beard") {
            ctx.fillStyle = b.hair;
            ctx.beginPath();
            ctx.ellipse(cx, hy + hh * 0.52, hw * 0.62, hh * 0.34, 0, 0, Math.PI);
            ctx.fill();
            ctx.fillStyle = b.skin;
            ctx.beginPath(); ctx.ellipse(cx, hy + hh * 0.30, hw * 0.30, hh * 0.14, 0, 0, Math.PI * 2); ctx.fill();
            // текст бороды штрихами
            ctx.strokeStyle = "rgba(255,255,255,.14)"; ctx.lineWidth = 0.9 * u;
            for (let i = -2; i <= 2; i++) {
                ctx.beginPath();
                ctx.moveTo(cx + i * 6 * u, hy + hh * 0.42);
                ctx.lineTo(cx + i * 6 * u - 1 * u, hy + hh * 0.62);
                ctx.stroke();
            }
        }
    }
    ctx.lineCap = "butt";
}

// персонаж → круглая картинка-URL (аватар игрока, боты в шапке)
const PORTRAIT_FILES = {
    elena: "img/portraits/elena.png",
    mei: "img/portraits/mei.png",
    mateo: "img/portraits/mateo.png",
    nick: "img/portraits/nick.jpg",
    amina: "img/portraits/amina.jpg",
    kenji: "img/portraits/kenji.jpg",
    asif: "img/portraits/asif.jpg",
    kamran: "img/portraits/kamran.jpg",
    barry: "img/portraits/barry.jpg",
    khan: "img/portraits/khan.jpg",
    salman: "img/portraits/salman.jpg",
    tarik: "img/portraits/tarik.jpg",
    jo: "img/portraits/jo.jpg",
    viki: "img/portraits/viki.jpg",
    roma: "img/portraits/roma.jpg",
    lev: "img/portraits/lev.jpg",
};
const AVATAR_PORTRAITS = ["nick", "amina", "kenji", "elena", "mei", "mateo"];
const _portraitImages = {};
function portraitPath(spec) {
    const id = spec && (spec.portrait || spec.id);
    return PORTRAIT_FILES[id] || null;
}
function portraitImage(path) {
    if (!_portraitImages[path]) {
        const image = new Image();
        image.onload = () => {
            Object.keys(_personCanvasCache).forEach(key => delete _personCanvasCache[key]);
        };
        image.src = path;
        _portraitImages[path] = image;
    }
    return _portraitImages[path];
}

const _avatarURLCache = {};
// персонаж → кешированный спрайт-канвас (рисуется один раз на размер)
const _personCanvasCache = {};
Object.values(PORTRAIT_FILES).forEach(portraitImage);
function personCanvas(spec, px) {
    const key = (spec.id || spec.name || "x") + "@" + px;
    if (_personCanvasCache[key]) return _personCanvasCache[key];
    const cnv = document.createElement("canvas");
    cnv.width = cnv.height = Math.round(px * 2);
    const g = cnv.getContext("2d");
    g.scale(2, 2);
    const path = portraitPath(spec);
    const image = path && portraitImage(path);
    if (image && image.complete && image.naturalWidth) {
        g.drawImage(image, 0, 0, px, px);
    } else if (image) {
        g.fillStyle = "#0d211a";
        g.fillRect(0, 0, px, px);
    } else {
        drawPerson(g, spec, px / 2, px / 2 + px * 0.09, px * 0.94);
    }
    _personCanvasCache[key] = cnv;
    return cnv;
}
function personURL(spec, px) {
    const path = portraitPath(spec);
    if (path) return path;
    return personCanvas(spec, px).toDataURL();
}
function _oldPersonURL(spec, px) {
    const key = (spec.id || spec.name || "x") + "@" + px;
    if (_avatarURLCache[key]) return _avatarURLCache[key];
    const cnv = document.createElement("canvas");
    cnv.width = cnv.height = px * 2;
    const g = cnv.getContext("2d");
    g.scale(2, 2);
    g.beginPath(); g.arc(px / 2, px / 2, px / 2 - 0.5, 0, Math.PI * 2); g.clip();
    g.fillStyle = "#0d211a"; g.fillRect(0, 0, px, px);
    drawPerson(g, spec, px / 2, px / 2 + px * 0.09, px * 0.94);
    const url = cnv.toDataURL();
    _avatarURLCache[key] = url;
    return url;
}
// превью расцветки: мини-версия всего поля
const previewURL = (function () {
    const cache = {};
    return function (idx, w, h) {
        w = w || 320; h = h || 210;
        const key = idx + "@" + w + "x" + h;
        if (cache[key]) return cache[key];
        const s0 = 240;
        const wall = s0 * 0.045, stoneR = s0 * 0.024 * 0.85, ringR = s0 * 0.065 * 0.85, pocketR = s0 * 0.024 * 1.5 * 0.9;
        const k = pocketR * 0.55;
        const mini = {
            size: s0, wall, stoneR, ringR, pocketR,
            L: wall, T: wall, R: s0 - wall, B: s0 - wall,
            pockets: [
                { x: wall + k, y: wall + k }, { x: s0 - wall - k, y: wall + k },
                { x: wall + k, y: s0 - wall - k }, { x: s0 - wall - k, y: s0 - wall - k },
            ],
        };
        const scale = Math.min(w / (s0 + 20), h / (s0 + 10));
        const cnv = document.createElement("canvas");
        cnv.width = Math.round(w * 2); cnv.height = Math.round(h * 2);
        const g = cnv.getContext("2d");
        g.setTransform(2 * scale, 0, 0, 2 * scale, 2 * (w - s0 * scale) / 2, 2 * (h - s0 * scale) / 2);
        themeOverride = THEMES[idx];
        try { drawBoard(g, mini, { phase: "aim", turn: 0 }); } finally { themeOverride = null; }
        const url = cnv.toDataURL();
        cache[key] = url;
        return url;
    };
})();

function avatarURL(idx, px) {
    const portrait = AVATAR_PORTRAITS[Math.max(0, Math.min(AVATAR_PORTRAITS.length - 1, idx))];
    if (PORTRAIT_FILES[portrait]) return PORTRAIT_FILES[portrait];
    return personURL(AVATARS[Math.max(0, Math.min(AVATARS.length - 1, idx))], px);
}

// мраморные разводы сукна — рисуются один раз в оффскрин
let feltCache = null;
function feltTexture(w) {
    const T = currentTheme();
    const key = w.size + "|" + T.id;
    if (feltCache && feltCache.key === key) return feltCache.cnv;
    const cnv = document.createElement("canvas");
    cnv.width = cnv.height = w.size;
    const g = cnv.getContext("2d");
    const fg = g.createRadialGradient(w.size / 2, w.size / 2, w.size * 0.15, w.size / 2, w.size / 2, w.size * 0.72);
    fg.addColorStop(0, T.felt1); fg.addColorStop(1, T.felt2);
    g.fillStyle = fg;
    g.fillRect(0, 0, w.size, w.size);
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 26; i++) {
        const x = rnd() * w.size, y = rnd() * w.size;
        const r = w.size * (0.05 + rnd() * 0.16);
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, i % 2 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)");
        gr.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = gr;
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    feltCache = { key, cnv };
    return cnv;
}

// ── Разметка сукна ──
function drawMarkings(ctx, w) {
    const s = w.size, cx = s / 2, cy = s / 2;
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.82)";
    ctx.lineWidth = s * 0.0018;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Two fine white boundary lines, like the marble-table reference.
    for (const inset of [s * 0.085, s * 0.105]) {
        ctx.strokeRect(inset, inset, s - 2 * inset, s - 2 * inset);
    }
    // Concentric centre rings and a fine diagonal through the centre.
    for (const radius of [s * 0.043, s * 0.032]) {
        ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.stroke();
    }
    const r = s * 0.043 / Math.SQRT2;
    ctx.beginPath();ctx.moveTo(cx-r,cy+r);ctx.lineTo(cx+r,cy-r);ctx.stroke();

    // Four long diagonal stems with hollow, softly curved spade arrowheads.
    for (const [sx, sy] of [[-1,-1],[1,-1],[-1,1],[1,1]]) {
        ctx.save();
        ctx.translate(cx + sx * s * 0.415, cy + sy * s * 0.415);
        ctx.rotate(Math.atan2(-sy, -sx));
        const tip = s * 0.34, h = s * 0.052, half = s * 0.024;
        ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(tip-h,0);ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(tip,0);
        ctx.bezierCurveTo(tip-h*0.38,-half*0.45,tip-h*0.56,-half*1.12,tip-h*0.8,-half);
        ctx.bezierCurveTo(tip-h*1.05,-half,tip-h*1.08,-half*0.36,tip-h*0.88,-half*0.2);
        ctx.lineTo(tip-h*1.12,0);
        ctx.lineTo(tip-h*0.88,half*0.2);
        ctx.bezierCurveTo(tip-h*1.08,half*0.36,tip-h*1.05,half,tip-h*0.8,half);
        ctx.bezierCurveTo(tip-h*0.56,half*1.12,tip-h*0.38,half*0.45,tip,0);
        ctx.closePath();ctx.stroke();
        ctx.restore();
    }
    ctx.restore();
}

function drawBoard(ctx, w, st) {
    const T = currentTheme();
    const s = w.size;

    const grd = ctx.createLinearGradient(0, 0, 0, s);
    grd.addColorStop(0, T.wood1);
    grd.addColorStop(0.45, T.wood2);
    grd.addColorStop(0.52, T.wood1);
    grd.addColorStop(1, T.wood2);
    roundRect(ctx, 0, 0, s, s, 14);
    ctx.fillStyle = grd; ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.45)"; ctx.lineWidth = 2; ctx.stroke();
    roundRect(ctx, w.wall * 0.28, w.wall * 0.28, s - w.wall * 0.56, s - w.wall * 0.56, 9);
    ctx.strokeStyle = T.frameHi; ctx.lineWidth = 1.4; ctx.stroke();

    ctx.drawImage(feltTexture(w), w.L - 3, w.T - 3, s - 2 * w.L + 6, s - 2 * w.T + 6);
    ctx.strokeStyle = "rgba(0,0,0,0.30)"; ctx.lineWidth = 5;
    ctx.strokeRect(w.L - 1.5, w.T - 1.5, s - 2 * w.L + 3, s - 2 * w.T + 3);

    drawMarkings(ctx, w);

    const [x0, x1] = PHY.baselineRange(w);
    const rcCol = ringColors();
    for (const turn of [0, 1]) {
        const y = PHY.baselineY(w, turn);
        const active = st && st.phase === "aim" && st.turn === turn;
        ctx.setLineDash([5, 8]);
        ctx.strokeStyle = active ? (turn === 0 ? rcCol.ringP1 : rcCol.ringP2) : T.baseline;
        ctx.lineWidth = active ? 1.8 : 1.3;
        ctx.beginPath();
        ctx.moveTo(x0, y); ctx.lineTo(x1, y);
        ctx.stroke();
        ctx.setLineDash([]);
        if (active) {
            ctx.fillStyle = T.mark;
            ctx.globalAlpha = 0.7;
            for (const [ax, dir] of [[x0 - 12, 1], [x1 + 12, -1]]) {
                ctx.beginPath();
                ctx.moveTo(ax + dir * 6, y);
                ctx.lineTo(ax - dir * 2, y - 4);
                ctx.lineTo(ax - dir * 2, y + 4);
                ctx.closePath(); ctx.fill();
            }
            ctx.globalAlpha = 1;
        }
    }

    // лузы — маленькие чёрные «дыры»
    for (const p of w.pockets) {
        ctx.beginPath(); ctx.arc(p.x, p.y, w.pocketR, 0, Math.PI * 2);
        ctx.fillStyle = T.pocketShadow; ctx.fill();
        ctx.beginPath(); ctx.arc(p.x, p.y, w.pocketR * PHY.P.POCKET_BLACK_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = T.hole; ctx.fill();
        ctx.beginPath(); ctx.arc(p.x, p.y, w.pocketR * PHY.P.POCKET_BLACK_RADIUS, 0, Math.PI * 2);
        ctx.strokeStyle = T.holeRim; ctx.lineWidth = 1.2; ctx.stroke();
        ctx.beginPath();
        ctx.arc(p.x, p.y, w.pocketR * 0.78, -2.4, -1.2);
        ctx.strokeStyle = T.holeHi; ctx.lineWidth = 1.6; ctx.stroke();
    }
}

function drawStone(ctx, st, scale, alpha) {
    const P = currentPuck();
    const white = st.color === "w";
    const fill = white ? P.lightFill : P.darkFill;
    const rim = white ? P.lightRim : P.darkRim;
    const engrave = white ? P.lightEngrave : P.darkEngrave;
    const hi = white ? P.lightHi : P.darkHi;
    const T = currentTheme();
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.ellipse(st.x + 1.2, st.y + 2.1, st.r * scale, st.r * scale * 0.95, 0, 0, Math.PI * 2);
    ctx.fillStyle = T.shadow; ctx.fill();
    ctx.beginPath();
    ctx.arc(st.x, st.y, st.r * scale, 0, Math.PI * 2);
    // Soft material lighting, preserving the exact stone silhouette.
    const surface = ctx.createRadialGradient(
        st.x - st.r * scale * 0.35, st.y - st.r * scale * 0.4, 0,
        st.x, st.y, st.r * scale);
    surface.addColorStop(0, hi);
    surface.addColorStop(0.35, fill);
    surface.addColorStop(1, fill);
    ctx.fillStyle = surface; ctx.fill();
    ctx.strokeStyle = rim; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.save();
    ctx.translate(st.x, st.y);
    ctx.rotate(st.spinA);
    ctx.beginPath(); ctx.arc(0, 0, st.r * scale * 0.5, 0, Math.PI * 2);
    ctx.strokeStyle = engrave; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(st.x, st.y, st.r * scale * 0.78, -2.4, -1.3);
    ctx.strokeStyle = hi; ctx.lineWidth = 1.3; ctx.stroke();
    ctx.restore();
}

function drawRing(ctx, ring, color, ghost, blocked) {
    const T = currentTheme();
    const mid = (ring.r + ring.ri) / 2, band = ring.r - ring.ri;
    ctx.save();
    if (ghost) ctx.globalAlpha = 0.55;
    if (blocked) ctx.globalAlpha = 0.38;
    // Soft contact shadow, with the centre left open to the table below.
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = band * 0.45;
    ctx.beginPath();
    ctx.arc(ring.x + band * 0.12, ring.y + band * 0.25, mid, 0, Math.PI * 2);
    ctx.strokeStyle = T.shadow; ctx.lineWidth = band; ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(ring.x, ring.y, mid, 0, Math.PI * 2);
    ctx.strokeStyle = color; ctx.lineWidth = band; ctx.stroke();
    // Directional lighting gives the plastic a lit upper-left and shaded lower-right.
    const light = ctx.createLinearGradient(ring.x-ring.r, ring.y-ring.r, ring.x+ring.r, ring.y+ring.r);
    light.addColorStop(0, "rgba(255,255,255,0.48)");
    light.addColorStop(0.4, "rgba(255,255,255,0.08)");
    light.addColorStop(0.65, "rgba(0,0,0,0.06)");
    light.addColorStop(1, "rgba(0,0,0,0.38)");
    ctx.strokeStyle = light; ctx.lineWidth = band; ctx.stroke();

    // A rounded cross-section: recessed inner wall, bright shoulder, dark outer lip.
    const bevel = ctx.createRadialGradient(ring.x,ring.y,ring.ri,ring.x,ring.y,ring.r);
    bevel.addColorStop(0, "rgba(0,0,0,0.52)");
    bevel.addColorStop(0.14, "rgba(0,0,0,0.18)");
    bevel.addColorStop(0.34, "rgba(255,255,255,0.24)");
    bevel.addColorStop(0.55, "rgba(255,255,255,0.08)");
    bevel.addColorStop(0.8, "rgba(0,0,0,0.12)");
    bevel.addColorStop(1, "rgba(0,0,0,0.48)");
    ctx.strokeStyle = bevel; ctx.stroke();
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(ring.x, ring.y, mid + band * 0.1, -2.9, -1.1);
    ctx.strokeStyle = "rgba(255,255,255,0.42)"; ctx.lineWidth = band * 0.2; ctx.stroke();
    ctx.beginPath();ctx.arc(ring.x,ring.y,mid+band*0.1,-2.65,-2.03);
    ctx.strokeStyle = "rgba(255,255,255,0.72)";ctx.lineWidth = band*0.09;ctx.stroke();
    ctx.beginPath();ctx.arc(ring.x,ring.y,ring.ri+band*0.09,0.35,1.8);
    ctx.strokeStyle = "rgba(255,255,255,0.32)";ctx.lineWidth = band*0.1;ctx.stroke();
    ctx.lineCap = "butt";
    if (ghost) {
        const t = (performance.now() / 900) % 1;
        ctx.beginPath();
        ctx.arc(ring.x, ring.y, ring.r + 6 + t * 14, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(217,72,64,${0.35 * (1 - t)})`;
        ctx.lineWidth = 1.6; ctx.stroke();
    }
    if (blocked) {
        ctx.beginPath();
        ctx.arc(ring.x, ring.y, ring.r + 5, 0, Math.PI * 2);
        ctx.setLineDash([4, 5]);
        ctx.strokeStyle = "rgba(178,58,46,0.85)";
        ctx.lineWidth = 1.6; ctx.stroke();
        ctx.setLineDash([]);
    }
    ctx.restore();
}

function drawAim(ctx, ring, angle, power, len, color) {
    const ux = Math.cos(angle), uy = Math.sin(angle);
    ctx.setLineDash([5, 8]);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(ring.x + ux * ring.r, ring.y + uy * ring.r);
    ctx.lineTo(ring.x + ux * len, ring.y + uy * len);
    ctx.stroke();
    ctx.setLineDash([]);
    const ax = ring.x + ux * len, ay = ring.y + uy * len;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax - ux * 10 - uy * 5.5, ay - uy * 10 + ux * 5.5);
    ctx.lineTo(ax - ux * 10 + uy * 5.5, ay - uy * 10 - ux * 5.5);
    ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
    ctx.beginPath();
    ctx.arc(ring.x, ring.y, ring.r + 6, -Math.PI / 2, -Math.PI / 2 + power * Math.PI * 2);
    ctx.strokeStyle = color; ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.stroke();
    ctx.lineCap = "butt";
}

// ═══════════════ Кадр ═══════════════
function draw(ctx, w, st) {
    const rc = ringColors();
    drawBoard(ctx, w, st);

    if (st.trail && st.trail.length > 1 && w.ring) {
        const T = currentTheme();
        const band = (w.ring.r - w.ring.ri);
        ctx.lineCap = "round";
        for (let i = 1; i < st.trail.length; i++) {
            const p0 = st.trail[i - 1], p1 = st.trail[i];
            const d = Math.hypot(p1.x - p0.x, p1.y - p0.y);
            const steps = Math.max(1, Math.min(4, Math.round(d / 8)));
            for (let q = 1; q <= steps; q++) {
                const kk = (i - 1 + q / steps) / st.trail.length;
                const x = p0.x + (p1.x - p0.x) * q / steps;
                const y = p0.y + (p1.y - p0.y) * q / steps;
                ctx.beginPath();
                ctx.arc(x, y, w.ring.ri + band * 0.55 * kk, 0, Math.PI * 2);
                ctx.lineWidth = 1.5 + 2.5 * kk;
                ctx.strokeStyle = `rgba(${T.trailRgb},${(0.20 * kk).toFixed(3)})`;
                ctx.stroke();
            }
        }
    }

    for (const s of w.stones) {
        if (s.done) continue;
        if (s.sink > 0) drawStone(ctx, s, 1 - s.sink * 0.75, 1 - s.sink);
        else drawStone(ctx, s, 1, 1);
    }

    if (st.dragAim && w.ring) {
        drawAim(ctx, w.ring, st.dragAim.angle, st.dragAim.power,
            40 + st.dragAim.power * w.size * 0.42,
            st.dragAim.power > 0.85 ? rc.aimHot : rc.aim);
    }
    if (st.botAim && w.ring) {
        drawAim(ctx, w.ring, st.botAim.angle, st.botAim.power,
            40 + st.botAim.power * w.size * 0.42, "rgba(61,156,109,0.8)");
    }
    // прицел онлайн-соперника в реальном времени
    if (st.oppAim && w.ring) {
        drawAim(ctx, w.ring, st.oppAim.angle, st.oppAim.power,
            40 + st.oppAim.power * w.size * 0.42, "rgba(120,200,235,0.8)");
    }

    if (w.ring && !w.ring.done && !(w.ring.sink > 0)) {
        drawRing(ctx, w.ring, st.ringColor || rc.ringP1, st.ringPlaced === false, st.ringBlocked);
    }

    for (const a of st.potAnims || []) {
        const k = a.t / 0.4;
        ctx.beginPath();
        ctx.arc(a.x, a.y, w.pocketR * (0.3 + 0.7 * k), 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${currentTheme().markRgb},${((1 - k) * 0.5).toFixed(3)})`;
        ctx.lineWidth = 1.6;
        ctx.stroke();
    }

    // практика обучения шага 1: стол приглушён на 50% — фокус на ползунке
    if (st.dimBoard) {
        ctx.fillStyle = "rgba(3,7,5,0.5)";
        ctx.fillRect(-4, -4, w.size + 8, w.size + 8);
    }

    // искры удовольствия: золотые брызги при забитой шашке
    for (const s of st.sparks || []) {
        const a = Math.max(0, 1 - s.t / s.life);
        ctx.beginPath();
        ctx.arc(s.x, s.y, 1.3 + 1.8 * a, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${s.c},${(a * 0.95).toFixed(3)})`;
        ctx.fill();
    }
}

function pieceURL(color) {
    const c = document.createElement("canvas"); c.width = c.height = 40;
    drawStone(c.getContext("2d"), {x:20,y:19,r:16,color,spinA:0}, 1, 1);
    return c.toDataURL();
}
const ringIcons = new Map();
function ringURL(color) {
    if (!ringIcons.has(color)) {
        const c = document.createElement("canvas"); c.width = c.height = 48;
        drawRing(c.getContext("2d"), {x:24,y:22,r:20,ri:20 * PHY.P.RING_INNER}, color, false, false);
        ringIcons.set(color, c.toDataURL());
    }
    return ringIcons.get(color);
}
global.RCRender = {
    pieceURL, ringURL, drawStone, drawRing,
    draw, refreshStyle, currentTheme, currentPuck, ringColors,
    THEMES, PUCKS, AVATARS, drawPerson, avatarURL, personURL, personCanvas, previewURL,
};

})(window);
