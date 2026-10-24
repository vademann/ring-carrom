"use strict";
(() => {
    const tr=(ru,en)=>I18N.lang==='en'?en:ru;
    let state='',started=0;
    const retry=document.createElement('button');retry.id='connectionRetry';retry.className='friend-action';retry.onclick=()=>RCNet.retryNow();
    const status=document.createElement('p');status.id='connectionStatus';status.className='friend-muted';status.setAttribute('role','status');
    const row=document.createElement('div');row.className='connection-tools';row.append(status,retry);document.getElementById('scr-online').append(row);
    const practice=document.createElement('button');practice.id='quickPractice';practice.className='btn ghost';practice.onclick=()=>{if(RCNet.active&&RCNet.quick&&!RCNet.connected)newGame('free');};document.getElementById('onlineQuick').append(practice);
    const banner=document.createElement('aside');banner.id='queuePracticeBanner';banner.hidden=true;banner.className='connection-banner';const text=document.createElement('span'),cancel=document.createElement('button');cancel.className='friend-action';cancel.onclick=()=>{RCNet.destroy();banner.hidden=true;};banner.append(text,cancel);document.body.append(banner);
    function render(){
        const seconds=Math.floor((Date.now()-started)/1000);
        const recovering=state==='reconnecting'||state.startsWith('error:');
        status.textContent=!RCNet.active?'':recovering?tr('Восстанавливаем связь… Если сервер запускается после простоя, это займёт время.','Restoring connection… Waking the server after inactivity can take time.'):RCNet.connected?tr('Подключено','Connected'):RCNet.quick?tr('Ищем соперника','Finding an opponent')+` · ${seconds} ${tr('сек.','sec.')}`:tr('Подключаемся…','Connecting…');
        retry.textContent=tr('Повторить подключение','Retry connection');retry.hidden=!RCNet.active||!recovering;
        practice.textContent=tr('Потренироваться во время поиска','Practice while searching');practice.disabled=!RCNet.active||RCNet.connected;
        banner.hidden=!(RCNet.active&&RCNet.quick&&!RCNet.connected&&!document.getElementById('scr-online').classList.contains('active'));
        text.textContent=tr('Поиск продолжается. Матч откроется автоматически.','Search continues. Your match will open automatically.');cancel.textContent=tr('Отменить поиск','Cancel search');
    }
    window.addEventListener('rc-network-status',e=>{if(!started||!RCNet.active)started=Date.now();state=e.detail;render();});
    window.addEventListener('rc-screen-changed',render);setInterval(render,1000);render();
})();
