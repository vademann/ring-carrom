"use strict";
// ═══════════════════════════════════════════════════════════
//  main.js — Ring Carrom: экраны, режимы, ввод, игровой цикл,
//  бот, онлайн (nostr + lan), магазин, обучение, i18n.
// ═══════════════════════════════════════════════════════════

const PHY = window.RCPhysics;
const BOT = window.RCBot;
const RND = window.RCRender;
let NET = window.RCNet;              // активный транспорт: RCNet или RCLan

const $ = id => document.getElementById(id);
const canvas = $("c");
const ctx = canvas.getContext("2d");

let view = { scale: 1, css: 0 };

let mode = "bot";            // bot | pvp | online | free | accuracy | break | tutorial
let world = PHY.createWorld();
let turn = 0;
let phase = "aim";           // aim | drag | slide | moving | bot | botAim | over
let scores = [0, 0];
let playerColors = [null, null];
let difficulty = +(RCStore.get("rc_diff") || 1);
let soundVolume = Math.max(0, Math.min(1, +(RCStore.get("rc_sound_volume") ?? 0.8)));
let musicVolume = Math.max(0, Math.min(1, +(RCStore.get("rc_music_volume") ?? 0.35)));
let soundOn = RCStore.get("rc_sound") !== "0";
let myIndex = 0;             // в онлайн-режиме: 0 хост, 1 гость
let ringPlaced = true;       // false — кольцо ждёт выбора места (ghost)
let pendingWinner = null;
let pendingShots = [];       // онлайн-удары соперника, прибывшие во время чужого хода
let oppLive = null;          // живое зеркало соперника: { x, aim:{angle,power}, t }
let lastLiveSync = 0;

let pottedAll = 0, pottedOwn = 0, pottedOpp = 0;
let ringFellThisShot = false, settle = 0, accumulator = 0;
let drag = null;
let botAnim = null, botAim = null;
let trail = [], potAnims = [], sparks = [];
let drill = { shots: 0, potted: 0, attempts: 0, results: [] };
let botPersona = null;
let rouletteActive = false, roulPrevOff = 0;
let tutStep = -1, tutPhase = "card", tutStartX = 0, tutMoved = 0, tutInputs = 0, tutShotSeen = false;
let comboUntil = 0, comboCount = 0, comboFinishTimer = null;
let knownLanHosts = [];
let opponentProfile = null;
let gameSeed = null, onlineMove = 0, onlineShotOwner = null;
let restartRequest = null;
let turnDeadline = 0, serverClockOffset = 0, lastTimeoutMove = -1;
let onlineSkips = [0,0];
let waitingForState = false, pendingState = null, shotStartedAt = 0;
function gameSnapshot() {
    return { turn, scores: scores.slice(), colors:playerColors.slice(), stones: world.stones.filter(s => !s.done).map(s => [s.x, s.y, s.color]),
        ring: [world.ring.x, world.ring.y], deadline: turnDeadline, winner: pendingWinner, over: phase === "over" };
}
function validSnapshot(s) {
    const position = p => Array.isArray(p) && p.length >= 2 && p.slice(0,2).every(v => Number.isFinite(v) && Math.abs(v) < PHY.SIZE * 2);
    return s && RCMatchRules.validColors(s.colors||[null,null]) && (s.turn === 0 || s.turn === 1) && Array.isArray(s.scores) && s.scores.length === 2 && s.scores.every(v => Number.isInteger(v) && v >= 0 && v <= 100) &&
        Array.isArray(s.stones) && s.stones.length <= 10 && s.stones.every(p => position(p) && (p[2] === "w" || p[2] === "b")) && position(s.ring) &&
        (s.winner === null || s.winner === 0 || s.winner === 1) && typeof s.over === "boolean";
}
function restoreSnapshot(s, move) {
    if (!validSnapshot(s)) return;
    clearTimeout(comboFinishTimer);
    turnDeadline = Number.isFinite(s.deadline) ? s.deadline : Date.now()+60000;
    turn = s.turn; scores = s.scores.slice(); pendingWinner = s.winner;
    playerColors=(s.colors||[null,null]).slice();
    world.stones = s.stones.map(p => PHY.makeBody(p[0], p[1], world.stoneR, PHY.P.STONE_MASS, "stone", p[2]));
    world.ring = PHY.makeBody(s.ring[0], s.ring[1], world.ringR, PHY.P.RING_MASS, "ring");
    PHY.rebuild(world);
    onlineMove = move; waitingForState = false; pendingState = null;
    drag = null; sliderHeld = false; oppLive = null;
    resetShotCounters(); phase = s.over ? "over" : "aim";
    $("over").classList.remove("open"); updateBar();
    if (s.over) finishMatch();
    else setHint(I18N.t(turn === myIndex ? "hintYourTurn" : "hintOpponentTurn"));
}
function receiveState(msg) {
    if(Array.isArray(msg.skips))onlineSkips=msg.skips.slice(0,2);
    if (Number.isFinite(msg.serverNow)) serverClockOffset = msg.serverNow-Date.now();
    if (msg.match === gameSeed && msg.move >= onlineMove && msg.state && Number.isFinite(msg.state.deadline)) turnDeadline = msg.state.deadline;
    if (msg.timeout && msg.match === gameSeed && msg.move > lastTimeoutMove && msg.move >= onlineMove) {
        lastTimeoutMove = msg.move; showNotice(trText("Время истекло", "Time expired"));
    }
    if (msg.reset && mode === "online" && Number.isInteger(msg.match) && msg.match !== gameSeed && validSnapshot(msg.state)) startOnlineGame(msg.match);
    if (mode !== "online" || msg.match !== gameSeed || !Number.isInteger(msg.move) || (!msg.reset && msg.move < onlineMove) || !validSnapshot(msg.state)) return;
    if (msg.reset || msg.timeout) { restoreSnapshot(msg.state, msg.move); return; }
    if (phase === "moving") { pendingState = msg; return; }
    const same = !waitingForState && msg.move === onlineMove && turn === msg.state.turn &&
        JSON.stringify(scores) === JSON.stringify(msg.state.scores) && JSON.stringify(playerColors)===JSON.stringify(msg.state.colors||[null,null]) && JSON.stringify(gameSnapshot().stones) === JSON.stringify(msg.state.stones);
    if (!same) restoreSnapshot(msg.state, msg.move);
}
function localProfile() {
    const avatar = Number(RCStore.get("rc_avatar") || 0);
    return { name: (RCStore.get("rc_name") || I18N.t("defaultName")).trim().slice(0, 12),
        avatar: Number.isInteger(avatar) && avatar >= 0 && avatar < RND.AVATARS.length ? avatar : 0 };
}
function sendProfile() { NET.send({ t: "profile", ...localProfile(), social:window.RCLocalFriends?.profile() }); }
function escapeText(value) {
    return String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function boardFlipped() { return mode === "online" && myIndex === 1; }
function viewX(x) { return boardFlipped() ? world.size - x : x; }
let celebrationTimer = null;
const TUT_STEPS = 4;
const MAX_PULL = PHY.SIZE * 0.15;
const MIN_PULL = 12;

function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const colorOf = t => playerColors[t];

// ═══════════════ Аудио ═══════════════
let audioCtx = null, effectsBus = null;
function ensureAudio() {
    if (!audioCtx) {
        try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
    }
    if (audioCtx && !effectsBus) { effectsBus = audioCtx.createGain(); effectsBus.gain.value = soundOn ? soundVolume : 0; effectsBus.connect(audioCtx.destination); }
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
}
function impactSound(vol, kind) {
    if (!audioCtx || !soundOn || vol <= 0.01) return;
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    const base = kind === "wall" ? 320 : kind === "ring" ? 900 : 1500;
    osc.type = "triangle";
    osc.frequency.setValueAtTime(base + Math.random() * 220, t);
    osc.frequency.exponentialRampToValueAtTime(base * 0.55, t + 0.04);
    g.gain.setValueAtTime(Math.min(vol, 0.5), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === "wall" ? 0.09 : 0.045));
    osc.connect(g).connect(effectsBus);
    osc.start(t); osc.stop(t + 0.1);
    if (kind !== "wall") {
        const buf = audioCtx.createBuffer(1, 220, audioCtx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
        const src = audioCtx.createBufferSource();
        const ng = audioCtx.createGain();
        ng.gain.value = vol * 0.35;
        src.buffer = buf;
        src.connect(ng).connect(effectsBus);
        src.start(t);
    }
}
function potSound() {
    if (!audioCtx || !soundOn) return;
    const t = audioCtx.currentTime;
    [660, 990].forEach((f, i) => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = "sine"; o.frequency.value = f;
        g.gain.setValueAtTime(0.12, t + i * 0.07);
        g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.07 + 0.25);
        o.connect(g).connect(effectsBus);
        o.start(t + i * 0.07); o.stop(t + i * 0.07 + 0.3);
    });
}
function buzz(ms) {
    try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {}
}

const ev = {
    hit(kind, vol) { impactSound(vol, kind); buzz(Math.min(22, vol * 60)); },
    wall(sp) { impactSound(Math.min(0.35, sp / 1100), "wall"); buzz(Math.min(16, sp / 45)); },
    pot(b) {
        if (b.type === "stone") {
            RCMatchRules.assign(playerColors,turn,b.color);
            pottedAll++;
            if (b.color === colorOf(turn)) pottedOwn++; else pottedOpp++;
            updateBar();
            potAnims.push({ x: b.x, y: b.y, t: 0 });
            spawnSparks(b.x, b.y);
            potSound(); buzz(30);
        } else {
            ringFellThisShot = true;
            impactSound(0.4, "wall"); buzz(70);
        }
    },
};

// ═══════════════ Раскладка канваса ═══════════════
function layout() {
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    const stage = document.querySelector("#scr-game .stage");
    const r = stage.getBoundingClientRect();
    // Reserve the two slider rows so the board fits short screens as well.
    const sliders = $("oppSliderRow").offsetHeight + $("sliderRow").offsetHeight;
    const side = Math.max(120, Math.min(r.width - 16, r.height - sliders) * 0.985);
    canvas.width = Math.round(side * DPR);
    canvas.height = Math.round(side * DPR);
    canvas.style.width = side + "px";
    canvas.style.height = side + "px";
    view.css = side;
    view.scale = side / PHY.SIZE;
    ctx.setTransform(DPR * view.scale, 0, 0, DPR * view.scale, 0, 0);
}

// ═══════════════ Экраны ═══════════════
function showScreen(id) {
    RCChat.visibility(id === "scr-game" && mode === "online");
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
    $(id).classList.add("active");
    if(window.RCFriends)setTimeout(()=>window.RCFriends.sync(),0);
    if (id === "scr-menu") renderHomeProfile();
    updateMenuMusic();
    if (id === "scr-game") layout();
    else {
        clearTimeout(comboFinishTimer);
        clearTimeout(noticeTimer);
        $("gameNotice").classList.remove("show");
        clearTimeout(celebrationTimer);
        $("celebration").classList.remove("show");
        comboUntil = 0;
        setHint(""); $("toast").classList.remove("show"); $("thinking").classList.remove("show");
    }
    window.dispatchEvent(new Event('rc-screen-changed'));
}

function ringColor() {
    const rc = RND.ringColors();
    return turn === 0 ? rc.ringP1 : rc.ringP2;
}

function nameOf(t) {
    if (mode === "online") return t === myIndex ? localProfile().name : (opponentProfile ? opponentProfile.name : I18N.t("nameOpp"));
    if (mode === "bot") return t === 0 ? (RCStore.get("rc_name") || I18N.t("defaultName")) : (botPersona ? botPersona.name : I18N.t("nameBot"));
    return t === 0 ? I18N.t("nameP1") : I18N.t("nameP2");
}
function colorName(t) { return I18N.t(colorOf(t)==='w'?'colorW':colorOf(t)==='b'?'colorB':'colorOpen'); }
function puckIndicator(t){return colorOf(t)?`<img class="puckico" alt="${escapeText(colorName(t))}" src="${RND.pieceURL(colorOf(t))}">`:`<span class="color-open">${escapeText(I18N.t('colorOpen'))}</span>`;}

function updateBar() {

    const m = $("barMid");
    if (mode === "free" || mode === "accuracy" || mode === "break" || mode === "tutorial") {
        let txt = "";
        if (mode === "free" || mode === "tutorial") txt = I18N.t("trainFree", { n: drill.shots, m: drill.potted });
        if (mode === "accuracy") txt = I18N.t("trainAcc", { n: Math.min(drill.shots + 1, 10), m: drill.potted });
        if (mode === "break") txt = I18N.t("trainBreak", { n: Math.min(drill.attempts + 1, 3) });
        m.innerHTML = `<div class="bar-note">${txt}<br>${escapeText(colorName(0))}</div>`;
        return;
    }
    const dim = phase === "over" ? " dim" : "";
    const myAv = RND.avatarURL(+(RCStore.get("rc_avatar") || 0), 44);
    let oppAv;
    if (mode === "bot") oppAv = botPersona ? RND.personURL(botPersona, 44) : myAv;
    else if (mode === "online") oppAv = opponentProfile ? RND.avatarURL(opponentProfile.avatar, 44) : "";
    else oppAv = RND.avatarURL(1, 44);
    const reward = [10, 20, 30][difficulty] || 10;
    const left = mode === "online" ? myIndex : 0;
    const right = 1 - left;
    const center = mode === "bot"
        ? `<div class="prize"><span class="gemicon"></span><b>+${reward}</b></div>`
        : `<div class="prize"><b style="color:#cdb87a">VS</b>${mode === "online" ? '<span id="turnTimer" role="timer">60</span>' : ""}</div>`;
    m.innerHTML =
        `<div class="side${turn===left?' current-turn':''}"><img class="avbig" src="${myAv}">` +
        `<div class="sidecol"><div class="nm">${escapeText(nameOf(left))}</div>` +
        `<div class="scoreline">${puckIndicator(left)}<span class="pts">${scores[left]}</span></div>` +
        `</div></div>` +
        center +
        `<div class="side right${turn===right?' current-turn':''}"><img class="avbig" ${oppAv ? `src="${oppAv}"` : 'style="visibility:hidden"'}>` +
        `<div class="sidecol"><div class="nm">${escapeText(nameOf(right))}</div>` +
        `<div class="scoreline"><span class="pts">${scores[right]}</span>${puckIndicator(right)}</div>` +
        `</div></div>`;
    RCChat.positionBubbles();
}

let toastTimer = null;
function trText(ru, en) { return I18N.lang === "en" ? en : ru; }
let noticeTimer;
function showNotice(text, duration=2000) {
    const box = $("gameNotice"); box.textContent = text;
    box.classList.add("show"); clearTimeout(noticeTimer);
    noticeTimer = setTimeout(()=>box.classList.remove("show"), duration);
}
function showToast(text, ms) {
    const t = $("toast");
    t.textContent = text;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), ms || 1300);
}
function setHint(text) {
    const h = $("hint");
    if (!text) { h.classList.add("hide"); return; }
    h.textContent = text;
    h.classList.remove("hide");
}

// ═══════════════ Партия ═══════════════
function freshGameState() {
    scores = [0, 0];
    playerColors = [null, null];
    turn = 0;
    pottedAll = pottedOwn = pottedOpp = 0;
    ringFellThisShot = false;
    settle = 0; accumulator = 0;
    botAnim = null; botAim = null;
    trail = []; potAnims = []; sparks = [];
    drill = { shots: 0, potted: 0, attempts: 0, results: [] };
    pendingWinner = null;
    comboUntil = 0;
    clearTimeout(comboFinishTimer);
    drag = null;
    sliderHeld = false;
    pendingShots = [];
    oppLive = null;
    $("over").classList.remove("open");
    $("thinking").classList.remove("show");
}

function newGame(m) {
    mode = m;
    freshGameState();
    world = PHY.createWorld();
    PHY.rack(world, 0);
    ringPlaced = false;
    phase = "aim";
    showScreen("scr-game");
    updateBar();
    setHint(I18N.t("hintPlace"));
}

function startOnlineGame(seed, announce=false) {
    onlineSkips=[0,0];
    if (NET === RCLan) serverClockOffset = 0;
    turnDeadline = Date.now()+serverClockOffset+60000; lastTimeoutMove = -1;
    restartRequest = null;
    $("confirmOv").classList.remove("open");
    mode = "online";
    myIndex = NET.myIndex;
    freshGameState();
    gameSeed = seed; onlineMove = 0; onlineShotOwner = null; waitingForState = false; pendingState = null;
    world = PHY.createWorld();
    PHY.rack(world, 0, mulberry32(seed));
    ringPlaced = false;
    phase = "aim";
    showScreen("scr-game");
    updateBar();
    setHint(I18N.t("hintPlace"));
    if (announce) showNotice(trText("Новая игра", "New game"));
}

function humanTurn() {
    if (mode === "bot") return turn === 0;
    if (mode === "online") return turn === myIndex && !waitingForState && (NET !== RCNet || RCNet.connected);
    return true;
}

function shotTaken() {
    drill.shots++;
    ringPlaced = true;
    tutShotSeen = true;
    setHint("");
}

function remainingColor(color) {
    return world.stones.filter(s => !s.done && s.color === color).length;
}

function endShot() {
    if ((mode !== "online" && (mode !== "bot" || turn === 0)) || (mode === "online" && onlineShotOwner === myIndex)) window.RCProgress?.shot(pottedOwn,mode);
    finishLocalShot();
    if (mode !== "online") return;
    if (onlineShotOwner === myIndex) {
        if (NET === RCNet) waitingForState = true;
        NET.send({ t: "state", match: gameSeed, move: onlineMove, state: gameSnapshot() });
    } else {
        clearTimeout(comboFinishTimer);
        waitingForState = true;
        if (pendingState && pendingState.move >= onlineMove) restoreSnapshot(pendingState.state, pendingState.move);
        else setHint(I18N.t("netSyncing"));
    }
}
function finishLocalShot() {
    if (!ringFellThisShot && (mode === "tutorial" ? pottedAll : pottedOwn) >= 2) showCombo(mode === "tutorial" ? pottedAll : pottedOwn);
    const scoringMode = (mode === "pvp" || mode === "bot" || mode === "online");

    if (mode === "break") {
        drill.results.push(pottedOwn);
        drill.potted += pottedOwn;
        drill.attempts++;
        if (drill.attempts >= 3) {
            const best = Math.max(...drill.results);
            saveBest("rc_best_break", drill.potted);
            phase = "over";
            updateBar();
            showOver(I18N.t("overBreak"),
                `${drill.potted} ${plural(drill.potted)}`,
                I18N.t("breakBest", { n: best }) + " · " +
                I18N.t("record", { n: bestRecord("rc_best_break") }));
            return;
        }
        PHY.rack(world, 0); playerColors=[null,null];
        showToast(`${I18N.t("toastBreak", { n: drill.attempts })} · ${pottedOwn} ${plural(pottedOwn)}`);
        resetShotCounters();
        phase = "aim";
        updateBar();
        setHint(I18N.t("hintBreak"));
        return;
    }

    if (mode === "accuracy") {
        drill.potted += pottedOwn;
        updateBar();
        if (drill.shots >= 10) {
            saveBest("rc_best_accuracy", drill.potted);
            phase = "over";
            updateBar();
            showOver(I18N.t("overAcc"),
                I18N.t("overAccRes", { n: drill.potted }),
                I18N.t("record", { n: bestRecord("rc_best_accuracy") }));
            return;
        }
        if (colorOf(0) && remainingColor(colorOf(0)) === 0) { PHY.rack(world, 0); playerColors=[null,null]; updateBar(); }
    }

    if (mode === "free" || mode === "tutorial") {
        drill.potted += pottedOwn;
        updateBar();
        if (pottedOwn > 0) showToast(`+${pottedOwn}`);
        if (colorOf(0) && remainingColor(colorOf(0)) === 0) { PHY.rack(world, 0); playerColors=[null,null]; updateBar(); }
    }

    if (scoringMode) {
        if (pottedOwn > 0) scores[turn] += pottedOwn;
        if (pottedOpp > 0) scores[1 - turn] += pottedOpp;
        if (ringFellThisShot) {
            scores[turn] = Math.max(0, scores[turn] - 2);
            showToast(I18N.t("toastFoul"));
        } else if (pottedOwn > 0 && pottedOpp === 0) {
            showToast(I18N.t("toastPlus", { n: pottedOwn }));
        } else if (pottedOpp > 0) {
            showToast(I18N.t("toastOppPot"));
        }

        const outcome=RCMatchRules.outcome(world.stones,playerColors,scores);
        pendingWinner=outcome.winner;
        if (outcome.over) {
            phase = "over";
            updateBar();
            clearTimeout(comboFinishTimer);
            comboFinishTimer = setTimeout(finishMatch, Math.max(0, comboUntil - performance.now()));
            return;
        }

        if (!(pottedOwn > 0 && pottedOpp === 0 && !ringFellThisShot)) {
            turn = 1 - turn;
        }
        updateBar();
    }

    respawnRing();
    resetShotCounters();
    if (mode === "online") turnDeadline = Date.now()+serverClockOffset+60000;

    if (mode === "bot" && turn === 1) {
        phase = "bot";
        updateBar();
        startBotTurn();
    } else {
        phase = "aim";
        if (mode === "pvp") setHint(I18N.t("hintTurn", { n: `${nameOf(turn)} · ${colorName(turn)}` }));
        if (mode === "online" && humanTurn()) setHint(I18N.t("hintYourTurn"));
    }
}

function resetShotCounters() {
    pottedAll = pottedOwn = pottedOpp = 0;
    ringFellThisShot = false;
    settle = 0;
    accumulator = 0;
    trail = [];
}

function spawnSparks(x, y) {
    for (let i = 0; i < 16; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 60 + Math.random() * 170;
        sparks.push({
            x, y,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp - 70,
            t: 0,
            life: 0.45 + Math.random() * 0.35,
            c: Math.random() < 0.6 ? "255,219,130" : "255,255,255",
        });
    }
}

// конфетти
let confettiOn = false, confettiParts = [], confettiLast = 0;
function startConfetti() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const cv = $("confettiC");
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(innerWidth * DPR);
    cv.height = Math.round(innerHeight * DPR);
    const cctx = cv.getContext("2d");
    cctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    confettiParts = [];
    const colors = ["#e2b53c", "#ffe9a8", "#6ed6e0", "#6ed6a0", "#e05548", "#a5b8ff"];
    for (let i = 0; i < 160; i++) {
        confettiParts.push({
            x: Math.random() * innerWidth,
            y: -20 - Math.random() * innerHeight * 0.8,
            w: 5 + Math.random() * 6,
            h: 8 + Math.random() * 8,
            vy: 60 + Math.random() * 140,
            vx: -30 + Math.random() * 60,
            rot: Math.random() * Math.PI,
            vr: -3 + Math.random() * 6,
            c: colors[i % colors.length],
        });
    }
    confettiOn = true;
    confettiLast = performance.now();
    (function loop(now) {
        if (!confettiOn) { cctx.clearRect(0, 0, innerWidth, innerHeight); return; }
        const dt = Math.min(0.05, (now - confettiLast) / 1000 || 0.016);
        confettiLast = now;
        cctx.clearRect(0, 0, innerWidth, innerHeight);
        for (const p of confettiParts) {
            p.y += p.vy * dt; p.x += p.vx * dt + Math.sin(p.y * 0.02) * 0.6;
            p.rot += p.vr * dt;
            if (p.y > innerHeight + 20) { p.y = -20; p.x = Math.random() * innerWidth; }
            cctx.save();
            cctx.translate(p.x, p.y); cctx.rotate(p.rot);
            cctx.fillStyle = p.c;
            cctx.globalAlpha = 0.9;
            cctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
            cctx.restore();
        }
        cctx.globalAlpha = 1;
        requestAnimationFrame(loop);
    })(performance.now());
}
function stopConfetti() { confettiOn = false; }

let winCountTimer = null;
const rewardedWins = new WeakSet();
function showWin(reward) {
    celebrate("celebrateWin", "celebrateReward", { n: reward }, "🏆", false);
    if (!rewardedWins.has(world)) {
        RCStore.reward(null,reward,reward);
        window.RCProgress?.unlockCosmetics();
        rewardedWins.add(world);
        renderCoins();
    }
    renderHomeProfile();
    $("winXp").textContent = I18N.t("winExperience", {n:reward});
    $("winTitle").textContent = I18N.t("winTitle");
    $("winOv").classList.add("open");
    window.RCArcade?.decorateResult(null);
    startConfetti();
    const el = $("winAmount");
    const t0 = performance.now();
    clearInterval(winCountTimer);
    winCountTimer = setInterval(() => {
        const k = Math.min(1, (performance.now() - t0) / 900);
        el.textContent = "+" + Math.round(reward * (1 - Math.pow(1 - k, 3)));
        if (k >= 1) clearInterval(winCountTimer);
    }, 30);
    const wb = $("winOv").querySelector(".winbtns");
    wb.classList.remove("show");
    setTimeout(() => wb.classList.add("show"), 700);
}
function hideWin() {
    $("winOv").classList.remove("open", "show");
    clearInterval(winCountTimer);
    stopConfetti();
}

function finishMatch() {
    if(mode === "bot" && pendingWinner === 0) window.RCProgress?.botWin(gameSeed);
    let h;
    if (pendingWinner === null) {
        h = I18N.t("overDraw");
    } else if (mode === "bot" || mode === "online") {
        h = pendingWinner === myIndex
            ? I18N.t("overYouWin")
            : I18N.t("overYouLose", { n: nameOf(pendingWinner) });
    } else {
        h = I18N.t("overWin", { n: nameOf(pendingWinner) });
    }
    if (pendingWinner !== null) h += ` · ${colorName(pendingWinner)}`;

    if (mode === "bot" && pendingWinner === 0) {
        const reward = [10, 20, 30][difficulty] || 10;
        updateBar();
        showWin(reward);
        return;
    }
    showOver(h, "");
    window.RCArcade?.decorateResult(null);
    if (pendingWinner !== null && (mode === "pvp" || pendingWinner === myIndex)) {
        celebrate("celebrateWin", "celebrateWinDetail", {}, "🏆");
    }
}

function respawnRing() {
    const ring = world.ring;
    ring.sink = 0; ring.done = false; ring.pocket = -1;
    ring.vx = 0; ring.vy = 0;
    ring.y = PHY.baselineY(world, turn);
    ring.x = PHY.freeRingX(world, world.size / 2, turn);
    ringPlaced = false;
}

function plural(n) {
    if (I18N.lang === "en") return I18N.t(n === 1 ? "stone1" : "stone5");
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return I18N.t("stone1");
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return I18N.t("stone2");
    return I18N.t("stone5");
}

function saveBest(key, v) {
    const old = +(RCStore.get(key) || 0);
    if (v > old) RCStore.set(key, String(v));
}
function bestRecord(key) {
    return RCStore.get(key) || "—";
}

function showOver(title, res, sub) {
    $("overH").textContent = title;
    $("overRes").innerHTML = res + (sub ? `<small>${sub}</small>` : "");
    $("over").classList.add("open");
}

// ═══════════════ Онлайн ═══════════════
function leaveOnline(msg) {
    if (mode === "online") {
        try { NET.send({ t: "bye" }); } catch (e) {}
    }
    NET.destroy();
    mode = "bot";
    $("over").classList.remove("open");

    showScreen("scr-menu");
    phase = "over";
    $("confirmOv").classList.remove("open");
    if (msg) showNotice(msg === I18N.t("oppLeft") ? trText("Противник вышел из игры", "Opponent left the game") : msg, 3000);
}

function restartOnline(announce = mode === "online" && gameSeed !== null) {
    const seed = (Math.random() * 0x7fffffff) | 0;
    startOnlineGame(seed, announce);
    NET.send({ t: "start", seed, announce, state: gameSnapshot() });
}

// лёгкие live-сообщения о перемещении/прицеле (не чаще ~15/с)
function liveSync(msg) {
    if (mode !== "online") return;
    const now = performance.now();
    if (now - lastLiveSync < 60) return;
    lastLiveSync = now;
    NET.send(msg);
}

// ═══════════════ Бот ═══════════════
function startBotTurn() {
    $("thinking").textContent = I18N.t("botThinking");
    $("thinking").classList.add("show");
    const snap = PHY.cloneWorld(world);
    const gen = BOT.planShots(snap, difficulty, scores, colorOf(1));
    function chunk() {
        if (phase !== "bot") { $("thinking").classList.remove("show"); return; }
        const t0 = performance.now();
        let r;
        do { r = gen.next(); } while (!r.done && performance.now() - t0 < 12);
        if (!r.done) { requestAnimationFrame(chunk); return; }
        $("thinking").classList.remove("show");
        botAnim = {
            t: 0,
            fromX: world.ring.x, fromY: world.ring.y,
            plan: r.value,
            overshoot: r.value.overshoot || 0,
        };
        botAim = null;
        phase = "botAim";
    }
    requestAnimationFrame(chunk);
}

function updateBotAim(dt) {
    const a = botAnim;
    a.t += dt;
    const ring = world.ring;
    const D = a.plan.slide || 0.6;
    if (a.t < D) {
        // живое скольжение: разгон → торможение; лёгкий перелетает и поправляется
        const k = a.t / D;
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        ring.x = a.fromX + (a.plan.x - a.fromX) * e;
        if (a.overshoot) ring.x += Math.sin(k * Math.PI) * a.overshoot;
    } else {
        ring.x = a.plan.x;
        // прицел виден сопернику и игроку почти секунду — читается замах
        botAim = { angle: a.plan.angle, power: a.plan.speed / PHY.P.MAX_SHOT_V };
        if (a.t > D + 0.75) {
            botAim = null;
            PHY.applyShot(world, a.plan.x, a.plan.y, a.plan.angle, a.plan.speed);
            shotTaken();
            phase = "moving";
            settle = 0; accumulator = 0;
            botAnim = null;
        }
    }
}

// ═══════════════ Обработка сети ═══════════════
function attachNetHandlers() {
    NET.onStatus = kind => {
        if (kind === "waiting") {
            $("hostStatus").textContent = I18N.t("netWaiting");
            $("quickStatus").textContent = trText("Ожидаем другого игрока","Waiting for another player");
        } else if (kind === "reconnecting") {
            if (mode === "online" && (phase === "drag" || phase === "slide")) { phase = "aim"; drag = null; sliderHeld = false; }
            if (mode === "online") setHint(I18N.t("netRestoring"));
            else { $("hostStatus").textContent = I18N.t("netRestoring"); $("joinStatus").textContent = I18N.t("netRestoring"); }
            $("quickStatus").textContent = I18N.t("netRestoring");
        } else if (kind === "reconnected") {
            if (mode === "online") setHint(I18N.t(turn === myIndex ? "hintYourTurn" : "netRestored"));
        } else if (kind === "connected") {
            RCChat.reset();
            sendProfile();
            if (NET.myIndex === 0) {
                restartOnline();
            } else {
                const msg = I18N.t("netWaiting");
                $("joinStatus").textContent = msg;
                $("lanJoinStatus").textContent = msg;
            }
        } else if (kind === "closed") {
            if (mode === "online") leaveOnline(I18N.t("oppLeft"));
            else {
                $("hostStatus").textContent = I18N.t("connClosed");
                $("lanHostStatus").textContent = I18N.t("connClosed");
            }
        } else if (kind.indexOf("error:") === 0) {
            const et = kind.slice(6);
            const txt =
                et === "peer-unavailable" ? I18N.t("errNotFound") :
                et === "room-full" ? I18N.t("errRoomFull") :
                et === "expired" ? I18N.t("netExpired") :
                et === "update-required" ? I18N.t("netUpdateRequired") :
                et === "permission" ? I18N.t("errLanPermission") :
                et === "offline" || et === "network" ? I18N.t("errNoNet") :
                et === "server-error" || et === "socket-error" || et === "socket-closed" || et === "disconnected" ?
                    I18N.t("errServer") :
                et === "browser-incompatible" ? I18N.t("errIncompatible") :
                et === "ssl-unavailable" || et === "webrtc" ? I18N.t("errBlocked") :
                et === "badcode" ? I18N.t("codeLen") :
                et === "connect" ? I18N.t("errLan") :
                et === "discover" || et === "host" || et === "lan" ? I18N.t("errLan") :
                I18N.t("errLink", { n: et });
            if ($("scr-online").classList.contains("active")) {
                $("quickStatus").textContent = txt;
                if (netTab === "lan") {
                    $("lanJoinStatus").textContent = txt;
                    if (et !== "unavailable-id") $("lanHostStatus").textContent = txt;
                } else {
                    $("joinStatus").textContent = txt;
                    if (et !== "unavailable-id") $("hostStatus").textContent = txt;
                }
            } else if (mode === "online") {
                leaveOnline(txt);
            } else {
                showToast(txt, 2600);
            }
        }
    };
    NET.onMessage = msg => {
        if (!msg || typeof msg !== "object") return;
        if (msg.t === "game-result") {
            window.RCProgress?.result(msg,myIndex);
            if(mode === "online" && msg.match === gameSeed) {
                pendingWinner=msg.winner;phase="over";turnDeadline=0;waitingForState=false;drag=null;sliderHeld=false;
                clearTimeout(comboFinishTimer);updateBar();finishMatch();
                const reasons={inactivity:trText("Три пропущенных хода подряд","Three missed turns"),disconnect:trText("Время на возвращение истекло","Reconnect time expired"),left:trText("Противник вышел из игры","Opponent left the game")};
                if(reasons[msg.reason])$("overRes").textContent=reasons[msg.reason];
                window.RCProgress?.showResult(msg,myIndex);
            }
        } else if (msg.t === "restore-game") {
            opponentProfile = msg.profile || null;
            if (NET===RCNet && msg.profile?.social)window.RCLocalFriends?.remember(msg.profile.social);
            if (!Number.isInteger(msg.match)) { if (NET.myIndex === 0) restartOnline(); return; }
            if (Number.isFinite(msg.serverNow)) serverClockOffset = msg.serverNow-Date.now();
            startOnlineGame(msg.match);
            if (validSnapshot(msg.state)) restoreSnapshot(msg.state, msg.move);
            if(msg.result)NET.onMessage(msg.result);
            if (msg.shot) applyNetShot(msg.shot, true);
            if (msg.restart) {
                if (msg.restart.from !== myIndex) receiveRestartRequest(msg.restart);
                else restartRequest = msg.restart;
            }
            if (msg.restartApproved && NET.myIndex === 0) restartOnline();
            if (!RCNet.connected) setHint(I18N.t("netRestoring"));
            sendProfile();
        } else if (msg.t === "chat") {
            RCChat.receive(msg);
        } else if (msg.t === "profile") {
            if (typeof msg.name !== "string" || !Number.isInteger(msg.avatar) || msg.avatar < 0 || msg.avatar >= RND.AVATARS.length) return;
            opponentProfile = { name: msg.name.trim().slice(0, 12) || I18N.t("defaultName"), avatar: msg.avatar };
            if(NET===RCNet && msg.social)window.RCLocalFriends?.remember(msg.social);
            if (mode === "online") updateBar();
        } else if (msg.t === "start" && typeof msg.seed === "number") {
            if (Number.isFinite(msg.serverNow)) serverClockOffset = msg.serverNow-Date.now();
            startOnlineGame(msg.seed, !!msg.announce);
            if (validSnapshot(msg.state)) restoreSnapshot(msg.state, 0);
        } else if (msg.t === "hello" && NET.myIndex === 0) {
            // гость постучался — создаём партию
            restartOnline();
        } else if (msg.t === "shot") {
            if (mode === "online" && msg.match === gameSeed && Number.isInteger(msg.move) && msg.move > onlineMove && isFinite(msg.x) && isFinite(msg.angle) && isFinite(msg.power)) {
                pendingShots.push(msg);
                oppLive = null;
            }
        } else if (msg.t === "state") {
            receiveState(msg);
        } else if (msg.t === "turn-timeout") {
            if (NET === RCLan && myIndex === 1) receiveState(msg);
        } else if (msg.t === "sync-state") {
            receiveState(msg);
            if (msg.shot && msg.shot.move > onlineMove && !pendingShots.some(s => s.move === msg.shot.move)) pendingShots.push(msg.shot);
        } else if ((msg.t === "place" || msg.t === "aim") && mode === "online" && turn !== myIndex && Number.isFinite(msg.x)) {
            oppLive = { x: msg.x, t: performance.now(), aim: msg.t === "aim" && Number.isFinite(msg.angle) && Number.isFinite(msg.power) ? { angle: msg.angle, power: Math.max(0, Math.min(1, msg.power / PHY.P.MAX_SHOT_V)) } : null };
        } else if (msg.t === "rematch-request") {
            receiveRestartRequest(msg);
        } else if (msg.t === "rematch-response" && restartRequest && msg.id === restartRequest.id && msg.match === gameSeed) {
            restartRequest = null;
            if (msg.accept) { if (NET.myIndex === 0) restartOnline(); }
            else showToast(I18N.t("restartDeclined"));
        } else if (msg.t === "bye") {
            leaveOnline(I18N.t("oppLeft"));
        }
    };
}

function applyNetShot(m, restoring = false) {
    const owner = Number.isInteger(m.from) ? m.from : m.player;
    if ((!restoring && owner === myIndex) || (owner !== 0 && owner !== 1) || !validSnapshot(m.before)) return;
    onlineSkips[owner]=0;
    restoreSnapshot(m.before, m.move - 1);
    turn = owner; onlineMove = m.move; onlineShotOwner = owner; waitingForState = false; shotStartedAt = performance.now();
    const x = PHY.freeRingX(world, m.x, turn);
    PHY.applyShot(world, x, world.ring.y, m.angle, m.power);
    shotTaken();
    phase = "moving";
    settle = 0; accumulator = 0;
}

function sendShot(x, angle, power) {
    if (mode === "online") {
        onlineSkips[myIndex]=0;
        onlineMove++; onlineShotOwner = myIndex; waitingForState = false; pendingState = null; shotStartedAt = performance.now();
        NET.send({ t: "shot", x, angle, power, match: gameSeed, move: onlineMove, player: myIndex, before: gameSnapshot() });
    }
}

// ═══════════════ Игровой цикл ═══════════════
let lastT = performance.now();

function tick(now) {
    updateTurnTimer();
    const dt = Math.min((now - lastT) / 1000, 0.05);
    lastT = now;

    if (phase === "moving" && mode === "online") {
        if (pendingState && performance.now() - shotStartedAt > 8000) {
            restoreSnapshot(pendingState.state, pendingState.move);
        } else if (onlineShotOwner === myIndex && performance.now() - shotStartedAt > 12000) {
            for (const body of world._all) { body.vx = 0; body.vy = 0; if (body.sink > 0) body.done = true; }
            endShot();
        }
    }
    if (phase === "moving") {
        accumulator += dt;
        let steps = 0;
        while (accumulator >= PHY.P.SUB_DT && steps++ < 40) {
            PHY.stepWorld(world, ev);
            accumulator -= PHY.P.SUB_DT;
        }
        if (PHY.allAsleep(world)) {
            settle += dt;
            if (settle > 0.35) endShot();
        } else settle = 0;

        const ring = world.ring;
        if (ring && (ring.vx || ring.vy) && Math.hypot(ring.vx, ring.vy) > 260) {
            trail.push({ x: ring.x, y: ring.y });
            if (trail.length > 12) trail.shift();
        } else if (trail.length) trail.shift();
    }

    if (phase === "botAim" && botAnim) updateBotAim(dt);

    if (mode === "tutorial") advanceTutorial();

    // очередь онлайн-ударов соперника: применяем, когда наш стол свободен
    if (mode === "online" && phase !== "moving" && pendingShots.length) {
        const m = pendingShots.shift();
        if (m.match === gameSeed && m.move > onlineMove) applyNetShot(m);
    }
    // живое зеркало прицела соперника (гаснет без обновлений)
    if (oppLive && performance.now() - oppLive.t > 2500) oppLive = null;
    if (mode === "online" && phase === "aim" && turn !== myIndex && oppLive) {
        const range = PHY.baselineRange(world);
        if (oppLive.xShown === undefined) oppLive.xShown = oppLive.x;
        oppLive.xShown += (oppLive.x - oppLive.xShown) * Math.min(1, dt * 10);
        world.ring.x = Math.max(range[0], Math.min(range[1], oppLive.xShown));
        ringPlaced = true;
    }

    for (const a of potAnims) a.t += dt;
    potAnims = potAnims.filter(a => a.t < 0.4);
    for (const s of sparks) { s.t += dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 320 * dt; }
    sparks = sparks.filter(s => s.t < s.life);
    world.stones = world.stones.filter(s => !s.done);
    PHY.rebuild(world);

    syncSlider();
    draw();
}

function frame(t) {
    tick(t);
    requestAnimationFrame(frame);
}

// страховка: если rAF троттлится (свёрнуто/энергосбережение), игровой тик идёт
setInterval(() => tick(performance.now()), 120);
setInterval(() => {
    if (mode === "online" && NET === RCNet && RCNet.connected && gameSeed !== null) NET.send({ t: "sync-request", match: gameSeed });
}, 2000);

function draw() {
    ctx.save();
    if (boardFlipped()) { ctx.translate(world.size, world.size); ctx.rotate(Math.PI); }
    const ringBlocked = (phase === "slide" || sliderHeld ||
        (mode === "online" && turn !== myIndex && oppLive)) &&
        world.ring && world.stones.some(s =>
            !s.done && Math.hypot(s.x - world.ring.x, s.y - world.ring.y) < s.r + world.ring.r);
    RND.draw(ctx, world, {
        phase, turn,
        ringColor: ringColor(),
        trail, potAnims, sparks,
        botAim,
        oppAim: (mode === "online" && turn !== myIndex && oppLive && oppLive.aim)
            ? oppLive.aim : null,
        dragAim: dragAim(),
        ringPlaced,
        ringBlocked,
        dimBoard: mode === "tutorial" && tutStep === 0 && tutPhase === "practice",
    });
    ctx.restore();
    drawCoach(ctx, performance.now());
    drawCombo(ctx, performance.now());
}

function dragAim() {
    if (phase !== "drag" || !drag) return null;
    const ring = world.ring;
    const dx = ring.x - drag.cx, dy = ring.y - drag.cy;
    const pull = Math.hypot(dx, dy);
    if (pull < 4) return null;
    return {
        angle: Math.atan2(dy, dx),
        power: Math.min(pull / MAX_PULL, 1),
    };
}

// ═══════════════ Ввод ═══════════════
function toWorld(e) {
    const r = canvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    const x = (t.clientX - r.left) / view.scale, y = (t.clientY - r.top) / view.scale;
    return boardFlipped() ? { x: world.size - x, y: world.size - y } : { x, y };
}

canvas.addEventListener("touchstart", onStart, { passive: false });
canvas.addEventListener("mousedown", onStart);
canvas.addEventListener("touchmove", onMove, { passive: false });
canvas.addEventListener("mousemove", onMove);
canvas.addEventListener("touchend", onEnd);
canvas.addEventListener("mouseup", onEnd);
canvas.addEventListener("touchcancel", onEnd);

function onStart(e) {
    ensureAudio();
    if (mode === "tutorial" && (tutPhase !== "practice" || tutStep !== 1)) return;
    if ((phase !== "aim" && phase !== "slide") || !humanTurn()) return;
    e.preventDefault();
    const p = toWorld(e);
    const ring = world.ring;
    const by = PHY.baselineY(world, turn);
    const range = PHY.baselineRange(world);

    if (Math.hypot(p.x - ring.x, p.y - ring.y) <= ring.r * 2.6) {
        drag = { cx: p.x, cy: p.y };
        phase = "drag";
        ringPlaced = true;
    } else if (Math.abs(p.y - by) <= 100 && p.x > range[0] - 50 && p.x < range[1] + 50) {
        ring.x = Math.max(range[0], Math.min(range[1], p.x));
        ringPlaced = true;
        phase = "slide";
        liveSync({ t: "place", x: ring.x });
    }
}

function onMove(e) {
    if (phase !== "drag" && phase !== "slide") return;
    e.preventDefault();
    const p = toWorld(e);
    if (phase === "drag" && drag) {
        drag.cx = p.x; drag.cy = p.y;
        const ring = world.ring;
        const dx = ring.x - drag.cx, dy = ring.y - drag.cy;
        const pull = Math.hypot(dx, dy);
        if (pull > 4) {
            liveSync({ t: "aim", x: ring.x, angle: Math.atan2(dy, dx),
                       power: Math.min(pull / MAX_PULL, 1) * PHY.P.MAX_SHOT_V });
        }
    }
    if (phase === "slide") {
        const range = PHY.baselineRange(world);
        const nx = Math.max(range[0], Math.min(range[1], p.x));
        tutMoved += Math.abs(nx - world.ring.x);
        tutInputs++;
        world.ring.x = nx;
        ringPlaced = true;
        liveSync({ t: "place", x: nx });
    }
}

function onEnd(e) {
    if (phase === "slide") {
        // отпустили поверх шашек — кольцо встаёт на ближайшее свободное место
        world.ring.x = PHY.freeRingX(world, world.ring.x, turn);
        phase = "aim";
        tutTryFinish();
        liveSync({ t: "place", x: world.ring.x });
        return;
    }
    if (phase !== "drag" || !drag) return;
    e.preventDefault();
    const ring = world.ring;
    const dx = ring.x - drag.cx, dy = ring.y - drag.cy;
    const pull = Math.hypot(dx, dy);
    drag = null;
    if (pull < MIN_PULL) { phase = "aim"; return; }
    const power = Math.min(pull / MAX_PULL, 1);
    const angle = Math.atan2(dy, dx);
    PHY.applyShot(world, ring.x, ring.y, angle, power * PHY.P.MAX_SHOT_V);
    sendShot(ring.x, angle, power * PHY.P.MAX_SHOT_V);
    shotTaken();
    phase = "moving";
    settle = 0; accumulator = 0;
    buzz(12);
}

// ═══════════════ Тренировки/статистика ═══════════════
function refreshTrainingStats() {
    $("stFree").textContent = "";
    const acc = RCStore.get("rc_best_accuracy");
    const brk = RCStore.get("rc_best_break");
    $("stAccuracy").textContent = acc ? I18N.t("record", { n: acc }) : I18N.t("noRecord");
    $("stBreak").textContent = brk ? I18N.t("record", { n: brk }) : I18N.t("noRecord");
}

// ═══════════════ Подтверждение ═══════════════
let confirmCb = null, confirmCancelCb = null;
function askConfirm(titleKey, goKey, cb, stayKey = "btnStay", cancelCb = null) {
    $("confTitle").textContent = I18N.t(titleKey);
    $("confGo").textContent = I18N.t(goKey);
    $("confStay").textContent = I18N.t(stayKey);
    $("confGo").classList.toggle("danger", goKey !== "btnSaveProfile");
    $("confGo").classList.toggle("primary", goKey === "btnSaveProfile");
    confirmCb = cb;
    confirmCancelCb = cancelCb;
    $("confirmOv").classList.add("open");
}
$("confStay").addEventListener("click", () => {
    $("confirmOv").classList.remove("open");
    confirmCb = null;
    const cb = confirmCancelCb; confirmCancelCb = null;
    if (cb) cb();
});
$("confGo").addEventListener("click", () => {
    $("confirmOv").classList.remove("open");
    const cb = confirmCb; confirmCb = null;
    confirmCancelCb = null;
    if (cb) cb();
});

function requestRestart() {
    if (restartRequest) { showToast(I18N.t("toastRematch")); return; }
    restartRequest = {id:Date.now().toString(36)+Math.random().toString(36).slice(2),match:gameSeed};
    NET.send({t:"rematch-request",...restartRequest});
    showToast(I18N.t("toastRematch"));
    const id=restartRequest.id;
    setTimeout(()=>{if(restartRequest && restartRequest.id===id) restartRequest=null;},120000);
}
function receiveRestartRequest(msg) {
    if (mode !== "online" || msg.match !== gameSeed || typeof msg.id !== "string") return;
    askConfirm("confirmPeerRestart", "btnRestart", () => {
        if (gameSeed !== msg.match) return;
        NET.send({t:"rematch-response",id:msg.id,match:msg.match,accept:true});
        if (NET.myIndex === 0) restartOnline();
    }, "btnDecline", () => NET.send({t:"rematch-response",id:msg.id,match:msg.match,accept:false}));
}

// ═══════════════ Кнопки и меню ═══════════════
$("btnBot").addEventListener("click", () => {
    $("diffOv").classList.add("open");
});
$("diffClose").addEventListener("click", () => $("diffOv").classList.remove("open"));
$("diffOv").addEventListener("click", e => {
    if (e.target === $("diffOv")) $("diffOv").classList.remove("open");
});
$("btnDiffStart").addEventListener("click", () => {
    $("diffOv").classList.remove("open");
    const menu = $("scr-menu");
    menu.classList.add("spread");
    setTimeout(() => { menu.classList.remove("spread"); startRoulette(); }, 470);
});
function refreshSeg() {
    document.querySelectorAll("#diffOv .diffopt").forEach(o =>
        o.classList.toggle("on", +o.dataset.d === difficulty));
}
document.querySelectorAll("#diffOv .diffopt").forEach(o => {
    o.addEventListener("click", () => {
        difficulty = +o.dataset.d;
        RCStore.set("rc_diff", String(difficulty));
        refreshSeg();
    });
});

$("btnOnline").addEventListener("click", () => {
    if (!RCNet.ready && !RCLan.ready) { showToast(I18N.t("errGeneric"), 2200); return; }
    showNetTab("net");
    showScreen("scr-online");
});
$("btnPvp").addEventListener("click", () => newGame("pvp"));
$("btnTraining").addEventListener("click", () => { refreshTrainingStats(); showScreen("scr-training"); });
$("btnHow").addEventListener("click", () => startTutorial());
$("btnSettingsOpen").addEventListener("click", () => { renderSettings(); showScreen("scr-settings"); });

$("btnTrainBack").addEventListener("click", () => showScreen("scr-menu"));
$("btnSettingsBack").addEventListener("click", () => showScreen("scr-menu"));

function quitToMenuFlow() {
    if (mode === "online") { leaveOnline(); return; }
    phase = "over";
    $("thinking").classList.remove("show");
    showScreen("scr-menu");
}
$("btnBack").addEventListener("click", () => {
    if (phase !== "over") {
        askConfirm("confirmExit", "btnExit", quitToMenuFlow);
        return;
    }
    quitToMenuFlow();
});
$("btnReset").addEventListener("click", () => {
    if (mode === "online") { requestRestart(); return; }
    if (phase !== "over") {
        askConfirm("confirmReset", "btnRestart", () => {
            newGame(mode);
        });
        return;
    }
    newGame(mode);
});
$("btnAgain").addEventListener("click", () => {
    $("over").classList.remove("open");
    if (mode === "online") {
        requestRestart();
        return;
    }
    newGame(mode);
});
$("btnWinAgain").addEventListener("click", () => {
    hideWin();
    if (mode === "online") {
        requestRestart();
        return;
    }
    startRoulette();
});
$("btnWinExit").addEventListener("click", () => {
    hideWin();
    showScreen("scr-menu");
});
$("btnOverMenu").addEventListener("click", () => {
    $("over").classList.remove("open");
    if (mode === "online") { NET.destroy(); mode = "pvp"; }
    showScreen("scr-menu");
});

document.querySelectorAll(".card[data-drill]").forEach(card => {
    card.addEventListener("click", () => newGame(card.dataset.drill));
});

// ── экран сети ──
function onlinePanel(name) {
    $("onlineQuick").style.display = name === "quick" ? "flex" : "none";
    $("onlinePick").style.display = name === "pick" ? "flex" : "none";
    $("onlineHost").style.display = name === "host" ? "flex" : "none";
    $("onlineJoin").style.display = name === "join" ? "flex" : "none";
}
function lanPanel(name) {
    $("lanPick").style.display = name === "pick" ? "flex" : "none";
    $("lanHost").style.display = name === "host" ? "flex" : "none";
    $("lanJoin").style.display = name === "join" ? "flex" : "none";
}
let netTab = "net";
function showNetTab(t) {
    netTab = t;
    document.querySelectorAll("#netSeg button").forEach(b =>
        b.classList.toggle("on", b.dataset.n === t));
    $("netWrap").style.display = t === "net" ? "flex" : "none";
    $("lanWrap").style.display = t === "lan" ? "flex" : "none";
    cancelNet();
}
function cancelNet() {
    opponentProfile = null;
    RCNet.destroy();
    RCLan.destroy();
    onlinePanel("pick");
    lanPanel("pick");
    NET = RCNet;
    attachNetHandlers();
}
$("netSeg").addEventListener("click", e => {
    const b = e.target.closest("button[data-n]");
    if (b) showNetTab(b.dataset.n);
});
$("btnHost").addEventListener("click", () => {
    opponentProfile = null;
    NET = RCNet;
    attachNetHandlers();
    onlinePanel("host");
    $("hostStatus").textContent = I18N.t("netWaiting");
    NET.host(({ code }) => {
        $("hostCode").textContent = code;
        $("hostStatus").textContent = I18N.t("netWaiting");
    }, () => {
        $("hostStatus").textContent = I18N.t("codeTaken");
    });
});
$("btnQuick").addEventListener("click",()=>{
    opponentProfile=null;NET=RCNet;attachNetHandlers();onlinePanel("quick");
    $("quickStatus").textContent=trText("Ожидаем другого игрока","Waiting for another player");
    NET.find(()=>{});
});
$("btnQuickCancel").addEventListener("click",cancelNet);
$("btnJoinPick").addEventListener("click", () => {
    onlinePanel("join");
    $("joinCode").value = "";
    $("joinStatus").textContent = " ";
    setTimeout(() => $("joinCode").focus(), 60);
});
$("btnJoinGo").addEventListener("click", doJoin);
$("joinCode").addEventListener("keydown", e => { if (e.key === "Enter") doJoin(); });
function doJoin() {
    opponentProfile = null;
    const code = $("joinCode").value.trim().toUpperCase();
    if (code.length !== 4) { $("joinStatus").textContent = I18N.t("codeLen"); return; }
    NET = RCNet;
    attachNetHandlers();
    $("joinStatus").textContent = I18N.t("connecting");
    NET.join(code, () => {});
}

// ── Wi-Fi (LAN) ──
function renderLanList(list = knownLanHosts) {
    knownLanHosts = list;
    $("lanList").innerHTML = list.length
        ? list.map(ip => `<button class="lanhost" data-ip="${ip}"><span>${ip}</span><small>${I18N.t("connectAction")}</small></button>`).join("")
        : `<div class="hintline">${I18N.t("lanNoHosts")}</div>`;
}
function lanUiHandler() {
    return p => {
        if (p.ip) {
            $("lanIp").textContent = p.ip;
            $("lanHostStatus").textContent = I18N.t("lanWaiting");
        }
        if (p.code) {
            $("lanIp").textContent = I18N.t("lanCode", { n: p.code });
            $("lanHostStatus").textContent = I18N.t("lanTesting");
        }
        if (p.discovered) renderLanList(p.discovered);
    };
}
$("btnLanHost").addEventListener("click", () => {
    opponentProfile = null;
    NET = RCLan;
    attachNetHandlers();
    lanPanel("host");
    $("lanHostStatus").textContent = I18N.t("connecting");
    $("lanIp").textContent = "··· ··· ··· ···";
    RCLan.onUi = lanUiHandler();
    RCLan.host(() => {});
    const ip = RCLan.localIp();
    if (ip) { $("lanIp").textContent = ip; $("lanHostStatus").textContent = I18N.t("lanWaiting"); }
});
$("btnLanJoinPick").addEventListener("click", () => {
    opponentProfile = null;
    NET = RCLan;
    attachNetHandlers();
    lanPanel("join");
    $("lanAddr").value = "";
    $("lanAddr").placeholder = RCLan.native ? "192.168.1.5" : "AB12";
    $("lanJoinStatus").textContent = RCLan.native ? I18N.t("lanSearching") : I18N.t("lanEnterCode");
    renderLanList([]);
    RCLan.onUi = lanUiHandler();
    if (RCLan.native) RCLan.join("", null);
});
$("lanList").addEventListener("click", e => {
    const b = e.target.closest(".lanhost");
    if (!b) return;
    $("lanJoinStatus").textContent = I18N.t("connecting");
    RCLan.join(b.dataset.ip, null);
});
$("btnLanJoinGo").addEventListener("click", lanJoinGo);
$("lanAddr").addEventListener("keydown", e => { if (e.key === "Enter") lanJoinGo(); });
function lanJoinGo() {
    const addr = $("lanAddr").value.trim();
    if (!addr) { $("lanJoinStatus").textContent = I18N.t("lanNeedAddr"); return; }
    $("lanJoinStatus").textContent = I18N.t("connecting");
    RCLan.onUi = lanUiHandler();
    RCLan.join(addr, null);
}
$("btnOnlineBack").addEventListener("click", () => { cancelNet(); showScreen("scr-menu"); });
$("btnHostCancel").addEventListener("click", cancelNet);
$("btnJoinCancel").addEventListener("click", cancelNet);
$("btnLanHostCancel").addEventListener("click", cancelNet);
$("btnLanJoinCancel").addEventListener("click", cancelNet);

// Separate, persistent volumes. Music is a quiet original Web Audio arrangement.
function refreshSound() {
    if (effectsBus) effectsBus.gain.setTargetAtTime(soundOn ? soundVolume : 0, audioCtx.currentTime, .04);
}
$("btnSettingsGear").addEventListener("click", () => {
    ensureAudio();
    $("soundTitle").textContent = I18N.t("settingsTitle");
    $("effectsLabel").textContent = trText("Звуки", "Sound effects");
    $("musicLabel").textContent = trText("Музыка", "Music");
    $("soundOv").classList.add("open");
    updateMenuMusic();
});
for (const [id,key] of [["effectsVolume","sound"],["musicVolume","music"]]) {
    $(id).value = Math.round((key === "sound" ? soundVolume : musicVolume)*100);
    $(id+"Value").textContent = $(id).value+"%";
    $(id).addEventListener("input", () => {
        ensureAudio(); const value = Number($(id).value)/100;
        if (key === "sound") { soundVolume=value; soundOn=value>0; RCStore.set("rc_sound",soundOn?"1":"0"); }
        else musicVolume=value;
        RCStore.set("rc_"+key+"_volume",value);
        $(id+"Value").textContent = Math.round(value*100)+"%";
        refreshSound(); updateMenuMusic();
    });
}
$("soundClose").onclick = ()=>$("soundOv").classList.remove("open");
$("soundOv").onclick = e=>{if(e.target===$("soundOv")) $("soundClose").click();};
let musicBus = null, musicNext = 0, musicStep = 0;
function updateMenuMusic() {
    if (!audioCtx) return;
    if (!musicBus) { musicBus=audioCtx.createGain(); musicBus.gain.value=0; musicBus.connect(audioCtx.destination); }
    const active = $("scr-menu").classList.contains("active") && !document.hidden;
    musicBus.gain.setTargetAtTime(active ? musicVolume*.3 : 0, audioCtx.currentTime, .25);
    if (!active) { musicNext=0; return; }
    if (!musicNext || musicNext<audioCtx.currentTime) musicNext=audioCtx.currentTime+.05;
    const chords=[[130.81,164.81,196],[110,130.81,164.81],[87.31,110,130.81],[98,123.47,146.83]];
    while(musicNext<audioCtx.currentTime+.7) {
        const chord=chords[Math.floor(musicStep/8)%4], frequency=chord[musicStep%3]*(musicStep%4===0?1:2);
        const o=audioCtx.createOscillator(),g=audioCtx.createGain();
        o.type="sine"; o.frequency.value=frequency;
        g.gain.setValueAtTime(0,musicNext); g.gain.linearRampToValueAtTime(.23,musicNext+.035);
        g.gain.exponentialRampToValueAtTime(.0001,musicNext+1.5);
        o.connect(g).connect(musicBus);o.start(musicNext);o.stop(musicNext+1.6);
        o.onended=()=>{o.disconnect();g.disconnect();};
        musicNext+=.42;musicStep++;
    }
}
setInterval(updateMenuMusic,200);
document.addEventListener("pointerdown",()=>{ensureAudio();updateMenuMusic();},{once:true});
document.addEventListener("visibilitychange",updateMenuMusic);
refreshSound();
ensureAudio(); updateMenuMusic();

function updateTurnTimer() {
    const peer=$("peerCountdown");
    const away=mode === "online" && NET===RCNet && NET.peerUntil && phase!=="over";
    peer.hidden=!away;
    if(away) peer.textContent=trText("Соперник переподключается — ","Opponent reconnecting — ")+Math.max(0,Math.ceil((NET.peerUntil-Date.now())/1000))+trText(" сек."," s");
    if (mode !== "online") return;
    const moving = phase === "moving", remaining=Math.max(0,Math.ceil((turnDeadline-Date.now()-serverClockOffset)/1000));
    const el=$("turnTimer");
    if(el) { el.textContent=phase === "over" ? "—" : moving ? "• • •" : String(remaining); el.classList.toggle("urgent",!moving && remaining<=10); }
    if (NET !== RCLan || myIndex !== 0 || phase === "over" || moving || waitingForState || remaining>0) return;
    onlineSkips[turn]++;
    if(onlineSkips[turn]>=3){
        const result={t:"game-result",id:"lan-"+gameSeed,match:gameSeed,winner:1-turn,reason:"inactivity"};
        NET.send(result);NET.onMessage(result);return;
    }
    turn=1-turn;onlineMove++;drag=null;sliderHeld=false;oppLive=null;
    respawnRing();resetShotCounters();phase="aim";turnDeadline=Date.now()+60000;
    NET.send({t:"turn-timeout",match:gameSeed,move:onlineMove,state:gameSnapshot(),timeout:true,skips:onlineSkips});
    updateBar();showNotice(trText("Время истекло","Time expired"));
    setHint(I18N.t(turn===myIndex?"hintYourTurn":"hintOpponentTurn"));
}

// ═══════════════ Обучение ═══════════════
function startTutorial() {
    mode = "tutorial";
    freshGameState();
    world = PHY.createWorld();
    PHY.rack(world, 0);
    ringPlaced = false;
    phase = "aim";
    showScreen("scr-game");
    updateBar();
    syncSlider();
    tutShotSeen = false;
    showTutCard(0);
}

function showTutCard(i) {
    tutStep = i;
    tutPhase = "card";
    sliderHeld = false;
    drag = null;
    phase = "aim";
    syncSlider();
    $("tutNum").textContent = I18N.t("tutStep", { n: i + 1, m: TUT_STEPS });
    $("tutH").textContent = I18N.t("tut" + (i + 1) + "h");
    $("tutB").innerHTML = I18N.t("tut" + (i + 1) + "b");
    $("tutNext").textContent =
        i === 0 || i === 1 ? I18N.t("tutTry") :
        i === TUT_STEPS - 1 ? I18N.t("tutDone") : I18N.t("tutNext");
    $("tutClose").textContent = I18N.t("tutSkip");
    $("tutNext").style.display = "";
    $("tutClose").style.display = "";
    $("tutDots").innerHTML = Array.from({ length: TUT_STEPS }, (_, k) =>
        `<i class="${k === i ? "on" : ""}"></i>`).join("");
    $("tut").classList.add("open");
}

function startTutPractice(i) {
    tutPhase = "practice";
    tutShotSeen = false;
    syncSlider();
    $("tut").classList.remove("open");
    setHint(i === 0 ? I18N.t("hintPlace") : I18N.t("tutTryShot"));
}

function advanceTutorial() {
    if (mode !== "tutorial" || tutPhase !== "practice") return;
    if (tutStep === 1 && tutShotSeen && phase === "aim") {
        showTutCard(2);
    }
}
function tutTryFinish() {
    if (mode !== "tutorial" || tutPhase !== "practice" || tutStep !== 0) return;
    if (tutMoved >= 60) {
        tutMoved = -999;
        showTutCard(1);
    }
}

function endTutorial(completed = false) {
    tutStep = -1;
    tutPhase = "card";
    $("tut").classList.remove("open");
    setHint("");
    phase = "over";
    showScreen("scr-menu");
    if (completed) celebrate("celebrateTutorial", "celebrateTutorialDetail", {}, "⭐");
}

$("tutNext").addEventListener("click", () => {
    if (mode === "tutorial") {
        if (tutStep === 0) { startTutPractice(0); tutStartX = world.ring.x; tutMoved = 0; tutInputs = 0; return; }
        if (tutStep === 1) { startTutPractice(1); return; }
        if (tutStep < TUT_STEPS - 1) { showTutCard(tutStep + 1); return; }
        endTutorial(true);
        return;
    }
    $("tut").classList.remove("open");
});
$("tutClose").addEventListener("click", () => {
    if (mode === "tutorial") { endTutorial(); return; }
    $("tut").classList.remove("open");
});

// ═══════════════ Магазин ═══════════════
const PRICE = 100;
function coins() {
    return RCStore.balance();
}
function addCoins(n) { RCStore.commit({rc_coins:String(coins()+n)}); renderCoins(); }
function renderHomeProfile() {
    const profile = localProfile(), progress = RCLevel.state();
    $("homeAvatar").src = RND.avatarURL(profile.avatar, 64);
    $("homeName").textContent = profile.name;
    $("homeAvatar").alt = profile.name;
    $("homeAvatar").title = profile.name;
    $("homeLevel").textContent = I18N.t("playerLevel", {n:progress.level});
    $("homeLevelValue").textContent = progress.level;
    $("homeXpFill").style.width = progress.xp + "%";
    $("homeXpText").textContent = `${progress.xp} / ${progress.target} ` + I18N.t("xpLabel");
    $("homeXpBar").setAttribute("aria-valuenow", progress.xp);
    $("homeXpBar").setAttribute("aria-label", I18N.t("experienceLabel"));
    $("homeXpBar").setAttribute("aria-valuetext", $("homeXpText").textContent);
}
window.refreshHomeProfile = renderHomeProfile;
function renderCoins() {
    const v = coins();
    const a = $("coinsVal"); if (a) a.textContent = v;
    const b = $("coinsMenu"); if (b) b.textContent = v;
}
function ownedList(kind) {
    try { return JSON.parse(RCStore.get("rc_own_" + kind) || "[0]"); } catch (e) { return [0]; }
}
function setOwned(kind, list) { RCStore.set("rc_own_" + kind, JSON.stringify(list)); }

function renderSettings() {
    renderCoins();
    renderLoginCalendar();
    renderHomeProfile();
    $("avProf").src = RND.avatarURL(+(RCStore.get("rc_avatar") || 0), 44);
    const ni = $("nameInput");
    if (document.activeElement !== ni) ni.value = RCStore.get("rc_name") || I18N.t("defaultName");
    const tSel = +(RCStore.get("rc_theme") || 0);
    const pSel = +(RCStore.get("rc_puck") || 0);
    const aSel = +(RCStore.get("rc_avatar") || 0);
    const tOwn = ownedList("themes");
    const pOwn = ownedList("pucks");
    const lang = I18N.lang;

    function buyBtn(owned, sel) {
        if (sel) return `<button class="buybtn selected">${I18N.t("swatchSelected")}</button>`;
        if (owned) return `<button class="buybtn select" data-act="select">${I18N.t("shopSelect")}</button>`;
        const afford = coins() >= PRICE;
        return `<button class="buybtn${afford ? "" : " locked"}" data-act="buy">
            <i class="coinmini"></i>${PRICE}</button>`;
    }

    $("avatarGrid").innerHTML = RND.AVATARS.map((av, i) => {
        const sel = aSel === i;
        return `<div class="shopitem${sel ? " selected" : ""}" data-kind="avatar" data-i="${i}">
            <div class="pucks2"><img class="avico" style="width:64px;height:64px" src="${RND.avatarURL(i, 64)}" alt="${escapeText(lang === "en" ? av.en : av.ru)}"></div>
            <div class="nm">${escapeText(lang === "en" ? av.en : av.ru)}</div>${buyBtn(true, sel)}</div>`;
    }).join("");

    $("themeGrid").innerHTML = RND.THEMES.map((th, i) => {
        const owned = tOwn.indexOf(i) !== -1;
        const sel = tSel === i;
        return `<div class="shopitem themecard${sel ? " selected" : ""}" data-kind="theme" data-i="${i}">
            <img class="previmg" src="${RND.previewURL(i)}" alt="">
            <div class="nm" style="margin-top:7px">${lang === "en" ? th.en : th.ru}</div>
            ${buyBtn(owned, sel)}</div>`;
    }).join("");

    $("puckGrid").innerHTML = RND.PUCKS.map((pk, i) => {
        const owned = pOwn.indexOf(i) !== -1;
        const sel = pSel === i;
        return `<div class="shopitem${sel ? " selected" : ""}" data-kind="puck" data-i="${i}">
            <div class="pucks2">
                <span class="pk" style="background:${pk.lightFill}; border:2px solid ${pk.lightRim}"></span>
                <span class="pk" style="background:${pk.darkFill}; border:2px solid ${pk.darkRim}"></span>
            </div>
            <div class="nm">${lang === "en" ? pk.en : pk.ru}</div>
            ${buyBtn(owned, sel)}</div>`;
    }).join("");
}
window.refreshSettingsScreen = renderSettings;
function confirmNameChange() {
    const name = $("nameInput").value.trim().slice(0, 12) || I18N.t("defaultName");
    if (name === localProfile().name) return;
    askConfirm("confirmName", "btnSaveProfile", () => {
        RCStore.set("rc_name", name);
        $("nameInput").blur(); renderSettings(); updateBar(); sendProfile();
        showToast(I18N.t("nameSaved"));
    }, "btnCancelProfile");
}
$("btnNameOk").addEventListener("click", confirmNameChange);
$("nameInput").addEventListener("keydown", e => { if (e.key === "Enter") confirmNameChange(); });

function popItem(kind, i) {
    const el = document.querySelector(`.shopitem[data-kind="${kind}"][data-i="${i}"]`);
    if (!el) return;
    el.classList.remove("pop");
    void el.offsetWidth;
    el.classList.add("pop");
    setTimeout(() => el.classList.remove("pop"), 750);
}

function shopClick(kind, i, act) {
    const free = kind === "avatar";
    const selKey = kind === "theme" ? "rc_theme" : kind === "avatar" ? "rc_avatar" : "rc_puck";
    const owned = free ? true : ownedList(kind === "theme" ? "themes" : "pucks").indexOf(i) !== -1;
    if (owned) {
        if (act !== "select" && act !== "buy") return;
        if (kind === "avatar") {
            if (localProfile().avatar === i) return;
            askConfirm("confirmAvatar", "btnSaveProfile", () => {
                RCStore.set("rc_avatar", String(i));
                renderSettings(); updateBar(); sendProfile();
                showToast(I18N.t("avatarSaved"));
            }, "btnCancelProfile");
            return;
        }
        RCStore.set(selKey, String(i));
        if (kind !== "avatar") RND.refreshStyle();
        renderSettings();
        return;
    }
    if (act !== "buy") return;
    if (coins() < PRICE) { showToast(I18N.t("toastNotEnough"), 1800); return; }
    const list = ownedList(kind === "theme" ? "themes" : "pucks");
    list.push(i);
    RCStore.commit({rc_coins:String(coins()-PRICE),['rc_own_'+(kind==='theme'?'themes':'pucks')]:JSON.stringify(list),[selKey]:String(i)});
    RND.refreshStyle();
    renderSettings();
    popItem(kind, i);
    celebrate("celebratePurchase", "celebratePurchaseDetail", {}, "🎁");
}
function safeShopClick(kind,i,act){try{shopClick(kind,i,act);}catch(_){showToast(trText('Не удалось сохранить покупку. Освободите место и повторите.','Could not save the purchase. Free some space and retry.'),3500);}}

$("avatarGrid").addEventListener("click", e => {
    const item = e.target.closest(".shopitem");
    if (!item) return;
    const btn = e.target.closest(".buybtn");
    safeShopClick("avatar", +item.dataset.i, btn ? btn.dataset.act : undefined);
});
$("themeGrid").addEventListener("click", e => {
    const item = e.target.closest(".shopitem");
    if (!item) return;
    const btn = e.target.closest(".buybtn");
    safeShopClick("theme", +item.dataset.i, btn ? btn.dataset.act : undefined);
});
$("puckGrid").addEventListener("click", e => {
    const item = e.target.closest(".shopitem");
    if (!item) return;
    const btn = e.target.closest(".buybtn");
    safeShopClick("puck", +item.dataset.i, btn ? btn.dataset.act : undefined);
});

// ═══════════════ Ползунок позиции кольца ═══════════════
let sliderHeld = false;
const sliderEl = $("ringSlider");
const oppSliderEl = $("oppSlider");
function syncSlider() {
    const prow = $("sliderRow"), orow = $("oppSliderRow");
    const myActive = (phase === "aim" || phase === "slide") && humanTurn() && tutorialAllowsPosition();
    sliderEl.disabled = !myActive;
    prow.classList.toggle("guided", mode === "tutorial" && tutPhase === "practice" && tutStep === 0);
    const rc = RND.ringColors();
    const me = mode === "online" ? myIndex : mode === "pvp" ? turn : 0;
    prow.style.setProperty("--ring-icon", `url("${RND.ringURL(me === 0 ? rc.ringP1 : rc.ringP2)}")`);
    orow.style.setProperty("--ring-icon", `url("${RND.ringURL(mode === "online" && myIndex === 1 ? rc.ringP1 : rc.ringP2)}")`);
    // в botAim бот сам двигает кольцо — его линия активна и зеркалит прицел
    const oppActive = (phase === "aim" || phase === "slide" || phase === "botAim") && !humanTurn();
    // обе линии выбора видны одновременно: линия игрока снизу, соперника сверху
    prow.classList.toggle("off", !myActive);
    prow.style.setProperty("--ringcol", ringColorRgbOf(mode === "online" ? myIndex : mode === "pvp" ? turn : 0));   // линия игрока — его цвет
    orow.classList.toggle("off", !oppActive);
    orow.style.setProperty("--oppcol", ringColorRgbOf(mode === "online" ? 1 - myIndex : 1));     // линия соперника — его цвет
    if (!world.ring) return;
    const range = PHY.baselineRange(world);
    if (+sliderEl.min !== Math.round(range[0])) sliderEl.min = Math.round(range[0]);
    if (+sliderEl.max !== Math.round(range[1])) sliderEl.max = Math.round(range[1]);
    if (+oppSliderEl.min !== Math.round(range[0])) oppSliderEl.min = Math.round(range[0]);
    if (+oppSliderEl.max !== Math.round(range[1])) oppSliderEl.max = Math.round(range[1]);
    // дорожка обоих слайдеров = длине линии на столе: ползунок и кольцо движутся 1:1
    const want = Math.round((range[1] - range[0]) * view.scale + 24) + "px";
    if (sliderEl.style.width !== want) sliderEl.style.width = want;
    if (oppSliderEl.style.width !== want) oppSliderEl.style.width = want;
    if (!sliderHeld) {
        const vx = Math.round(viewX(world.ring.x));
        sliderEl.value = humanTurn() && phase !== "moving" ? vx : world.size / 2;
        oppSliderEl.value = !humanTurn() && phase !== "moving" ? vx : world.size / 2;
    }
}

// цвет кольца конкретного игрока (для линий выбора) в формате "r,g,b"
function ringColorRgbOf(t) {
    const rc = RND.ringColors();
    const hex = (t === 0 ? rc.ringP1 : rc.ringP2).replace("#", "");
    return [
        parseInt(hex.substr(0, 2), 16),
        parseInt(hex.substr(2, 2), 16),
        parseInt(hex.substr(4, 2), 16),
    ].join(",");
}
sliderEl.addEventListener("pointerdown", () => { sliderHeld = true; ensureAudio(); });
sliderEl.addEventListener("pointerup", () => { sliderHeld = false; tutTryFinish(); });
sliderEl.addEventListener("pointercancel", () => { sliderHeld = false; });
sliderEl.addEventListener("change", () => tutTryFinish());
sliderEl.addEventListener("input", () => {
    if (phase !== "aim" && phase !== "slide") return;
    if (!humanTurn() || !world.ring || !tutorialAllowsPosition()) return;
    const range = PHY.baselineRange(world);
    const x = Math.max(range[0], Math.min(range[1], viewX(+sliderEl.value)));
    tutMoved += Math.abs(x - world.ring.x);
    tutInputs++;
    world.ring.x = x;
    ringPlaced = true;
    liveSync({ t: "place", x });
});
sliderEl.addEventListener("change", () => {
    // отпустили на шашках — кольцо встаёт на ближайшее свободное место
    if (world.ring && humanTurn() && tutorialAllowsPosition() && (phase === "aim" || phase === "slide")) {
        world.ring.x = PHY.freeRingX(world, world.ring.x, turn);
        sliderEl.value = Math.round(viewX(world.ring.x));
        liveSync({ t: "place", x: world.ring.x });
    }
});

function ringColorRgb() {
    const hex = ringColor().replace("#", "");
    return [
        parseInt(hex.substr(0, 2), 16),
        parseInt(hex.substr(2, 2), 16),
        parseInt(hex.substr(4, 2), 16),
    ].join(",");
}

// ═══════════════ Язык ═══════════════
function applyLangExtras() {
    const labels = [I18N.t("diff0"), I18N.t("diff1"), I18N.t("diff2")];
    document.querySelectorAll("#diffOv .dnm").forEach((el, i) => {
        if (labels[i]) el.textContent = labels[i];
    });
    refreshSeg();
    refreshFlags();
    renderHomeProfile();
    if ($("scr-settings").classList.contains("active")) renderSettings();
    if ($("scr-training").classList.contains("active")) refreshTrainingStats();
}
function refreshFlags() {
    $("btnLangRu").classList.toggle("on", I18N.lang === "ru");
    $("btnLangEn").classList.toggle("on", I18N.lang === "en");
    $("btnLangRu").setAttribute("aria-pressed", I18N.lang === "ru");
    $("btnLangEn").setAttribute("aria-pressed", I18N.lang === "en");
}
$("btnLangRu").addEventListener("click", () => { I18N.set("ru"); applyLangExtras(); });
$("btnLangEn").addEventListener("click", () => { I18N.set("en"); applyLangExtras(); });

// ═══════════════ Системный «Назад» ═══════════════
window.__androidBack = function () {
    if (RCChat.closeIfOpen()) return true;
    if ($("confirmOv").classList.contains("open")) { $("confStay").click(); return true; }
    for (const id of ["progressOv", "soundOv", "dailyOv", "diffOv", "tut", "winOv"]) {
        if ($(id).classList.contains("open")) {
            if (id === "tut" && mode === "tutorial") { endTutorial(); return true; }
            $(id).classList.remove("open");
            return true;
        }
    }
    const screen = document.querySelector(".screen.active");
    const scr = screen ? screen.id : "scr-menu";
    if (scr === "scr-settings" || scr === "scr-training") {
        showScreen("scr-menu"); return true;
    }
    if (scr === "scr-online") { cancelNet(); showScreen("scr-menu"); return true; }
    if (scr === "scr-roulette") { rouletteActive = false; showScreen("scr-menu"); return true; }
    if (scr === "scr-game") {
        $("btnBack").click();
        return true;
    }
    return false;
};

// ═══════════════ Рулетка ботов ═══════════════
// 10 противников с детальными 2D-портретами (общий стиль с аватарами)
const BOTS = [
    { name: "Асиф",   skin: "#e8b98a", shade: "#c99a6c", light: "#f5d3a8", hair: "#1c1c1c", hairHi: "#333333", hairStyle: "cap",  capColor: "#2f7d5c", brows: "#1c1c1c", face: "beard",    shirt: "#2f7d5c", shirtShade: "#1f5a41", collar: "#245e46", knit: true },
    { name: "Камран", skin: "#d9a06b", shade: "#b57f4e", light: "#efc290", hair: "#2a2018", hairHi: "#463826", hairStyle: "short", brows: "#2a2018", face: "mustache", shirt: "#b23a2e", shirtShade: "#8a2a22", collar: "#c96a5a", plaid: true },
    { name: "Барри",  skin: "#f0c8a0", shade: "#d9a97e", light: "#fbdcb8", hair: "#c8c8c8", hairHi: "#e8e8e8", hairStyle: "bald",  brows: "#8a8a8a", face: "glasses",  shirt: "#2a4d6e", shirtShade: "#1e3a52", collar: "#7a95b5", knit: true },
    { name: "Хан",    skin: "#b07b4f", shade: "#8f5f3a", light: "#c99a6c", hair: "#100d0a", hairHi: "#2a2018", hairStyle: "cap",  capColor: "#5a3a7d", brows: "#100d0a", face: "beard",    shirt: "#5a3a7d", shirtShade: "#42285c", collar: "#7a5caa", plaid: true },
    { name: "Салман", skin: "#e8b98a", shade: "#c99a6c", light: "#f5d3a8", hair: "#3a2c1c", hairHi: "#584428", hairStyle: "short", brows: "#3a2c1c", face: "none",     shirt: "#c2801f", shirtShade: "#9a6512", collar: "#e0b060", knit: true },
    { name: "Тарик",  skin: "#d9a06b", shade: "#b57f4e", hair: "#1c1c1c", hairHi: "#333333", hairStyle: "bald",  brows: "#1c1c1c", face: "mustache", shirt: "#1f5f5a", shirtShade: "#144540", collar: "#2a8078", knit: false },
    { name: "Джо",    skin: "#f0c8a0", shade: "#d9a97e", light: "#fbdcb8", hair: "#6a4a2a", hairHi: "#8a6238", hairStyle: "short", brows: "#6a4a2a", face: "glasses",  shirt: "#8a2f4a", shirtShade: "#662236", collar: "#b55a72", plaid: false },
    { name: "Вики",   skin: "#e8b98a", shade: "#c99a6c", light: "#f5d3a8", hair: "#d4a017", hairHi: "#f0c040", hairStyle: "cap",  capColor: "#3457a5", brows: "#8a6a10", face: "none",     shirt: "#3457a5", shirtShade: "#27417d", collar: "#6a8ac5", knit: true },
    { name: "Рома",   skin: "#e8c8a8", shade: "#c9a582", light: "#f5ddb8", hair: "#4a3320", hairHi: "#68492e", hairStyle: "short", brows: "#4a3320", face: "beard",    shirt: "#4a6b1f", shirtShade: "#365116", collar: "#6a8a2a", plaid: true },
    { name: "Лев",    skin: "#f0c8a0", shade: "#d9a97e", light: "#fbdcb8", hair: "#c8b8a8", hairHi: "#e8ddd0", hairStyle: "bald",  brows: "#a89a88", face: "none",     shirt: "#6e2f7d", shirtShade: "#52235c", collar: "#9a5aac", knit: true },
];

const BOT_PORTRAITS = ["asif", "kamran", "barry", "khan", "salman", "tarik", "jo", "viki", "roma", "lev"];
const BOT_NAMES_EN = ["Asif", "Kamran", "Barry", "Khan", "Salman", "Tarik", "Jo", "Viki", "Roma", "Lev"];
BOTS.forEach((bot, index) => {
    bot.portrait = BOT_PORTRAITS[index];
    const ru = bot.name;
    Object.defineProperty(bot, "name", { get: () => I18N.lang === "en" ? BOT_NAMES_EN[index] : ru });
});

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function cardRect(x, slot, h) {
    const cs = slot - 12;
    return { x: x + 6, y: Math.round((h - cs) / 2), w: cs, h: cs };
}

function drawPortrait(ctx, b, cr) {
    ctx.fillStyle = "#0d211a";
    ctx.strokeStyle = "rgba(226,181,60,.35)";
    ctx.lineWidth = 1.5;
    roundRect(ctx, cr.x, cr.y, cr.w, cr.h, 9);
    ctx.fill(); ctx.stroke();
    // портрет из кеша спрайтов: прокрутка рулетки — просто наложение готовых картинок
    ctx.save();
    roundRect(ctx, cr.x, cr.y, cr.w, cr.h, 9);
    ctx.clip();
    ctx.drawImage(RND.personCanvas(b, Math.round(cr.w)), cr.x, cr.y, cr.w, cr.h);
    ctx.restore();
    ctx.strokeStyle = "rgba(226,181,60,.35)";
    ctx.lineWidth = 1.5;
    roundRect(ctx, cr.x, cr.y, cr.w, cr.h, 9);
    ctx.stroke();
}

function drawStrip(ctx, cv, off, slot, highlight, blurPx) {
    const w = cv.clientWidth || 360, h = 128;
    if (!drawStrip.buf || drawStrip.buf.width !== cv.width || drawStrip.buf.height !== cv.height) {
        drawStrip.buf = document.createElement("canvas");
    }
    const buf = drawStrip.buf;
    buf.width = cv.width; buf.height = cv.height;
    const bctx = buf.getContext("2d");
    bctx.setTransform(ctx.getTransform());
    bctx.clearRect(0, 0, w, h);
    bctx.fillStyle = "rgba(6,20,14,.78)";
    roundRect(bctx, 0, 0, w, h, 12);
    bctx.fill();
    bctx.save();
    roundRect(bctx, 2, 2, w - 4, h - 4, 11);
    bctx.clip();
    const N = BOTS.length;
    const first = Math.floor(off / slot) - 1;
    const count = Math.ceil(w / slot) + 3;
    for (let i = first; i < first + count; i++) {
        const idx = ((i % N) + N) % N;
        const cr = cardRect(i * slot - off, slot, h);
        drawPortrait(bctx, BOTS[idx], cr);
        if (idx === highlight) {
            bctx.strokeStyle = "#ffe9a8"; bctx.lineWidth = 3;
            roundRect(bctx, cr.x, cr.y, cr.w, cr.h, 9);
            bctx.stroke();
        }
    }
    bctx.restore();
    ctx.clearRect(0, 0, w, h);
    if (blurPx > 0.3) ctx.filter = "blur(" + blurPx.toFixed(1) + "px)";
    ctx.drawImage(buf, 0, 0, w, h);
    ctx.filter = "none";
}

rouletteActive = false;
function startRoulette() {
    showScreen("scr-roulette");
    rouletteActive = true;
    botPersona = null;
    const reward = [10, 20, 30][difficulty] || 10;
    $("roulTitle").textContent = I18N.t("rouletteVs", { n: I18N.t("diff" + difficulty) });
    $("roulReward").textContent = "+" + reward;
    $("roulStatus").textContent = I18N.t("rouletteSpin");
    const cv = $("roulCanvas");
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    const w = cv.clientWidth || 360, h = 128;
    cv.width = Math.round(w * DPR);
    cv.height = Math.round(h * DPR);
    const ctx = cv.getContext("2d");
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const slot = Math.max(78, w / 4.2);
    const N = BOTS.length, stripW = N * slot;
    const target = Math.floor(Math.random() * N);
    const finalOff = 2 * stripW + target * slot + slot / 2 - w / 2;
    const dur = 3000, t0 = performance.now();
    roulPrevOff = 0;
    function frameRoulette(now) {
        if (!rouletteActive) return;
        const k = Math.min(1, (now - t0) / dur);
        const e = 1 - Math.pow(1 - k, 3);
        const off = finalOff * e;
        const speed = Math.abs(off - roulPrevOff);
        roulPrevOff = off;
        const blur = Math.min(7, speed * 0.55);
        drawStrip(ctx, cv, off, slot, k >= 1 ? target : -1, blur);
        if (k < 1) requestAnimationFrame(frameRoulette);
        else {
            botPersona = BOTS[target];
            $("roulStatus").textContent = I18N.t("rouletteGo") + " · " + botPersona.name;
            $("scr-roulette").classList.add("spread");
            setTimeout(() => {
                $("scr-roulette").classList.remove("spread");
                rouletteActive = false;
                newGame("bot");
            }, 500);
        }
    }
    requestAnimationFrame(frameRoulette);
}

// ═══════════════ Старт ═══════════════
window.addEventListener("resize", () => {
    if ($("scr-game").classList.contains("active")) layout();
});

window.__androidBack = function () {
    if (RCChat.closeIfOpen()) return true;
    if ($("confirmOv").classList.contains("open")) { $("confStay").click(); return true; }
    for (const id of ["progressOv", "soundOv", "dailyOv", "diffOv", "tut", "winOv"]) {
        if ($(id).classList.contains("open")) {
            if (id === "tut" && mode === "tutorial") { endTutorial(); return true; }
            $(id).classList.remove("open");
            return true;
        }
    }
    const screen = document.querySelector(".screen.active");
    const scr = screen ? screen.id : "scr-menu";
    if (scr === "scr-settings" || scr === "scr-training") {
        showScreen("scr-menu"); return true;
    }
    if (scr === "scr-online") { cancelNet(); showScreen("scr-menu"); return true; }
    if (scr === "scr-roulette") { rouletteActive = false; showScreen("scr-menu"); return true; }
    if (scr === "scr-game") {
        $("btnBack").click();
        return true;
    }
    return false;
};

// отладочный доступ для автотестов
window.RC = {
    get world() { return world; },
    get phase() { return phase; },
    get turn() { return turn; },
    get mode() { return mode; },
    get scores() { return scores; },
    get drill() { return drill; },
    get myIndex() { return myIndex; },
    get ringPlaced() { return ringPlaced; },
    get pendingShots() { return pendingShots.length; },
    get sparks() { return sparks.length; },
    get coins() { return coins(); },
    get tutStep() { return tutStep; },
    shoot(angle, power, x) {
        if (phase !== "aim" || !humanTurn()) return false;
        const ring = world.ring;
        const sx = x !== undefined ? PHY.freeRingX(world, x, turn) : ring.x;
        PHY.applyShot(world, sx, ring.y, angle, power * PHY.P.MAX_SHOT_V);
        sendShot(sx, angle, power * PHY.P.MAX_SHOT_V);
        shotTaken();
        phase = "moving";
        settle = 0; accumulator = 0;
        return true;
    },
    fastForward() {
        if (phase !== "moving") return false;
        let guard = 0;
        while (phase === "moving" && guard++ < 300000) {
            PHY.stepWorld(world, ev);
            if (PHY.allAsleep(world)) { endShot(); break; }
        }
        return true;
    },
    newGame(m) { newGame(m || mode); },
    startOnline(seed) { startOnlineGame(seed); },
};

attachNetHandlers();

// Daily login rewards are shared by the startup prompt and shop calendar.
function renderLoginCalendar() {
    const state = RCDaily.status();
    $("loginDays").innerHTML = RCDaily.rewards.map((reward, i) => {
        const day = i + 1, done = day < state.day || (day === state.day && state.claimed);
        return `<div class="login-day${done ? " claimed" : day === state.day ? " current" : ""}"${day === state.day ? ' aria-current="date"' : ''}><span>${I18N.t("loginDay", {n:day})}</span><i class="gemicon" aria-hidden="true"></i><b>+${reward}</b>${done ? `<small>${I18N.t("loginDone")}</small>` : ""}</div>`;
    }).join("");
    $("btnLoginClaim").disabled = state.claimed;
    $("btnLoginClaim").textContent = I18N.t(state.claimed ? "loginClaimed" : "loginClaim", {n:state.reward});
    $("dailyAmount").textContent = "+" + state.reward;
}
function checkDaily() {
    renderLoginCalendar();
    if (!RCDaily.status().claimed) $("dailyOv").classList.add("open");
}
function claimLoginGift() {
    let reward;
    try{reward=RCDaily.claim();}catch(_){showToast(trText('Не удалось сохранить бонус. Освободите место и повторите.','Could not save the bonus. Free some space and retry.'),3500);return;}
    renderCoins(); renderLoginCalendar();
    $("dailyOv").classList.remove("open");
    if (reward) celebrate("celebrateDaily", "celebrateReward", {n:reward}, "💎");
}
$("btnDailyGet").addEventListener("click", claimLoginGift);
$("btnLoginClaim").addEventListener("click", claimLoginGift);
document.addEventListener("visibilitychange", () => {
    if (!document.hidden) renderLoginCalendar();
});
// Refresh an open shop at midnight without interrupting a match.
setInterval(() => { if ($("scr-settings").classList.contains("active")) renderLoginCalendar(); }, 30000);

// язык интерфейса (RU/EN) — флаги на главном экране
I18N.apply();
applyLangExtras();
renderCoins();
setTimeout(checkDaily, 700);
const startupSession = RCNet.saved();
function offerSavedGame() {
    const saved = startupSession;
    if (!saved || !RCNet.saved() || RCNet.active) return;
    if ($("dailyOv").classList.contains("open")) { setTimeout(offerSavedGame, 500); return; }
    let deciding=true;
    const watch=async()=>{
        if(!deciding || RCNet.active)return;
        const exists=await RCNet.checkSaved(saved);
        if(!deciding || RCNet.active)return;
        if(exists===false){
            deciding=false;RCStore.remove("rc_session");
            $("confirmOv").classList.remove("open");
            showToast(I18N.t("oppLeft"));return;
        }
        setTimeout(watch,1000);
    };
    askConfirm("confirmResume", "btnResume", () => {
        deciding=false;
        NET = RCNet; attachNetHandlers();
        showScreen("scr-online");
        $("joinStatus").textContent = I18N.t("netRestoring");
        onlinePanel("join");
        RCNet.resumeSaved(saved);
    }, "btnLeaveGame", () => {deciding=false;RCNet.discardSaved(saved);});
    watch();
}
setTimeout(offerSavedGame, 900);

// самопроверка физики: game.html?selftest=1
if (location.search.indexOf("selftest") !== -1 && window.RCSelftest) {
    const log = $("testlog");
    log.style.display = "block";
    RCSelftest.run(line => {
        log.textContent += line + "\n";
        log.scrollTop = log.scrollHeight;
        console.log(line);
    });
}

// стартуем с меню; мир создаём, чтобы канвас мог рисовать подложку
PHY.rack(world, 0);
showScreen("scr-menu");

// Social invitations reuse the established room transport and match lifecycle.
window.RCFriendGame = {
    available() {
        return !RCNet.active && !RCLan.peer && !RCLan.connected &&
            !document.getElementById('scr-game').classList.contains('active') &&
            !document.getElementById('scr-roulette').classList.contains('active');
    },
    host() {
        return new Promise((resolve,reject)=>{
            opponentProfile=null;NET=RCNet;attachNetHandlers();
            showScreen('scr-online');showNetTab('net');onlinePanel('host');
            $('hostCode').textContent='…';$('hostStatus').textContent=trText('Готовим приглашение…','Preparing invitation…');
            const timer=setTimeout(()=>{if(!RCNet.code){RCNet.destroy();reject(new Error('room_unavailable'));}},12000);
            RCNet.host(({code})=>{
                clearTimeout(timer);$('hostCode').textContent=code;
                $('hostStatus').textContent=trText('Ждём друга. Приглашение действует 90 секунд.','Waiting for your friend. Invitation expires after 90 seconds.');
                resolve({code,token:RCNet.token});
            });
        });
    },
    join(code) {
        opponentProfile=null;NET=RCNet;attachNetHandlers();
        showScreen('scr-online');showNetTab('net');onlinePanel('join');
        $('joinCode').value=code;$('joinStatus').textContent=I18N.t('connecting');
        RCNet.join(code,()=>{});
    },
    cancel(code) {
        if(RCNet.code===code && !RCNet.connected && mode!=='online') {
            cancelNet();showScreen('scr-friends');
        }
    }
};
requestAnimationFrame(frame);

// One permission gate for all placement controls during the guided lesson.
function tutorialAllowsPosition() {
    return mode !== "tutorial" || (tutPhase === "practice" && tutStep === 0);
}
function showCombo(n) {
    comboCount = n;
    comboUntil = performance.now() + 1800;
    buzz([40, 50, 70]);
    rewardSound();
}

// Brief, non-blocking feedback: existing controls stay available throughout.
function rewardSound() {
    ensureAudio();
    if (!soundOn || !audioCtx) return;
    const t = audioCtx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((frequency, i) => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = "sine"; o.frequency.value = frequency;
        const start = t + i * .075;
        g.gain.setValueAtTime(0, start);
        g.gain.linearRampToValueAtTime(.09, start + .015);
        g.gain.exponentialRampToValueAtTime(.0001, start + .24);
        o.connect(g).connect(effectsBus);
        o.start(start); o.stop(start + .25);
        o.onended = () => { o.disconnect(); g.disconnect(); };
    });
}
function celebrate(titleKey, detailKey, vars = {}, icon = "⭐", confetti = true) {
    const el = $("celebration");
    clearTimeout(celebrationTimer);
    el.classList.remove("show");
    $("celebrationTitle").textContent = I18N.t(titleKey, vars);
    $("celebrationDetail").textContent = I18N.t(detailKey, vars);
    el.querySelector(".celebration-icon").textContent = icon;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.querySelector(".celebration-particles").replaceChildren();
    if (confetti && !reduced) {
        const colors = ["#ffda7b", "#65e3cf", "#a8baff", "#ff99ac", "#ffffff"];
        const fragment = document.createDocumentFragment();
        for (let i = 0; i < 38; i++) {
            const part = document.createElement("i");
            part.style.cssText = `--x:${Math.random() * 100}%;--drift:${Math.random() * 160 - 80}px;--delay:${Math.random() * .28}s;--rot:${Math.random() * 720 - 360}deg;background:${colors[i % colors.length]}`;
            fragment.appendChild(part);
        }
        el.querySelector(".celebration-particles").appendChild(fragment);
    }
    void el.offsetWidth;
    el.classList.add("show");
    rewardSound();
    buzz([25, 45, 45]);
    celebrationTimer = setTimeout(() => {
        el.classList.remove("show");
        el.querySelector(".celebration-particles").replaceChildren();
    }, 2600);
}
function drawCombo(c, now) {
    if (now >= comboUntil) return;
    const t = 1 - (comboUntil - now) / 1800;
    c.save();
    c.translate(360, 320 - t * 24);
    const scale = t < .18 ? .6 + .4 * Math.sin(t / .18 * Math.PI / 2) : 1;
    c.scale(scale, scale);
    c.globalAlpha = Math.min(1, t * 12, (1 - t) * 5);
    for (let i = 0; i < 18; i++) {
        const a = i * Math.PI * 2 / 18, r = 80 + t * 160;
        c.fillStyle = i % 2 ? "#ffdc78" : "#78ffe0";
        c.beginPath(); c.arc(Math.cos(a) * r, Math.sin(a) * r * .55, 4 * (1 - t), 0, Math.PI * 2); c.fill();
    }
    c.shadowColor = "#ffbc45"; c.shadowBlur = 24;
    c.textAlign = "center"; c.textBaseline = "middle";
    c.font = "900 48px sans-serif"; c.lineWidth = 7; c.strokeStyle = "#152b35";
    const text = I18N.t(comboCount >= 3 ? "comboTriple" : "comboDouble");
    c.strokeText(text, 0, 0); c.fillStyle = "#fff1ad"; c.fillText(text, 0, 0);
    c.restore();
}
function drawCoach(c, now) {
    if (mode !== "tutorial") return;
    const demo = $("tutDemo");
    if (tutPhase === "card") {
        const dc = demo.getContext("2d");
        dc.clearRect(0, 0, 360, 150);
        paintLesson(dc, tutStep, now);
        return;
    }
    if (phase !== "aim" || sliderHeld || drag) return;
    const r = world.ring, k = (now % 2200) / 2200;
    c.save(); c.strokeStyle = "#ffcf70"; c.lineWidth = 4;
    c.setLineDash([8, 8]); c.beginPath();
    if (tutStep === 0) { c.moveTo(r.x - 75, r.y); c.lineTo(r.x + 75, r.y); }
    else { c.moveTo(r.x, r.y); c.lineTo(r.x, r.y + 85); }
    c.stroke(); c.setLineDash([]);
    c.font = "48px sans-serif"; c.textAlign = "center";
    c.fillText("☝", tutStep === 0 ? r.x + Math.sin(k * Math.PI * 2) * 75 : r.x, tutStep === 0 ? r.y + 55 : r.y + 30 + k * 85);
    c.restore();
}
function paintLesson(c, step, now) {
    const k = (now % 2400) / 2400;
    c.save();
    c.fillStyle = "#102c31"; c.fillRect(0, 0, 360, 150);
    c.strokeStyle = "#73968b"; c.lineWidth = 2;
    c.beginPath(); c.moveTo(40, 110); c.lineTo(320, 110); c.stroke();
    if (step < 2) {
        const x = step === 0 ? 180 + Math.sin(k * Math.PI * 2) * 95 : 180;
        RND.drawRing(c, {x, y:110, r:17, ri:10}, RND.ringColors().ringP1, false, false);
        c.font = "34px sans-serif"; c.fillStyle = "#fff";
        c.fillText("☝", x - 14, step === 0 ? 147 : 114 + Math.min(k * 2, 1) * 30);
        if (step === 1) {
            c.setLineDash([5, 6]); c.strokeStyle = "#ffdc78";
            c.beginPath(); c.moveTo(180, 90); c.lineTo(180, 24); c.stroke();
            c.setLineDash([]);
            RND.drawRing(c, {x:180, y:110 - Math.max(0, k - .55) * 190, r:17, ri:10}, RND.ringColors().ringP1, false, false);
        }
    } else {
        c.fillStyle = "#030d12"; c.beginPath(); c.arc(310, 32, 23, 0, Math.PI * 2); c.fill();
        const count = step === 3 ? 4 : 1;
        for (let i = 0; i < count; i++) {
            const q = Math.min(1, Math.max(0, k * (step === 3 ? 5 : 1.5) - i));
            if (q < 1) RND.drawStone(c, {x:65 + i * 45 + q * (245 - i * 45), y:95 - q * 63, r:13, color:"w", spinA:0}, 1 - q * .5, 1 - q);
        }
        c.fillStyle = "#ffdc78"; c.font = "bold 26px sans-serif";
        c.fillText(step === 3 ? (k > .8 ? "🏆" : "● ● ● ●") : "+1 ↻", 130, 140);
    }
    c.restore();
}
