"use strict";
(() => {
    const el = id => document.getElementById(id);
    const tr = (ru,en) => I18N.lang === 'en' ? en : ru;
    const state = {data:null, tab:'friends', results:null, query:'', online:false, favorites:false,
        busy:false, syncing:false, connected:false, revision:0, dialog:null, messages:[], drafts:{}, selected:null, outgoing:null, pendingMessage:null, muted:new Set()};
    const errors = {
        login_format:['Логин: 3–20 символов, латинские буквы, цифры и _. Начните с буквы.','Use 3–20 letters, digits or _. Start with a Latin letter.'],
        login_taken:['Этот логин уже занят. Выберите другой.','This username is already taken.'],
        search_format:['Введите минимум 3 символа логина.','Enter at least 3 username characters.'],
        user_not_found:['Игрок не найден.','Player not found.'], blocked:['Действие недоступно: игрок заблокирован.','This player is blocked.'],
        not_friends:['Сначала добавьте игрока в друзья.','Add this player as a friend first.'],
        rate_limit:['Слишком много действий. Попробуйте через минуту.','Too many actions. Try again in a minute.'],
        friend_limit:['Достигнут лимит: 100 друзей.','The 100-friend limit has been reached.'], request_limit:['Сначала отмените лишние исходящие заявки.','Cancel some outgoing requests first.'],
        offline:['Друг сейчас не в сети.','Your friend is offline.'],dnd:['Друг включил «Не беспокоить».','Your friend enabled Do not disturb.'],
        busy:['Игрок уже занят. Попробуйте позже.','The player is busy. Try later.'],
        room_unavailable:['Не удалось подготовить комнату. Повторите приглашение.','Could not prepare the room. Try again.'],
        invite_expired:['Приглашение больше не действует.','This invitation is no longer available.'],
        message_format:['Введите сообщение до 300 символов.','Enter a message of up to 300 characters.'],
        network:['Нет связи с сервером. Проверьте интернет и нажмите «Обновить».','Cannot reach the server. Check your connection and tap Refresh.']
    };
    errors.storage_full=['На телефоне недостаточно места для сохранения друзей.','Not enough local storage to save friends.'];
    errors.queue_full=['Очередь отправки заполнена. Дождитесь доставки сообщений.','The sending queue is full. Wait for messages to be delivered.'];
    errors.request_missing=['Заявка уже отменена или обработана.','This request was cancelled or already handled.'];
    function errorText(error) { return (errors[error.message] || errors.network)[I18N.lang === 'en' ? 1 : 0]; }
    function node(tag, cls, text) { const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n; }
    function button(text, action, cls='') { const b=node('button','friend-action '+cls,text);b.type='button';b.disabled=state.busy;b.onclick=action;return b; }
    function notice(text, bad=false) { el('friendsStatus').textContent=text;el('friendLoginStatus').textContent=text;if(bad)showToast(text,3000); }
    async function api(action, fields={}) {
        const value=await RCLocalFriends.request(action,fields);
        state.connected=RCLocalFriends.online;
        return value;
    }
    const root=node('div','screen');root.id='scr-friends';
    root.innerHTML='<div class="friend-bar"><button class="iconbtn" id="friendsBack" aria-label="Назад">‹</button><h2 id="friendsTitle"></h2><button class="friend-action" id="friendsRefresh"></button></div><div class="friend-self"><div><small id="friendsSelfLabel"></small><br><b id="friendsSelfLogin"></b></div><button class="friend-action" id="friendsSelfCopy"></button></div><div class="friend-tabs" role="tablist" id="friendsTabs"></div><div id="friendsStatus" role="status" class="friend-muted"></div><div id="friendsContent" role="tabpanel"></div>';
    document.body.append(root);
    const banner=node('aside');banner.id='friendInviteBanner';banner.hidden=true;banner.setAttribute('aria-live','polite');document.body.append(banner);
    const dialog=node('div','overlay');dialog.id='friendDialog';dialog.innerHTML='<div class="modal friend-dialog" role="dialog" aria-modal="true" aria-labelledby="friendDialogTitle"><button class="xbtn" id="friendDialogClose" aria-label="Закрыть">✕</button><h2 id="friendDialogTitle"></h2><div class="friend-dialog-body" id="friendDialogBody"></div><form class="friend-message-form" id="friendMessageForm"><input id="friendMessageInput" maxlength="300" autocomplete="off"><button class="friend-action primary" id="friendMessageSend" type="submit"></button></form><p class="friend-muted" id="friendDialogStatus" role="status"></p></div>';document.body.append(dialog);
    function setData(data) {
        state.data=data;
        render();
        if(state.outgoing) {
            const inv=data.invites.find(i=>i.sender===data.me.id && i.room===state.outgoing);
            if(inv && ['expired','declined','cancelled'].includes(inv.state)) {
                const code=state.outgoing;state.outgoing=null;window.RCFriendGame.cancel(code);
                notice(tr('Приглашение завершено: друг отказался или истекло время.','Invitation ended: declined or timed out.'));
            } else if(inv?.state==='joined')state.outgoing=null;
        }
    }
    async function sync() {
        if(state.syncing || state.busy)return;
        state.syncing=true;
        const revision=state.revision;
        try {
            const activity=el('scr-game').classList.contains('active')?'in_game':
                (el('scr-online').classList.contains('active') && (el('lanHost').style.display==='flex'||el('lanJoin').style.display==='flex')?'waiting':'online');
            const data=await api('sync',{...localProfile(),active:!document.hidden,activity});
            if(revision!==state.revision)return;
            setData(data);
            el('friendsStatus').textContent=(data.relayOnline?tr('Обмен подключён','Relay connected'):tr('Офлайн: данные сохранены на телефоне','Offline: data is saved on this phone'))+
                (data.queued?tr(' · ждут отправки: ',' · queued: ')+data.queued:'');
            if(state.dialog==='chat')await loadMessages();
        }catch(error){el('friendsStatus').textContent=errorText(error);el('friendLoginStatus').textContent=errorText(error);render();}
        finally{state.syncing=false;}
    }
    async function run(action, fields={}, done) {
        if(state.busy)return;
        state.busy=true;
        state.revision++;
        const controls=[...document.querySelectorAll('#scr-friends button:not(#friendsBack),#friendInviteBanner button,#friendLoginSave,#friendDnd')].map(b=>[b,b.disabled]);
        controls.forEach(([b])=>b.disabled=true);
        try {
            const data=await api(action,fields);
            if(data.me)setData(data);
            if(done)await done(data);
            notice(state.data?.queued?tr('Сохранено на телефоне. Ждёт доставки: ','Saved on this phone. Queued: ')+state.data.queued:tr('Готово','Done'));
        }catch(error){notice(errorText(error),true);}
        finally{state.busy=false;controls.forEach(([b,disabled])=>b.disabled=disabled);render();}
    }
    function statusText(p) {
        if(!state.connected)return tr('Статус не обновлён: нет связи','Status unavailable: disconnected');
        const labels={online:['В сети','Online'],offline:['Не в сети','Offline'],in_game:['В игре','In a game'],waiting:['Ожидает соперника','Waiting for opponent'],dnd:['Не беспокоить','Do not disturb']};
        if(p.status==='offline' && p.lastSeen) {
            return tr('Был(а): ','Last seen: ')+new Date(p.lastSeen*1000).toLocaleString(I18N.lang==='en'?'en-GB':'ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
        }
        return (labels[p.status]||labels.offline)[I18N.lang==='en'?1:0];
    }
    function person(p) {
        const row=node('div','friend-person'), img=node('img');img.src=RND.avatarURL(p.avatar,64);img.alt='';
        const info=node('div');info.append(node('b','',p.name),node('small','','@'+p.login+' · '+p.id.slice(0,8)),node('small',state.connected&&p.status!=='offline'?'friend-online':'',statusText(p)));
        row.append(img,info);return row;
    }
    function confirmAction(p,action,text) {
        openDialog('confirm',p);el('friendDialogBody').append(node('p','',text));
        el('friendDialogBody').append(button(tr('Подтвердить','Confirm'),()=>run(action,{target:p.id},()=>closeDialog()),'danger'));
    }
    function card(p) {
        const c=node('article','friend-card');c.append(person(p));const actions=node('div','friend-actions');c.append(actions);
        const act=(text,fn,cls)=>actions.append(button(text,fn,cls));
        if(p.relationship==='blocked') {
            act(tr('Разблокировать','Unblock'),()=>run('unblock',{target:p.id}));return c;
        }
        act(tr('Профиль','Profile'),()=>viewProfile(p));
        if(p.relationship==='friend') {
            act(tr('Пригласить','Invite'),()=>invite(p),'primary');actions.lastChild.disabled=state.busy || !state.connected || !(p.status==='online'||(p.status==='offline'&&state.data.pushAvailable));
            const unread=state.data.unread[p.id]||0;
            act(tr('Сообщения','Messages')+(unread?' ('+unread+')':''),()=>openChat(p));
            act(p.favorite?tr('Убрать из избранного','Unfavorite'):tr('В избранное','Favorite'),()=>run('favorite',{target:p.id,enabled:!p.favorite}));
            act(tr('Удалить','Remove'),()=>confirmAction(p,'remove',tr('Удалить игрока из друзей?','Remove this friend?')),'danger');
        }else if(p.relationship==='incoming') {
            act(tr('Принять','Accept'),()=>run('accept',{target:p.id}),'primary');
            act(tr('Отклонить','Decline'),()=>run('decline',{target:p.id}));
        }else if(p.relationship==='outgoing') {
            act(tr('Отменить заявку','Cancel request'),()=>run('cancel_request',{target:p.id}));
        }else act(tr('Добавить','Add friend'),()=>run('request',{target:p.id}),'primary');
        act(tr('Заблокировать','Block'),()=>confirmAction(p,'block',tr('Заблокировать игрока? Дружба и заявки будут удалены.','Block this player? Friendship and requests will be removed.')),'danger');
        return c;
    }
    function list(users,empty) {
        const l=node('div','friend-list');users.forEach(p=>l.append(card(p)));if(!users.length)l.append(node('p','friend-empty',empty));return l;
    }
    function render() {
        const d=state.data;
        el('friendsMenuLabel').textContent=tr('Друзья','Friends');el('friendsTitle').textContent=tr('Друзья','Friends');
        el('friendsRefresh').textContent=tr('Обновить','Refresh');el('friendsRefresh').disabled=state.busy;
        el('friendsSelfLabel').textContent=tr('Ваш логин · код друга','Your username · friend code');el('friendsSelfLogin').textContent=d?'@'+d.me.login+' · '+d.me.id.slice(0,8):tr('Загрузка…','Loading…');
        el('friendsSelfCopy').textContent=tr('Копировать код','Copy code');el('friendsSelfCopy').disabled=!d;
        const badges=d?d.incoming.length+Object.values(d.unread).reduce((a,b)=>a+b,0)+d.invites.filter(i=>i.receiver===d.me.id&&i.state==='pending').length:0;
        el('friendsBadge').hidden=!badges;el('friendsBadge').textContent=badges>99?'99+':badges;
        el('friendLoginLabel').textContent=tr('Логин для поиска друзей','Username for friend search');
        el('friendLoginSave').textContent=tr('Сохранить','Save');el('friendLoginSave').disabled=state.busy || !d;
        if(d && document.activeElement!==el('friendLogin'))el('friendLogin').value=d.me.login;
        el('friendLoginHelp').textContent=tr('3–20 символов: a–z, цифры и _. Логины могут совпадать; код друга уникален.','3–20 characters: a–z, digits and _. Usernames may repeat; friend codes are unique.');
        el('friendGuestHelp').textContent=tr('Друзья и переписка хранятся только на телефоне. Сервер пересылает события между открытыми приложениями. При очистке данных доступ потеряется.','Friends and messages are stored only on your phone. The relay forwards events between open apps. Clearing data loses access.');
        el('friendDndLabel').textContent=tr('Не беспокоить: без приглашений','Do not disturb: no invitations');el('friendDnd').checked=!!d?.dnd;el('friendDnd').disabled=state.busy||!d;
        el('friendLoginCopy').textContent=tr('Копировать код друга','Copy friend code');el('friendLoginCopy').disabled=!d;
        el('friendMessageInput').placeholder=tr('Сообщение другу…','Message your friend…');el('friendMessageSend').textContent=tr('Отправить','Send');
        const tabs=el('friendsTabs');tabs.replaceChildren();
        [['friends',tr('Друзья','Friends')],['requests',tr('Заявки','Requests')+(d?.incoming.length?' ('+d.incoming.length+')':'')],['search',tr('Поиск','Search')],['recent',tr('Недавние','Recent')],['blocked',tr('Блокировка','Blocked')]].forEach(([id,title])=>{
            const b=button(title,()=>{state.tab=id;render();});b.setAttribute('role','tab');b.setAttribute('aria-selected',state.tab===id);b.id='friendTab-'+id;b.setAttribute('aria-controls','friendsContent');tabs.append(b);
        });
        el('friendsContent').setAttribute('aria-labelledby','friendTab-'+state.tab);
        // Keep live text input and keyboard intact during background refreshes.
        if(state.tab==='search' && el('friendSearchInput') && document.activeElement===el('friendSearchInput')) {renderBanner();return;}
        const content=el('friendsContent'),scroll=content.dataset.tab===state.tab?content.scrollTop:0;
        content.dataset.tab=state.tab;content.replaceChildren();
        if(!d){content.append(node('p','friend-empty',tr('Подключитесь к интернету, чтобы загрузить друзей.','Connect to the internet to load your friends.')));renderBanner();return;}
        if(state.tab==='friends') {
            const filters=node('div','friend-filter');
            [[tr('Только в сети','Online only'),'online'],[tr('Избранные','Favorites'),'favorites']].forEach(([label,key])=>{
                const l=node('label'),input=node('input');input.type='checkbox';input.checked=state[key];input.onchange=()=>{state[key]=input.checked;render();};l.append(input,node('span','',label));filters.append(l);
            });content.append(filters);
            const friends=d.friends.filter(p=>(!state.online||p.status!=='offline')&&(!state.favorites||p.favorite)).sort((a,b)=>Number(b.favorite)-Number(a.favorite)||Number(a.status==='offline')-Number(b.status==='offline')||a.name.localeCompare(b.name));
            content.append(node('p','friend-muted',`${d.friends.length} / 100 · `+tr('друзей','friends')),list(friends,tr('Пока никого. Найдите друга по логину во вкладке «Поиск».','No friends yet. Find someone by username in Search.')));
        }else if(state.tab==='requests') {
            renderInvites(content);
            content.append(node('h3','friend-section-title',tr('Входящие','Incoming')),list(d.incoming,tr('Нет входящих заявок','No incoming requests')),node('h3','friend-section-title',tr('Отправленные','Sent')),list(d.outgoing,tr('Нет отправленных заявок','No sent requests')));
        }else if(state.tab==='search') {
            const form=node('form','friend-search-row');form.id='friendSearchForm';const input=node('input');input.id='friendSearchInput';input.value=state.query;input.placeholder=tr('Логин или код друга','Username or friend code');input.maxLength=100;input.autocapitalize='none';input.autocomplete='off';input.spellcheck=false;input.setAttribute('aria-label',tr('Логин или код друга','Username or friend code'));input.oninput=()=>state.query=input.value;
            const submit=button(tr('Найти','Find'),null,'primary');submit.type='submit';form.append(input,submit);
            form.onsubmit=e=>{e.preventDefault();run('search',{query:state.query},data=>{state.results=data.results;input.blur();});};
            content.append(form,node('p','friend-muted',tr('По логину ищем игроков онлайн (от 3 символов). Код друга можно вставить и без интернета: заявка дождётся подключения обоих игроков.','Username search finds online players (3+ characters). A friend code also works offline: requests wait until both players connect.')));
            if(state.results!==null)content.append(list(state.results.map(p=>{
                const updated=[...d.friends,...d.incoming,...d.outgoing,...d.blocked].find(x=>x.id===p.id);return updated||{...p,relationship:'none'};
            }),tr('Игроки не найдены','No players found')));
        }else if(state.tab==='recent')content.append(list(d.recent,tr('Здесь появятся соперники после подключения к онлайн-матчу.','Your opponents will appear here after joining online matches.')));
        else content.append(list(d.blocked,tr('Заблокированных игроков нет','No blocked players')));
        content.scrollTop=scroll;renderBanner();
    }
    function findUser(id){return state.data && [...state.data.friends,...state.data.incoming,...state.data.outgoing,...state.data.recent].find(p=>p.id===id);}
    function renderInvites(content) {
        const d=state.data, invitations=d.invites.filter(i=>i.state==='pending'||i.state==='accepted');
        if(!invitations.length)return;
        content.append(node('h3','friend-section-title',tr('Приглашения в игру','Game invitations')));
        invitations.forEach(i=>{
            const incoming=i.receiver===d.me.id,p=findUser(incoming?i.sender:i.receiver);if(!p)return;
            const card=node('article','friend-card');card.append(node('b','',p.name+' · '+Math.max(0,i.expires-Math.floor(Date.now()/1000))+tr(' сек.',' sec.')));
            const a=node('div','friend-actions');card.append(a);
            if(incoming && i.state==='pending') {
                a.append(button(tr('Принять','Accept'),()=>acceptInvite(i,p),'primary'),button(tr('Отклонить','Decline'),()=>run('decline_invite',{target:p.id,invite:i.id})));
            }else if(!incoming)a.append(button(tr('Отменить приглашение','Cancel invitation'),()=>run('cancel_invite',{target:p.id,invite:i.id},()=>{window.RCFriendGame.cancel(i.room);state.outgoing=null;})));
            content.append(card);
        });
    }
    function renderBanner() {
        const d=state.data;
        const inv=d?.invites.find(i=>i.receiver===d.me.id&&i.state==='pending'&&i.expires*1000>Date.now()&&!state.muted.has(i.id));
        banner.replaceChildren();banner.hidden=!inv||!state.connected||d.dnd;
        if(banner.hidden)return;
        const p=findUser(inv.sender);if(!p){banner.hidden=true;return;}
        banner.append(node('p','',p.name+tr(' приглашает вас сыграть',' invites you to play')));
        const actions=node('div','friend-actions');
        actions.append(button(tr('Принять','Accept'),()=>acceptInvite(inv,p),'primary'),button(tr('Отклонить','Decline'),()=>run('decline_invite',{target:p.id,invite:inv.id})),button(tr('Скрыть','Hide'),()=>{state.muted.add(inv.id);renderBanner();}));
        actions.firstChild.disabled=state.busy || !window.RCFriendGame.available();banner.append(actions);
    }
    async function invite(p) {
        if(!window.RCFriendGame.available()){notice(tr('Завершите текущую игру или поиск соперника.','Finish the current game or matchmaking first.'),true);return;}
        await run('profile',{target:p.id},async()=>{
            closeDialog();const room=await window.RCFriendGame.host();
            try {setData(await api('invite',{target:p.id,token:room.token}));state.outgoing=room.code;}
            catch(error){window.RCFriendGame.cancel(room.code);throw error;}
        });
    }
    async function acceptInvite(inv,p) {
        if(!window.RCFriendGame.available()){notice(tr('Завершите текущую игру или поиск соперника.','Finish the current game or matchmaking first.'),true);return;}
        await run('accept_invite',{target:p.id,invite:inv.id},data=>{closeDialog();banner.hidden=true;window.RCFriendGame.join(data.code);});
    }
    function openDialog(kind,p) {
        if(state.dialog==='chat'&&state.selected)state.drafts[state.selected.id]=el('friendMessageInput').value;
        state.dialog=kind;state.selected=p;el('friendDialogTitle').textContent=p.name+' · @'+p.login;
        el('friendDialogBody').replaceChildren();el('friendDialogStatus').textContent='';el('friendMessageForm').hidden=kind!=='chat';dialog.classList.add('open');
        if(kind==='chat')el('friendMessageInput').value=state.drafts[p.id]||'';
    }
    function closeDialog() {if(state.dialog==='chat'&&state.selected)state.drafts[state.selected.id]=el('friendMessageInput').value;state.dialog=null;state.selected=null;dialog.classList.remove('open');}
    async function viewProfile(p) {
        await run('profile',{target:p.id},data=>{
            openDialog('profile',p);const body=el('friendDialogBody');body.append(person(data.profile));
            body.append(node('p','friend-muted',tr('Уровень: ','Level: ')+(data.profile.level||1)));
            const s=data.stats;
            if(s)body.append(node('p','friend-section-title',tr('Рейтинг: ','Rating: ')+s.rating),node('p','friend-muted',tr('Победы / поражения / ничьи: ','Wins / losses / draws: ')+`${s.wins} / ${s.losses} / ${s.draws}`));
        });
    }
    async function openChat(p) {openDialog('chat',p);await loadMessages();}
    async function loadMessages() {
        const p=state.selected;if(!p||state.dialog!=='chat'||document.hidden)return;
        try {
            const data=await api('conversation',{target:p.id});if(state.selected?.id!==p.id||state.dialog!=='chat')return;
            const body=el('friendDialogBody');
            const pinned=body.scrollHeight-body.scrollTop-body.clientHeight<45;
            const scroll=body.scrollTop;
            if(JSON.stringify(data.messages)!==JSON.stringify(state.messages)||body.childElementCount===0) {
                state.messages=data.messages;body.replaceChildren();
                for(const m of data.messages){const item=node('div','friend-message'+(m.sender===state.data.me.id?' own':''),m.text);item.append(node('time','',new Date(m.at*1000).toLocaleTimeString(I18N.lang==='en'?'en-GB':'ru-RU',{hour:'2-digit',minute:'2-digit'})+(m.sender===state.data.me.id?(m.seen?tr(' · прочитано',' · read'):m.delivery==='expired'?tr(' · не доставлено: истёк срок',' · delivery expired'):m.delivery==='queued'?tr(' · ждёт отправки',' · queued'):tr(' · доставлено',' · delivered')):'')));body.append(item);}
                if(!data.messages.length)body.append(node('p','friend-empty',tr('Напишите первое сообщение','Send the first message')));
                body.scrollTop=pinned?body.scrollHeight:scroll;
            }
            delete state.data.unread[p.id];render();
        }catch(error){el('friendDialogStatus').textContent=errorText(error);}
    }
    el('friendMessageForm').onsubmit=async e=>{
        e.preventDefault();const input=el('friendMessageInput'),text=input.value.trim(),p=state.selected;if(!p||!text||state.busy)return;
        state.busy=true;el('friendMessageSend').disabled=true;
        if(state.pendingMessage?.target!==p.id||state.pendingMessage.text!==text)state.pendingMessage={target:p.id,text,nonce:crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2)};
        try{await api('message',state.pendingMessage);state.pendingMessage=null;input.value='';await loadMessages();}
        catch(error){el('friendDialogStatus').textContent=errorText(error);}
        finally{state.busy=false;el('friendMessageSend').disabled=false;}
    };
    async function copyLogin() {
        if(!state.data)return;const text=RCLocalFriends.code();
        try {await navigator.clipboard.writeText(text);showToast(tr('Код друга скопирован','Friend code copied'));}
        catch(e){const input=node('textarea');input.value=text;document.body.append(input);input.select();const ok=document.execCommand('copy');input.remove();showToast(ok?tr('Код друга скопирован','Friend code copied'):text);}
    }
    el('btnFriends').onclick=()=>{showScreen('scr-friends');render();sync();};
    el('friendsBack').onclick=()=>showScreen('scr-menu');el('friendsRefresh').onclick=sync;
    el('friendsSelfCopy').onclick=copyLogin;el('friendLoginCopy').onclick=copyLogin;
    el('friendLoginSave').onclick=()=>run('login',{login:el('friendLogin').value});
    el('friendLogin').onkeydown=e=>{if(e.key==='Enter')el('friendLoginSave').click();};
    el('friendDnd').onchange=()=>run('dnd',{enabled:el('friendDnd').checked});
    el('friendDialogClose').onclick=closeDialog;dialog.onclick=e=>{if(e.target===dialog)closeDialog();};
    const back=window.__androidBack;
    window.__androidBack=()=>{if(state.dialog){closeDialog();return true;}if(root.classList.contains('active')){showScreen('scr-menu');return true;}return back();};
    new MutationObserver(render).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
    document.addEventListener('visibilitychange',()=>sync());
    window.addEventListener('online',sync);
    window.RCFriends={sync,open:()=>el('btnFriends').click(),get data(){return state.data;}};
    render();sync();setInterval(()=>{if(!document.hidden)sync();},3000);
})();
