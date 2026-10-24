"""Run the exact bundled physics in bounded, isolated V8. Never evaluate client code."""
import asyncio
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from py_mini_racer import MiniRacer

class MatchEngine:
    def __init__(self):
        self.pool=ThreadPoolExecutor(max_workers=1,thread_name_prefix='physics')
        self.context=None

    def execute(self,method,*args):
        if self.context is None:
            self.context=MiniRacer()
            self.context.set_hard_memory_limit(64*1024*1024)
            self.context.eval('var window=globalThis;')
            root=Path(__file__).parent/'public/js'
            for name in ('physics.js','match-rules.js'):
                self.context.eval((root/name).read_text(encoding='utf-8-sig'))
        expression='JSON.stringify(RCMatchRules.'+method+'('+','.join(json.dumps(arg) for arg in args)+'))'
        return json.loads(self.context.eval(expression,timeout=1500))

    async def call(self,method,*args):
        if self.pool is None:self.pool=ThreadPoolExecutor(max_workers=1,thread_name_prefix='physics')
        return await asyncio.get_running_loop().run_in_executor(self.pool,self.execute,method,*args)

    async def close(self):
        if self.pool is None:return
        def release():
            if self.context is not None:self.context.close();self.context=None
        await asyncio.get_running_loop().run_in_executor(self.pool,release)
        self.pool.shutdown(wait=True);self.pool=None

engine=MatchEngine()
