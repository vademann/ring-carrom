"use strict";
// ═══════════════════════════════════════════════════════════
//  RCLan — игра по локальной сети Wi-Fi без интернета.
//  В приложении работает через нативный мост window.RCAndroid
//  (TCP-сокет + UDP-объявления для поиска хоста). В браузере —
//  фолбэк на BroadcastChannel (две вкладки одного устройства).
//  Интерфейс совпадает с RCNet: myIndex, onMessage, onStatus,
//  send, destroy — main.js пользуется ими одинаково.
// ═══════════════════════════════════════════════════════════
(function (global) {

const TCP_PORT = 45910;
const UDP_PORT = 45911;       // объявления хоста (TCP_PORT + 1)
const PREFIX_BC = "rcom-lan-";
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const parseNative = value => typeof value === "string" ? JSON.parse(value) : value;

function makeCode() {
    let s = "";
    for (let i = 0; i < 4; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    return s;
}

const lan = {
    peer: null,               // BroadcastChannel или null
    myIndex: 0,
    native: typeof RCAndroid !== "undefined",
    discovered: [],           // IP найденных хостов (нативный режим)
    onMessage: null,          // {t:"start"|"shot"|...}
    onStatus: null,           // "connected" | "closed" | "error:<type>"
    onUi: null,               // события экрана: {ip} | {discovered:[ip]} | {waiting}

    get ready() { return this.native || typeof BroadcastChannel !== "undefined"; },

    emit(kind) { if (this.onStatus) this.onStatus(kind); },
    deliver(msg) { if (this.onMessage) this.onMessage(msg); },
    ui(payload) { if (this.onUi) this.onUi(payload); },

    // ── Нативные события (мост вызывает их из UI-потока) ──
    _nativeEvents() {
        const self = this;
        global.RCAndroidEvents = {
            onHostReady(json) { try { const d = parseNative(json); self.ui({ ip: d.ip }); } catch (e) {} },
            onPeerConnected() { self.emit("connected"); },
            onPeerDisconnected() { self.emit("closed"); },
            onDiscovered(json) {
                try {
                    const d = parseNative(json);
                    if (d.ip && self.discovered.indexOf(d.ip) === -1) {
                        self.discovered.push(d.ip);
                        self.ui({ discovered: self.discovered.slice() });
                    }
                } catch (e) {}
            },
            onMessage(json) {
                try { self.deliver(JSON.parse(json)); } catch (e) {}
            },
            onError(json) {
                try { const d = parseNative(json); self.emit("error:" + (d.type || "lan")); } catch (e) {}
            },
        };
    },

    // Создать игру. onReady({code, ip}) — когда готово ждать соперника.
    host(onReady) {
        if (!this.ready) { this.emit("error:offline"); return; }
        this.destroy();
        this.myIndex = 0;
        this.discovered = [];
        if (this.native) {
            this._nativeEvents();
            RCAndroid.hostStart(TCP_PORT);
        } else {
            const code = makeCode();
            const ch = new BroadcastChannel(PREFIX_BC + code);
            this.peer = ch;
            const seen = new Set();
            ch.onmessage = e => {
                const m = e.data;
                if (!m || typeof m !== "object") return;
                if (m.t === "hello" && !seen.has("hello")) {
                    seen.add("hello");
                    ch.postMessage({ t: "hello-ack" });
                    this.emit("connected");
                    return;
                }
                this.deliver(m);
            };
            this.ui({ code });
            onReady({ code });
        }
    },

    // Подключиться: target — IP хоста (нативно) или код (фолбэк).
    join(target, onReady) {
        if (!this.ready) { this.emit("error:offline"); return; }
        this.destroy();
        this.myIndex = 1;
        this.discovered = [];
        if (this.native) {
            this._nativeEvents();
            const ip = (target || "").trim();
            if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
                RCAndroid.connect(ip, TCP_PORT);
            } else {
                // без адреса — слушаем объявления хостов в сети
                RCAndroid.discoverStart(UDP_PORT);
                this.emit("discovering");
            }
        } else {
            const code = (target || "").trim().toUpperCase();
            if (code.length !== 4) { this.emit("error:badcode"); return; }
            const ch = new BroadcastChannel(PREFIX_BC + code);
            this.peer = ch;
            ch.onmessage = e => {
                const m = e.data;
                if (!m || typeof m !== "object") return;
                if (m.t === "hello-ack") { this.emit("connected"); return; }
                this.deliver(m);
            };
            ch.postMessage({ t: "hello" });
            onReady && onReady();
        }
    },

    send(msg) {
        if (this.peer) { try { this.peer.postMessage(msg); } catch (e) {} return; }
        if (this.native) {
            try { RCAndroid.send(JSON.stringify(msg)); } catch (e) {}
        }
    },

    localIp() {
        if (this.native) { try { return RCAndroid.localIp(); } catch (e) {} }
        return "";
    },

    destroy() {
        if (this.peer) { try { this.peer.close(); } catch (e) {} }
        if (this.native) { try { RCAndroid.stopAll(); } catch (e) {} }
        this.peer = null;
        this.discovered = [];
    },
};

global.RCLan = lan;

})(window);
