(()=>{'use strict';
const $=id=>document.getElementById(id);
const panel=$('mpPanel'),waiting=$('mpWaiting'),court=$('mpCourt'),canvas=$('mpCanvas'),ctx=canvas.getContext('2d');
const status=$('mpStatus'),hold=new Set();let pending=null,socket=null,authenticated=false,connecting=false,room='',slot=-1,state=null,board=null,shownBoard=false;
const profile=()=>window.HUOnlineBridge?.getProfile?.()||{name:'Player',team:0};
const squad=()=>window.HUOnlineBridge?.getSquad?.()||[];
const localTeamList=['ATL','BOS','BKN','CHA','CHI','CLE','DAL','DEN','DET','GSW','HOU','IND','LAC','LAL','MEM','MIA','MIL','MIN','NOP','NYK','OKC','ORL','PHI','PHX','POR','SAC','SAS','TOR','UTA','WAS'];
const setStatus=t=>{status.textContent=t};
const escapeHTML=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
function iconForTeam(t){return localTeamList[t]||'TEAM'}
function rosterHTML(cards){return (cards||[]).map((c,i)=>`<div class="mpPlayer"><b>${['PG','SG','SF','PF','C'][i]}</b><div>${escapeHTML(c?.name||'Player')}<small>${Math.round(c?.ovr||65)} OVR · ${escapeHTML(c?.position||'')} ${c?.position!==c?.slot?'(−10% out of position)':''}</small></div></div>`).join('')}
function updateSquad(){const items=window.HUOnlineBridge?.getLineup?.()||[];$('mpYourFive').innerHTML=rosterHTML(items.map(p=>({name:p.name,ovr:p.ovr,position:p.pos,slot:p.slot})));const p=profile();$('mpClubName').textContent=p.name+' · '+iconForTeam(p.team);}
function setLinkStatus(online){$('mpLinkDot').classList.toggle('online',!!online);$('mpLinkText').textContent=online?'ONLINE SERVER CONNECTED':'NOT CONNECTED'}
function cleanupUI(){room='';slot=-1;state=null;waiting.hidden=false;court.hidden=true;$('mpRoomCode').textContent='------';$('mpLeave').hidden=true;}
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
 const el=document.createElement('script');el.src=(window.HU_ONLINE_SERVER_URL||'').replace(/\/$/,'')+'/socket.io/socket.io.js';el.onload=resolve;el.onerror=()=>reject(new Error('Multiplayer server not found. Deploy the ZIP to a Node.js host such as Render, or set HU_ONLINE_SERVER_URL for a separate website.'));document.head.appendChild(el);
});}
function connect(){if(socket||connecting)return;connecting=true;setStatus('Connecting to multiplayer server…');loadSocketScript().then(()=>{
 const target=window.HU_ONLINE_SERVER_URL||location.origin;
 socket=window.io(target,{transports:['websocket','polling'],reconnection:true,reconnectionAttempts:20,timeout:12000});
 socket.on('connect',()=>{setLinkStatus(true);authenticated=false;doAuth()});
 socket.on('disconnect',()=>{authenticated=false;setLinkStatus(false);setStatus('Connection lost. Reconnecting…')});
 socket.on('connect_error',()=>{setLinkStatus(false);setStatus('The multiplayer server is unavailable. Check that your Node.js website is running.')});
 socket.on('mp:closed',reason=>{cleanupUI();setStatus(reason||'The room was closed.')});
 socket.on('mp:state',s=>{
  if(room&&s.code!==room)return;room=s.code;$('mpRoomCode').textContent=room;$('mpLeave').hidden=false;state=s;
  waiting.hidden=s.phase!=='waiting';court.hidden=s.phase==='waiting';
  if(s.phase==='waiting'){setStatus('Room created. Share the six-digit code with your friend.');return}
  const names=s.names||['Home','Away'];$('mpHomeLabel').textContent=names[0]+' · '+iconForTeam(s.teams[0]);$('mpAwayLabel').textContent=names[1]+' · '+iconForTeam(s.teams[1]);
  $('mpHomeScore').textContent=s.score[0];$('mpAwayScore').textContent=s.score[1];$('mpClock').textContent=s.phase==='final'?'FINAL':Math.ceil(s.remaining)+'s';
  $('mpHomeFive').innerHTML=rosterHTML(s.lineups?.[0]);$('mpAwayFive').innerHTML=rosterHTML(s.lineups?.[1]);
  $('mpAnnouncement').textContent=s.message||'';
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
function draw(){requestAnimationFrame(draw);if(panel.hidden||court.hidden||!state)return;
 const w=1000,h=560;ctx.clearRect(0,0,w,h);ctx.fillStyle='#b88752';ctx.fillRect(0,0,w,h);
 ctx.fillStyle='#c89962';for(let i=0;i<10;i++)ctx.fillRect(i*100+3,0,94,h);
 ctx.strokeStyle='#fff1db';ctx.lineWidth=3.5;ctx.strokeRect(32,33,936,494);ctx.beginPath();ctx.moveTo(500,33);ctx.lineTo(500,527);ctx.stroke();ctx.beginPath();ctx.arc(500,280,65,0,Math.PI*2);ctx.stroke();
 for(const bx of [84,916]){
  ctx.strokeRect(bx===84?32:810,195,158,170);
  ctx.beginPath();ctx.arc(bx,280,145,bx===84?-Math.PI/2:Math.PI/2,bx===84?Math.PI/2:3*Math.PI/2);ctx.stroke();
  ctx.fillStyle='#f5f6fa';ctx.fillRect(bx-5,252,10,56);ctx.strokeStyle='#ee5c29';ctx.lineWidth=6;ctx.beginPath();ctx.ellipse(bx,280,14,8,0,0,Math.PI*2);ctx.stroke();
 }
 const colors=['#265de2','#e64159'];
 for(const p of state.players){const x=p.x*10,y=33+p.y*4.94;ctx.fillStyle='#111a29aa';ctx.beginPath();ctx.ellipse(x+2,y+12,18,7,0,0,Math.PI*2);ctx.fill();
  ctx.beginPath();ctx.arc(x,y,16,0,Math.PI*2);ctx.fillStyle=colors[p.team];ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();
  ctx.fillStyle='white';ctx.font='900 13px system-ui';ctx.textAlign='center';ctx.fillText(p.jersey,x,y+4);
  if(state.selected[p.team]===p.id){ctx.strokeStyle=p.team===slot?'#ffeb78':'#b4f5f3';ctx.lineWidth=4;ctx.beginPath();ctx.arc(x,y,21,0,Math.PI*2);ctx.stroke()}
  ctx.font='700 12px system-ui';ctx.fillStyle='#101927';ctx.strokeStyle='#fff';ctx.lineWidth=2.5;const label=p.name.split(' ')[0]+' '+p.ovr;ctx.strokeText(label,x,y-25);ctx.fillText(label,x,y-25);
 }
 if(state.ball){let x=state.ball.x*10,y=33+state.ball.y*4.94;const f=state.ball.flight;if(f){const t=Math.min(1,f.elapsed/f.duration);y-=Math.sin(t*Math.PI)*(f.kind==='shot'?90:18)}ctx.fillStyle='#f98429';ctx.strokeStyle='#5b2b0d';ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,y,9,0,Math.PI*2);ctx.fill();ctx.stroke()}
 ctx.fillStyle='#111b2fc8';ctx.fillRect(399,5,202,33);ctx.fillStyle='#f5d582';ctx.font='900 19px system-ui';ctx.textAlign='center';ctx.fillText(state.phase==='final'?'FINAL':Math.ceil(state.remaining)+' SEC',500,28);
}
requestAnimationFrame(draw);
window.HUOnline={open(){panel.hidden=false;updateSquad();connect();if(authenticated)fetchBoard();}};
})();
