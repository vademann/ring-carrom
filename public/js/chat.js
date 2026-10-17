"use strict";
window.RCChat = (() => {
    const root = document.createElement("div");
    root.id = "netChat";
    root.hidden = true;
    root.innerHTML = `<button id="chatToggle" type="button" aria-expanded="false"></button>
        <section id="chatPanel" hidden aria-labelledby="chatTitle">
            <header><strong id="chatTitle"></strong><button id="chatClose" type="button">×</button></header>
            <div id="quickReactions" aria-label="Быстрые фразы"></div>
            <div id="chatMessages" role="log" aria-live="polite" aria-relevant="additions"></div>
            <form id="chatForm"><input id="chatInput" maxlength="300" autocomplete="off" enterkeyhint="send"><button id="chatSend" type="submit"></button></form>
        </section>`;
    document.body.append(root);
    const bubbles=document.createElement("div");
    bubbles.id="chatBubbles"; bubbles.hidden=true;
    const bubbleTimers=[];
    for(let i=0;i<2;i++) {
        const bubble=document.createElement("div");
        bubble.className="avatar-chat-stack";bubble.hidden=true;
        bubble.setAttribute("role","status");bubbles.append(bubble);
    }
    document.body.append(bubbles);
    function positionBubbles() {
        ["#barMid .side:not(.right) .avbig", "#barMid .side.right .avbig"].forEach((selector,i)=>{
            const avatar=document.querySelector(selector);if(!avatar)return;
            const rect=avatar.getBoundingClientRect(), bubble=bubbles.children[i];
            bubble.style.top=(rect.bottom+8)+"px";
            if(i===0)bubble.style.left=Math.max(8,rect.left)+"px";
            else bubble.style.right=Math.max(8,innerWidth-rect.right)+"px";
        });
    }
    window.addEventListener("resize",positionBubbles);
    function showBubble(text, own) {
        const i=own?0:1,bubble=bubbles.children[i];
        const row=document.createElement("div"); row.className="avatar-chat-bubble";
        row.textContent=text.replace(/\s+/g," "); bubble.hidden=false; bubble.append(row);
        while(bubble.children.length>3)bubble.firstElementChild.remove();
        positionBubbles();
        row.addEventListener("animationend",()=>{row.remove();if(!bubble.children.length)bubble.hidden=true;},{once:true});
        setTimeout(()=>{row.remove();if(!bubble.children.length)bubble.hidden=true;},2600);
    }
    const el = id => document.getElementById(id);
    let unread = 0, lastSent = 0;
    const seen = new Set();
    const tr = (ru, en) => I18N.lang === "en" ? en : ru;
    function labels() {
        el("quickReactions").setAttribute("aria-label", tr("Быстрые фразы", "Quick reactions"));
        if(!el("quickReactions").children.length) {
            [["Удачи!","Good luck!"],["Хороший удар!","Nice shot!"],["Спасибо!","Thanks!"],["👍","👍"]].forEach(words=>{
                const button=document.createElement("button");button.type="button";button.dataset.ru=words[0];button.dataset.en=words[1];
                button.onclick=()=>send(tr(words[0],words[1]));el("quickReactions").append(button);
            });
        }
        for(const button of el("quickReactions").children)button.textContent=tr(button.dataset.ru,button.dataset.en);
        el("chatToggle").textContent = tr("Чат", "Chat") + (unread ? ` (${unread})` : "");
        el("chatTitle").textContent = tr("Чат с соперником", "Opponent chat");
        el("chatClose").setAttribute("aria-label", tr("Закрыть чат", "Close chat"));
        el("chatInput").placeholder = tr("Сообщение…", "Message…");
        el("chatInput").setAttribute("aria-label", tr("Сообщение сопернику", "Message to opponent"));
        el("chatSend").textContent = tr("Отправить", "Send");
    }
    function open(value) {
        el("chatPanel").hidden = !value;
        el("chatToggle").setAttribute("aria-expanded", String(value));
        if (value) { unread = 0; el("chatMessages").scrollTop = el("chatMessages").scrollHeight; }
        else el("chatInput").blur();
        labels();
    }
    function append(text, name, own) {
        showBubble(text, own);
        const row = document.createElement("div");
        row.className = own ? "chat-message own" : "chat-message";
        const author = document.createElement("b"), body = document.createElement("span");
        author.textContent = name; body.textContent = text;
        row.append(author, body); el("chatMessages").append(row);
        while (el("chatMessages").children.length > 100) el("chatMessages").firstElementChild.remove();
        el("chatMessages").scrollTop = el("chatMessages").scrollHeight;
        if (!own && el("chatPanel").hidden) { unread++; labels(); }
    }
    el("chatToggle").onclick = () => open(el("chatPanel").hidden);
    el("chatClose").onclick = () => open(false);
    el("chatPanel").addEventListener("keydown", event => {
        if (event.key === "Escape") { open(false); el("chatToggle").focus(); }
        event.stopPropagation();
    });
    function send(text) {
        if (!text || mode !== "online" || (lastSent>0 && performance.now() - lastSent < 1000)) return;
        if (NET === RCNet && !RCNet.connected) { showToast(I18N.t("netRestoring")); return; }
        lastSent = performance.now();
        NET.send({ t: "chat", id: Date.now().toString(36) + Math.random().toString(36).slice(2, 12), text });
        append(text, localProfile().name, true);
        return true;
    }
    el("chatForm").onsubmit = event => {
        event.preventDefault();
        if(send(el("chatInput").value.trim().slice(0,300)))
        el("chatInput").value = "";
    };
    return {
        refresh: labels,
        positionBubbles,
        closeIfOpen() { if (root.hidden || el("chatPanel").hidden) return false; open(false); return true; },
        visibility(visible) { root.hidden = !visible; bubbles.hidden=!visible; if (!visible) open(false); labels(); positionBubbles(); },
        reset() { seen.clear(); unread = 0; lastSent = 0; el("chatMessages").replaceChildren(); el("chatInput").value = ""; open(false); [...bubbles.children].forEach((b,i)=>{b.hidden=true;b.replaceChildren();clearTimeout(bubbleTimers[i]);}); },
        receive(msg) {
            if (mode !== "online" || typeof msg.id !== "string" || msg.id.length > 64 || typeof msg.text !== "string" || !msg.text.trim() || msg.text.length > 300 || seen.has(msg.id)) return;
            seen.add(msg.id); if (seen.size > 200) seen.delete(seen.values().next().value);
            append(msg.text, opponentProfile ? opponentProfile.name : tr("Соперник", "Opponent"), false);
        }
    };
})();
