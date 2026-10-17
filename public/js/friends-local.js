"use strict";
// All durable social state belongs to this installation. Relay packets are retried
// from the phone until the receiving phone confirms it has saved them.
(() => {
    const KEY='rc_local_friends_v1';
    const stamp=()=>Math.floor(Date.now()/1000);
    const uuid=()=>crypto.randomUUID?crypto.randomUUID():Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
    const fail=code=>{throw new Error(code);};
    const makeLogin=()=>'g'+Array.from(crypto.getRandomValues(new Uint8Array(5)),b=>'abcdefghjkmnpqrstuvwxyz23456789'[b%31]).join('');
    let data,online=false,flight=null,received=[],activity='online',active=true,pushAvailable=false;
    const ready=(async()=>{
        const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(RCNet.identity()));
        const id=Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
        try{data=JSON.parse(localStorage.getItem(KEY));}catch(e){}
        if(!data || data.id!==id || data.version!==1) {
            let old;try{old=JSON.parse(localStorage.getItem('rc_friends_cache'));}catch(e){}
            data={version:1,id,login:old?.me?.login||makeLogin(),dnd:false,contacts:{},incoming:{},outgoing:{},blocked:{},favorites:{},recent:{},messages:{},invites:{},outbox:[],seen:{},cancelled:{}};
            if(!/^[a-z][a-z0-9_]{2,19}$/.test(data.login))data.login=makeLogin();
        }
        save();
    })();
    function me(){return {id:data.id,login:data.login,...localProfile(),level:window.RCLevel?.state().level||1};}
    function code(p=me()){return 'rcf1:'+p.login+':'+p.id;}
    function parseCode(value) {
        const m=/^rcf1:([a-z][a-z0-9_]{2,19}):([a-f0-9]{64})$/i.exec(value.trim());
        return m?{id:m[2].toLowerCase(),login:m[1].toLowerCase(),name:m[1],avatar:0,status:'offline',lastSeen:0}:null;
    }
    function save() {
        // Keep local history bounded, including pending deliveries and deduplication.
        const history=Object.entries(data.messages).flatMap(([peer,rows])=>rows.map(m=>({peer,id:m.id,at:m.at}))).sort((a,b)=>b.at-a.at);
        const keep=new Set(history.slice(0,1000).map(m=>m.id));
        for(const [peer,rows] of Object.entries(data.messages))data.messages[peer]=rows.filter(m=>keep.has(m.id)).slice(-200);
        for(const key of ['seen','cancelled']) {
            const entries=Object.entries(data[key]).sort((a,b)=>b[1]-a[1]);
            data[key]=Object.fromEntries(entries.slice(0,key==='seen'?4096:512));
        }
        for(const packet of data.outbox)if(packet.expires<=stamp()&&packet.payload.kind==='message'){
            const message=(data.messages[packet.to]||[]).find(m=>m.id===packet.id);
            if(message)message.delivery='expired';
        }
        data.outbox=data.outbox.filter(p=>p.expires>stamp());
        for(const [id,inv] of Object.entries(data.invites))if(inv.expires<stamp()-86400)delete data.invites[id];
        const recents=Object.entries(data.recent).sort((a,b)=>b[1]-a[1]).slice(0,30);data.recent=Object.fromEntries(recents);
        const spare=Object.values(data.contacts).filter(p=>!p.friendship&&!data.incoming[p.id]&&!data.outgoing[p.id]&&!data.blocked[p.id]&&!data.recent[p.id]).sort((a,b)=>(b.updated||0)-(a.updated||0));
        spare.slice(100).forEach(p=>delete data.contacts[p.id]);
        try{localStorage.setItem(KEY,JSON.stringify(data));}catch(e){fail('storage_full');}
        try{window.RCNotifications?.syncLocal(data);}catch(e){}
    }
    function contact(p) {
        if(!p || !/^[a-f0-9]{64}$/.test(p.id)||p.id===data.id||typeof p.login!=='string'||typeof p.name!=='string')return null;
        const old=data.contacts[p.id]||{};
        return data.contacts[p.id]={...old,id:p.id,login:p.login.slice(0,20),name:p.name.slice(0,12),avatar:Number.isInteger(p.avatar)?Math.max(0,Math.min(5,p.avatar)):0,level:p.level||old.level||1,status:p.status||'offline',lastSeen:p.lastSeen||old.lastSeen||0,updated:stamp()};
    }
    function relation(id) {
        if(data.blocked[id])return 'blocked';
        if(data.contacts[id]?.friendship)return 'friend';
        if(data.incoming[id])return 'incoming';
        if(data.outgoing[id])return 'outgoing';
        return 'none';
    }
    function view(p){return {...p,status:online?p.status:'offline',relationship:relation(p.id),favorite:!!data.favorites[p.id]};}
    function snapshot() {
        const profiles=Object.values(data.contacts),unread={};
        for(const p of profiles)if(relation(p.id)==='friend'){
            const n=(data.messages[p.id]||[]).filter(m=>m.sender===p.id&&!m.seen).length;if(n)unread[p.id]=n;
        }
        for(const inv of Object.values(data.invites)) {
            if(['pending','accepted'].includes(inv.state)&&inv.expires<=stamp())inv.state='expired';
            if(inv.sender===data.id && window.RCNet?.connected && RCNet.code===inv.room)inv.state='joined';
        }
        return {me:{...me(),status:active?activity:'offline'},dnd:data.dnd,relayOnline:online,pushAvailable,
            friends:profiles.filter(p=>relation(p.id)==='friend').map(view),
            incoming:Object.keys(data.incoming).filter(id=>!data.blocked[id]).map(id=>view(data.contacts[id])),
            outgoing:Object.keys(data.outgoing).filter(id=>!data.blocked[id]).map(id=>view(data.contacts[id])),
            blocked:Object.keys(data.blocked).map(id=>view(data.contacts[id])),
            recent:Object.keys(data.recent).filter(id=>!data.blocked[id]&&data.contacts[id]).sort((a,b)=>data.recent[b]-data.recent[a]).map(id=>view(data.contacts[id])),
            invites:Object.values(data.invites).filter(i=>i.expires>stamp()-120),unread,
            queued:data.outbox.filter(p=>p.payload.kind!=='ack').length};
    }
    function enqueue(to,payload,id=uuid(),seconds=7*86400) {
        if(data.outbox.some(p=>p.id===id))return id;
        if(data.outbox.length>=500)fail('queue_full');
        data.outbox.push({id,to,payload,expires:stamp()+seconds});return id;
    }
    function ack(event){enqueue(event.sender.id,{kind:'ack',packet:event.packet},'ack_'+event.packet,86400);}
    function unlink(id) {
        const p=data.contacts[id];if(p)delete p.friendship;
        delete data.incoming[id];delete data.outgoing[id];delete data.favorites[id];
        for(const inv of Object.values(data.invites))if((inv.sender===id||inv.receiver===id)&&['pending','accepted'].includes(inv.state))inv.state='cancelled';
    }
    function receive(event) {
        const p=event.sender,payload=event.payload;
        if(!p || !payload || !contact(p))return;
        if(payload.kind==='ack') {
            const pending=data.outbox.find(m=>m.id===payload.packet&&m.to===p.id);
            if(pending){data.outbox=data.outbox.filter(m=>m!==pending);const message=(data.messages[p.id]||[]).find(m=>m.id===pending.id);if(message)message.delivery='delivered';}
            return;
        }
        ack(event);
        if(data.seen[event.id])return;
        data.seen[event.id]=stamp();
        if(data.blocked[p.id])return;
        const peer=data.contacts[p.id],kind=payload.kind;
        if(kind==='request') {
            if(peer.friendship||data.cancelled[event.packet]||Object.keys(data.incoming).length>=100)return;
            data.incoming[p.id]={id:event.packet,at:stamp()};
        }else if(kind==='request_cancel') {
            if(typeof payload.request!=='string')return;data.cancelled[payload.request]=stamp();
            if(data.incoming[p.id]?.id===payload.request)delete data.incoming[p.id];
        }else if(kind==='accept') {
            if(data.outgoing[p.id]?.id!==payload.request && !peer.friendship)return;
            if(typeof payload.friendship!=='string'||payload.friendship.length>80)return;
            if(Object.values(data.contacts).filter(c=>c.friendship).length>=100&&!peer.friendship)return;
            peer.friendship=peer.friendship?[peer.friendship,payload.friendship].sort()[0]:payload.friendship;
            delete data.outgoing[p.id];delete data.incoming[p.id];
        }else if(kind==='decline') {
            if(data.outgoing[p.id]?.id===payload.request)delete data.outgoing[p.id];
        }else if(kind==='remove') {
            if(peer.friendship===payload.friendship)unlink(p.id);
        }else if(peer.friendship && peer.friendship===payload.friendship) {
            if(kind==='message' && typeof payload.text==='string' && payload.text.trim() && payload.text.length<=300) {
                const rows=data.messages[p.id]||(data.messages[p.id]=[]);
                if(!rows.some(m=>m.id===event.packet))rows.push({id:event.packet,sender:p.id,receiver:data.id,text:payload.text,at:stamp(),seen:false,delivery:'delivered'});
            }else if(kind==='read' && Array.isArray(payload.ids)) {
                const ids=new Set(payload.ids.slice(0,200));for(const m of data.messages[p.id]||[])if(m.sender===data.id&&ids.has(m.id))m.seen=true;
            }else if(kind==='invite' && typeof payload.room==='string' && /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/.test(payload.room) && Number.isInteger(payload.expires) && payload.expires>stamp() && payload.expires<=stamp()+100 && !data.dnd) {
                data.invites[event.packet]={id:event.packet,sender:p.id,receiver:data.id,room:payload.room,expires:payload.expires,state:'pending'};
            }else if(kind==='invite_response') {
                const inv=data.invites[payload.invite];
                if(inv && inv.receiver===p.id && ['accepted','declined','cancelled'].includes(payload.state))inv.state=payload.state;
            }else if(kind==='invite_cancel') {
                const inv=data.invites[payload.invite];if(inv&&inv.sender===p.id)inv.state='cancelled';
            }
        }
    }
    async function rpc(fields) {
        let last;
        for(const endpoint of [...new Set([RCNet.endpoint(),...RCNet.endpoints()])]) {
            const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),3500);
            try {
                const response=await RCNet.request(endpoint.replace(/^ws/,'http').replace(/\/ws$/,'/social'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identity:RCNet.identity(),...fields}),signal:controller.signal});
                const result=await response.json();if(!response.ok){if(result.error)throw Object.assign(new Error(result.error),{server:true});throw new Error('network');}online=true;return result;
            }catch(e){if(e.server)throw e;last=e;}finally{clearTimeout(timer);}
        }
        online=false;throw last||new Error('network');
    }
    async function poll(query='') {
        await ready;
        const inbox=(window.RCNotifications?.inbox()||[]).filter(e=>e.target===data.id);
        if(inbox.length){
            const previous=JSON.stringify(data);
            try{inbox.forEach(receive);save();window.RCNotifications.acknowledge(inbox);}
            catch(e){data=JSON.parse(previous);throw e;}
        }
        if(flight){await flight;if(query)return poll(query);return;}
        flight=(async()=>{
            try {
                const beforeReceived=received;
                const pending=data.outbox.filter(p=>p.expires>stamp());
                const urgent=p=>p.payload.kind!=='ack'&&p.expires<stamp()+120;
                const batch=[...pending.filter(urgent).slice(0,8),...pending.filter(p=>p.payload.kind==='ack').slice(0,8),...pending.filter(p=>p.payload.kind!=='ack'&&!urgent(p)).slice(0,16)];
                const result=await rpc({op:'poll',profile:me(),active,activity,dnd:data.dnd,watch:Object.keys(data.contacts).slice(0,250),packets:batch,received:beforeReceived,query,...window.RCNotifications?.delivery()});
                pushAvailable=!!result.pushAvailable;
                const backup=JSON.stringify(data);
                try {
                    for(const p of Object.values(data.contacts))p.status='offline';
                    for(const p of Object.values(result.online||{}))contact(p);
                    for(const p of result.results||[])contact(p);
                    for(const event of result.events||[])receive(event);
                    const forwarded=new Set(result.forwarded||[]);
                    data.outbox=data.outbox.filter(p=>!(p.payload.kind==='ack'&&forwarded.has(p.id)));
                    // Rotate retries so an offline recipient cannot block other friends.
                    const sent=new Set(batch.map(p=>p.id));
                    data.outbox=[...data.outbox.filter(p=>!sent.has(p.id)),...data.outbox.filter(p=>sent.has(p.id))];
                    save();received=(result.events||[]).map(e=>e.id);
                    try{window.RCNotifications?.notify(result.events||[],data.id);}catch(e){}
                }catch(e){data=JSON.parse(backup);throw e;}
                return result;
            }catch(e){online=false;throw e;}
        })();
        try{return await flight;}finally{flight=null;}
    }
    function friend(target) {const p=data.contacts[target];if(!p)fail('user_not_found');if(data.blocked[target])fail('blocked');if(!p.friendship)fail('not_friends');return p;}
    async function request(action,fields={}) {
        await ready;
        if(action==='sync') {
            activity=fields.activity||activity;active=fields.active!==false;
            try{await poll();}catch(e){if(e.message==='storage_full')throw e;}
            return snapshot();
        }
        if(action==='search') {
            const query=String(fields.query||'').trim(),parsed=parseCode(query);
            if(parsed){if(parsed.id===data.id)fail('user_not_found');contact(parsed);save();return {results:data.blocked[parsed.id]?[]:[view(data.contacts[parsed.id])]};}
            const login=query.toLowerCase().replace(/^@/,'');if(!/^[a-z0-9_]{3,20}$/.test(login))fail('search_format');
            let result;try{result=await poll(login);}catch(e){}
            const known=Object.values(data.contacts).filter(p=>p.login.startsWith(login)&&!data.blocked[p.id]);
            const results=result?.results||known;if(!online&&!results.length)fail('network');return {results:results.filter(p=>!data.blocked[p.id]).map(p=>view(data.contacts[p.id]||p))};
        }
        const backup=JSON.stringify(data);
        try {
            if(action==='login') {
                const login=String(fields.login||'').toLowerCase().trim();if(!/^[a-z][a-z0-9_]{2,19}$/.test(login))fail('login_format');data.login=login;
            }else if(action==='dnd')data.dnd=!!fields.enabled;
            else {
                const id=fields.target,p=data.contacts[id];if(!p||id===data.id)fail('user_not_found');
                if(action!=='unblock'&&data.blocked[id])fail('blocked');
                if(action==='request') {
                    if(Object.keys(data.outgoing).length>=50&&!data.outgoing[id])fail('request_limit');
                    if(!p.friendship&&!data.outgoing[id]){const packet=enqueue(id,{kind:'request'});data.outgoing[id]={id:packet,at:stamp()};}
                }else if(action==='accept') {
                    const incoming=data.incoming[id];if(!incoming)fail('request_missing');
                    if(Object.values(data.contacts).filter(p=>p.friendship).length>=100&&!p.friendship)fail('friend_limit');
                    const token=[incoming.id,data.outgoing[id]?.id].filter(Boolean).sort()[0];
                    p.friendship=token;enqueue(id,{kind:'accept',request:incoming.id,friendship:token});delete data.incoming[id];delete data.outgoing[id];
                }else if(action==='decline') {
                    if(data.incoming[id])enqueue(id,{kind:'decline',request:data.incoming[id].id});delete data.incoming[id];
                }else if(action==='cancel_request') {
                    if(data.outgoing[id]){enqueue(id,{kind:'request_cancel',request:data.outgoing[id].id});data.outbox=data.outbox.filter(q=>q.id!==data.outgoing[id].id);}delete data.outgoing[id];
                }else if(action==='remove'||action==='block') {
                    data.outbox=data.outbox.filter(q=>q.to!==id);
                    if(p.friendship)enqueue(id,{kind:'remove',friendship:p.friendship});
                    if(data.outgoing[id])enqueue(id,{kind:'request_cancel',request:data.outgoing[id].id});
                    if(data.incoming[id])enqueue(id,{kind:'decline',request:data.incoming[id].id});
                    for(const inv of Object.values(data.invites))if((inv.sender===id||inv.receiver===id)&&['pending','accepted'].includes(inv.state))try{await rpc({op:'revoke',room:inv.room,invite:inv.id});}catch(e){}
                    unlink(id);if(action==='block')data.blocked[id]=true;
                }else if(action==='unblock')delete data.blocked[id];
                else if(action==='profile')return {profile:view(p),stats:null};
                else {
                    friend(id);
                    if(action==='favorite') {if(fields.enabled)data.favorites[id]=true;else delete data.favorites[id];}
                    else if(action==='message') {
                        if(typeof fields.text!=='string'||!fields.text.trim()||fields.text.length>300)fail('message_format');
                        const rows=data.messages[id]||(data.messages[id]=[]),nonce=fields.nonce||uuid();
                        if(!rows.some(m=>m.id===nonce)) {
                            enqueue(id,{kind:'message',text:fields.text.trim(),friendship:p.friendship},nonce);
                            rows.push({id:nonce,sender:data.id,receiver:id,text:fields.text.trim(),at:stamp(),seen:false,delivery:'queued'});
                        }
                    }else if(action==='conversation') {
                        const rows=data.messages[id]||[],ids=rows.filter(m=>m.sender===id&&!m.seen).map(m=>m.id);
                        if(ids.length){enqueue(id,{kind:'read',ids,friendship:p.friendship});rows.forEach(m=>{if(m.sender===id)m.seen=true;});}
                        save();return {messages:rows.slice(-100)};
                    }else if(action==='invite') {
                        if(!online||(p.status==='offline'&&!pushAvailable))fail('offline');if(p.status==='dnd')fail('dnd');if(!['online','offline'].includes(p.status))fail('busy');
                        const inv=uuid(),room=await rpc({op:'reserve',target:id,token:fields.token,invite:inv});
                        data.invites[inv]={id:inv,sender:data.id,receiver:id,room:room.code,expires:room.expires,state:'pending'};
                        enqueue(id,{kind:'invite',room:room.code,expires:room.expires,friendship:p.friendship},inv,90);
                    }else if(['accept_invite','decline_invite','cancel_invite'].includes(action)) {
                        const inv=data.invites[fields.invite];if(!inv||inv.expires<=stamp()||inv.state!=='pending'||(inv.sender!==id&&inv.receiver!==id))fail('invite_expired');
                        if(action==='accept_invite') {
                            if(data.dnd||inv.receiver!==data.id)fail('busy');
                            const result=await rpc({op:'accept',room:inv.room,invite:inv.id});inv.state='accepted';enqueue(id,{kind:'invite_response',invite:inv.id,state:'accepted',friendship:p.friendship},uuid(),90);save();return result;
                        }
                        try{await rpc({op:'revoke',room:inv.room,invite:inv.id});}catch(e){}
                        inv.state=action==='decline_invite'?'declined':'cancelled';
                        enqueue(id,{kind:action==='decline_invite'?'invite_response':'invite_cancel',invite:inv.id,state:inv.state,friendship:p.friendship},uuid(),90);
                    }else fail('action');
                }
            }
            save();
        }catch(e){data=JSON.parse(backup);throw e;}
        // Durable local action succeeds offline; transmit as soon as a route exists.
        setTimeout(()=>{poll().then(()=>window.RCFriends?.sync()).catch(()=>{});},0);
        return snapshot();
    }
    function remember(p) {
        ready.then(()=>{if(contact(p)){data.recent[p.id]=stamp();save();window.RCFriends?.sync();}}).catch(()=>{});
    }
    window.RCLocalFriends={ready,request,code:()=>data?code():null,profile:()=>data?me():{},remember,syncNotifications:()=>{if(data)window.RCNotifications?.syncLocal(data);},get online(){return online;}};
})();
