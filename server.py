"""Ring Carrom relay: resumable rooms and ordered, acknowledged game messages."""
import asyncio
import json
import logging
import math
import secrets
import sys
import os
import time
from types import SimpleNamespace
import career
import social_relay
from push_delivery import push
from match_engine import engine
from career_cloud import cloud
from pathlib import Path
from urllib.parse import urlsplit
if sys.platform == 'win32':
    # Avoid asyncio's transport protocol swap during Windows sendfile fallback.
    os.environ.setdefault('AIOHTTP_NOSENDFILE', '1')
from aiohttp import web, WSMsgType, ClientConnectionError

ROOT = Path(__file__).resolve().parent
ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
GRACE = 900
RECONNECT = 60
rooms = {}
tokens = {}
clients = set()
ended_tokens = {}
rating_tasks = set()

def revoke(credential):
    ended_tokens[credential] = time.monotonic()+GRACE
    while len(ended_tokens)>2000:
        ended_tokens.pop(next(iter(ended_tokens)))

class Player:
    def __init__(self, token):
        self.token = token
        self.ws = None
        self.detached = time.monotonic()
        self.received = 0
        self.next_seq = 0
        self.pending = {}
        self.history = {}
        self.profile = None
        self.write_lock = asyncio.Lock()
        self.last_replay = 0
        self.poll_lock = asyncio.Lock()
        self.outbox = asyncio.Queue(maxsize=1024)
        self.writer = None
        self.career_id = None
        self.shots = self.hits = 0

class Room:
    def __init__(self, code, host):
        self.code = code
        self.players = [host, None]
        self.closed = False
        self.match = None
        self.move = 0
        self.state_move = 0
        self.turn = 0
        self.state = None
        self.shot = None
        self.expected = None
        self.shot_at = 0
        self.restart = None
        self.restart_approved = False
        self.deadline = 0
        self.quick = False
        self.skips = [0, 0]
        self.result = None
        self.game_id = secrets.token_hex(16)
        self.paused = None
        self.started_at = time.monotonic()

    @property
    def matched(self):
        return self.players[1] is not None

def online(player):
    return player is not None and player.ws is not None and not player.ws.closed

def social_room_status(key):
    for room in rooms.values():
        if not room.closed and any(p and p.career_id == key for p in room.players):
            return 'in_game' if room.matched else 'waiting'
    return None

def social_can_join(room, key):
    return social_relay.can_join(room,key)

def social_remember(room):
    # Recent opponents are retained by the phones, never by the social relay.
    pass

async def send(player, data):
    if not online(player):
        return False
    peer = player.ws
    if isinstance(peer, HttpPeer):
        try:
            await peer.send_json(data)
            return True
        except ClientConnectionError:
            return False
    try:
        player.outbox.put_nowait((peer, data))
        if player.writer is None or player.writer.done():
            player.writer = asyncio.create_task(drain_player(player))
        return True
    except asyncio.QueueFull:
        return False

async def drain_player(player):
    while not player.outbox.empty():
        peer, data = player.outbox.get_nowait()
        if player.ws is not peer or peer.closed:
            continue
        try:
            await asyncio.wait_for(peer.send_json(data), timeout=3)
        except (ClientConnectionError, OSError, asyncio.TimeoutError):
            # Reliable messages stay in pending; another player's handler never waits.
            try:
                await asyncio.wait_for(peer.close(), timeout=1)
            except (OSError, asyncio.TimeoutError):
                pass

async def close_peer(peer):
    if peer is None:
        return
    try:
        await asyncio.wait_for(peer.close(), timeout=1)
    except (OSError, asyncio.TimeoutError):
        pass

async def close_room(room, leaver=None):
    if room.closed:
        return
    if leaver is not None and room.matched and room.state and not room.state['over']:
        await finish_game(room, 1-leaver, 'left')
    room.closed = True
    rooms.pop(room.code, None)
    for player in room.players:
        if player:
            tokens.pop(player.token, None)
            revoke(player.token)
            if online(player):
                try:
                    await asyncio.wait_for(player.ws.send_json({'op':'closed','result':result_for(room,player)}), timeout=1)
                except (ClientConnectionError, OSError, asyncio.TimeoutError):
                    pass
                await close_peer(player.ws)

def valid_payload(data, index):
    if not isinstance(data, dict):
        return False
    kind = data.get('t')
    if kind in ('rematch-request', 'rematch-response'):
        return (type(data.get('match')) is int and isinstance(data.get('id'), str) and 0 < len(data['id']) <= 64
                and (kind == 'rematch-request' or type(data.get('accept')) is bool))
    if kind == 'chat':
        return (isinstance(data.get('id'), str) and 0 < len(data['id']) <= 64
                and isinstance(data.get('text'), str) and 0 < len(data['text'].strip()) <= 300 and len(data['text']) <= 300)
    if kind == 'sync-request':
        return type(data.get('match')) is int
    if kind == 'state':
        return type(data.get('match')) is int and type(data.get('move')) is int and valid_snapshot(data.get('state'))
    if kind == 'profile':
        return isinstance(data.get('name'), str) and 0 < len(data['name'].strip()) <= 12 and type(data.get('avatar')) is int and 0 <= data['avatar'] < 6
    if kind == 'start':
        return index == 0 and type(data.get('seed')) is int and 0 <= data['seed'] <= 0x7fffffff and valid_snapshot(data.get('state'))
    if kind in ('shot', 'place', 'aim'):
        fields = ('x', 'angle', 'power') if kind in ('shot','aim') else ('x',)
        return (all(type(data.get(k)) in (float, int) and math.isfinite(data[k]) and abs(data[k]) < 2000 for k in fields)
                and (kind != 'shot' or type(data.get('match')) is int and type(data.get('move')) is int and data['move']>0 and 0<=data['power']<=1500))
    return kind in ('rematch', 'bye')

def valid_snapshot(state):
    def position(point):
        return isinstance(point, list) and len(point) >= 2 and all(type(v) in (int, float) and math.isfinite(v) and abs(v) < 2000 for v in point[:2])
    return (isinstance(state, dict) and type(state.get('turn')) is int and state['turn'] in (0, 1)
            and isinstance(state.get('scores'), list) and len(state['scores']) == 2
            and all(type(v) is int and 0 <= v <= 100 for v in state['scores'])
            and isinstance(state.get('stones'), list) and len(state['stones']) <= 10
            and all(position(p) and len(p) == 3 and p[2] in ('w','b') for p in state['stones'])
            and position(state.get('ring')) and (state.get('winner') is None or type(state.get('winner')) is int and state['winner'] in (0,1)) and type(state.get('over')) is bool)

async def queue(player, payload):
    if player is None:
        return
    player.next_seq += 1
    event = {'op':'data','seq':player.next_seq,'data':payload}
    player.pending[player.next_seq] = event
    player.history[player.next_seq] = event
    while len(player.history)>512:
        player.history.pop(next(iter(player.history)))
    await send(player, event)

def sync_state(room):
    return {'t':'sync-state','match':room.match,'move':room.state_move,'state':room.state,'shot':room.shot,'serverNow':time.time()*1000,'skips':room.skips}

def result_for(room, player):
    if not room.result:return None
    index=room.players.index(player)
    eligible=room.result['reason']=='completed' or (room.result['winner']==index and sum(p.shots for p in room.players if p)>=3)
    won=room.result['winner']==index
    reward=dict(coins=20 if won else 10 if room.result['winner'] is None else 5,xp=30 if won else 20 if room.result['winner'] is None else 10) if eligible else dict(coins=0,xp=0)
    return dict(room.result, career=career.read(player.career_id), reward=reward)

async def finish_game(room, winner, reason):
    if room.result or room.state is None:
        return
    room.deadline = 0
    room.paused = None
    room.shot = None
    room.state = dict(room.state, over=True, winner=winner, deadline=0)
    room.result = {'t':'game-result','match':room.match,'id':room.game_id,'winner':winner,'reason':reason}
    at=int(time.time()*1000)
    saved_game_id=room.game_id
    saved_players=[SimpleNamespace(career_id=p.career_id,profile=dict(p.profile or {}),shots=p.shots,hits=p.hits) if p else None for p in room.players]
    try:
        await cloud.record(saved_game_id,saved_players,winner,reason,at)
    except Exception:
        room.result['statsPending']=True
        async def retry_rating():
            for attempt in range(12):
                await asyncio.sleep(min(60,2**attempt))
                try:
                    await cloud.record(saved_game_id,saved_players,winner,reason,at)
                    if room.game_id==saved_game_id:
                        room.result.pop('statsPending',None)
                        for participant in room.players:
                            if participant:await queue(participant,result_for(room,participant))
                    return
                except Exception:logging.warning('Rating save pending')
        task=asyncio.create_task(retry_rating())
        rating_tasks.add(task);task.add_done_callback(rating_tasks.discard)
    for player in room.players:
        if player:
            await queue(player,result_for(room,player))

def peer_until(player):
    if player is None or player.detached is None or online(player):
        return None
    return (time.time()+max(0,RECONNECT-(time.monotonic()-player.detached)))*1000

def quick_room(key):
    return next((r for r in rooms.values() if r.quick and not r.closed and not r.matched
                 and online(r.players[0]) and (not key or r.players[0].career_id != key)),None)

async def session_message(room, index, player, ws, data):
    if room.closed or player.ws is not ws:
        return False
    op = data.get('op')
    now = time.monotonic()
    if op == 'ping':
        await send(player, {'op':'pong','ack':player.received,'sent':player.next_seq,'peerOnline':online(room.players[1-index]),'matched':room.matched,'peerUntil':peer_until(room.players[1-index])})
        return True
    if op == 'leave':
        await close_room(room,index)
        return False
    elif op == 'restore':
        other = room.players[1-index]
        await send(player, {'op':'restored','data':dict(sync_state(room), t='restore-game', profile=other.profile if other else None,
            restart=room.restart if room.restart and room.restart['expires'] > time.time() else None, restartApproved=room.restart_approved,
            result=result_for(room,player),peerUntil=peer_until(other))})
    elif op == 'client-error' and isinstance(data.get('message'), str):
        logging.error('Client handler error room=%s player=%s: %s',room.code,index,data['message'][:1000])
    elif op == 'replay' and type(data.get('seq')) is int:
        if 0 <= data['seq'] <= player.next_seq and now-player.last_replay >= .2:
            player.last_replay = now
            if player.history and data['seq']<next(iter(player.history))-1:
                await send(player, {'op':'resync','sent':player.next_seq})
                return True
            for seq, event in list(player.history.items()):
                if seq > data['seq']:
                    await send(player,event)
    elif op == 'received' and type(data.get('seq')) is int and 0 <= data['seq'] <= player.next_seq:
        ack = data['seq']
        for seq in [seq for seq in player.pending if seq <= ack]:
            player.pending.pop(seq, None)
    elif op in ('data', 'live') and valid_payload(data.get('data'), index):
        payload = dict(data['data'], **{'from': index})
        other = room.players[1-index]
        if op == 'live':
            if payload['t'] not in ('aim', 'place'):
                await ws.close(code=1008)
                return False
            await send(other, {'op': 'live', 'data': payload})
            return True
        seq = data.get('seq')
        # Compatibility for diagnostics using a raw WebSocket.
        legacy = seq is None
        if legacy:
            seq = player.received + 1
        if type(seq) is not int or seq < 1 or seq > player.received + 1:
            await ws.close(code=1008, message=b'Invalid sequence')
            return False
        if seq > player.received:
            kind = payload['t']
            accepted = True
            if kind == 'bye':
                player.received = seq
                await close_room(room,index)
                return False
            if kind == 'start':
                accepted = room.match is None or room.restart_approved
                if accepted:
                    room.match = payload['seed']
                    room.move = room.state_move = 0
                    room.turn = 0
                    room.state = await engine.call('initial', room.match)
                    room.shot = None
                    room.restart = None
                    room.restart_approved = False
                    room.result = None
                    room.game_id = secrets.token_hex(16)
                    room.skips = [0,0]
                    room.paused = None
                    for participant in room.players:
                        if participant: participant.shots = participant.hits = 0
                    arm_turn(room)
                    payload['state'] = room.state
                    payload['serverNow'] = time.time()*1000
                    if not legacy:
                        await queue(player, sync_state(room))
            elif kind == 'profile':
                social_profile=payload.get('social')
                if isinstance(social_profile,dict):
                    # The sender cannot claim another installation's public friend ID.
                    social_profile['id']=player.career_id
                player.profile = payload
            elif kind == 'rematch-request':
                accepted = payload['match'] == room.match and (room.restart is None or room.restart['expires'] <= time.time())
                if accepted:
                    room.restart = dict(payload, expires=time.time()+120)
            elif kind == 'rematch-response':
                request = room.restart
                accepted = (request is not None and request['expires'] > time.time() and request['from'] != index
                            and request['id'] == payload['id'] and payload['match'] == room.match)
                if accepted:
                    room.restart_approved = payload['accept']
                    room.restart = None
            elif kind == 'shot':
                if room.paused is not None and all(online(p) for p in room.players):
                    resume_clock(room)
                await expire_turn(room)
                accepted = (payload.get('match') == room.match and payload.get('move') == room.move + 1 and index == room.turn and room.shot is None and not room.result and room.paused is None)
                if accepted:
                    try:
                        room.shot = payload
                        expected = await engine.call('shot', room.state, payload)
                    except Exception:
                        room.shot = None
                        await queue(player, sync_state(room))
                        player.received = seq
                        await send(player, {'op':'ack','seq':seq})
                        return True
                    if room.closed or room.result:
                        room.shot=None
                        return True
                    room.skips[index] = 0
                    player.shots += 1
                    payload['before'] = room.state
                    payload['player'] = index
                    room.move = payload['move']
                    room.shot = payload
                    room.expected = expected
                    room.shot_at = time.monotonic()
                    room.deadline = 0
            elif kind == 'state':
                accepted = (payload['match'] == room.match and payload['move'] == room.move and room.shot is not None and room.shot['player'] == index)
                if accepted:
                    if room.expected['scores'][index] > room.state['scores'][index]: player.hits += 1
                    room.state = room.expected
                    room.expected = None
                    room.state_move = room.move
                    room.turn = room.state['turn']
                    room.shot = None
                    arm_turn(room)
                    payload['state'] = room.state
                    payload['serverNow'] = time.time()*1000
                    if not legacy:
                        await queue(player, sync_state(room))
                    if room.state['over']:
                        await finish_game(room,room.state['winner'],'completed')
            elif kind == 'sync-request':
                accepted = False
            if kind == 'sync-request' or not accepted:
                if kind == 'rematch-request':
                    await queue(player, {'t':'rematch-response','match':room.match,'id':payload['id'],'accept':False})
                elif kind == 'rematch-response':
                    pass
                elif room.state is not None and len(player.pending) < 32:
                    await queue(player, dict(sync_state(room), reset=kind != 'sync-request'))
                player.received = seq
                if not legacy:
                    await send(player, {'op':'ack','seq':seq})
                return True
            if other:
                if len(other.pending) >= 512:
                    await close_room(room)
                    return False
                await queue(other, payload)
            player.received = seq
        if not legacy:
            await send(player, {'op': 'ack', 'seq': player.received})
    else:
        logging.warning('Invalid operation room=%s player=%s op=%r kind=%r',room.code if room else None,index,op,data.get('data',{}).get('t') if isinstance(data.get('data'),dict) else None)
        await ws.close(code=1008, message=b'Invalid operation')
        return False
    return True

async def websocket(request):
    if len(clients) >= 220:
        raise web.HTTPServiceUnavailable()
    ws = web.WebSocketResponse(heartbeat=10, max_msg_size=8192)
    await ws.prepare(request)
    clients.add(ws)
    room, index, player = None, None, None
    window, count = time.monotonic(), 0
    try:
        async for message in ws:
            if message.type != WSMsgType.TEXT:
                continue
            now = time.monotonic()
            if now - window >= 1:
                window, count = now, 0
            count += 1
            if count > 120:
                await ws.close(code=1008, message=b'Rate limit')
                break
            try:
                data = json.loads(message.data)
                if not isinstance(data, dict):
                    raise ValueError()
            except (ValueError, TypeError):
                await ws.close(code=1008, message=b'Invalid JSON')
                break
            op = data.get('op')
            if op == 'ping':
                if player:
                    if player.ws is not ws:
                        break
                    await send(player, {'op':'pong','ack':player.received,'sent':player.next_seq,
                        'matched':room.matched,'peerOnline':online(room.players[1-index]),'peerUntil':peer_until(room.players[1-index])})
                else:
                    await ws.send_json({'op':'pong'})
                continue
            if player is None:
                if data.get('protocol') != 4:
                    await ws.send_json({'op':'error','error':'update-required'})
                    break
                token = data.get('token')
                if token is not None and (not isinstance(token, str) or not 32 <= len(token) <= 128):
                    await ws.close(code=1008, message=b'Invalid token')
                    break
                found = tokens.get(token)
                if token in ended_tokens:
                    await ws.send_json({'op':'closed'})
                    break
                if found and op in ('resume', 'host', 'join'):
                    room, index = found
                    player = room.players[index]
                    async with player.poll_lock:
                        if room.closed:
                            await ws.send_json({'op':'error','error':'expired'})
                            break
                        previous = player.ws
                        player.ws, player.detached = ws, None
                        if previous is not None and previous is not ws:
                            await close_peer(previous)
                        other = room.players[1-index]
                        await ws.send_json({'op': 'resumed', 'index':index, 'token': player.token, 'code': room.code,
                                            'matched': room.matched, 'peerOnline': online(other), 'ack': player.received})
                        for event in list(player.history.values()):
                            await ws.send_json(event)
                        if room.matched:
                            await send(other, {'op': 'peer-back'})
                elif op == 'resume':
                    await ws.send_json({'op': 'error', 'error': 'expired'})
                    break
                elif op == 'host' and data.get('quick') and quick_room(career.identity(data.get('identity'))):
                    room = quick_room(career.identity(data.get('identity')))
                    player,index = Player(token or secrets.token_hex(32)),1
                    player.career_id = career.identity(data.get('identity'))
                    player.ws,player.detached = ws,None
                    room.players[index] = player
                    social_remember(room)
                    tokens[player.token] = (room,index)
                    await ws.send_json({'op':'joined','index':index,'code':room.code,'token':player.token})
                    await ws.send_json({'op':'connected'})
                    await send(room.players[0],{'op':'connected'})
                elif op == 'host':
                    if len(rooms) >= 100:
                        await ws.send_json({'op': 'error', 'error': 'server-error'})
                        break
                    while True:
                        code = ''.join(secrets.choice(ALPHABET) for _ in range(4))
                        if code not in rooms:
                            break
                    player = Player(token or secrets.token_hex(32))
                    player.career_id = career.identity(data.get('identity'))
                    player.ws, player.detached = ws, None
                    room, index = Room(code, player), 0
                    room.quick = bool(data.get('quick'))
                    rooms[code] = room
                    tokens[player.token] = (room, index)
                    await ws.send_json({'op': 'hosted', 'code': code, 'token': player.token})
                elif op == 'join':
                    code = str(data.get('code', '')).strip().upper()
                    room = rooms.get(code)
                    if room is None:
                        await ws.send_json({'op': 'error', 'error': 'peer-unavailable'})
                        break
                    if room.matched:
                        await ws.send_json({'op': 'error', 'error': 'room-full'})
                        break
                    if not social_can_join(room, career.identity(data.get('identity'))):
                        await ws.send_json({'op': 'error', 'error': 'peer-unavailable'})
                        break
                    player = Player(token or secrets.token_hex(32))
                    player.career_id = career.identity(data.get('identity'))
                    player.ws, player.detached = ws, None
                    index = 1
                    room.players[1] = player
                    social_remember(room)
                    tokens[player.token] = (room, index)
                    await ws.send_json({'op': 'joined', 'token': player.token, 'code': code})
                    await ws.send_json({'op': 'connected'})
                    await send(room.players[0], {'op': 'connected'})
                    if not online(room.players[0]):
                        await ws.send_json({'op': 'peer-away'})
                else:
                    await ws.close(code=1008, message=b'Join a room first')
                    break
            elif player.ws is not ws:
                break
            else:
                async with player.poll_lock:
                    if player.ws is not ws or not await session_message(room, index, player, ws, data):
                        break
    except (ClientConnectionError, OSError):
        pass
    finally:
        clients.discard(ws)
        if player and player.ws is ws:
            player.ws = None
            player.detached = time.monotonic()
            if room and not room.closed:
                logging.info('Connection detached room=%s player=%s close=%s received=%s sent=%s pending=%s',room.code,index,ws.close_code,player.received,player.next_seq,len(player.pending))
                await send(room.players[1-index], {'op': 'peer-away', 'grace': GRACE})
    return ws

async def health(request):
    return web.json_response({'status':'ok','version':'2.0','authoritativePhysics':True,'cloudCareer':cloud.enabled,'rooms':len(rooms),'clients':len(clients),'resumeGrace':GRACE})

async def network_config(request):
    public_url=os.environ.get('RC_PUBLIC_URL') or os.environ.get('RENDER_EXTERNAL_URL')
    if public_url:
        parsed=urlsplit(public_url)
        if parsed.scheme!='https' or not parsed.hostname or parsed.username or parsed.password or parsed.port not in (None,443) or parsed.path not in ('','/') or parsed.query or parsed.fragment:
            raise web.HTTPServiceUnavailable(text='Invalid public server URL')
        return web.json_response({'urls':['wss://'+parsed.netloc+'/ws']},headers={'Access-Control-Allow-Origin':'*','Cache-Control':'no-store'})
    try:
        data = json.loads((ROOT/'endpoints.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        data = {'urls':[]}
    return web.json_response(data, headers={'Access-Control-Allow-Origin':'*','Cache-Control':'no-store'})

class HttpPeer:
    def __init__(self, poll_id):
        self.poll_id = poll_id
        self.closed = False
        self.events = []
        self.last_seen = time.monotonic()

    async def send_json(self, event):
        if len(self.events) >= 2048:
            self.closed = True
            raise ClientConnectionError('HTTP event queue full')
        self.events.append(event)

    async def close(self, **kwargs):
        self.closed = True

POLL_HEADERS = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS',
                'Access-Control-Allow-Headers':'Content-Type','Cache-Control':'no-store'}

async def social_endpoint(request):
    if request.method == 'OPTIONS':
        return web.Response(headers=POLL_HEADERS)
    try:
        body = await request.json()
        if not isinstance(body,dict):
            raise social_relay.RelayError('request')
        # Authenticate before making any directory request on the caller's behalf.
        social_relay.identity(body.get('identity'))
        can_push=False
        if body.get('op')=='reserve' and isinstance(body.get('target'),str):
            can_push=await push.has_route(body['target'])
        result = social_relay.execute(body,rooms,tokens,social_room_status,can_push)
        result['pushAvailable']=push.available
        push.enqueue(body,result)
        return web.json_response(result,headers=POLL_HEADERS)
    except social_relay.RelayError as error:
        return web.json_response({'error':str(error)},status=400,headers=POLL_HEADERS)
    except (ValueError,TypeError):
        return web.json_response({'error':'request'},status=400,headers=POLL_HEADERS)

async def career_endpoint(request):
    if request.method == 'OPTIONS': return web.Response(headers=POLL_HEADERS)
    try:
        body = await request.json()
        key = career.identity(body.get('identity')) if isinstance(body,dict) else None
        if not key: return web.json_response({'error':'identity'},status=400,headers=POLL_HEADERS)
        return web.json_response(await cloud.read(key),headers=POLL_HEADERS)
    except (ValueError,TypeError):
        return web.json_response({'error':'request'},status=400,headers=POLL_HEADERS)

async def poll(request):
    if request.method == 'OPTIONS':
        return web.Response(headers=POLL_HEADERS)
    try:
        body = await request.json()
    except (ValueError, TypeError):
        return web.json_response({'events':[{'op':'error','error':'server-error'}]},status=400,headers=POLL_HEADERS)
    if not isinstance(body, dict) or body.get('protocol') != 4:
        return web.json_response({'events':[{'op':'error','error':'update-required'}]},status=400,headers=POLL_HEADERS)
    credential = body.get('token')
    found = tokens.get(credential) if isinstance(credential,str) else None
    if body.get('check'):
        return web.json_response({'events':[{'op':'session-status','exists':bool(found and not found[0].closed)}]},headers=POLL_HEADERS)
    if isinstance(credential,str) and credential in ended_tokens:
        return web.json_response({'events':[{'op':'closed'}]},headers=POLL_HEADERS)
    poll_id, messages = body.get('pollId'), body.get('messages',[])
    if not isinstance(poll_id,str) or not 16 <= len(poll_id) <= 128 or not isinstance(messages,list) or len(messages)>64 or any(not isinstance(m,dict) for m in messages):
        return web.json_response({'events':[{'op':'error','error':'server-error'}]},status=400,headers=POLL_HEADERS)
    if not found and body.get('operation') in ('host','join'):
        error = None
        if not isinstance(credential,str) or not 32<=len(credential)<=128:
            error = 'server-error'
        elif body['operation']=='host' and body.get('quick') and quick_room(career.identity(body.get('identity'))):
            room = quick_room(career.identity(body.get('identity')))
            player,index = Player(credential),1
            player.career_id = career.identity(body.get('identity'))
            room.players[index] = player
            social_remember(room)
            await send(room.players[0],{'op':'connected'})
        elif body['operation']=='host':
            if len(rooms)>=100:
                error = 'server-error'
            else:
                while True:
                    code = ''.join(secrets.choice(ALPHABET) for _ in range(4))
                    if code not in rooms:
                        break
                player = Player(credential)
                player.career_id = career.identity(body.get('identity'))
                room,index = Room(code,player),0
                room.quick = bool(body.get('quick'))
                rooms[code] = room
        else:
            room = rooms.get(str(body.get('code','')).strip().upper())
            if room is None:
                error = 'peer-unavailable'
            elif room.matched:
                error = 'room-full'
            elif not social_can_join(room, career.identity(body.get('identity'))):
                error = 'peer-unavailable'
            else:
                player,index = Player(credential),1
                player.career_id = career.identity(body.get('identity'))
                room.players[index] = player
                social_remember(room)
        if error:
            return web.json_response({'events':[{'op':'error','error':error}]},headers=POLL_HEADERS)
        found = tokens[credential] = (room,index)
    if not found:
        return web.json_response({'events':[{'op':'error','error':'expired'}]},status=403,headers=POLL_HEADERS)
    room,index = found
    player = room.players[index]
    async with player.poll_lock:
        if room.closed or tokens.get(credential) != found:
            return web.json_response({'events':[{'op':'error','error':'expired'}]},status=403,headers=POLL_HEADERS)
        peer = player.ws
        if not isinstance(peer,HttpPeer) or peer.poll_id != poll_id or peer.closed:
            if not body.get('resume'):
                return web.json_response({'events':[],'retry':True},status=409,headers=POLL_HEADERS)
            previous = peer
            peer = HttpPeer(poll_id)
            player.ws, player.detached = peer, None
            if previous is not None:
                await close_peer(previous)
            other = room.players[1-index]
            await peer.send_json({'op':'resumed','index':index,'token':player.token,'code':room.code,'matched':room.matched,
                                  'peerOnline':online(other),'ack':player.received})
            for event in list(player.history.values()):
                await peer.send_json(event)
            if room.matched:
                await send(other,{'op':'peer-back'})
            logging.info('HTTPS fallback attached room=%s player=%s',room.code,index)
        peer.last_seen = time.monotonic()
        for message in messages:
            if not await session_message(room,index,player,peer,message):
                break
        events, peer.events = peer.events, []
        if peer.closed and not room.closed:
            player.ws, player.detached = None, time.monotonic()
            events.append({'op':'error','error':'server-error'})
        return web.json_response({'events':events},headers=POLL_HEADERS)

async def index(request):
    return web.FileResponse(ROOT/'public'/'game.html', headers={'Cache-Control':'no-store'})

async def leave(request):
    if request.method=='OPTIONS':
        return web.Response(headers=POLL_HEADERS)
    try:
        body = await request.json()
        credential = body.get('token') if isinstance(body,dict) else None
        if not isinstance(credential,str) or not 32<=len(credential)<=128:
            raise ValueError()
    except (ValueError,TypeError):
        return web.json_response({'error':'invalid-token'},status=400,headers=POLL_HEADERS)
    revoke(credential)
    found = tokens.get(credential)
    if found:
        await close_room(found[0],found[1])
    return web.json_response({'closed':True},headers=POLL_HEADERS)

def arm_turn(room):
    if room.paused is not None and not room.state['over']:
        room.paused = 60
        room.deadline = 0
        room.state = dict(room.state,deadline=0)
        return
    room.deadline = time.monotonic()+60 if not room.state['over'] else 0
    room.state = dict(room.state, deadline=time.time()*1000+60000 if room.deadline else 0)

def resume_clock(room):
    remaining = room.paused
    room.paused = None
    if room.shot is None:
        room.deadline = time.monotonic()+remaining
        room.state = dict(room.state,deadline=time.time()*1000+remaining*1000)

async def expire_turn(room):
    if room.closed or not room.deadline or time.monotonic() < room.deadline or room.shot is not None:
        return
    room.skips[room.turn] += 1
    if room.skips[room.turn] >= 3:
        await finish_game(room,1-room.turn,'inactivity')
        return
    room.turn = 1-room.turn
    room.move += 1
    room.state_move = room.move
    # Board coordinates are canonical, independent of each phone's rotation.
    y = 597.6 if room.turn == 0 else 122.4
    def blocked(x):
        return any(abs(p[1]-y)<65.08 and abs(p[0]-x)<65.08 for p in room.state['stones'])
    x = next((candidate for d in range(0,720,2) for candidate in (360-d,360+d)
              if 169.128 <= candidate <= 550.872 and not blocked(candidate)),360)
    room.state = dict(room.state, turn=room.turn, ring=[x,y])
    arm_turn(room)
    for player in room.players:
        if player:
            await queue(player, dict(sync_state(room), timeout=True))

async def room_cleanup(app):
    async def sweep():
        while True:
            await asyncio.sleep(.2)
            for credential,deadline in list(ended_tokens.items()):
                if deadline<time.monotonic():
                    ended_tokens.pop(credential,None)
            for room in list(rooms.values()):
                for index, player in enumerate(room.players):
                    if player and isinstance(player.ws,HttpPeer) and time.monotonic()-player.ws.last_seen>6:
                        await player.ws.close()
                        player.detached = player.ws.last_seen
                        player.ws = None
                        await send(room.players[1-index],{'op':'peer-away','grace':GRACE})
                if room.matched and room.state and not room.result:
                    # A client cannot freeze the turn forever by withholding its final state.
                    if room.shot is not None and room.expected is not None and time.monotonic()-room.shot_at>16:
                        owner=room.shot['player']
                        if room.expected['scores'][owner]>room.state['scores'][owner]:room.players[owner].hits+=1
                        room.state=room.expected;room.expected=None;room.state_move=room.move;room.turn=room.state['turn'];room.shot=None
                        arm_turn(room)
                        for participant in room.players:
                            if participant:await queue(participant,sync_state(room))
                        if room.state['over']:await finish_game(room,room.state['winner'],'completed')
                    absent = [i for i,p in enumerate(room.players) if not online(p)]
                    if absent:
                        if room.paused is None:
                            room.paused = max(0,room.deadline-time.monotonic()) if room.deadline else 60
                            room.deadline = 0
                        expired = [i for i in absent if room.players[i].detached is not None and time.monotonic()-room.players[i].detached>=RECONNECT]
                        if expired:
                            await finish_game(room,1-expired[0] if len(absent)==1 else None,'disconnect')
                    elif room.paused is not None:
                        resume_clock(room)
                        for participant in room.players: await queue(participant,sync_state(room))
                await expire_turn(room)
                if any(p and p.detached is not None and time.monotonic()-p.detached > GRACE for p in room.players):
                    await close_room(room)
    task = asyncio.create_task(sweep())
    yield
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)

async def shutdown(app):
    await asyncio.gather(*(ws.close(code=1001, message=b'Server shutdown') for ws in list(clients)))
    for task in list(rating_tasks):task.cancel()
    await asyncio.gather(*list(rating_tasks),return_exceptions=True)
    await engine.close()

def create_app():
    app = web.Application(client_max_size=65536)
    app.router.add_get('/health', health)
    app.router.add_get('/config', network_config)
    app.router.add_route('POST','/social',social_endpoint)
    app.router.add_route('OPTIONS','/social',social_endpoint)
    app.router.add_route('POST','/career',career_endpoint)
    app.router.add_route('OPTIONS','/career',career_endpoint)
    app.router.add_get('/ws', websocket)
    app.router.add_route('POST','/poll',poll)
    app.router.add_route('OPTIONS','/poll',poll)
    app.router.add_route('POST','/leave',leave)
    app.router.add_route('OPTIONS','/leave',leave)
    app.router.add_get('/', index)
    app.router.add_static('/', ROOT/'public', show_index=False)
    app.cleanup_ctx.append(room_cleanup)
    app.on_shutdown.append(shutdown)
    async def close_push(app):await push.close()
    app.on_shutdown.append(close_push)
    return app

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO,format='%(asctime)s %(levelname)s %(message)s')
    if sys.platform == 'win32':
        # Avoid Proactor pipe shutdown errors on abruptly reset tunnel sockets.
        # The test server stays below the Windows selector's socket limit.
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    web.run_app(create_app(), host=os.environ.get('HOST','0.0.0.0' if os.environ.get('PORT') else '127.0.0.1'), port=int(os.environ.get('PORT','8787')), access_log=None)
