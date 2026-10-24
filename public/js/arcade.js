"use strict";
// Presentation and navigation only. The actual game/relay/save handlers remain authoritative.
window.RCArcade = (() => {
    const el=id=>document.getElementById(id),tr=(ru,en)=>I18N.lang==='en'?en:ru;
    const make=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
    function icon(name){const n=make('img','arc-icon');n.src=`img/icons/${name}.svg`;n.alt='';n.setAttribute('aria-hidden','true');return n;}
    function action(id,name,click){const b=make('button','arc-action');b.id=id;b.type='button';b.append(icon(name),make('span'));b.onclick=click;return b;}
    const home=el('scr-menu'),header=home.querySelector('.menu-top'),logo=el('logoImg');
    const legacy=make('div','arc-legacy');legacy.hidden=true;
    for(const child of [...home.children])if(child!==header){legacy.append(child);}
    const brand=make('div','arc-brand');brand.append(logo);
    const hero=make('div','arc-hero'),tableImage=make('img','arc-table-image');tableImage.id='homeBoard';tableImage.src='img/classic-board-3d.png';tableImage.width=1448;tableImage.height=1086;hero.append(tableImage);
    let selectedMode='online';
    const modes=make('div','arc-modes');modes.setAttribute('role','group');
    const online=action('homeModeOnline','world',()=>selectMode('online')),bot=action('homeModeBot','robot',()=>selectMode('bot'));modes.append(online,bot);
    const play=action('homePlay','player-play',()=>{el(selectedMode==='online'?'btnOnline':'btnBot').click();});play.classList.add('arc-primary');
    const secondary=make('div','arc-secondary'),training=action('homeTraining','target-arrow',()=>el('btnTraining').click()),local=action('homeLocal','users-group',()=>el('btnPvp').click());secondary.append(training,local);
    const friendRow=make('div','arc-home-friends'),friendInfo=make('div','arc-friend-summary'),friendAvatars=make('div','arc-avatar-stack'),invite=action('homeInvite','user-plus',()=>{RCFriends.open();el('friendTab-search')?.click();});friendRow.append(friendInfo,friendAvatars,invite);
    home.replaceChildren(header,brand,hero,modes,play,secondary,friendRow,legacy);

    const nav=make('nav','arc-nav');nav.id='bottomNav';nav.setAttribute('aria-label',tr('Основная навигация','Main navigation'));
    const routes=[['home','home',()=>showScreen('scr-menu')],['friends','users',()=>RCFriends.open()],['quests','clipboard-check',()=>el('btnQuests').click()],['shop','shopping-bag',()=>el('btnSettingsOpen').click()]];
    for(const [name,glyph,callback] of routes){const b=action('nav-'+name,glyph,()=>{if(el('scr-game').classList.contains('active')||RCNet.active)return;closePanels();callback();refreshNav(name);});b.dataset.route=name;nav.append(b);}
    document.body.append(nav);
    function closePanels(){for(const id of ['progressClose','soundClose','friendDialogClose'])el(id)?.click();el('friendShareOv')?.querySelector('.xbtn')?.click();}
    function refreshNav(active){
        const screen=document.querySelector('.screen.active')?.id;
        nav.hidden=['scr-game','scr-roulette','scr-online'].includes(screen);
        const route=active||(screen==='scr-friends'?'friends':screen==='scr-settings'?'shop':'home');
        for(const b of nav.children){const selected=b.dataset.route===route;b.classList.toggle('active',selected);if(selected)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');}
    }
    function selectMode(mode){selectedMode=mode;online.classList.toggle('selected',mode==='online');bot.classList.toggle('selected',mode==='bot');online.setAttribute('aria-pressed',String(mode==='online'));bot.setAttribute('aria-pressed',String(mode==='bot'));}

    // Keep existing input nodes and native bridge bindings when grouping settings.
    const settings=el('soundOv').querySelector('.audio-settings');settings.classList.add('arc-settings');
    const settingsTabs=make('div','arc-settings-tabs');settingsTabs.setAttribute('role','tablist');
    const groups={};for(const id of ['profile','audio','notifications','backup']){const section=make('section','arc-settings-panel');section.id='settings-'+id;groups[id]=section;settings.append(section);}
    groups.profile.append(el('friendAccount'));
    const shopProfile=make('div','arc-settings-shortcut');const profileCopy=make('p','friend-muted');shopProfile.append(profileCopy);
    const profileButton=action('settingsAppearance','users',()=>{el('soundClose').click();el('btnSettingsOpen').click();});shopProfile.append(profileButton);groups.profile.append(shopProfile);
    const help=action('settingsHelp','help',()=>{el('soundClose').click();el('btnHow').click();});groups.profile.append(help);
    const career=action('settingsCareer','chart-bar',()=>{el('soundClose').click();el('btnCareer').click();});groups.profile.append(career);
    const audioHeading=settings.querySelector('[data-i18n="audioLabel"]'),langHeading=settings.querySelector('[data-i18n="languageLabel"]');
    for(const node of [langHeading,settings.querySelector('.settings-languages'),audioHeading,settings.querySelector('label[for="effectsVolume"]'),el('effectsVolume'),settings.querySelector('label[for="musicVolume"]'),el('musicVolume')])if(node)groups.audio.append(node);
    groups.notifications.append(el('notificationSettings'));groups.backup.append(el('backupSettings'));
    settings.insertBefore(settingsTabs,groups.profile);
    const settingsEntries=[['profile','users','Профиль','Profile'],['audio','volume','Звук','Audio'],['notifications','bell','Уведомления','Notifications'],['backup','shield-lock','Копия','Backup']];
    let settingsSection='profile';
    function openSettingsSection(id){settingsSection=id;for(const [name,node] of Object.entries(groups))node.hidden=name!==id;for(const b of settingsTabs.children){b.classList.toggle('selected',b.dataset.section===id);b.setAttribute('aria-selected',String(b.dataset.section===id));}}
    for(const [id,glyph] of settingsEntries){const b=action('settingsTab-'+id,glyph,()=>openSettingsSection(id));b.dataset.section=id;b.setAttribute('role','tab');b.setAttribute('aria-controls','settings-'+id);settingsTabs.append(b);}
    const beforeFilesImport=window.RCBackup?.importFile;
    if(beforeFilesImport)window.RCBackup.importFile=raw=>{beforeFilesImport(raw);openSettingsSection('backup');};

    function homeFriends(){
        const data=window.RCFriends?.data,peers=(data?.friends||[]).filter(p=>p.status&&p.status!=='offline');
        friendInfo.textContent=peers.length?tr('Друзья в сети','Friends online'):tr('Играйте вместе','Play together');friendAvatars.replaceChildren();
        for(const p of peers.slice(0,2)){const image=make('img');image.src=RND.avatarURL(p.avatar,36);image.alt=p.name;friendAvatars.append(image);}
        if(!peers.length){const caption=make('small');caption.textContent=tr('Добавьте друга по QR-коду','Add a friend using a QR code');friendInfo.append(caption);}
        const count=el('friendsBadge')?.textContent||'';const b=el('nav-friends');b.dataset.badge=el('friendsBadge')?.hidden?'':count;
    }
    function translate(){
        online.lastChild.textContent=tr('Онлайн','Online');bot.lastChild.textContent=tr('С ботом','Vs bot');play.lastChild.textContent=tr('Играть','Play');training.lastChild.textContent=tr('Тренировка','Practice');local.lastChild.textContent=tr('Два игрока','Two players');invite.lastChild.textContent=tr('Пригласить','Invite');
        const labels={home:tr('Главная','Home'),friends:tr('Друзья','Friends'),quests:tr('Задания','Quests'),shop:tr('Магазин','Shop')};for(const b of nav.children)b.lastChild.textContent=labels[b.dataset.route];
        for(const [id,,ru,en] of settingsEntries)el('settingsTab-'+id).lastChild.textContent=tr(ru,en);
        profileCopy.textContent=tr('Имя, аватар и оформление доступны в профиле магазина.','Name, avatar and appearance are available in your shop profile.');profileButton.lastChild.textContent=tr('Имя и оформление','Name and appearance');help.lastChild.textContent=tr('Как играть','How to play');career.lastChild.textContent=tr('Рейтинг и статистика','Rating and statistics');
        tableImage.alt=tr('Каменный игровой стол Ring Carrom, 2 × 2 метра','Ring Carrom stone game table, 2 × 2 metres');homeFriends();
    }
    function xpPanel(reward){
        const panel=make('div','arc-result-progress'),level=RCLevel.state(),label=make('p');label.textContent=tr('Уровень ','Level ')+level.level+' · '+level.xp+' / '+level.target+' XP';
        const progress=make('progress');progress.max=level.target;progress.value=Math.max(0,level.xp-reward);progress.setAttribute('aria-label',tr('Опыт уровня','Level experience'));panel.append(label,progress);requestAnimationFrame(()=>progress.value=level.xp);return panel;
    }
    function decorateResult(msg){
        const winning=msg?msg.winner===myIndex:pendingWinner===0,target=el('winOv').classList.contains('open')?el('winOv').querySelector('.winbox'):el('over').querySelector('.modal');
        if(!target)return;target.classList.add('arc-results');for(const old of target.querySelectorAll('.arc-result-details,.arc-result-emblem,.arc-result-progress'))old.remove();
        const emblem=make('div','arc-result-emblem');emblem.append(icon('trophy'));emblem.classList.toggle('won',winning);target.prepend(emblem);
        const details=make('div','arc-result-details'),score=make('p','arc-result-score',scores[0]+' : '+scores[1]);details.append(score);
        const actions=target.querySelector('.mrow');
        if(msg){const reward=msg.reward||{coins:0,xp:0};target.insertBefore(details,actions);target.insertBefore(xpPanel(reward.xp),actions);}
        else {target.insertBefore(details,actions);if(mode==='bot'&&winning)target.insertBefore(xpPanel([10,20,30][difficulty]||10),actions);}
    }
    window.addEventListener('rc-match-finished',()=>decorateResult(null));
    window.addEventListener('rc-screen-changed',()=>{refreshNav();homeFriends();});
    new MutationObserver(()=>{refreshNav(el('progressOv').classList.contains('open')?'quests':undefined);}).observe(el('progressOv'),{attributes:true,attributeFilter:['class']});
    new MutationObserver(()=>{openSettingsSection(settingsSection);}).observe(el('soundOv'),{attributes:true,attributeFilter:['class']});
    new MutationObserver(translate).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
    setInterval(homeFriends,3000);selectMode('online');openSettingsSection('profile');translate();refreshNav();
    return {selectMode,openSettingsSection,decorateResult,refresh:()=>{translate();refreshNav();}};
})();
