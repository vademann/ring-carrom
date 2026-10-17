"use strict";
// Local calendar dates are converted to day numbers so DST cannot break a streak.
window.RCDaily = (() => {
    const rewards = Object.freeze([10, 15, 20, 25, 30, 40, 50]);
    function dayNumber(date = new Date()) {
        return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
    }
    function load() {
        try {
            const value = JSON.parse(localStorage.getItem("rc_login_rewards"));
            if (value && Number.isInteger(value.lastDay) && Number.isInteger(value.day) && value.day >= 1 && value.day <= 7) return value;
        } catch (_) {}
        // Preserve an already claimed legacy reward on the migration day.
        const legacy = localStorage.getItem("rc_daily");
        if (/^\d{4}-\d{2}-\d{2}$/.test(legacy || "")) {
            const [y, m, d] = legacy.split("-").map(Number);
            return {lastDay: Math.floor(Date.UTC(y, m - 1, d) / 86400000), day: 1};
        }
        return null;
    }
    function status(date = new Date()) {
        const today = dayNumber(date), saved = load();
        const claimed = !!saved && saved.lastDay >= today;
        const day = claimed ? saved.day : saved && saved.lastDay === today - 1 ? saved.day % 7 + 1 : 1;
        return {today, day, claimed, reward: rewards[day - 1]};
    }
    function claim(date = new Date()) {
        const state = status(date);
        if (state.claimed) return 0;
        // Record the claim before updating the balance to reject repeat clicks.
        const balance = localStorage.getItem("rc_coins");
        localStorage.setItem("rc_login_rewards", JSON.stringify({lastDay:state.today, day:state.day}));
        localStorage.setItem("rc_coins", String((balance === null ? 500 : Number(balance) || 0) + state.reward));
        window.dispatchEvent(new Event('rc-daily-claimed'));
        return state.reward;
    }
    return {rewards, status, claim, dayNumber};
})();
