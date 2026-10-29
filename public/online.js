(()=>{'use strict';
const $=id=>document.getElementById(id);
const panel=$('mpPanel'),waiting=$('mpWaiting'),court=$('mpCourt'),canvas=$('mpCanvas'),ctx=canvas.getContext('2d');
const status=$('mpStatus'),hold=new Set();let pending=null,socket=null,authenticated=false,connecting=false,room='',slot=-1,state=null,board=null,shownBoard=false;
// Keep a small buffer of authoritative server frames to smooth uneven packet arrivals.
let frames=[];const RENDER_DELAY=110;let lastLineupKey='',lastAnnouncement='';
const profile=()=>window.HUOnlineBridge?.getProfile?.()||{name:'Player',team:0};
const squad=()=>window.HUOnlineBridge?.getSquad?.()||[];
const localTeamList=['ATL','BOS','BKN','CHA','CHI','CLE','DAL','DEN','DET','GSW','HOU','IND','LAC','LAL','MEM','MIA','MIL','MIN','NOP','NYK','OKC','ORL','PHI','PHX','POR','SAC','SAS','TOR','UTA','WAS'];
const setStatus=t=>{status.textContent=t};
const escapeHTML=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
function iconForTeam(t){return localTeamList[t]||'TEAM'}
function rosterHTML(cards){return (cards||[]).map((c,i)=>`<div class="mpPlayer"><b>${['PG','SG','SF','PF','C'][i]}</b><div>${escapeHTML(c?.name||'Player')}<small>${Math.round(c?.ovr||65)} OVR · ${escapeHTML(c?.position||'')} ${c?.position!==c?.slot?'(−10% out of position)':''}</small></div></div>`).join('')}
function updateSquad(){const items=window.HUOnlineBridge?.getLineup?.()||[];$('mpYourFive').innerHTML=rosterHTML(items.map(p=>({name:p.name,ovr:p.ovr,position:p.pos,slot:p.slot})));const p=profile();$('mpClubName').textContent=p.name+' · '+iconForTeam(p.team);}
function setLinkStatus(online){$('mpLinkDot').classList.toggle('online',!!online);$('mpLinkText').textContent=online?'ONLINE SERVER CONNECTED':'NOT CONNECTED'}
function cleanupUI(){frames=[];lastLineupKey='';lastAnnouncement='';room='';slot=-1;state=null;waiting.hidden=false;court.hidden=true;$('mpRoomCode').textContent='------';$('mpLeave').hidden=true;}
function applyReceipts(receipts){for(const reward of receipts||[]){const bridge=window.HUOnlineBridge;const done=bridge?.applyReceipt?.(reward);if(done?.ok){socket?.emit('mp:receipt:ack',reward.id,()=>{});if(!done.duplicate)setStatus(`ONLINE REWARDS: +${reward.coins} coins and +${reward.trophies} trophies!`);}}}
function doAuth(){if(!socket?.connected)return;const p=profile();let token='';try{token=localStorage.getItem('hu-online-token-v1')||''}catch(e){}
 socket.emit('mp:hello',{token,name:p.name,team:p.team},reply=>{
  if(!reply?.ok){setStatus(reply?.error||'Could not sign in.');return;}
  authenticated=true;if(reply.token)try{localStorage.setItem('hu-online-token-v1',reply.token)}catch(e){}
  board=reply.board;updateBoard();applyReceipts(reply.receipts);
  if(reply.rejoined){room=reply.rejoined.code;slot=reply.rejoined.slot;$('mpRoomCode').textContent=room;$('mpLeave').hidden=false;setStatus('Reconnected to your match '+room+'.')}
  else setStatus('Connected. Create a room or enter a friend’s six-digit code.');
 });
}
function loadSocketScript(){if(typeof window.io==='function')return Promise.resolve();return new Promise((resolve,reject)=>{
 const el=document.createElement('script');el.src='https://hardwood-ultimate.onrender.com/socket.io/socket.io.js';el.onload=resolve;el.onerror=()=>reject(new Error('Multiplayer server not found. Deploy the ZIP to a Node.js host such as Render, or set HU_ONLINE_SERVER_URL for a separate website.'));document.head.appendChild(el);
});}
function connect(){if(socket||connecting)return;connecting=true;setStatus('Connecting to multiplayer server…');loadSocketScript().then(()=>{
 const target='https://hardwood-ultimate.onrender.com';
 socket=window.io(target,{transports:['polling'],reconnection:true,reconnectionAttempts:20,timeout:12000});
 socket.on('connect',()=>{setLinkStatus(true);authenticated=false;doAuth()});
 socket.on('disconnect',()=>{authenticated=false;setLinkStatus(false);setStatus('Connection lost. Reconnecting…')});
 socket.on('connect_error',()=>{setLinkStatus(false);setStatus('The multiplayer server is unavailable. Check that your Node.js website is running.')});
 socket.on('mp:closed',reason=>{cleanupUI();setStatus(reason||'The room was closed.')});
 socket.on('mp:state',s=>{
  if(room&&s.code!==room)return;room=s.code;$('mpRoomCode').textContent=room;$('mpLeave').hidden=false;state=s;
  waiting.hidden=s.phase!=='waiting';court.hidden=s.phase==='waiting';
  if(s.phase==='playing'){if(frames.length&&frames[frames.length-1].data.gameId!==s.gameId)frames=[];frames.push({at:performance.now(),data:s});if(frames.length>12)frames.shift();}
  if(s.phase==='waiting'){setStatus('Room created. Share the six-digit code with your friend.');return}
  const names=s.names||['Home','Away'];$('mpHomeLabel').textContent=names[0]+' · '+iconForTeam(s.teams[0]);$('mpAwayLabel').textContent=names[1]+' · '+iconForTeam(s.teams[1]);
  $('mpHomeScore').textContent=s.score[0];$('mpAwayScore').textContent=s.score[1];$('mpClock').textContent=s.phase==='final'?'FINAL':Math.ceil(s.remaining)+'s';
  const lineupKey=s.gameId;if(lastLineupKey!==lineupKey){$('mpHomeFive').innerHTML=rosterHTML(s.lineups?.[0]);$('mpAwayFive').innerHTML=rosterHTML(s.lineups?.[1]);lastLineupKey=lineupKey;}
  if(lastAnnouncement!==s.message){$('mpAnnouncement').textContent=s.message||'';lastAnnouncement=s.message;}
  $('mpRematch').hidden=s.phase!=='final';
  if(s.phase==='playing'){status.textContent=s.connected.every(Boolean)?'Match live — WASD move · Space shoot · E pass · F steal · Q switch · Shift sprint':'Opponent disconnected — match paused.'}
  else if(s.phase==='final')setStatus(s.winner===-1?'FINAL · Draw':s.winner===slot?'FINAL · You won!':'FINAL · You lost.');
 });
 socket.on('mp:receipts',applyReceipts);
 socket.on('mp:board-updated',()=>{if(shownBoard)fetchBoard()});
 }).catch(e=>setStatus(e.message)).finally(()=>connecting=false)
}
function enter(event){if(!socket?.connected||!authenticated){setStatus('Server not connected yet.');return}if(room){setStatus('Leave your current room before creating another.');return}
 const payload={name:profile().name,team:profile().team,squad:squad(),code:$('mpJoinCode').value.trim()};
 socket.emit(event,payload,r=>{if(!r?.ok){setStatus(r?.error||'Unable to join.');return}room=r.code;slot=r.slot;$('mpRoomCode').textContent=room;$('mpLeave').hidden=false;setStatus(slot===0?'Room created. Share the code with your friend.':'Joined! Starting your 5v5 match.');});
}
function fetchBoard(){if(!socket?.connected||!authenticated)return;socket.emit('mp:leaderboard',null,r=>{if(r?.ok){board=r;updateBoard()}})}
function updateBoard(){if(!board)return;const entries=board.entries||[];
 const rows=entries.map((p,i)=>`<tr><td>${i+1}</td><td>${escapeHTML(p.name)}</td><td>${iconForTeam(p.team)}</td><td>${p.wins}</td><td>${p.losses}</td><td>${p.trophies}</td></tr>`).join('');
 $('mpLeaderboard').innerHTML=`<p class="mpNote">Live server rankings · Your rank: ${board.rank?'#'+board.rank:'Not ranked yet'} · ${entries.length} shown</p><table><thead><tr><th>#</th><th>CLUB</th><th>TEAM</th><th>W</th><th>L</th><th>ONLINE TROPHIES</th></tr></thead><tbody>${rows||'<tr><td colspan="6">No online matches finished yet.</td></tr>'}</tbody></table>`;
}
$('mpClose').addEventListener('click',()=>{panel.hidden=true;hold.clear();pending=null});
$('mpCreate').addEventListener('click',()=>enter('mp:create'));
$('mpJoin').addEventListener('click',()=>enter('mp:join'));
$('mpLeave').addEventListener('click',()=>{if(socket&&room)socket.emit('mp:leave',null,()=>{});cleanupUI();setStatus('Left the room.')});
$('mpRematch').addEventListener('click',()=>socket?.emit('mp:rematch',null,r=>setStatus(r?.ok?'Rematch requested. Waiting for your friend.':r?.error||'Unable to rematch.')));
$('mpCopy').addEventListener('click',()=>{if(!room)return;const text=room;if(navigator.clipboard?.writeText)navigator.clipboard.writeText(text).then(()=>setStatus('Room code copied: '+text)).catch(()=>setStatus('Room code: '+text));else setStatus('Room code: '+text)});
$('mpLeaderboardBtn').addEventListener('click',()=>{shownBoard=!shownBoard;$('mpBoardPanel').hidden=!shownBoard;if(shownBoard)fetchBoard()});
$('mpJoinCode').addEventListener('keydown',e=>{if(e.key==='Enter')enter('mp:join')});
const keys={KeyW:'up',ArrowUp:'up',KeyS:'down',ArrowDown:'down',KeyA:'left',ArrowLeft:'left',KeyD:'right',ArrowRight:'right',ShiftLeft:'sprint',ShiftRight:'sprint'};
const actions={Space:'shoot',KeyE:'pass',KeyF:'steal',KeyQ:'switch'};
window.addEventListener('keydown',e=>{if(panel.hidden||court.hidden||e.target.tagName==='INPUT')return;
 if(keys[e.code])hold.add(keys[e.code]);if(actions[e.code]&&!e.repeat)pending=actions[e.code];
 if(keys[e.code]||actions[e.code]){e.preventDefault();e.stopImmediatePropagation()}
},true);
window.addEventListener('keyup',e=>{if(panel.hidden)return;if(keys[e.code])hold.delete(keys[e.code]);if(keys[e.code]||actions[e.code]){e.preventDefault();e.stopImmediatePropagation()}},true);
window.addEventListener('blur',()=>hold.clear());
for(const b of panel.querySelectorAll('[data-mpk]')){const a=b.dataset.mpk;b.addEventListener('pointerdown',e=>{e.preventDefault();b.setPointerCapture(e.pointerId);if(['shoot','pass','steal','switch'].includes(a))pending=a;else hold.add(a)});for(const ev of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(ev,()=>hold.delete(a))}
setInterval(()=>{if(!socket?.connected||!room||state?.phase!=='playing')return;socket.emit('mp:input',{dx:Number(hold.has('right'))-Number(hold.has('left')),dy:Number(hold.has('down'))-Number(hold.has('up')),sprint:hold.has('sprint'),action:pending});pending=null},50);
function visualState(){
 if(frames.length<2)return state;
 const target=performance.now()-RENDER_DELAY;
 while(frames.length>2&&frames[1].at<=target)frames.shift();
 const a=frames[0],b=frames[1];
 if(a.data.gameId!==b.data.gameId)return b.data;
 const t=Math.max(0,Math.min(1,(target-a.at)/Math.max(1,b.at-a.at)));
 const blend=(x,y)=>x+(y-x)*t;
 const old=new Map(a.data.players.map(p=>[p.id,p]));
 const players=b.data.players.map(p=>{const prev=old.get(p.id);return prev?{...p,x:blend(prev.x,p.x),y:blend(prev.y,p.y)}:p});
 let ball=b.data.ball;
 if(a.data.ball&&ball&&a.data.ball.flight?.kind===ball.flight?.kind){ball={...ball,x:blend(a.data.ball.x,ball.x),y:blend(a.data.ball.y,ball.y)};}
 return {...b.data,players,ball};
}
function paintPlayer(p,view,now){
 const x=32+p.x*9.36,y=33+p.y*4.94,ours=p.team===slot;
 const color=p.team===0?'#2562c8':'#dc4252',trim=p.team===0?'#f6c86e':'#fff1dd';
 const walking=Math.sin(now*.010+p.id*1.8)*2.7;
 ctx.save();ctx.translate(x,y);
 ctx.fillStyle='#0a15296b';ctx.beginPath();ctx.ellipse(2,4,13,5,0,0,Math.PI*2);ctx.fill();
 if(view.selected[p.team]===p.id){ctx.strokeStyle=ours?'#ffdb67':'#85e6f2';ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(0,2,18,8,0,0,Math.PI*2);ctx.stroke();}
 // 2.5D athletes: animated legs, jersey, arms and face, matching the main game's character language.
 ctx.lineCap='round';ctx.strokeStyle='#172238';ctx.lineWidth=5;
 ctx.beginPath();ctx.moveTo(-5,-17);ctx.lineTo(-6+walking,-2);ctx.moveTo(5,-17);ctx.lineTo(6-walking,-2);ctx.stroke();
 ctx.strokeStyle='#c89168';ctx.lineWidth=4;
 ctx.beginPath();ctx.moveTo(-10,-35);ctx.lineTo(-14-walking*.4,-21);ctx.moveTo(10,-35);ctx.lineTo(14+walking*.4,-21);ctx.stroke();
 const shirt=ctx.createLinearGradient(-10,-38,11,-20);shirt.addColorStop(0,'#121a2b');shirt.addColorStop(.3,color);shirt.addColorStop(.8,color);shirt.addColorStop(1,'#17213b');
 ctx.fillStyle=shirt;ctx.strokeStyle=trim;ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(-9,-38);ctx.lineTo(9,-38);ctx.lineTo(10,-19);ctx.lineTo(-10,-19);ctx.closePath();ctx.fill();ctx.stroke();
 ctx.fillStyle=trim;ctx.font='900 12px system-ui';ctx.textAlign='center';ctx.fillText(p.jersey,0,-23);
 ctx.fillStyle='#c89168';ctx.beginPath();ctx.arc(0,-45,8,0,Math.PI*2);ctx.fill();
 ctx.fillStyle='#1c1720';ctx.beginPath();ctx.arc(0,-46,8,Math.PI,Math.PI*2);ctx.fill();
 const label=(p.name||'Player').split(' ')[0]+' · '+p.ovr;
 ctx.font='700 12px system-ui';ctx.lineWidth=3.5;ctx.strokeStyle='#0b1224';ctx.strokeText(label,0,-60);ctx.fillStyle='#fff';ctx.fillText(label,0,-60);
 ctx.restore();
}
function draw(){requestAnimationFrame(draw);if(panel.hidden||court.hidden||!state)return;
 const view=visualState(),now=performance.now(),w=1000,h=560;
 ctx.clearRect(0,0,w,h);
 // Broadcast-style hardwood court and arena lighting, closer to the offline game.
 const floor=ctx.createLinearGradient(0,0,w,h);floor.addColorStop(0,'#c88e54');floor.addColorStop(.48,'#efc28a');floor.addColorStop(1,'#bd8351');ctx.fillStyle=floor;ctx.fillRect(0,0,w,h);
 for(let i=0;i<38;i++){ctx.fillStyle=i%3===0?'#5c35120d':'#fff3d20c';ctx.fillRect(i*27,0,25,h);}
 ctx.strokeStyle='rgba(255,246,222,.95)';ctx.lineWidth=3.2;ctx.strokeRect(32,33,936,494);
 ctx.beginPath();ctx.moveTo(500,33);ctx.lineTo(500,527);ctx.moveTo(563,280);ctx.arc(500,280,63,0,Math.PI*2);ctx.stroke();
 for(const bx of [84,916]){
  const left=bx===84;
  ctx.fillStyle=left?'#c3455050':'#265bba50';ctx.fillRect(left?32:810,196,158,168);
  ctx.strokeStyle='#fff1d9';ctx.strokeRect(left?32:810,196,158,168);
  ctx.beginPath();ctx.arc(bx,280,145,left?-Math.PI/2:Math.PI/2,left?Math.PI/2:3*Math.PI/2);ctx.stroke();
  ctx.fillStyle='#e6f5fa9a';ctx.fillRect(bx-5,254,10,52);
  ctx.strokeStyle='#f46d32';ctx.lineWidth=5;ctx.beginPath();ctx.ellipse(bx,280,13,7,0,0,Math.PI*2);ctx.stroke();
  ctx.strokeStyle='#ffffff77';ctx.lineWidth=1;for(let j=-2;j<=2;j++){ctx.beginPath();ctx.moveTo(bx-10+j*4,285);ctx.lineTo(bx-6+j*3,304);ctx.stroke();}
 }
 const ordered=[...view.players].sort((a,b)=>a.y-b.y);for(const p of ordered)paintPlayer(p,view,now);
 if(view.ball){let x=32+view.ball.x*9.36,y=33+view.ball.y*4.94;const f=view.ball.flight;if(f){const t=Math.min(1,f.elapsed/f.duration);y-=Math.sin(t*Math.PI)*(f.kind==='shot'?90:22)}
  const grad=ctx.createRadialGradient(x-3,y-3,1,x,y,10);grad.addColorStop(0,'#ffba6d');grad.addColorStop(1,'#be521e');ctx.fillStyle=grad;ctx.strokeStyle='#5b2b0d';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(x,y,9,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.beginPath();ctx.moveTo(x-8,y);ctx.lineTo(x+8,y);ctx.moveTo(x,y-8);ctx.lineTo(x,y+8);ctx.stroke();}
 ctx.fillStyle='#111b2fe0';ctx.fillRect(399,5,202,33);ctx.fillStyle='#f5d582';ctx.font='900 19px system-ui';ctx.textAlign='center';ctx.fillText(state.phase==='final'?'FINAL':Math.ceil(state.remaining)+' SEC',500,28);
}
requestAnimationFrame(draw);
window.HUOnline={open(){panel.hidden=false;updateSquad();connect();if(authenticated)fetchBoard();}};
})();
