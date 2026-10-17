"""Transient social routing only. No database, filesystem or offline mailboxes.

Phones retain their contacts, friendship decisions, outboxes and conversations.
This module keeps online routes and short-lived in-flight packets in RAM only.
"""
import hashlib
import json
import re
import time

peers = {}
rates = {}
TTL = 18
PACKET_TTL = 30

class RelayError(Exception):
    pass

def identity(secret):
    if not isinstance(secret,str) or not re.fullmatch('[a-f0-9]{64}',secret):
        raise RelayError('identity')
    return hashlib.sha256(secret.encode()).hexdigest()

def prune():
    now=time.monotonic()
    for key,p in list(peers.items()):
        if now-p['seen'] > TTL:
            del peers[key]
        else:
            p['inbox']={eid:event for eid,event in p['inbox'].items() if now-event['stamp']<PACKET_TTL}
    if len(rates)>5000:
        for key,(stamp,_) in list(rates.items()):
            if now-stamp>60:rates.pop(key,None)

def public(peer):
    return dict(peer['profile'],status=peer['status'],lastSeen=int(time.time()))

def can_join(room,key):
    return not getattr(room,'invited_id',None) or (
        room.invited_id==key and room.invite_accepted and room.invite_expires>time.time())

def execute(body,rooms,tokens,room_status):
    uid=identity(body.get('identity'))
    prune()
    now=time.monotonic()
    stamp,count=rates.get(uid,(now,0))
    if now-stamp>60:stamp,count=now,0
    if count>=180:raise RelayError('rate_limit')
    rates[uid]=(stamp,count+1)
    op=body.get('op','poll')
    if op=='poll':
        p=body.get('profile')
        if not isinstance(p,dict) or not re.fullmatch('[a-z][a-z0-9_]{2,19}',str(p.get('login',''))) or not isinstance(p.get('name'),str) or not 1<=len(p['name'])<=12 or type(p.get('avatar')) is not int or not 0<=p['avatar']<6:
            raise RelayError('profile')
        if len(peers)>=2000 and uid not in peers:raise RelayError('rate_limit')
        peer=peers.setdefault(uid,dict(inbox={},seen=now))
        level=p.get('level',1)
        peer['profile']=dict(id=uid,login=p['login'],name=p['name'],avatar=p['avatar'],level=max(1,min(10000,level)) if type(level) is int else 1)
        peer['seen']=now if body.get('active',True) else now-TTL-1
        peer['status']=room_status(uid) or ('dnd' if body.get('dnd') else body.get('activity','online'))
        if peer['status'] not in ('online','offline','in_game','waiting','dnd'):raise RelayError('profile')
        received=body.get('received',[])
        packets=body.get('packets',[])
        watch=body.get('watch',[])
        if not all(isinstance(v,list) for v in (received,packets,watch)) or len(received)>128 or len(packets)>32 or len(watch)>250:
            raise RelayError('request')
        for eid in received:
            if isinstance(eid,str):peer['inbox'].pop(eid,None)
        forwarded=[]
        for packet in packets:
            if not isinstance(packet,dict) or not isinstance(packet.get('id'),str) or not re.fullmatch('[a-zA-Z0-9_-]{8,80}',packet['id']) or not re.fullmatch('[a-f0-9]{64}',str(packet.get('to',''))) or not isinstance(packet.get('payload'),dict) or len(json.dumps(packet))>6000:
                raise RelayError('request')
            target=peers.get(packet['to'])
            if not target or now-target['seen']>TTL:continue
            event_id=uid+':'+packet['id']
            if len(target['inbox'])>=128 and event_id not in target['inbox']:continue
            target['inbox'].setdefault(event_id,dict(stamp=now,event=dict(id=event_id,packet=packet['id'],sender=public(peer),payload=packet['payload'])))
            forwarded.append(packet['id'])
        watched={key:public(peers[key]) for key in watch if isinstance(key,str) and key in peers and now-peers[key]['seen']<=TTL}
        query=str(body.get('query','')).lower().strip().lstrip('@')
        results=[]
        if query and re.fullmatch('[a-z0-9_]{3,20}',query):
            results=[public(p) for key,p in peers.items() if key!=uid and now-p['seen']<=TTL and p['profile']['login'].startswith(query)][:15]
        return dict(me=public(peer),online=watched,results=results,events=[v['event'] for v in list(peer['inbox'].values())[:128]],forwarded=forwarded)
    if op=='reserve':
        found=tokens.get(str(body.get('token','')))
        other=body.get('target')
        target=peers.get(other) if isinstance(other,str) else None
        if not target:raise RelayError('offline')
        if target['status']=='dnd':raise RelayError('dnd')
        if target['status']!='online':raise RelayError('busy')
        if not found or found[1]!=0 or found[0].closed or found[0].matched or found[0].quick or found[0].players[0].career_id!=uid:
            raise RelayError('room_unavailable')
        inv=body.get('invite')
        if not isinstance(inv,str) or not re.fullmatch('[a-zA-Z0-9_-]{8,80}',inv):raise RelayError('request')
        room=found[0]
        room.invited_id=other;room.invite_accepted=False;room.invite_expires=time.time()+90;room.invite_id=inv
        return dict(code=room.code,expires=int(room.invite_expires))
    if op in ('accept','revoke'):
        room=rooms.get(str(body.get('room','')))
        if not room or room.closed or room.matched or not getattr(room,'invited_id',None) or getattr(room,'invite_id',None)!=body.get('invite'):
            raise RelayError('invite_expired')
        if op=='accept':
            if room.invited_id!=uid or room.invite_expires<=time.time():raise RelayError('invite_expired')
            if room_status(uid):raise RelayError('busy')
            room.invite_accepted=True
            return dict(code=room.code)
        if uid not in (room.invited_id,room.players[0].career_id):raise RelayError('invite_expired')
        room.invite_accepted=False;room.invite_expires=0
        return dict(ok=True)
    raise RelayError('action')
