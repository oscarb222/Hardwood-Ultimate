'use strict';
const fs=require('fs');const path=require('path');const crypto=require('crypto');
const folder=process.env.DATA_DIR||path.resolve(__dirname,'../data');fs.mkdirSync(folder,{recursive:true});
const filename=path.join(folder,'online-leaderboard.json');
let state={accounts:{}};
try{const loaded=JSON.parse(fs.readFileSync(filename,'utf8'));if(loaded&&typeof loaded.accounts==='object')state=loaded}catch(e){if(e.code!=='ENOENT')console.warn('Leaderboard read issue:',e.message)}
function persist(){const tmp=filename+'.tmp';fs.writeFileSync(tmp,JSON.stringify(state,null,2));fs.renameSync(tmp,filename)}
function accountFromToken(token){if(typeof token!=='string'||!/^([a-f0-9]{64})$/.test(token))return null;const hash=crypto.createHash('sha256').update(token).digest('hex');return state.accounts[hash]||null}
function createAccount(name,team){const token=crypto.randomBytes(32).toString('hex');const id=crypto.createHash('sha256').update(token).digest('hex');const a={id,name,team,joined:Date.now(),wins:0,losses:0,draws:0,trophies:0,coinsWon:0,points:0,receipts:[]};state.accounts[id]=a;persist();return {account:a,token}}
function updateAccount(a,name,team){a.name=name;a.team=team;persist()}
function reward(a,game,team){if(a.receipts.some(x=>x.id===game.id))return;
 const won=game.winner===team,draw=game.winner===-1,scored=game.score[team];
 const coins=scored*25+(won?250:draw?150:100),trophies=scored+(won?10:0);
 if(won)a.wins++;else if(draw)a.draws++;else a.losses++;
 a.trophies+=trophies;a.coinsWon+=coins;a.points+=scored;
 a.receipts.push({id:game.id,coins,trophies,won,draw,points:scored,opponent:game.score[1-team],created:Date.now()});
 a.receipts=a.receipts.slice(-50);persist();
}
function receipts(a){return a.receipts||[]}
function ackReceipt(a,id){a.receipts=(a.receipts||[]).filter(x=>x.id!==id);persist()}
function leaderboard(id){const entries=Object.values(state.accounts).map(a=>({name:a.name,team:a.team,wins:a.wins,losses:a.losses,draws:a.draws,trophies:a.trophies,points:a.points})).sort((a,b)=>b.trophies-a.trophies||b.wins-a.wins||a.name.localeCompare(b.name));
 const my=state.accounts[id];let rank=my?1+entries.filter(a=>a.trophies>my.trophies||(a.trophies===my.trophies&&a.wins>my.wins)).length:null;
 return {entries:entries.slice(0,50),rank,me:my?{wins:my.wins,losses:my.losses,draws:my.draws,trophies:my.trophies}:null};}
module.exports={accountFromToken,createAccount,updateAccount,reward,receipts,ackReceipt,leaderboard};
