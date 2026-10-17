"use strict";
window.RCLevel = (() => {
    const perLevel = 100;
    function state() {
        const stored = Number(localStorage.getItem("rc_xp") || 0);
        const total = Number.isSafeInteger(stored) && stored >= 0 ? stored : 0;
        return {total, level: Math.floor(total / perLevel) + 1, xp: total % perLevel, target: perLevel};
    }
    function victory(reward) {
        if (!Number.isSafeInteger(reward) || reward <= 0) return state();
        localStorage.setItem("rc_xp", String(state().total + reward));
        return state();
    }
    return {state, victory};
})();
