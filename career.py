"""Persistent installation-based statistics; session tokens never enter the database."""
import hashlib
import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path

DB = Path(__file__).with_name('career.sqlite3')

def identity(secret):
    if isinstance(secret, str) and len(secret) == 64 and all(c in '0123456789abcdef' for c in secret):
        return hashlib.sha256(secret.encode()).hexdigest()
    return None

@contextmanager
def connect():
    db = sqlite3.connect(DB)
    db.row_factory = sqlite3.Row
    db.executescript('''CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY, rating INTEGER DEFAULT 1000, wins INTEGER DEFAULT 0,
        losses INTEGER DEFAULT 0, draws INTEGER DEFAULT 0, streak INTEGER DEFAULT 0,
        best INTEGER DEFAULT 0, shots INTEGER DEFAULT 0, hits INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS matches (game TEXT, player TEXT, at INTEGER,
        result TEXT, opponent TEXT, delta INTEGER, reason TEXT, PRIMARY KEY(game,player));''')
    try:
        with db:
            yield db
    finally:
        db.close()

def ensure(db, key):
    db.execute('INSERT OR IGNORE INTO players(id) VALUES(?)', (key,))

def read(key):
    if not key:
        return None
    with connect() as db:
        ensure(db, key)
        result = dict(db.execute('SELECT * FROM players WHERE id=?', (key,)).fetchone())
        result.pop('id')
        result['history'] = [dict(row) for row in db.execute(
            'SELECT game,at,result,opponent,delta,reason FROM matches WHERE player=? ORDER BY at DESC,rowid DESC LIMIT 20', (key,))]
        return result

def record(game, players, winner, reason, at):
    keys = [p.career_id if p else None for p in players]
    # Playing against another window of the same installation cannot farm rating.
    if not all(keys) or keys[0] == keys[1]:
        return
    with connect() as db:
        for key in keys:
            ensure(db, key)
        if db.execute('SELECT 1 FROM matches WHERE game=? LIMIT 1', (game,)).fetchone():
            return
        ratings = [db.execute('SELECT rating FROM players WHERE id=?', (key,)).fetchone()[0] for key in keys]
        score = .5 if winner is None else float(winner == 0)
        delta = round(24 * (score - 1 / (1 + 10 ** ((ratings[1]-ratings[0])/400))))
        for i, key in enumerate(keys):
            won, lost = int(winner == i), int(winner is not None and winner != i)
            change = delta if i == 0 else -delta
            result = 'win' if won else 'loss' if lost else 'draw'
            db.execute('''UPDATE players SET rating=rating+?, wins=wins+?, losses=losses+?,
                draws=draws+?, streak=CASE WHEN ? THEN streak+1 ELSE 0 END,
                best=MAX(best,CASE WHEN ? THEN streak+1 ELSE 0 END), shots=shots+?,hits=hits+? WHERE id=?''',
                (change,won,lost,int(winner is None),won,won,players[i].shots,players[i].hits,key))
            profile = players[1-i].profile or {}
            db.execute('INSERT INTO matches VALUES(?,?,?,?,?,?,?)',
                (game,key,at,result,str(profile.get('name','Соперник'))[:12],change,reason))
