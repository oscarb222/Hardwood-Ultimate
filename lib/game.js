'use strict';
const POSITIONS=['PG','SG','SF','PF','C'];
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const chance=(n)=>Math.random()<clamp(n,0,1);
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const defaultLineup=[{name:'Rookie PG',position:'PG',ovr:65},{name:'Rookie SG',position:'SG',ovr:64},{name:'Rookie SF',position:'SF',ovr:63},{name:'Rookie PF',position:'PF',ovr:62},{name:'Rookie C',position:'C',ovr:61}];
function roster(catalog,ids){
 return POSITIONS.map((slot,i)=>{
  const id=Number(ids?.[i]);
  const original=Number.isInteger(id)?catalog[id]:null;
  const p=original||defaultLineup[i];
  return {cardId:original?id:-1,name:String(p.name).slice(0,36),position:p.position||slot,slot,ovr:clamp(Math.round(p.ovr||65),1,101),jersey:(i+1)*3};
 });
}
function startingPosition(team,i){
 const row=[15,31,50,69,85][i];
 return {x:team===0?22:78,y:row};
}
function createGame(room){
 const players=Array.from({length:10},(_,j)=>{
  const team=Math.floor(j/5),idx=j%5,card=room.lineups[team][idx];
  return {id:j,team,index:idx,...startingPosition(team,idx),name:card.name,ovr:card.ovr,position:card.position,slot:card.slot,jersey:card.jersey,points:0,steals:0};
 });
 return {id:room.code+'-'+Date.now()+'-'+Math.random().toString(36).slice(2,6),phase:'playing',duration:120,remaining:120,score:[0,0],players,selected:[0,5],holder:0,ball:{x:players[0].x,y:players[0].y,flight:null},control:[{dx:0,dy:0,sprint:false},{dx:0,dy:0,sprint:false}],cooldowns:[0,0],message:'TIP OFF',winner:null,settled:false,createdAt:Date.now()};
}
function positionedRating(p){return p.position===p.slot?p.ovr:clamp(Math.round(p.ovr*.9),1,101)}
function skillBoost(p){const o=positionedRating(p);return o>=90?.10:o>=80?.05:0}
function possession(game,team){
 for(const p of game.players){const s=startingPosition(p.team,p.index);p.x=s.x;p.y=s.y}
 game.holder=team*5;
 game.selected[team]=game.holder;
 game.ball.flight=null;
 game.ball.x=game.players[game.holder].x;
 game.ball.y=game.players[game.holder].y;
}
function action(game,team,type){
 if(game.phase!=='playing'||game.cooldowns[team]>0)return;
 const controlled=game.players[game.selected[team]],holder=game.holder>=0?game.players[game.holder]:null;
 if(type==='switch'){
  game.selected[team]=team*5+(game.selected[team]-team*5+1)%5;
  game.cooldowns[team]=.13;return;
 }
 if(type==='pass'&&holder&&holder.team===team){
  const allies=game.players.filter(p=>p.team===team&&p.id!==holder.id);
  // Select a nearby open teammate rather than teleporting the ball to the target.
  allies.sort((a,b)=>distance(a,holder)-distance(b,holder));
  const target=allies[0];
  game.ball.flight={kind:'pass',fromX:holder.x,fromY:holder.y,toX:target.x,toY:target.y,target:target.id,elapsed:0,duration:clamp(distance(holder,target)/45,.22,.7)};
  game.ball.x=holder.x;game.ball.y=holder.y;game.holder=-1;
  game.message='PASS';game.cooldowns[team]=.2;return;
 }
 if(type==='shoot'&&holder&&holder.team===team){
  const hoop={x:team===0?94:6,y:50};const d=distance(holder,hoop);
  const kind=d<=15?'layup':d>=37?'three':'mid';const points=kind==='three'?3:2;
  let accuracy=(kind==='three'?.55:kind==='mid'?.50:.60)+skillBoost(holder);
  // Gentle positional variations retained from V_25. Defence and positioning matter.
  if(holder.position==='C'){if(kind==='layup')accuracy+=.02;else accuracy-=.02;}
  else if(holder.position==='PF'){if(kind==='layup'&&holder.slot==='PF')accuracy=1;else accuracy+=.01;}
  else if(holder.position==='PG'){accuracy+=(kind==='layup'?-.02:.02);}
  else if(holder.position==='SF'){accuracy+=.01;}
  else if(holder.position==='SG'){accuracy+=(kind==='layup'?-.01:.02);}
  const defenders=game.players.filter(p=>p.team!==team);
  const near=defenders.reduce((min,p)=>Math.min(min,distance(p,holder)),100);
  const contest=near<5?.13:near<9?.07:0;
  accuracy=clamp(accuracy-contest,.12,accuracy===1&&contest===0?1:.98);
  const duration=kind==='layup'?.34:.55;
  game.ball.flight={kind:'shot',fromX:holder.x,fromY:holder.y,toX:hoop.x,toY:hoop.y,elapsed:0,duration,shooter:holder.id,team,points,accuracy};
  game.holder=-1;game.message=kind==='layup'?'LAYUP!':points===3?'THREE-POINT ATTEMPT':'JUMP SHOT';game.cooldowns[team]=.32;return;
 }
 if(type==='steal'&&holder&&holder.team!==team){
  const d=distance(controlled,holder),defRating=positionedRating(controlled);
  let stealChance=.26+(defRating>=90?.06:defRating>=80?.03:0);
  if(controlled.slot==='C')stealChance+=.015;
  if(controlled.slot==='PG')stealChance-=.03;
  if(d<=9&&chance(stealChance)){
   game.holder=controlled.id;game.ball.x=controlled.x;game.ball.y=controlled.y;
   controlled.steals++;game.message='STEAL!';
  }else if(d<=9)game.message='STEAL MISSED';
  game.cooldowns[team]=.55;
 }
}
function step(game,dt){
 if(game.phase!=='playing')return;
 game.remaining=Math.max(0,game.remaining-dt);
 for(let team=0;team<2;team++){
  game.cooldowns[team]=Math.max(0,game.cooldowns[team]-dt);
  const input=game.control[team]||{};
  const selected=game.players[game.selected[team]];
  if(!selected)continue;
  let dx=clamp(+input.dx||0,-1,1),dy=clamp(+input.dy||0,-1,1);
  const mag=Math.max(1,Math.hypot(dx,dy));dx/=mag;dy/=mag;
  const speed=input.sprint?19:14;
  selected.x=clamp(selected.x+dx*dt*speed,3,97);
  selected.y=clamp(selected.y+dy*dt*speed,5,95);
  for(const other of game.players){
   if(other.team!==team||other.id===selected.id)continue;
   const has=game.holder>=0?game.players[game.holder]:null;
   const a=has?.team===team?{x:team===0?67:33,y:[18,34,50,66,82][other.index]}:has?{x:has.x+(team===0?-4:4),y:has.y+(other.index-2)*5}:{x:team===0?45:55,y:[18,34,50,66,82][other.index]};
   const speed=other.index===4?4.2:5.8;
   other.x=clamp(other.x+clamp(a.x-other.x,-speed*dt,speed*dt),3,97);
   other.y=clamp(other.y+clamp(a.y-other.y,-speed*dt,speed*dt),5,95);
  }
 }
 if(game.holder>=0){const h=game.players[game.holder];game.ball.x=h.x;game.ball.y=h.y;}
 const f=game.ball.flight;
 if(f){
  f.elapsed+=dt;const t=clamp(f.elapsed/f.duration,0,1);
  // Pass targets move with their teammates; the ball interpolates until caught.
  if(f.kind==='pass'){const target=game.players[f.target];if(target){f.toX=target.x;f.toY=target.y;}}
  game.ball.x=f.fromX+(f.toX-f.fromX)*t;game.ball.y=f.fromY+(f.toY-f.fromY)*t;
  if(t>=1){
   game.ball.flight=null;
   if(f.kind==='pass'){
    game.holder=f.target;const p=game.players[f.target];game.selected[p.team]=p.id;
    game.ball.x=p.x;game.ball.y=p.y;game.message='PASS COMPLETE';
   }else if(chance(f.accuracy)){
    game.score[f.team]+=f.points;
    game.players[f.shooter].points+=f.points;
    game.message=(game.remaining===0?'BUZZER BEATER! ':'')+`+${f.points} POINTS`;
    possession(game,1-f.team);
   }else{game.message='MISSED SHOT';possession(game,1-f.team)}
  }
 }
 if(game.remaining<=0&&!game.ball.flight){
  game.phase='final';game.winner=game.score[0]===game.score[1]?-1:game.score[0]>game.score[1]?0:1;
  game.message=game.winner===-1?'FINAL · DRAW':'FINAL · '+(game.winner===0?'HOME':'AWAY')+' WINS';
 }
}
function snapshot(r){
 const g=r.game;
 return {code:r.code,phase:g?.phase||'waiting',connected:r.seats.map(x=>!!x?.socketId),names:r.seats.map(x=>x?.name||'Waiting for opponent'),teams:r.seats.map(x=>x?.team??0),lineups:r.lineups,gameId:g?.id||'',remaining:g?.remaining||0,score:g?.score||[0,0],players:g?.players||[],selected:g?.selected||[0,5],holder:g?.holder??-1,ball:g?.ball||null,message:g?.message||'',winner:g?.winner??null};
}
module.exports={createGame,step,action,snapshot,roster,clamp};
