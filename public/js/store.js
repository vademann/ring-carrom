"use strict";
// One authoritative write for a reward, purchase or complete profile restore.
window.RCStore=(()=>{
    const KEY='rc_state_v2';
    let cachedRaw,cached;
    function load(){const raw=localStorage.getItem(KEY);if(raw===null)return {};if(raw===cachedRaw)return cached;const value=JSON.parse(raw);if(!value||Array.isArray(value)||typeof value!=='object')throw Error('storage_corrupt');cachedRaw=raw;cached=value;return value;}
    function get(key){const state=load();return Object.hasOwn(state,key)?state[key]:localStorage.getItem(key);}
    function json(key,fallback){const raw=get(key);return raw===null?fallback:JSON.parse(raw);}
    function commit(values){
        const state={...load()};
        for(const [key,value] of Object.entries(values)){if(!/^rc_[a-z0-9_]+$/.test(key)||key===KEY)throw Error('storage_key');state[key]=String(value);}
        // setItem is atomic: either every field commits or none of them does.
        localStorage.setItem(KEY,JSON.stringify(state));
        for(const [key,value] of Object.entries(values))try{localStorage.setItem(key,String(value));}catch(_){}
        window.dispatchEvent(new Event('rc-save-changed'));
    }
    function balance(){const value=get('rc_coins');return value===null?500:Math.max(0,Number(value)||0);}
    function set(key,value){if(Object.hasOwn(load(),key))commit({[key]:value});else localStorage.setItem(key,String(value));}
    function remove(key){const state={...load()};if(Object.hasOwn(state,key)){state[key]=null;localStorage.setItem(KEY,JSON.stringify(state));}localStorage.removeItem(key);}
    function reward(id,coins,xp=0,extra={}){
        const seen=json('rc_reward_ids',[]);if(id&&seen.includes(id))return false;
        const values={...extra,rc_coins:String(balance()+coins),rc_xp:String(Math.max(0,Number(get('rc_xp'))||0)+xp)};
        if(id)values.rc_reward_ids=JSON.stringify([...seen,id].slice(-2000));
        commit(values);return true;
    }
    function exportData(){const data={};for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(/^rc_/.test(key)&&key!==KEY)data[key]=localStorage.getItem(key);}return Object.fromEntries(Object.entries({...data,...load()}).filter(([key,value])=>typeof value==='string'&&!['rc_session','rc_departures'].includes(key)));}
    function restore(data){
        if(!data||Array.isArray(data)||typeof data!=='object'||Object.keys(data).length>150)throw Error('backup_invalid');
        if(!/^[a-f0-9]{64}$/.test(data.rc_identity||''))throw Error('backup_invalid');
        for(const key of ['rc_coins','rc_xp'])if(data[key]!==undefined&&(!Number.isSafeInteger(Number(data[key]))||Number(data[key])<0))throw Error('backup_invalid');
        for(const key of ['rc_own_themes','rc_own_pucks'])if(data[key]!==undefined){const items=JSON.parse(data[key]);if(!Array.isArray(items)||items.length>20||items.some(i=>!Number.isInteger(i)||i<0||i>4))throw Error('backup_invalid');}
        for(const key of ['rc_login_rewards','rc_quests','rc_weekly','rc_lifetime','rc_local_friends_v1'])if(data[key]!==undefined){const value=JSON.parse(data[key]);if(!value||Array.isArray(value)||typeof value!=='object')throw Error('backup_invalid');}
        const safe={};for(const [key,value] of Object.entries(data)){if(!/^rc_[a-z0-9_]+$/.test(key)||key===KEY||['rc_session','rc_departures'].includes(key)||typeof value!=='string')throw Error('backup_invalid');safe[key]=value;}
        const replacement={...safe};
        for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(/^rc_/.test(key)&&key!==KEY&&!Object.hasOwn(replacement,key))replacement[key]=null;}
        for(const key of Object.keys(load()))if(!Object.hasOwn(replacement,key))replacement[key]=null;
        replacement.rc_session=null;replacement.rc_departures=null;
        localStorage.setItem(KEY,JSON.stringify(replacement));
        for(const [key,value] of Object.entries(replacement))try{if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value);}catch(_){}
        localStorage.removeItem('rc_session');localStorage.removeItem('rc_departures');
    }
    return {get,set,remove,json,commit,balance,reward,exportData,restore};
})();
