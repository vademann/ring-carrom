"use strict";
// Pure match rules shared with the server's isolated V8 engine.
window.RCMatchRules = (() => {
    const P=window.RCPhysics;
    function rng(seed){return ()=>{let t=seed+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};}
    function validColors(colors){return Array.isArray(colors)&&colors.length===2&&((colors[0]===null&&colors[1]===null)||(colors[0]==='w'&&colors[1]==='b')||(colors[0]==='b'&&colors[1]==='w'));}
    function assign(colors,owner,color){if(colors[owner]===null){colors[owner]=color;colors[1-owner]=color==='w'?'b':'w';return true;}return false;}
    function outcome(stones,colors,scores){
        if(!colors[0])return {over:false,winner:null};
        const left=colors.map(color=>stones.some(s=>!s.done&&s.color===color));
        const over=!left[0]||!left[1];
        return {over,winner:!over?null:!left[0]&&!left[1]?(scores[0]===scores[1]?null:scores[0]>scores[1]?0:1):!left[0]?0:1};
    }
    function snapshot(w,turn,scores,winner=null,over=false,colors=[null,null]){return {turn,scores,colors:colors.slice(),stones:w.stones.filter(s=>!s.done).map(s=>[s.x,s.y,s.color]),ring:[w.ring.x,w.ring.y],winner,over};}
    function initial(seed){const w=P.createWorld();P.rack(w,0,rng(seed));return snapshot(w,0,[0,0]);}
    function shot(before,shot){
        const w=P.createWorld(),owner=before.turn,scores=before.scores.slice(),colors=(before.colors||[null,null]).slice();
        if(!validColors(colors))throw Error('invalid_colors');
        w.stones=before.stones.map(p=>P.makeBody(p[0],p[1],w.stoneR,P.P.STONE_MASS,'stone',p[2]));
        w.ring=P.makeBody(360,P.baselineY(w,owner),w.ringR,P.P.RING_MASS,'ring');P.rebuild(w);
        const x=P.freeRingX(w,shot.x,owner);
        if(Math.abs(x-shot.x)>1.1||shot.power<0||shot.power>P.P.MAX_SHOT_V)throw Error('invalid_shot');
        let own=0,opp=0,foul=false;
        const events={hit(){},wall(){},pot(b){if(b.type==='ring')foul=true;else {assign(colors,owner,b.color);if(b.color===colors[owner])own++;else opp++;}}};
        P.applyShot(w,x,P.baselineY(w,owner),shot.angle,shot.power);
        if(!P.simulate(w,events,16))throw Error('simulation_timeout');
        scores[owner]+=own;scores[1-owner]+=opp;if(foul)scores[owner]=Math.max(0,scores[owner]-2);
        const {over,winner}=outcome(w.stones,colors,scores);
        const turn=over?owner:own>0&&opp===0&&!foul?owner:1-owner;
        if(!over){w.ring=P.makeBody(360,P.baselineY(w,turn),w.ringR,P.P.RING_MASS,'ring');w.ring.x=P.freeRingX(w,360,turn);}
        return snapshot(w,turn,scores,winner,over,colors);
    }
    return {initial,shot,validColors,assign,outcome};
})();
