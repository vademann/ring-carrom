"use strict";
window.RCProgress=(()=>{
    const el=id=>document.getElementById(id), tr=(ru,en)=>I18N.lang==="en"?en:ru;
    const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))||fallback;}catch(e){return fallback;}};
    let current="", careerData=read("rc_career",null), botGames=new WeakSet();
    const tasks=[
        {key:"potted",ru:"Забейте 3 фишки",en:"Pocket 3 pieces",target:3,reward:10},
        {key:"online",ru:"Завершите сетевую партию",en:"Finish an online match",target:1,reward:15},
        {key:"wins",ru:"Выиграйте партию",en:"Win a match",target:1,reward:20}
    ];
    function daily(){
        const date=new Date().toLocaleDateString("sv"), saved=read("rc_quests",{});
        return saved.date===date?saved:{date,potted:0,online:0,wins:0,claimed:[]};
    }
    function saveDaily(value){localStorage.setItem("rc_quests",JSON.stringify(value));if(current==="quests")renderQuests();}
    function renderQuests(){
        const data=daily();el("progressTitle").textContent=tr("Ежедневные задания","Daily quests");
        el("progressBody").replaceChildren();
        const description=document.createElement("p");description.textContent=tr("Обновляются в полночь. Награды — в алмазах.","Reset at midnight. Rewards are diamonds.");el("progressBody").append(description);
        for(const task of tasks){
            const row=document.createElement("div");row.className="quest-row";
            const label=document.createElement("span"),button=document.createElement("button");button.className="btn";
            label.textContent=tr(task.ru,task.en)+` · ${Math.min(data[task.key]||0,task.target)}/${task.target}`;
            const claimed=data.claimed.includes(task.key);button.disabled=claimed || (data[task.key]||0)<task.target;
            button.textContent=claimed?tr("Получено","Claimed"):`+${task.reward} 💎`;
            button.onclick=()=>{
                const latest=daily();if(latest.claimed.includes(task.key)||(latest[task.key]||0)<task.target)return;
                latest.claimed.push(task.key);saveDaily(latest);addCoins(task.reward);showToast(tr("Награда получена","Reward claimed"));
            };
            row.append(label,button);el("progressBody").append(row);
        }
    }
    function renderCareer(status=""){
        el("progressTitle").textContent=tr("Рейтинг и статистика","Rating and statistics");
        el("progressBody").replaceChildren();
        const caption=document.createElement("p");caption.textContent=status || tr("Сетевые партии через сервер. Профиль привязан к этой установке игры.","Server matches. Profile belongs to this installation.");el("progressBody").append(caption);
        if(!careerData)return;
        const d=careerData;
        const values=[ [tr("Рейтинг","Rating"),d.rating],[tr("Победы / поражения / ничьи","Wins / losses / draws"),`${d.wins} / ${d.losses} / ${d.draws}`],
            [tr("Серия побед / лучшая","Win streak / best"),`${d.streak} / ${d.best}`],[tr("Результативные удары","Scoring shots"),d.shots?Math.round(d.hits/d.shots*100)+"%":"—"] ];
        for(const [label,value] of values){const row=document.createElement("div");row.className="stat-row";const name=document.createElement("span"),v=document.createElement("b");name.textContent=label;v.textContent=value;row.append(name,v);el("progressBody").append(row);}
        const title=document.createElement("h3");title.textContent=tr("Последние матчи","Recent matches");el("progressBody").append(title);
        const results={win:tr("Победа","Win"),loss:tr("Поражение","Loss"),draw:tr("Ничья","Draw")};
        for(const m of d.history||[]){const row=document.createElement("div");row.className="history-row";row.textContent=`${results[m.result]} · ${m.opponent} · ${m.delta>=0?"+":""}${m.delta} · ${new Date(m.at).toLocaleDateString()}`;el("progressBody").append(row);}
        if(!d.history?.length){const empty=document.createElement("p");empty.textContent=tr("Здесь появятся завершённые матчи.","Completed matches will appear here.");el("progressBody").append(empty);}
    }
    el("btnQuests").onclick=()=>{current="quests";renderQuests();el("progressOv").classList.add("open");};
    el("btnCareer").onclick=async()=>{
        current="career";renderCareer(tr("Обновляем статистику…","Updating statistics…"));el("progressOv").classList.add("open");
        try{careerData=await RCNet.career();localStorage.setItem("rc_career",JSON.stringify(careerData));if(current==="career")renderCareer();}
        catch(e){if(current==="career")renderCareer(tr("Нет связи. Показаны сохранённые данные.","Offline. Showing saved data."));}
    };
    el("progressClose").onclick=()=>{current="";el("progressOv").classList.remove("open");};
    el("progressOv").onclick=e=>{if(e.target===el("progressOv"))el("progressClose").click();};
    return {
        shot(potted,mode){if(mode==="tutorial")return;const d=daily();d.potted=Math.min(3,d.potted+Math.max(0,potted));saveDaily(d);},
        botWin(){if(botGames.has(world))return;botGames.add(world);const d=daily();d.wins=1;saveDaily(d);},
        result(msg,index){
            if(msg.career){careerData=msg.career;localStorage.setItem("rc_career",JSON.stringify(careerData));}
            const seen=read("rc_results",[]);if(!msg.id||seen.includes(msg.id))return;
            localStorage.setItem("rc_results",JSON.stringify([...seen,msg.id].slice(-200)));
            // Leaving or never returning is not a completed quest for that player.
            if(msg.winner!==index && ["left","disconnect","inactivity"].includes(msg.reason))return;
            const d=daily();d.online=1;if(msg.winner===index)d.wins=1;saveDaily(d);
        }
    };
})();
