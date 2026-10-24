"use strict";
window.RCFriendShare=(()=>{
    const tr=(ru,en)=>I18N.lang==='en'?en:ru;
    let pending='',opened='';
    const overlay=document.createElement('div');overlay.id='friendShareOv';overlay.className='overlay';
    const modal=document.createElement('div');modal.className='modal friend-dialog';overlay.append(modal);document.body.append(overlay);
    function close(){overlay.classList.remove('open');}
    async function open(){
        await RCLocalFriends.ready;modal.replaceChildren();const code=RCLocalFriends.code(),url='https://ring-carrom-relay.onrender.com/?friend='+encodeURIComponent(code);
        const title=document.createElement('h2');title.textContent=tr('Пригласить друга','Invite a friend');modal.append(title);
        const x=document.createElement('button');x.className='xbtn';x.textContent='✕';x.setAttribute('aria-label',tr('Закрыть','Close'));x.onclick=close;modal.append(x);
        const canvas=document.createElement('canvas');canvas.width=300;canvas.height=300;canvas.style.cssText='width:min(100%,260px);height:auto;align-self:center;border-radius:12px';canvas.setAttribute('aria-label',tr('QR-код приглашения','Invitation QR code'));
        const qr=qrcodegen.QrCode.encodeText(url,qrcodegen.QrCode.Ecc.MEDIUM),ctx=canvas.getContext('2d'),size=qr.size+8;
        ctx.fillStyle='#fff';ctx.fillRect(0,0,300,300);ctx.fillStyle='#000';for(let y=0;y<qr.size;y++)for(let x=0;x<qr.size;x++)if(qr.getModule(x,y))ctx.fillRect(Math.floor((x+4)*300/size),Math.floor((y+4)*300/size),Math.ceil(300/size),Math.ceil(300/size));modal.append(canvas);
        const hint=document.createElement('p');hint.className='friend-muted';hint.textContent=tr('Пусть друг сканирует QR камерой телефона или откроет ссылку.','Ask your friend to scan with their phone camera or open the link.');modal.append(hint);
        const field=document.createElement('textarea');field.readOnly=true;field.value=url;field.style.cssText='width:100%;min-height:76px;user-select:text';field.setAttribute('aria-label',tr('Ссылка приглашения','Invitation link'));modal.append(field);
        const share=document.createElement('button');share.id='friendShareSend';share.className='friend-action primary';share.textContent=tr('Поделиться ссылкой','Share link');share.onclick=async()=>{try{if(window.RCFiles)RCFiles.share(url);else if(navigator.share)await navigator.share({title:'Ring Carrom',text:tr('Добавь меня в друзья!','Add me as a friend!'),url});else{await navigator.clipboard.writeText(url);showToast(tr('Ссылка скопирована','Link copied'));}}catch(_){field.select();document.execCommand('copy');}};modal.append(share);overlay.classList.add('open');
    }
    const button=document.createElement('button');button.id='friendsShare';button.className='friend-action';button.onclick=open;
    document.querySelector('.friend-self').append(button);
    function translate(){button.textContent=tr('QR / Пригласить','QR / Invite');}translate();
    new MutationObserver(translate).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
    overlay.onclick=e=>{if(e.target===overlay)close();};const back=window.__androidBack;window.__androidBack=()=>{if(overlay.classList.contains('open')){close();return true;}return back();};
    async function openPending(){
        pending=pending||(window.RCFiles?RCFiles.friendLink():'')||new URLSearchParams(location.search).get('friend')||'';
        if(!pending||pending===opened||!window.RCFriendGame.available())return;
        const code=pending;if(!/^rcf1:[a-z][a-z0-9_]{2,19}:[a-f0-9]{64}$/.test(code)){pending='';return;}
        if(!window.RCFiles&&!document.getElementById('friendOpenApp')){const app=document.createElement('a');app.id='friendOpenApp';app.className='friend-action primary';app.textContent=tr('Открыть приглашение в приложении','Open invitation in the app');app.href='ringcarrom://friend?friend='+encodeURIComponent(code);document.querySelector('.friend-self').append(app);}
        await RCLocalFriends.ready;opened=code;pending='';window.RCFriends.open();await RCFriends.sync();document.getElementById('friendTab-search').click();const input=document.getElementById('friendSearchInput');if(!input){opened='';pending=code;return;}input.value=code;input.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('friendSearchForm').requestSubmit();
    }
    window.addEventListener('rc-screen-changed',()=>setTimeout(openPending,0));setTimeout(openPending,1600);
    return {open,openPending};
})();
