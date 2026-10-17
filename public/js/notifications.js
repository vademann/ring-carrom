"use strict";
(() => {
    const native=window.RCNotify, tr=(ru,en)=>I18N.lang==='en'?en:ru;
    let current={}, pendingRoute='';
    const root=document.createElement('section');root.className='friend-account';root.id='notificationSettings';
    document.getElementById('friendAccount').after(root);
    function read(){try{return native?JSON.parse(native.state()):{};}catch(e){return {};}}
    function save(fields){native?.configure(JSON.stringify(fields));refresh();window.RCFriends?.sync();}
    function refresh(){
        current=read();root.replaceChildren();
        const title=document.createElement('h3');title.textContent=tr('Уведомления','Notifications');root.append(title);
        const status=document.createElement('p');status.className='friend-muted';
        status.textContent=!native?tr('Системные уведомления доступны в Android-приложении.','System notifications are available in the Android app.'):
            !current.enabled?tr('Включите уведомления, чтобы не пропускать приглашения и бонус.','Enable notifications for invitations and your daily bonus.'):
            !current.permitted?tr('Разрешите уведомления в настройках Android.','Allow notifications in Android settings.'):
            !current.configured?tr('Напоминание о бонусе работает. Уведомления о друзьях ещё не подключены.','Bonus reminders are ready. Friend push notifications are not connected yet.'):
            tr('Уведомления включены. Доставка зависит от интернета и настроек телефона.','Notifications enabled. Delivery depends on connectivity and phone settings.');
        status.id='notificationStatus';root.append(status);
        if(!native)return;
        const control=document.createElement('button');control.type='button';control.className='friend-action';control.id='notificationEnable';
        control.textContent=current.enabled?(current.permitted?tr('Выключить уведомления','Disable notifications'):tr('Разрешить в Android','Allow in Android')):tr('Включить уведомления','Enable notifications');
        control.onclick=()=>{if(!current.enabled)native.enable();else if(!current.permitted)native.settings();else save({enabled:false});};root.append(control);
        for(const [key,ru,en] of [['invitesEnabled','Приглашения в игру','Game invitations'],['friendsEnabled','Заявки и принятие в друзья','Friend requests and acceptance'],['messagesEnabled','Личные сообщения','Direct messages'],['dailyEnabled','Ежедневный бонус','Daily bonus']]){
            const label=document.createElement('label');label.style.cssText='display:flex;gap:8px;align-items:center;margin-top:10px';
            const input=document.createElement('input');input.type='checkbox';input.id='notify_'+key;input.checked=!!current[key];input.disabled=!current.enabled;
            input.onchange=()=>save({[key]:input.checked});label.append(input,document.createTextNode(tr(ru,en)));root.append(label);
        }
        const hourLabel=document.createElement('label');hourLabel.style.cssText='display:flex;gap:8px;align-items:center;margin-top:10px';hourLabel.textContent=tr('Бонус: время телефона','Bonus: phone time');
        const hour=document.createElement('select');hour.id='notificationHour';hour.disabled=!current.enabled||!current.dailyEnabled;
        for(let n=8;n<=22;n++){const option=document.createElement('option');option.value=String(n);option.textContent=String(n).padStart(2,'0')+':00';option.selected=current.hour===n;hour.append(option);}
        hour.onchange=()=>save({hour:Number(hour.value)});hourLabel.append(hour);root.append(hourLabel);
    }
    function syncLocal(data){
        if(!native||!data)return;
        native.syncLocal(JSON.stringify({identity:data.id,language:I18N.lang,claimed:RCDaily.status().claimed,dnd:data.dnd,
            friends:Object.fromEntries(Object.values(data.contacts).filter(p=>p.friendship).map(p=>[p.id,p.friendship])),
            outgoing:Object.fromEntries(Object.entries(data.outgoing).map(([id,p])=>[id,p.id])),blocked:data.blocked}));
    }
    async function openPending(){
        if(!native)return;pendingRoute=pendingRoute||native.route();if(!pendingRoute)return;
        await window.RCLocalFriends?.ready;
        // Preserve an active match; the notification can be opened after leaving it.
        if(!window.RCFriendGame?.available())return;
        const route=pendingRoute;pendingRoute='';
        document.getElementById('dailyOv').classList.remove('open');
        if(route==='daily'){showScreen('scr-menu');checkDaily();return;}
        window.RCFriends.open();await RCFriends.sync();
        document.getElementById(route==='requests'?'friendTab-requests':'friendTab-friends')?.click();
    }
    window.RCNotifications={refresh,syncLocal,openPending,delivery:()=>{const s=read();return native?{pushToken:s.enabled&&s.permitted?s.token||'':''}:{};},
        inbox:()=>{try{return native?Object.values(JSON.parse(native.inbox())):[];}catch(e){return [];}},
        acknowledge:events=>native?.acknowledge(JSON.stringify(events.map(e=>e.id))),
        notify:(events,id)=>events.forEach(e=>native?.event(JSON.stringify({...e,target:id})))};
    document.addEventListener('visibilitychange',()=>{if(!document.hidden){refresh();openPending();}});
    window.addEventListener('rc-daily-claimed',()=>window.RCLocalFriends?.syncNotifications());
    new MutationObserver(()=>{refresh();window.RCLocalFriends?.syncNotifications();}).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
    refresh();window.RCLocalFriends?.ready.then(()=>window.RCLocalFriends.syncNotifications());setTimeout(openPending,1500);
})();
