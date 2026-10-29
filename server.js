'use strict';
const express=require('express');const http=require('http');const crypto=require('crypto');const path=require('path');const fs=require('fs');const {Server}=require('socket.io');
const {createGame,step,action,snapshot,roster,clamp}=require('./lib/game');
const db=require('./lib/store');const catalog=require('./public/catalog.json');
const app=express();app.disable('x-powered-by');
app.get('/health',(_,res)=>res.json({ok:true,game:'Hardwood Ultimate Online',mode:'5v5'}));
app.use(express.static(path.join(__dirname,'public'),{maxAge:0}));
const server=http.createServer(app);
const origins=(process.env.ALLOWED_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean);
const io=new Server(server,{cors:{origin:origins.length?origins:true,methods:['GET','POST']},maxHttpBufferSize:12000,pingTimeout:20000});
const rooms=new Map();
const safeName=x=>String(x||'Player').replace(/[^a-zA-Z0-9 _-]/g,'').trim().slice(0,20)||'Player';
const safeTeam=x=>Number.isInteger(x)&&x>=0&&x<30?x:0;
const send=(ack,body)=>{if(typeof ack==='function')ack(body)};
const fail=(ack,error)=>send(ack,{ok:false,error});
function code(){let c;do{c=crypto.randomInt(0,1000000).toString().padStart(6,'0')}while(rooms.has(c));return c}
function session(socket){const account=socket.data.account;if(!account)return null;return account}
function detach(socket){const c=socket.data.room;if(!c)return;const r=rooms.get(c);if(r){const seat=r.seats.find(x=>x.accountId===socket.data.account?.id);if(seat&&seat.socketId===socket.id){seat.socketId=null;seat.offlineSince=Date.now();r.disconnectedAt=Date.now();io.to(c).emit('mp:state',snapshot(r));}}socket.data.room='';}
function requirePlayer(socket,ack){const a=session(socket);if(!a){fail(ack,'Please connect first.');return null}return a}
function getRoom(socket){const r=rooms.get(socket.data.room);if(!r)return null;const i=r.seats.findIndex(x=>x.accountId===socket.data.account?.id&&x.socketId===socket.id);return i<0?null:{r,slot:i};}
function enterRoom(socket,r,slot){const seat=r.seats[slot];if(!seat||seat.accountId!==socket.data.account.id)return false;seat.socketId=socket.id;seat.offlineSince=0;socket.data.room=r.code;socket.join(r.code);return true}
function emitRoom(r){io.to(r.code).emit('mp:state',snapshot(r))}
function leave(socket,reason='Left the room'){
 const located=getRoom(socket);if(!located){detach(socket);return}
 const {r,slot}=located;socket.leave(r.code);socket.data.room='';const seat=r.seats[slot];seat.socketId=null;seat.offlineSince=Date.now();
 if(r.game?.phase==='playing'){
  r.game.phase='final';r.game.winner=1-slot;r.game.message='MATCH FORFEITED';if(Date.now()-r.game.createdAt>=30000)settle(r);
 }
 io.to(r.code).emit('mp:closed',reason);for(const x of r.seats)if(x?.socketId&&x.socketId!==socket.id){const s=io.sockets.sockets.get(x.socketId);if(s){s.leave(r.code);s.data.room=''}}rooms.delete(r.code);
}
function settle(r){const g=r.game;if(!g||g.phase!=='final'||g.settled)return;g.settled=true;
 for(let i=0;i<2;i++){
  const account=r.seats[i]?.accountId&&r.seats[i].account;
  if(!account)continue;db.reward(account,g,i);
  const id=r.seats[i].socketId;if(id)io.to(id).emit('mp:receipts',db.receipts(account));
 }
 emitRoom(r);io.emit('mp:board-updated');
}
io.on('connection',socket=>{
 socket.on('mp:hello',(p={},ack)=>{
  const name=safeName(p.name),team=safeTeam(p.team);
  let a=db.accountFromToken(p.token),token=null;
  if(!a){const created=db.createAccount(name,team);a=created.account;token=created.token}
  else if(a.name!==name||a.team!==team)db.updateAccount(a,name,team);
  socket.data.account=a;
  const old=[...rooms.values()].find(r=>r.seats.some(x=>x?.accountId===a.id));
  let rejoined=null;
  if(old){const slot=old.seats.findIndex(x=>x?.accountId===a.id);const s=old.seats[slot];
   // Reclaim the slot from a stale connection, preventing duplicate controllers.
   if(s.socketId&&s.socketId!==socket.id){const prev=io.sockets.sockets.get(s.socketId);if(prev){prev.leave(old.code);prev.data.room=''}}
   enterRoom(socket,old,slot);rejoined={code:old.code,slot};emitRoom(old);
  }
  send(ack,{ok:true,token,account:{name:a.name,team:a.team},rejoined,board:db.leaderboard(a.id),receipts:db.receipts(a)});
 });
 socket.on('mp:create',(p={},ack)=>{
  const a=requirePlayer(socket,ack);if(!a)return;if(socket.data.room)return fail(ack,'Leave your current room first.');
  if(rooms.size>1000)return fail(ack,'The server has reached its room limit.');
  const c=code(),r={code:c,created:Date.now(),seats:[{accountId:a.id,account:a,name:a.name,team:a.team,socketId:null},null],lineups:[roster(catalog,p.squad),null],game:null};
  rooms.set(c,r);enterRoom(socket,r,0);send(ack,{ok:true,code:c,slot:0});emitRoom(r);
 });
 socket.on('mp:join',(p={},ack)=>{
  const a=requirePlayer(socket,ack);if(!a)return;if(socket.data.room)return fail(ack,'Leave your current room first.');
  const now=Date.now();const attempts=socket.data.attempts||(socket.data.attempts=[]);while(attempts.length&&attempts[0]<now-60000)attempts.shift();if(attempts.length>=12)return fail(ack,'Too many attempts. Try again shortly.');attempts.push(now);
  const c=String(p.code||'').trim();if(!/^\d{6}$/.test(c))return fail(ack,'Enter a six-digit room code.');const r=rooms.get(c);
  if(!r)return fail(ack,'Room not found. Check the code.');if(r.seats[1])return fail(ack,'That room is already full.');
  if(r.seats[0].accountId===a.id)return fail(ack,'Use another account to join.');
  r.seats[1]={accountId:a.id,account:a,name:a.name,team:a.team,socketId:null};r.lineups[1]=roster(catalog,p.squad);enterRoom(socket,r,1);
  r.game=createGame(r);r.lastTick=Date.now();send(ack,{ok:true,code:c,slot:1});emitRoom(r);
 });
 socket.on('mp:input',input=>{
  const ref=getRoom(socket);if(!ref||ref.r.game?.phase!=='playing'||!ref.r.seats.every(x=>x?.socketId))return;
  const now=Date.now();if(now-(socket.data.lastInput||0)<22)return;socket.data.lastInput=now;
  const {r,slot}=ref;const dx=clamp(Number(input?.dx)||0,-1,1),dy=clamp(Number(input?.dy)||0,-1,1);
  r.game.control[slot]={dx,dy,sprint:input?.sprint===true};
  const a=input?.action;if(['shoot','pass','steal','switch'].includes(a))action(r.game,slot,a);
 });
 socket.on('mp:leave',(_,ack)=>{leave(socket,'Your opponent left the match.');send(ack,{ok:true})});
 socket.on('mp:rematch',(_,ack)=>{const ref=getRoom(socket);if(!ref)return fail(ack,'Join a room first.');const {r,slot}=ref;if(r.game?.phase!=='final')return fail(ack,'Finish the match first.');
  r.rematchReady=r.rematchReady||[false,false];r.rematchReady[slot]=true;
  const bothReady=r.rematchReady.every(Boolean);
  if(bothReady){r.rematchReady=[false,false];r.game=createGame(r);r.lastTick=Date.now();emitRoom(r)}
  send(ack,{ok:true,waiting:!bothReady})
 });
 socket.on('mp:leaderboard',(_,ack)=>{const a=requirePlayer(socket,ack);if(a)send(ack,{ok:true,...db.leaderboard(a.id)})});
 socket.on('mp:receipt:ack',(id,ack)=>{const a=requirePlayer(socket,ack);if(!a)return;if(typeof id==='string'&&id.length<100)db.ackReceipt(a,id);send(ack,{ok:true})});
 socket.on('disconnect',()=>detach(socket));
});
setInterval(()=>{
 const now=Date.now();for(const r of rooms.values()){
  if(now-r.created>3600000&&r.game?.phase!=='playing'){rooms.delete(r.code);continue;}
  const g=r.game;if(!g||g.phase!=='playing')continue;
  const disconnected=r.seats.findIndex(x=>x&&!x.socketId);
  if(disconnected>=0){const s=r.seats[disconnected];if(now-(s.offlineSince||now)>45000){g.phase='final';g.winner=1-disconnected;g.message='OPPONENT DISCONNECTED';settle(r)}continue;}
  const dt=Math.min(.08,Math.max(0,(now-(r.lastTick||now))/1000));r.lastTick=now;step(g,dt);if(g.phase==='final')settle(r);else emitRoom(r);
 }
},50);
const port=Number(process.env.PORT)||3000;server.listen(port,'0.0.0.0',()=>console.log(`Hardwood Ultimate Online listening on http://localhost:${port}`));
