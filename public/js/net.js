"use strict";
(function (global) {
    const nativeRequests=new Map();
    global.RCOnlineResult=result=>{
        const request=nativeRequests.get(result.id);
        if(!request)return;
        nativeRequests.delete(result.id);request.finish();
        if(result.error)request.reject(new Error(result.error));
        else request.resolve({ok:result.status>=200 && result.status<300,status:result.status,json:async()=>JSON.parse(result.body)});
    };
    function request(url,options={}) {
        // OnlineBridge enforces the HTTPS hosts bundled in server-config.js.
        if(!global.RCOnline || !/^(https:\/\/|http:\/\/10\.0\.2\.2:8787\/)/.test(url))return fetch(url,options);
        return new Promise((resolve,reject)=>{
            const id=token();
            const abort=()=>{RCOnline.cancel(id);nativeRequests.delete(id);reject(new Error("Native request aborted"));};
            nativeRequests.set(id,{resolve,reject,finish:()=>options.signal?.removeEventListener("abort",abort)});
            options.signal?.addEventListener("abort",abort,{once:true});
            if(options.signal?.aborted){abort();return;}
            RCOnline.request(id,url,options.body||"");
        });
    }
    function token() {
        const bytes = new Uint8Array(32);
        crypto.getRandomValues(bytes);
        return Array.from(bytes, b => b.toString(16).padStart(2,"0")).join("");
    }
    const net = {
        request,
        identity() {
            let value=localStorage.getItem('rc_identity');
            if(!/^[a-f0-9]{64}$/.test(value||'')){value=token();localStorage.setItem('rc_identity',value);}
            return value;
        },
        async career() {
            for(const endpoint of this.endpoints()) {
                const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),3500);
                try {
                    const response=await request(endpoint.replace(/^ws/,"http").replace(/\/ws$/,"/career"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({identity:this.identity()}),signal:controller.signal});
                    if(response.ok)return await response.json();
                }catch(e){}finally{clearTimeout(timer);}
            }
            throw new Error('offline');
        },
        myIndex:0, onMessage:null, onStatus:null, socket:null, code:"", connected:false,
        generation:0, heartbeat:null, retry:null, deadline:null,
        inbox:new Map(), diagnostics:{gaps:0,replays:0,errors:[],lastClose:null},
        get ready() { return typeof WebSocket !== "undefined"; },
        saved() {
            try { const s=JSON.parse(localStorage.getItem("rc_session")); return s && Date.now()-s.savedAt<900000 && s.token && s.everConnected && !this.departures().some(e=>e.token===s.token) ? s : null; } catch(e) { return null; }
        },
        persist() {
            if (!this.active || !this.token || !this.everConnected) return;
            try { localStorage.setItem("rc_session",JSON.stringify({endpoint:this.endpoint(),urls:this.endpoints(),savedAt:Date.now(),token:this.token,code:this.code,myIndex:this.myIndex,operation:this.operation,nextSeq:this.nextSeq,lastReceived:this.lastReceived,pending:[...this.pending],everConnected:true,polling:!!this.polling})); } catch(e) {}
        },
        resumeSaved(s) {
            this.destroy(false);
            this.addEndpoints(s.urls || [s.endpoint]);
            Object.assign(this,{token:s.token,code:s.code,myIndex:s.myIndex,operation:s.operation,nextSeq:s.nextSeq,lastReceived:s.lastReceived,pending:new Map(s.pending),registered:true,everConnected:true,readyCalled:true,active:true,reloading:true,downSince:Date.now(),attempts:0,onReady:null});
            if(s.polling || global.RCOnline)this.startPolling();else this.attempt();
        },
        departures() {
            try {return (this.departureFallback || JSON.parse(global.RCOnline?.loadDepartures?RCOnline.loadDepartures():localStorage.getItem("rc_departures"))||[]).filter(s=>s.token && Date.now()-s.created<900000);}catch(e){return [];}
        },
        saveDepartures(entries) {
            const value=JSON.stringify(entries);
            this.departureFallback=global.RCOnline?.saveDepartures && !RCOnline.saveDepartures(value)?entries:null;
            try {localStorage.setItem("rc_departures",value);}catch(e){this.departureFallback=entries;}
        },
        queueLeave(s) {
            if(!s || !s.token)return;
            const entries=this.departures().filter(entry=>entry.token!==s.token);
            entries.push({token:s.token,created:Date.now(),urls:[...new Set([this.endpoint(),...(s.urls||[]),s.endpoint].filter(Boolean))]});
            this.saveDepartures(entries.slice(-64));
            this.flushLeaves();
        },
        async flushLeaves() {
            if(this.leaveBusy)return;
            clearTimeout(this.leaveTimer);this.leaveBusy=true;
            try {
                for(const entry of this.departures()) {
                    for(const endpoint of [...new Set([...this.endpoints(),...entry.urls])]) {
                        const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),2500);
                        let closed=false;
                        try {
                            const response=await request(endpoint.replace(/^ws/,"http").replace(/\/ws$/,"/leave"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:entry.token}),signal:controller.signal});
                            closed=response.ok && (await response.json()).closed===true;
                        } catch(e) {} finally {clearTimeout(timer);}
                        if(closed){
                            this.saveDepartures(this.departures().filter(s=>s.token!==entry.token));
                            try {if(JSON.parse(localStorage.getItem("rc_session"))?.token===entry.token)localStorage.removeItem("rc_session");}catch(e){}
                            break;
                        }
                    }
                }
            } finally {
                this.leaveBusy=false;
                if(this.departures().length)this.leaveTimer=setTimeout(()=>this.flushLeaves(),1000);
            }
        },
        discardSaved(s) {
            this.queueLeave(s);
            if(this.active && this.token===s.token)this.destroy(false);
            const saved=this.saved();
            if(!saved || saved.token===s.token)localStorage.removeItem("rc_session");
        },
        async checkSaved(s) {
            for(const endpoint of [...new Set([...this.endpoints(),...(s.urls||[]),s.endpoint].filter(Boolean))]) {
                const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),1500);
                try {
                    const response=await request(endpoint.replace(/^ws/,"http").replace(/\/ws$/,"/poll"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({protocol:4,token:s.token,check:true}),signal:controller.signal});
                    if(response.ok){const result=await response.json();if(typeof result.events?.[0]?.exists==="boolean")return result.events[0].exists;}
                } catch(e) {} finally {clearTimeout(timer);}
            }
            return null;
        },
        emit(kind) { if(this.onStatus) this.onStatus(kind); },
        endpoints() {
            if(!this.urls) {
                const origin=/^https?:$/.test(location.protocol)?[(location.protocol==="https:"?"wss://":"ws://")+location.host+"/ws"]:[];
                this.urls=[...new Set([...origin,...(global.RC_SERVER_URLS||[]),global.RC_SERVER_URL].filter(Boolean))];
            }
            return this.urls;
        },
        addEndpoints(urls, replace=false) {
            const current=this.endpoint();
            const valid=urls.filter(u=>typeof u==="string" && /^wss?:\/\/[^/]+\/ws$/.test(u));
            this.urls=[...new Set([...valid,...(replace && valid.length && current.includes(".trycloudflare.com/")?[]:this.endpoints())])].slice(0,8);
            this.urlIndex=Math.max(0,this.urls.indexOf(current));
        },
        endpoint() { const urls=this.endpoints();return urls[(this.urlIndex||0)%urls.length]||""; },
        rotateEndpoint() {
            this.urlIndex=((this.urlIndex||0)+1)%Math.max(1,this.endpoints().length);
            this.pollFirst=true;
        },
        async discoverEndpoints() {
            if(this.discoveryAt && Date.now()-this.discoveryAt<20000)return;
            this.discoveryAt=Date.now();
            const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),5000);
            try {
                const response=await request(this.endpoint().replace(/^ws/,"http").replace(/\/ws$/,"/config"),{signal:controller.signal,cache:"no-store"});
                if(response.ok) { const config=await response.json();if(Array.isArray(config.urls))this.addEndpoints(config.urls.map(u=>u.replace(/^http/,"ws")+"/ws"),true); }
            } catch(e) {} finally {clearTimeout(timer);}
        },
        connect(op, code, onReady, quick=false) {
            this.destroy();
            this.quick = quick;
            this.peerUntil = null;
            this.myIndex = op === "host" ? 0 : 1;
            this.code = code;
            this.operation = op;
            this.onReady = onReady;
            this.token = token();
            this.registered = false;
            this.everConnected = false;
            this.readyCalled = false;
            this.nextSeq = 0;
            this.lastReceived = 0;
            this.pending = new Map();
            this.downSince = Date.now();
            this.attempts = 0;
            this.transportFailures=[];
            this.active = true;
            if(global.RCOnline)this.startPolling();else this.attempt();
        },
        wire(message) {
            if(this.polling) {
                if(message.op==="data" || message.op==="received" || message.op==="ping")return;
                if(message.op==="live")this.pollLive=message;
                else if(!this.pollOutbox.some(m=>m.op===message.op))this.pollOutbox.push(message);
                return;
            }
            if (this.socket && this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
        },
        pollEndpoint() { return this.endpoint().replace(/^ws:/,"http:").replace(/^wss:/,"https:").replace(/\/ws$/,"/poll"); },
        startPolling() {
            if(!this.active || !this.token)return;
            clearInterval(this.heartbeat);clearTimeout(this.deadline);clearTimeout(this.retry);
            const ws=this.socket;this.socket=null;if(ws)try{ws.close();}catch(e){}
            this.polling=true;this.pollId=token();this.pollFirst=true;this.pollOutbox=[];this.pollLive=null;
            this.connected=false;this.emit("reconnecting");this.persist();
            this.pollTimer=setTimeout(()=>this.poll(),0);
        },
        async poll() {
            if(!this.active || !this.polling)return;
            const generation=this.generation;
            const pending=[...this.pending].slice(0,48).map(([seq,data])=>({op:"data",seq,data}));
            const extra=this.pending.size<=48?this.pollOutbox.splice(0,10):[];
            const messages=[{op:"received",seq:this.lastReceived},...pending,...extra,{op:"ping"}];
            if(this.pollLive){messages.push(this.pollLive);this.pollLive=null;}
            const controller=new AbortController();this.pollController=controller;
            const timer=setTimeout(()=>controller.abort(),4000);
            try {
                const response=await request(this.pollEndpoint(),{method:"POST",headers:{"Content-Type":"application/json"},
                    body:JSON.stringify({protocol:4,token:this.token,identity:this.identity(),quick:this.quick,pollId:this.pollId,resume:this.pollFirst,operation:this.registered?undefined:this.operation,code:this.code,messages}),signal:controller.signal,cache:"no-store"});
                if(!response.ok && response.status!==403 && response.status!==409)throw new Error("HTTP "+response.status);
                const result=await response.json();
                if(!this.active || this.generation!==generation)return;
                if(result.retry)this.pollFirst=true;
                else {
                    this.pollFirst=false;this.downSince=null;this.discoverEndpoints();
                    for(const event of result.events||[]) {if(!this.active)break;this.receiveWire(event);}
                }
                this.persist();
            } catch(error) {
                if(!this.active || this.generation!==generation)return;
                this.pollOutbox.unshift(...extra);
                this.diagnostics.lastNetworkError=String(error);
                this.rotateEndpoint();
                this.connected=false;this.emit("reconnecting");
                if(!this.downSince)this.downSince=Date.now();
                if(Date.now()-this.downSince>895000){this.terminal("expired");return;}
            } finally {clearTimeout(timer);if(this.pollController===controller)this.pollController=null;}
            if(this.active && this.generation===generation)this.pollTimer=setTimeout(()=>this.poll(),this.downSince?250:600);
        },
        callReady() {
            if (this.readyCalled) return;
            this.readyCalled = true;
            if (this.onReady) this.onReady(this.operation === "host" ? {code:this.code} : undefined);
        },
        activate() {
            this.peerUntil = null;
            this.discoverEndpoints();
            this.connected = true;
            this.downSince = null;
            const initial = !this.everConnected;
            this.everConnected = true;
            this.persist();
            if (this.operation === "join") this.callReady();
            this.emit(initial ? "connected" : "reconnected");
        },
        acknowledge(seq) {
            if(!Number.isInteger(seq) || seq<0 || seq>this.nextSeq)return;
            for(const id of this.pending.keys()) if(id <= seq) this.pending.delete(id);
            this.persist();
        },
        flush() {
            for(const [seq,data] of this.pending) this.wire({op:"data",seq,data});
        },
        deliver(data) {
            try { if(this.onMessage) this.onMessage(data); }
            catch(error) {
                const message=String(error && error.stack || error).slice(0,1000);
                this.diagnostics.errors.push(message);
                if(this.diagnostics.errors.length>10)this.diagnostics.errors.shift();
                console.error("Network handler",message);
                this.wire({op:"client-error",message});
                if(data.t!=="restore-game") this.wire({op:"restore"});
            }
        },
        requestReplay() {
            if(this.lastReplayAt && Date.now()-this.lastReplayAt<500)return;
            this.lastReplayAt=Date.now();
            this.diagnostics.replays++;
            this.wire({op:"replay",seq:this.lastReceived});
        },
        receiveReliable(msg) {
            if (!Number.isInteger(msg.seq) || msg.seq<1) return;
            if(msg.seq>this.lastReceived) this.inbox.set(msg.seq,msg.data);
            while(this.inbox.has(this.lastReceived+1)) {
                const seq=this.lastReceived+1, data=this.inbox.get(seq);
                this.inbox.delete(seq);
                this.lastReceived=seq;
                this.deliver(data);
            }
            this.persist();
            this.wire({op:"received",seq:this.lastReceived});
            if(this.inbox.size) {
                this.diagnostics.gaps++;
                this.requestReplay();
            }
        },
        attempt() {
            if (!this.active) return;
            const generation = this.generation;
            let ws;
            try { ws = new WebSocket(this.endpoint()); }
            catch(e) { this.terminal("offline"); return; }
            this.socket = ws;
            const current = () => this.active && this.generation === generation && this.socket === ws;
            this.deadline = setTimeout(()=>{if(current())this.lost(ws);},6000);
            ws.onopen = () => {
                if (!current()) return;
                this.lastSeen = Date.now();
                this.wire(this.registered ? {op:"resume",token:this.token,protocol:4} : {op:this.operation,code:this.code,token:this.token,protocol:4,quick:this.quick,identity:this.identity()});
                clearInterval(this.heartbeat);
                this.heartbeat = setInterval(()=>{
                    if (!current()) return;
                    if (Date.now()-this.lastSeen > 6000) { this.lost(ws); return; }
                    this.wire({op:"ping"});
                    this.flush();
                    this.wire({op:"received",seq:this.lastReceived});
                    this.persist();
                },2000);
            };
            ws.onmessage = event => {
                if (!current()) return;
                let msg;
                try { msg = JSON.parse(event.data); } catch(e) { return; }
                this.receiveWire(msg);
            };
            ws.onerror = () => { if(current()) this.lost(ws); };
            ws.onclose = event => { if(current()) {this.diagnostics.lastClose={code:event.code,reason:event.reason};this.lost(ws);} };
        },
        receiveWire(msg) {
    this.lastSeen = Date.now();
    clearTimeout(this.deadline);
    if (msg.op === "hosted" || msg.op === "joined" || msg.op === "resumed") {
        if(msg.index===0 || msg.index===1)this.myIndex=msg.index;
        this.registered = true;
        this.downSince = null;
        this.token = msg.token;
        this.code = msg.code;
        this.attempts = 0;
        if (this.operation === "host") this.callReady();
        if (msg.op === "resumed") {
            if(Number.isInteger(msg.ack) && msg.ack>this.nextSeq)this.nextSeq=msg.ack;
            this.acknowledge(msg.ack);
            this.wire({op:"received",seq:this.lastReceived});
            this.flush();
            if (this.reloading) this.wire({op:"restore"});
            if (msg.matched && msg.peerOnline) this.activate();
            else if (msg.matched) { this.connected=false; this.emit("reconnecting"); }
            else if(this.operation==="host")this.emit("waiting");
        }
    } else if (msg.op === "resync" && Number.isInteger(msg.sent) && msg.sent>=this.lastReceived) {
        this.lastReceived=msg.sent;this.inbox.clear();this.persist();
        this.wire({op:"received",seq:this.lastReceived});this.wire({op:"restore"});
    } else if (msg.op === "restored") {
        this.reloading=false;
        this.deliver(msg.data);
        this.persist();
    } else if (msg.op === "connected" || msg.op === "peer-back") {
        this.activate();
    } else if (msg.op === "peer-away") {
        this.peerUntil=msg.peerUntil || Date.now()+60000;
        this.connected=false;
        this.emit("reconnecting");
    } else if (msg.op === "ack") {
        this.acknowledge(msg.seq);
    } else if (msg.op === "pong") {
        this.peerUntil=msg.peerUntil || null;
        if(this.registered && !msg.matched && this.operation==="host")this.emit("waiting");
        if(msg.matched) {
            if(msg.peerOnline && !this.connected)this.activate();
            else if(!msg.peerOnline && this.connected){this.connected=false;this.emit("reconnecting");}
        }
        if(Number.isInteger(msg.ack))this.acknowledge(msg.ack);
        if(Number.isInteger(msg.sent) && msg.sent>this.lastReceived) {
            this.requestReplay();
        }
    } else if (msg.op === "data") {
        this.receiveReliable(msg);
    } else if (msg.op === "live") {
        this.deliver(msg.data);
    } else if (msg.op === "error") {
        this.terminal(msg.error);
    } else if (msg.op === "closed") {
        if(msg.result)this.deliver(msg.result);
        this.destroy(); this.emit("closed");
    }
        },
        lost(ws) {
            if (this.socket !== ws || !this.active) return;
            this.socket = null;
            this.connected = false;
            clearInterval(this.heartbeat);
            clearTimeout(this.deadline);
            try { ws.close(); } catch(e) {}
            if (!this.downSince) this.downSince = Date.now();
            if (Date.now()-this.downSince > 895000) { this.terminal("expired"); return; }
            this.emit("reconnecting");
            this.transportFailures=(this.transportFailures||[]).filter(t=>Date.now()-t<30000);
            this.transportFailures.push(Date.now());
            this.rotateEndpoint();
            if(this.transportFailures.length>=2){this.startPolling();return;}
            const delay = Math.min(6000,500*Math.pow(1.6,this.attempts++)) + Math.random()*250;
            clearTimeout(this.retry);
            this.retry = setTimeout(()=>this.attempt(),delay);
        },
        terminal(error) {
            this.destroy();
            this.emit("error:"+error);
        },
        host(onReady) { this.connect("host","",onReady); },
        find(onReady) { this.connect("host","",onReady,true); },
        join(code,onReady) {
            code = String(code).trim().toUpperCase();
            if (!/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/.test(code)) { this.emit("error:badcode"); return; }
            this.connect("join",code,onReady);
        },
        send(data) {
            if (!this.active) return;
            if (data.t === "aim" || data.t === "place") {
                if(this.connected) this.wire({op:"live",data});
                return;
            }
            if (this.pending.size >= 128) { this.terminal("server-error"); return; }
            const seq = ++this.nextSeq;
            this.pending.set(seq,data);
            this.persist();
            if(this.registered) this.wire({op:"data",seq,data});
        },
        destroy(leave = true) {
            if(leave && this.token)this.queueLeave({token:this.token,urls:this.endpoints()});
            this.polling=false;clearTimeout(this.pollTimer);
            if(this.pollController)this.pollController.abort();
            this.reloading=false;
            if (leave) localStorage.removeItem("rc_session");
            this.active=false;
            this.generation++;
            clearInterval(this.heartbeat);
            clearTimeout(this.retry);
            clearTimeout(this.deadline);
            const ws = this.socket;
            this.socket = null;
            this.connected=false;
            if(ws) {
                try { if(leave && ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify({op:"leave"})); ws.close(); } catch(e) {}
            }
            if(this.pending) this.pending.clear();
            this.inbox.clear();
            this.token=null;this.code="";this.registered=false;
        }
    };
    global.RCNet=net;
    setTimeout(()=>net.flushLeaves(),0);
    global.addEventListener("online",()=>{
        net.flushLeaves();
        if(net.active && net.polling && !net.connected){clearTimeout(net.pollTimer);if(net.pollController)net.pollController.abort();else net.pollTimer=setTimeout(()=>net.poll(),0);}
    });
})(window);
