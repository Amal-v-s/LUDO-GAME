const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PORT = process.env.PORT || 3000;
const rooms = new Map();
const colors = ['coral', 'green', 'yellow', 'blue', 'purple', 'orange'];
const startOffsets = [0, 13, 26, 39, 8, 21];

function code() { return crypto.randomBytes(3).toString('hex').toUpperCase(); }
function safeAvatar(value) {
  if(typeof value!=='string'||value.length>120000) return '';
  const match=value.match(/^data:image\/(webp|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/);
  if(!match||match[2].length%4!==0) return '';
  return Buffer.from(match[2],'base64').length<=90000?value:'';
}
function publicRoom(room) {
  const active=current(room);
  return { code: room.code, started: room.started, players: room.players.map(({id, name, color, avatar}) => ({id, name, color, avatar:avatar||''})), turn: room.turn, die: room.die, lastRoll:room.lastRoll||null, canUndo:Boolean(room.started&&room.history?.length>1), canRedo:Boolean(room.started&&room.redoHistory?.length), historyEpoch:room.historyEpoch||0, validMoves:active?validTokenMoves(room,active.id):[], message: room.message, tokens: room.tokens, winners: room.winners };
}
function captureGameState(room) { return {turn:room.turn,die:room.die,lastRoll:room.lastRoll?{...room.lastRoll}:null,message:room.message,tokens:Object.fromEntries(Object.entries(room.tokens).map(([id,positions])=>[id,[...positions]])),winners:[...room.winners]}; }
function restoreGameState(room,state) { room.turn=state.turn;room.die=state.die;room.lastRoll=state.lastRoll?{...state.lastRoll}:null;room.message=state.message;room.tokens=Object.fromEntries(Object.entries(state.tokens).map(([id,positions])=>[id,[...positions]]));room.winners=[...state.winners]; }
function recordGameState(room) { room.history.push(captureGameState(room));if(room.history.length>101)room.history.shift();room.redoHistory=[]; }
function send(res, status, data) { res.writeHead(status, {'content-type':'application/json','access-control-allow-origin':'*','cache-control':'no-store'}); res.end(JSON.stringify(data)); }
function body(req) { return new Promise((resolve,reject)=>{let s=''; req.on('data',c=>s+=c); req.on('end',()=>{try{resolve(JSON.parse(s||'{}'))}catch(e){reject(e)}});}); }
function current(room) { return room.players[room.turn]; }
function nextTurn(room) { let n=room.players.length; do { room.turn=(room.turn+1)%n; } while(room.winners.includes(room.players[room.turn].id) && room.winners.length<n); }
function validTokenMoves(room, playerId) {
  if(room.die===null) return [];
  return (room.tokens[playerId]||[]).flatMap((position,index)=>position<0?room.die===6?[index]:[]:position+room.die<=57?[index]:[]);
}
function moveToken(room, player, idx) {
  const ts=room.tokens[player.id], old=ts[idx];
  if(old<0 && room.die!==6 || old>=0 && old+room.die>57) return {error:'That token cannot move.'};
  let captured=false; ts[idx]=old<0?0:old+room.die;
  const playerIndex=room.players.findIndex(p=>p.id===player.id), start=startOffsets[playerIndex];
  if(ts[idx]<52) {
    const pos=(start+ts[idx])%52;
    if(![0,8,13,21,26,34,39,47].includes(pos)) for(const op of room.players) if(op.id!==player.id) {const opIndex=room.players.findIndex(p=>p.id===op.id);room.tokens[op.id].forEach((t,i)=>{if(t>=0&&t<52&&(startOffsets[opIndex]+t)%52===pos){room.tokens[op.id][i]=-1;captured=true;}});}
  }
  const finished=ts[idx]===57; if(finished&&!room.winners.includes(player.id)) room.winners.push(player.id);
  const bonus=room.die===6||captured||finished;
  const description=finished?`${player.name} brought a token home!`:captured?`${player.name} captured a token!`:`${player.name} moved a token.`;
  room.die=null;
  if(room.winners.length===room.players.length-1) {room.winners.push(...room.players.filter(p=>!room.winners.includes(p.id)).map(p=>p.id));room.message='Game over!';}
  else if(!bonus) nextTurn(room);
  return {captured,finished,bonus,description};
}
function api(req,res,url) {
  if(req.method==='OPTIONS') {res.writeHead(204,{'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type'}); return res.end();}
  (async()=>{
    if(url.pathname==='/api/create' && req.method==='POST') {
      const b=await body(req), name=String(b.name||'').trim().slice(0,18)||'Player 1'; let id=crypto.randomUUID(); let c=code(); while(rooms.has(c)) c=code();
      const room={code:c,host:id,started:false,players:[{id,name,color:colors[0],avatar:safeAvatar(b.avatar)}],turn:0,die:null,message:'Waiting for friends to join…',tokens:{},winners:[],rollRequests:new Map(),history:[],redoHistory:[],historyEpoch:0};
      rooms.set(c,room); return send(res,200,{playerId:id,room:publicRoom(room)});
    }
    if(url.pathname==='/api/join' && req.method==='POST') {
      const b=await body(req), c=String(b.code||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6), room=rooms.get(c);
      if(!room) return send(res,404,{error:'Room not found. Check the code and try again.'});
      if(room.started) return send(res,409,{error:'This game has already started.'});
      if(room.players.length>=6) return send(res,409,{error:'This room is full.'});
      const id=crypto.randomUUID(), name=String(b.name||'').trim().slice(0,18)||`Player ${room.players.length+1}`;
      room.players.push({id,name,color:colors[room.players.length],avatar:safeAvatar(b.avatar)}); room.message=`${name} joined the room.`;
      return send(res,200,{playerId:id,room:publicRoom(room)});
    }
    const m=url.pathname.match(/^\/api\/room\/([A-Z0-9]+)$/);
    if(m && req.method==='GET') {const room=rooms.get(m[1]); return room?send(res,200,{room:publicRoom(room)}):send(res,404,{error:'Room not found.'});}
    if(m && req.method==='POST') {
      const room=rooms.get(m[1]); if(!room) return send(res,404,{error:'Room not found.'});
      const b=await body(req), player=room.players.find(p=>p.id===b.playerId); if(!player) return send(res,403,{error:'You are not in this room.'});
      if(room.started&&!Array.isArray(room.history)){room.history=[captureGameState(room)];room.redoHistory=[];room.historyEpoch=0;}
      if(b.action==='roll' && typeof b.rollId==='string' && room.rollRequests.has(b.rollId)) {
        return room.rollRequests.get(b.rollId)===player.id?send(res,200,{room:publicRoom(room)}):send(res,409,{error:'This roll request has already been used.'});
      }
      if(b.action==='start') {
        if(player.id!==room.host) return send(res,403,{error:'Only the host can start the game.'});
        if(room.players.length<2) return send(res,409,{error:'Invite at least one friend to start.'});
        if(!room.started) {room.started=true; room.message='Game started! Roll a six to bring a token out.'; for(const p of room.players) room.tokens[p.id]=[-1,-1,-1,-1];room.history=[captureGameState(room)];room.redoHistory=[];}
      } else if(!room.started) return send(res,409,{error:'The game has not started yet.'});
      else if(b.action==='undo') {
        if(room.history.length<=1) return send(res,409,{error:'There is no game action to undo.'});
        room.redoHistory.push(captureGameState(room));room.history.pop();restoreGameState(room,room.history.at(-1));room.historyEpoch++;
      } else if(b.action==='redo') {
        if(!room.redoHistory.length) return send(res,409,{error:'There is no game action to redo.'});
        const next=room.redoHistory.pop();restoreGameState(room,next);room.history.push(captureGameState(room));room.historyEpoch++;
      }
      else if(player.id!==current(room).id) return send(res,409,{error:'Wait for your turn.'});
      else if(b.action==='roll') {
        if(typeof b.rollId!=='string'||!b.rollId) return send(res,400,{error:'A roll request ID is required.'});
        if(room.die!==null) return send(res,409,{error:'Choose one of your tokens first.'});
        room.rollRequests.set(b.rollId,player.id);
        room.die=1+Math.floor(Math.random()*6); room.lastRoll={playerId:player.id,value:room.die}; room.message=`${player.name} rolled a ${room.die}.`;
        const rollMessage=room.message, moves=validTokenMoves(room,player.id);
        if(moves.length===0) {room.message+=` No moves available.`; if(room.die!==6) nextTurn(room); room.die=null;}
        else if(moves.length===1) {
          const result=moveToken(room,player,moves[0]);
          room.message=`${rollMessage} ${result.description} Moved automatically.${result.bonus&&room.winners.length!==room.players.length?' You get another turn.':''}${room.winners.length===room.players.length?' Game over!':''}`;
        }
        recordGameState(room);
      } else if(b.action==='move') {
        if(room.die===null) return send(res,409,{error:'Roll the die first.'});
        const idx=Number(b.token); if(!Number.isInteger(idx)||idx<0||idx>3) return send(res,400,{error:'Invalid token.'});
        const result=moveToken(room,player,idx); if(result.error) return send(res,409,{error:result.error});
        room.message=room.winners.length===room.players.length?'Game over!':result.description;
        recordGameState(room);
      } else return send(res,400,{error:'Unknown action.'});
      return send(res,200,{room:publicRoom(room)});
    }
    send(res,404,{error:'Not found.'});
  })().catch(()=>send(res,400,{error:'Invalid request.'}));
}
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost'); if(url.pathname.startsWith('/api/')) return api(req,res,url); const file=path.join(__dirname,'public',url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).replace(/^\/+/,'')); if(!file.startsWith(path.join(__dirname,'public'))) {res.writeHead(403);return res.end()} fs.readFile(file,(e,data)=>{if(e){res.writeHead(404);return res.end('Not found')} res.writeHead(200,{'content-type':types[path.extname(file)]||'application/octet-stream'});res.end(data)});}).listen(PORT,()=>console.log(`Ludo is ready at http://localhost:${PORT}`));
