"use strict";
window.RCBackup=(()=>{
    const tr=(ru,en)=>I18N.lang==='en'?en:ru;
    const section=document.createElement('section');section.className='friend-account';section.id='backupSettings';document.getElementById('friendAccount').after(section);
    let file='',busy=false;
    const bytes=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
    const base64=value=>{let s='';for(const b of new Uint8Array(value))s+=String.fromCharCode(b);return btoa(s);};
    async function key(password,salt){const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:310000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
    async function encrypt(data,password){
        if(password.length<10)throw Error('password');
        const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
        const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('RingCarromBackup:1')},await key(password,salt),new TextEncoder().encode(JSON.stringify(data)));
        return JSON.stringify({format:'RingCarromBackup',version:1,salt:base64(salt),iv:base64(iv),data:base64(encrypted)});
    }
    async function decrypt(raw,password){
        if(raw.length>4*1024*1024)throw Error('size');const value=JSON.parse(raw);
        if(value.format!=='RingCarromBackup'||value.version!==1||typeof value.data!=='string')throw Error('format');
        const salt=bytes(value.salt),iv=bytes(value.iv);if(salt.length!==16||iv.length!==12)throw Error('format');
        const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('RingCarromBackup:1')},await key(password,salt),bytes(value.data));
        const data=JSON.parse(new TextDecoder().decode(plain));
        if(!/^[a-f0-9]{64}$/.test(data.rc_identity||''))throw Error('identity');
        if(data.rc_local_friends_v1){const social=JSON.parse(data.rc_local_friends_v1),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(data.rc_identity))),b=>b.toString(16).padStart(2,'0')).join('');if(social.id!==hash||social.version!==1)throw Error('identity');for(const key of ['contacts','incoming','outgoing','blocked','favorites','recent','messages','invites','seen','cancelled'])if(!social[key]||Array.isArray(social[key])||typeof social[key]!=='object')throw Error('social');if(!Array.isArray(social.outbox)||social.outbox.length>500)throw Error('social');}
        return data;
    }
    function status(text){document.getElementById('backupStatus').textContent=text;}
    async function run(action){if(busy)return;busy=true;section.querySelectorAll('button').forEach(b=>b.disabled=true);try{await action();}catch(_){status(tr('Не удалось выполнить действие. Проверьте файл, пароль (от 10 символов) и свободное место.','Could not complete the action. Check the file, password (10+ characters), and free space.'));}finally{busy=false;section.querySelectorAll('button').forEach(b=>b.disabled=false);}}
    function render(){
        section.replaceChildren();const title=document.createElement('h3');title.textContent=tr('Резервная копия профиля','Profile backup');section.append(title);
        const note=document.createElement('p');note.className='friend-muted';note.textContent=tr('Сохраните прогресс, покупки, друзей и переписку в файл с паролем. Для переноса используйте файл и пароль. Игра не хранит копию пароля.','Save progress, purchases, friends and messages in a password-protected file. Transfer both the file and password. The game does not keep your password.');section.append(note);
        const input=document.createElement('input');input.type='password';input.id='backupPassword';input.minLength=10;input.maxLength=200;input.autocomplete='new-password';input.placeholder=tr('Пароль — минимум 10 символов','Password — at least 10 characters');input.setAttribute('aria-label',input.placeholder);section.append(input);
        const actions=document.createElement('div');actions.className='friend-actions';section.append(actions);
        function button(id,label,action){const b=document.createElement('button');b.id=id;b.className='friend-action';b.textContent=label;b.onclick=()=>run(action);actions.append(b);}
        button('backupExport',tr('Сохранить в файл','Save to file'),async()=>{
            if(!window.RCFriendGame.available())throw Error('match');
            const raw=await encrypt(RCStore.exportData(),input.value);input.value='';
            if(window.RCFiles)RCFiles.exportBackup(raw);else{const url=URL.createObjectURL(new Blob([raw],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='ring-carrom-backup.rcbackup';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
            status(tr('Выберите место для файла и сохраните пароль отдельно.','Choose a file location and keep your password separately.'));
        });
        button('backupChoose',tr('Выбрать копию','Choose backup'),()=>{if(window.RCFiles)RCFiles.importBackup();else picker.click();});
        button('backupRestore',tr('Восстановить профиль','Restore profile'),async()=>{
            if(!window.RCFriendGame.available()||!file)throw Error('match');const data=await decrypt(file,input.value);
            if(!confirm(tr('Заменить текущий профиль данными из копии? Приложение перезапустит игровой экран.','Replace this profile with the backup? The game screen will reload.')))return;
            RCStore.restore(data);input.value='';location.reload();
        });
        const picker=document.createElement('input');picker.type='file';picker.accept='.rcbackup,.json,application/json';picker.hidden=true;picker.onchange=async()=>{if(picker.files[0]){if(picker.files[0].size>4*1024*1024){fileResult(false);return;}importFile(await picker.files[0].text());}};section.append(picker);
        const message=document.createElement('p');message.id='backupStatus';message.className='friend-muted';message.setAttribute('role','status');section.append(message);
    }
    function importFile(raw){file=raw;status(tr('Файл выбран. Введите его пароль и нажмите «Восстановить профиль».','File selected. Enter its password and choose Restore profile.'));}
    function fileResult(ok){status(ok?tr('Копия сохранена.','Backup saved.'):tr('Не удалось прочитать или сохранить файл.','Could not read or save the file.'));}
    new MutationObserver(render).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});render();
    return {encrypt,decrypt,importFile,fileResult};
})();
