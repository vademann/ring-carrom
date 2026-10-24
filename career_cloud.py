"""Atomic two-player Firestore ratings with idempotent match receipts."""
import asyncio
import json
import os
from push_delivery import push
import career

class CloudCareer:
    @property
    def enabled(self):return push.available and os.environ.get('RC_CLOUD_CAREER','1')!='0'
    def name(self,collection,key):return f'projects/{push.project}/databases/(default)/documents/{collection}/{key}'
    async def document(self,collection,key):
        status,result=await push.call('GET','https://firestore.googleapis.com/v1/'+self.name(collection,key))
        if status==404:return None,None
        if status!=200:raise RuntimeError('Rating storage unavailable')
        return json.loads(result['fields']['data']['stringValue']),result['updateTime']
    def write(self,collection,key,value,stamp):
        return {'update':{'name':self.name(collection,key),'fields':{'data':{'stringValue':json.dumps(value,ensure_ascii=False,separators=(',',':'))}}},'currentDocument':{'updateTime':stamp} if stamp else {'exists':False}}
    async def read(self,key):
        if not self.enabled:return career.read(key)
        value,_=await self.document('rc_career',key)
        return value if value is not None else career.read(key)
    async def record(self,game,players,winner,reason,at):
        if not self.enabled:
            career.record(game,players,winner,reason,at);return
        keys=[p.career_id if p else None for p in players]
        if not all(keys) or keys[0]==keys[1]:return
        for attempt in range(5):
            receipt,_=await self.document('rc_match_receipts',game)
            if receipt is not None:
                for key in keys:
                    value,_=await self.document('rc_career',key)
                    if value:career.install(key,value)
                return
            values=[];stamps=[]
            for key in keys:
                value,stamp=await self.document('rc_career',key)
                values.append(value if value is not None else career.read(key));stamps.append(stamp)
            ratings=[v['rating'] for v in values]
            score=.5 if winner is None else float(winner==0)
            delta=round(24*(score-1/(1+10**((ratings[1]-ratings[0])/400))))
            for i,value in enumerate(values):
                won=winner==i;lost=winner is not None and winner!=i
                change=delta if i==0 else -delta
                value.update(rating=value['rating']+change,wins=value['wins']+int(won),losses=value['losses']+int(lost),draws=value['draws']+int(winner is None),streak=value['streak']+1 if won else 0,shots=value['shots']+players[i].shots,hits=value['hits']+players[i].hits)
                value['best']=max(value['best'],value['streak'])
                row=dict(game=game,at=at,result='win' if won else 'loss' if lost else 'draw',opponent=str((players[1-i].profile or {}).get('name','Player'))[:12],delta=change,reason=reason)
                value['history']=[row,*value.get('history',[])][:20]
            writes=[self.write('rc_career',key,value,stamp) for key,value,stamp in zip(keys,values,stamps)]
            writes.append(self.write('rc_match_receipts',game,dict(at=at,players=keys),None))
            status,_=await push.call('POST',f'https://firestore.googleapis.com/v1/projects/{push.project}/databases/(default)/documents:commit',{'writes':writes})
            if status==200:
                for key,value in zip(keys,values):career.install(key,value)
                return
            if status not in (409,400):raise RuntimeError('Rating commit unavailable')
            await asyncio.sleep(.1*(attempt+1))
        raise RuntimeError('Rating write conflict')

cloud=CloudCareer()
