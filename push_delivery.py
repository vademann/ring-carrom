"""FCM delivery. Firestore stores only device routing metadata, never events/history."""
import asyncio
import json
import logging
import os
import re
import time
from pathlib import Path
import aiohttp

KINDS={'request','accept','message','invite','request_cancel','decline','remove','invite_cancel','invite_response','read'}
VISIBLE={'request','accept','message','invite'}

class FirebasePush:
    def __init__(self):
        self.credentials=None
        self.project=''
        self.routes={}
        self.sent={}
        self.pending=set()
        self.tasks=set()
        self.registration={}
        self.refresh_lock=asyncio.Lock()
        self.route_locks={}
        inline=os.environ.get('FIREBASE_CREDENTIALS_JSON')
        path=os.environ.get('GOOGLE_APPLICATION_CREDENTIALS')
        if not path:
            candidate=Path(__file__).with_name('secrets')/'firebase-admin.json'
            if candidate.is_file():path=str(candidate)
        if inline or path:
            try:
                from google.oauth2.service_account import Credentials
                if inline:
                    info=json.loads(inline)
                    self.credentials=Credentials.from_service_account_info(info,scopes=['https://www.googleapis.com/auth/firebase.messaging','https://www.googleapis.com/auth/datastore'])
                    self.project=self.credentials.project_id
                else:
                    self.credentials=Credentials.from_service_account_file(path,scopes=['https://www.googleapis.com/auth/firebase.messaging','https://www.googleapis.com/auth/datastore'])
                    self.project=self.credentials.project_id
                if not re.fullmatch('[a-z][a-z0-9-]{4,62}',self.project):raise ValueError('project')
            except Exception:
                self.credentials=None
                logging.error('Push credentials could not be loaded; social relay remains available')

    @property
    def available(self):return self.credentials is not None

    async def access(self):
        async with self.refresh_lock:
            if not self.credentials.valid:
                from google.auth.transport.requests import Request
                request=Request()
                def refresh_request(*args,**kwargs):
                    kwargs['timeout']=4
                    return request(*args,**kwargs)
                await asyncio.wait_for(asyncio.to_thread(self.credentials.refresh,refresh_request),6)
            return self.credentials.token

    async def call(self,method,url,payload=None):
        access=await self.access()
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=5)) as session:
            async with session.request(method,url,json=payload,headers={'Authorization':'Bearer '+access}) as response:
                try:data=await response.json()
                except (ValueError,aiohttp.ContentTypeError):data={}
                return response.status,data

    def document(self,uid):
        if not isinstance(uid,str) or not re.fullmatch('[a-f0-9]{64}',uid):raise ValueError('identity')
        return f'https://firestore.googleapis.com/v1/projects/{self.project}/databases/(default)/documents/rc_push_routes/{uid}'

    async def route(self,uid):
        now=time.time()
        cached=self.routes.get(uid)
        if cached and now-cached['cached']<600:return cached
        status,result=await self.call('GET',self.document(uid))
        if status==404:route={'token':'','updated':0,'cached':now}
        elif status==200:
            fields=result.get('fields',{})
            route={'token':fields.get('token',{}).get('stringValue',''),'updated':int(fields.get('updated',{}).get('integerValue',0)),'cached':now}
            if now-route['updated']>30*86400:route['token']=''
        else:raise RuntimeError('Push directory unavailable: '+str(status))
        if len(self.routes)>=5000:self.routes.pop(next(iter(self.routes)))
        self.routes[uid]=route
        return route

    async def has_route(self,uid):
        if not self.available:return False
        try:return bool((await self.route(uid))['token'])
        except Exception:
            logging.warning('Push directory lookup failed')
            return False

    async def register(self,uid,token):
        if not isinstance(token,str) or (token and not re.fullmatch('[a-zA-Z0-9_:.-]{20,4096}',token)):return
        lock=self.route_locks.setdefault(uid,asyncio.Lock())
        try:
            async with lock:
                old=await self.route(uid)
                now=time.time()
                if old['token']==token and (not token or now-old['updated']<86400):return
                if token:
                    status,_=await self.call('PATCH',self.document(uid),{'fields':{'token':{'stringValue':token},'updated':{'integerValue':str(int(now))}}})
                    if status!=200:raise RuntimeError('registration')
                else:
                    status,_=await self.call('DELETE',self.document(uid))
                    if status not in (200,404):raise RuntimeError('unregister')
                self.routes[uid]={'token':token,'updated':now,'cached':now}
        finally:
            if not lock.locked():self.route_locks.pop(uid,None)

    async def deliver(self,sender,packet):
        kind=packet['payload'].get('kind')
        if kind not in KINDS:return
        now=time.time()
        expires=min(int(packet.get('expires',now+7*86400)),int(now+7*86400))
        if kind=='invite':expires=min(expires,int(packet['payload'].get('expires',0)))
        if expires<=now:return
        key=sender['id']+':'+packet['id']
        if self.sent.get(key,0)>now:return
        route=await self.route(packet['to'])
        if not route['token']:return
        event={'id':key,'packet':packet['id'],'target':packet['to'],'sender':sender,'payload':packet['payload']}
        raw=json.dumps(event,ensure_ascii=False,separators=(',',':'))
        if len(raw.encode())>3500:return
        message={'token':route['token'],'data':{'event':raw},'android':{'priority':'high' if kind in VISIBLE else 'normal','ttl':str(max(1,int(expires-now)))+'s'}}
        # No collapse_key: independent requests/messages must not replace one another.
        status,result=await self.call('POST',f'https://fcm.googleapis.com/v1/projects/{self.project}/messages:send',{'message':message})
        if status==200:
            self.sent[key]=expires
            if len(self.sent)>10000:self.sent={k:v for k,v in list(self.sent.items())[-8000:] if v>now}
        elif any(d.get('errorCode')=='UNREGISTERED' for d in result.get('error',{}).get('details',[])):
            # Remove only the obsolete token, never a token refreshed concurrently.
            if self.routes.get(packet['to'],{}).get('token')==route['token']:await self.register(packet['to'],'')
        else:raise RuntimeError('FCM send status '+str(status))

    def spawn(self,key,job):
        if key in self.pending or len(self.pending)>=512:
            job.close();return
        self.pending.add(key)
        async def run():
            try:await job
            except asyncio.CancelledError:raise
            except Exception:logging.warning('Push delivery deferred; event retained by sender')
            finally:self.pending.discard(key)
        task=asyncio.create_task(run());self.tasks.add(task);task.add_done_callback(self.tasks.discard)

    def enqueue(self,body,result):
        if not self.available or body.get('op','poll')!='poll':return
        sender=result['me'];uid=sender['id']
        if 'pushToken' in body:self.spawn('register:'+uid,self.register(uid,body['pushToken']))
        for packet in body.get('packets',[]):
            if packet.get('payload',{}).get('kind') not in KINDS:continue
            key=uid+':'+packet['id']
            if self.sent.get(key,0)>time.time():continue
            self.spawn(key,self.deliver(sender,packet))

    async def close(self):
        tasks=list(self.tasks)
        for task in tasks:task.cancel()
        await asyncio.gather(*tasks,return_exceptions=True)

push=FirebasePush()
