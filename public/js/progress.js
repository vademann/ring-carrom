"use strict";
window.RCProgress=(()=>{
    const el=id=>document.getElementById(id), tr=(ru,en)=>I18N.lang==="en"?en:ru;
    const read=(key,fallback)=>{try{return JSON.parse(RCStore.get(key))||fallback;}catch(e){return fallback;}};
    let current="", questTab='daily', careerData=read("rc_career",null), botGames=new WeakSet();
    const weeklyTasks=[{key:'potted',ru:'Забейте 30 фишек',en:'Pocket 30 pieces',target:30,reward:50},{key:'online',ru:'Завершите 5 сетевых матчей',en:'Finish 5 online matches',target:5,reward:75},{key:'wins',ru:'Выиграйте 3 партии',en:'Win 3 matches',target:3,reward:60}];
    const achievements=[{key:'first_win',stat:'wins',target:1,ru:'Первая победа',en:'First victory',coins:20,xp:20},{key:'ten_wins',stat:'wins',target:10,ru:'Десять побед',en:'Ten victories',coins:100,xp:50},{key:'hundred_pieces',stat:'potted',target:100,ru:'Точный удар',en:'Sharp shooter',coins:100,xp:50},{key:'online_debut',stat:'online',target:1,ru:'Сетевой дебют',en:'Online debut',coins:20,xp:20}];
    function weekId(){const d=new Date();d.setHours(12,0,0,0);d.setDate(d.getDate()-(d.getDay()+6)%7);return d.toLocaleDateString('sv');}
    function weekly(){const saved=read('rc_weekly',{}),week=weekId();return saved.week===week?saved:{week,potted:0,online:0,wins:0,claimed:[]};}
    function lifetime(){return read('rc_lifetime',{potted:0,wins:0,online:0,claimed:[]});}
    function counters(kind,amount,extra={}){const d=daily(),w=weekly(),life=lifetime();d[kind]=(d[kind]||0)+amount;w[kind]=(w[kind]||0)+amount;life[kind]=(life[kind]||0)+amount;RCStore.commit({...extra,rc_quests:JSON.stringify(d),rc_weekly:JSON.stringify(w),rc_lifetime:JSON.stringify(life)});if(current==='quests')renderQuests();}
    function navigation(){const nav=document.createElement('div');nav.className='progress-buttons';for(const [id,ru,en] of [['daily','Сегодня','Today'],['weekly','Неделя','Week'],['achievements','Достижения','Achievements']]){const b=document.createElement('button');b.className='friend-action'+(questTab===id?' primary':'');b.id='progressTab-'+id;b.textContent=tr(ru,en);b.onclick=()=>{questTab=id;renderQuests();};nav.append(b);}el('progressBody').append(nav);}
    function unlockCosmetics(){const level=RCLevel.state().level,values={};for(const [kind,items] of [['themes',[[3,1],[5,2]]],['pucks',[[2,1],[4,2]]]]){const owned=read('rc_own_'+kind,[0]);for(const [minimum,id] of items)if(level>=minimum&&!owned.includes(id))owned.push(id);values['rc_own_'+kind]=JSON.stringify(owned);}RCStore.commit(values);}
    function renderExtra(){
        el('progressTitle').textContent=tr('Задания и достижения','Quests and achievements');el('progressBody').replaceChildren();navigation();
        const data=questTab==='weekly'?weekly():lifetime(),entries=questTab==='weekly'?weeklyTasks:achievements;
        const note=document.createElement('p');note.textContent=questTab==='weekly'?tr('Новая неделя начинается в понедельник.','A new week starts on Monday.'):tr('Достижения сохраняются. За уровни 2 и 4 открываются фишки, за 3 и 5 — столы.','Achievements persist. Levels 2 and 4 unlock pieces; levels 3 and 5 unlock boards.');el('progressBody').append(note);
        for(const task of entries){const row=document.createElement('div');row.className='quest-row';const label=document.createElement('span'),b=document.createElement('button');b.className='btn';const key=task.key,stat=task.stat||key;label.textContent=tr(task.ru,task.en)+` · ${Math.min(data[stat]||0,task.target)}/${task.target}`;b.disabled=data.claimed.includes(key)||(data[stat]||0)<task.target;b.textContent=data.claimed.includes(key)?tr('Получено','Claimed'):`+${task.reward||task.coins} 💎${task.xp?' · +'+task.xp+' XP':''}`;
            b.onclick=()=>{try{const value=questTab==='weekly'?weekly():lifetime();if(value.claimed.includes(key)||(value[stat]||0)<task.target)return;value.claimed.push(key);RCStore.reward((questTab==='weekly'?'weekly:'+value.week:'achievement')+':'+key,task.reward||task.coins,task.xp||0,{[questTab==='weekly'?'rc_weekly':'rc_lifetime']:JSON.stringify(value)});unlockCosmetics();renderCoins();refreshHomeProfile();renderQuests();showToast(tr('Награда получена','Reward claimed'));}catch(_){showToast(tr('Не удалось сохранить награду. Освободите место и повторите.','Could not save the reward. Free some space and retry.'));}};
            row.append(label,b);el('progressBody').append(row);
        }
    }
    const tasks=[
        {key:"potted",ru:"Забейте 3 фишки",en:"Pocket 3 pieces",target:3,reward:10},
        {key:"online",ru:"Завершите сетевую партию",en:"Finish an online match",target:1,reward:15},
        {key:"wins",ru:"Выиграйте партию",en:"Win a match",target:1,reward:20}
    ];
    function daily(){
        const date=new Date().toLocaleDateString("sv"), saved=read("rc_quests",{});
        return saved.date===date?saved:{date,potted:0,online:0,wins:0,claimed:[]};
    }
    function saveDaily(value){RCStore.set("rc_quests",JSON.stringify(value));if(current==="quests")renderQuests();}
    function renderQuests(){
        if(questTab!=='daily'){renderExtra();return;}
        const data=daily();el("progressTitle").textContent=tr("Ежедневные задания","Daily quests");
        el("progressBody").replaceChildren();
        navigation();
        const description=document.createElement("p");description.textContent=tr("Обновляются в полночь. Награды — в алмазах.","Reset at midnight. Rewards are diamonds.");el("progressBody").append(description);
        for(const task of tasks){
            const row=document.createElement("div");row.className="quest-row";
            const label=document.createElement("span"),button=document.createElement("button");button.className="btn";
            label.textContent=tr(task.ru,task.en)+` · ${Math.min(data[task.key]||0,task.target)}/${task.target}`;
            const claimed=data.claimed.includes(task.key);button.disabled=claimed || (data[task.key]||0)<task.target;
            button.textContent=claimed?tr("Получено","Claimed"):`+${task.reward} 💎`;
            button.onclick=()=>{
                const latest=daily();if(latest.claimed.includes(task.key)||(latest[task.key]||0)<task.target)return;
                try{latest.claimed.push(task.key);RCStore.reward('quest:'+latest.date+':'+task.key,task.reward,0,{rc_quests:JSON.stringify(latest)});renderCoins();renderQuests();showToast(tr("Награда получена","Reward claimed"));}catch(_){showToast(tr('Не удалось сохранить награду. Освободите место и повторите.','Could not save the reward. Free some space and retry.'));}
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
        try{careerData=await RCNet.career();RCStore.set("rc_career",JSON.stringify(careerData));if(current==="career")renderCareer();}
        catch(e){if(current==="career")renderCareer(tr("Нет связи. Показаны сохранённые данные.","Offline. Showing saved data."));}
    };
    el("progressClose").onclick=()=>{current="";el("progressOv").classList.remove("open");};
    el("progressOv").onclick=e=>{if(e.target===el("progressOv"))el("progressClose").click();};
    return {
        shot(potted,mode){if(mode==="tutorial")return;counters('potted',Math.max(0,potted));},
        botWin(){if(botGames.has(world))return;counters('wins',1);botGames.add(world);unlockCosmetics();},
        unlockCosmetics,
        showResult(msg,index){const reward=msg.reward||{coins:0,xp:0};const detail=document.createElement('p');detail.id='onlineReward';detail.className='friend-muted';const record=msg.career?.history?.find(h=>h.game===msg.id);detail.textContent=`+${reward.coins} 💎 · +${reward.xp} XP`+(msg.statsPending?tr(' · Рейтинг ещё сохраняется',' · Rating save pending'):record?` · ${tr('Рейтинг','Rating')} ${msg.career.rating} (${record.delta>=0?'+':''}${record.delta})`:'');el('onlineReward')?.remove();el('overRes').append(detail);window.RCArcade?.decorateResult(msg);},
        result(msg,index){
            if(msg.career&&!msg.statsPending){careerData=msg.career;RCStore.set("rc_career",JSON.stringify(careerData));}
            const seen=read("rc_results",[]);if(!msg.id||seen.includes(msg.id))return;
            // Leaving or never returning is not a completed quest for that player.
            const eligible=msg.winner===index||!["left","disconnect","inactivity"].includes(msg.reason);
            const d=daily(),w=weekly(),life=lifetime();if(eligible){d.online++;w.online++;life.online++;if(msg.winner===index){d.wins++;w.wins++;life.wins++;}}
            const reward=msg.reward||{coins:0,xp:0};
            RCStore.reward('online:'+msg.id,Math.max(0,Math.min(20,reward.coins||0)),Math.max(0,Math.min(30,reward.xp||0)),{rc_results:JSON.stringify([...seen,msg.id].slice(-200)),rc_quests:JSON.stringify(d),rc_weekly:JSON.stringify(w),rc_lifetime:JSON.stringify(life)});
            unlockCosmetics();renderCoins();refreshHomeProfile();
        }
    };
})();
