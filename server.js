const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {Pool} = require('pg');
const {promisify} = require('util');
const PORT = process.env.PORT || 3000;
const rooms = new Map();
const colors = ['coral', 'green', 'yellow', 'blue', 'purple', 'orange'];
const startOffsets = [0, 13, 26, 39, 8, 21];
const scrypt=promisify(crypto.scrypt);
const dbPool=process.env.DATABASE_URL?new Pool({connectionString:process.env.DATABASE_URL,max:5,idleTimeoutMillis:30000,connectionTimeoutMillis:5000}):null;
const adminLoginAttempts=new Map();
const globalAdminLoginAttempts={startedAt:Date.now(),attempts:0};
const ADMIN_SESSION_TTL=60*60;
const ADMIN_PASSWORD=parsePasswordHash(process.env.ADMIN_PASSWORD_HASH||'');
const ADMIN_USERNAME=process.env.ADMIN_USERNAME||'';
const ADMIN_SESSION_SECRET=process.env.ADMIN_SESSION_SECRET||'';

function code() { return crypto.randomBytes(3).toString('hex').toUpperCase(); }
function safeAvatar(value) {
  if(typeof value!=='string'||value.length>120000) return '';
  const match=value.match(/^data:image\/(webp|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/);
  if(!match||match[2].length%4!==0) return '';
  return Buffer.from(match[2],'base64').length<=90000?value:'';
}
function parsePasswordHash(value){const parts=value.split('$');if(parts.length!==4||parts[0]!=='scrypt'||!/^\w+$/.test(parts[1])||!/^([0-9a-f]{32})$/i.test(parts[2])||!/^([0-9a-f]{128})$/i.test(parts[3]))return null;const n=Number(parts[1]);if(n!==16384)return null;return{salt:Buffer.from(parts[2],'hex'),hash:Buffer.from(parts[3],'hex')};}
function privateAccessConfigured(){return Boolean(dbPool&&ADMIN_PASSWORD&&ADMIN_USERNAME.length>=1&&ADMIN_SESSION_SECRET.length>=32)}
async function initializeArchive(){if(!dbPool)return;await dbPool.query(`CREATE TABLE IF NOT EXISTS ludo_captured_avatars (player_id TEXT PRIMARY KEY, player_name TEXT NOT NULL, player_color TEXT NOT NULL, image_data TEXT NOT NULL, captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()); CREATE TABLE IF NOT EXISTS ludo_game_archive (game_id UUID PRIMARY KEY, room_code TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('in_progress','completed')), started_at TIMESTAMPTZ NOT NULL, finished_at TIMESTAMPTZ, players JSONB NOT NULL, winners JSONB NOT NULL DEFAULT '[]'::jsonb, kill_counts JSONB NOT NULL DEFAULT '{}'::jsonb); CREATE INDEX IF NOT EXISTS ludo_game_archive_started_at_idx ON ludo_game_archive (started_at DESC); CREATE INDEX IF NOT EXISTS ludo_captured_avatars_captured_at_idx ON ludo_captured_avatars (captured_at DESC)`);}
async function storeAvatar(player){if(!dbPool||!player.avatar)return;await dbPool.query('INSERT INTO ludo_captured_avatars(player_id,player_name,player_color,image_data) VALUES($1,$2,$3,$4) ON CONFLICT(player_id) DO UPDATE SET player_name=EXCLUDED.player_name,player_color=EXCLUDED.player_color,image_data=EXCLUDED.image_data',[player.id,player.name,player.color,player.avatar]);}
function archivedPlayers(room){return room.players.map(({id,name,color})=>({id,name,color}));}
async function createArchivedGame(room,gameId,startedAt){if(!dbPool)return;await dbPool.query('INSERT INTO ludo_game_archive(game_id,room_code,status,started_at,players,winners,kill_counts) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb)',[gameId,room.code,'in_progress',startedAt,JSON.stringify(archivedPlayers(room)),JSON.stringify([]),JSON.stringify(room.killCounts||{})]);}
async function syncArchivedGame(room){if(!dbPool||!room.archiveGameId)return;const complete=room.winners.length===room.players.length;await dbPool.query('UPDATE ludo_game_archive SET status=$2,finished_at=CASE WHEN $2=\'completed\' THEN COALESCE(finished_at,NOW()) ELSE NULL END,players=$3::jsonb,winners=$4::jsonb,kill_counts=$5::jsonb WHERE game_id=$1',[room.archiveGameId,complete?'completed':'in_progress',JSON.stringify(archivedPlayers(room)),JSON.stringify(room.winners),JSON.stringify(room.killCounts||{})]);}
function publicRoom(room) {
  const active=current(room);
  return { code: room.code, started: room.started, players: room.players.map(({id, name, color, avatar}) => ({id, name, color, avatar:avatar||''})), turn: room.turn, die: room.die, lastRoll:room.lastRoll||null, killCounts:room.killCounts||{}, canUndo:Boolean(room.started&&room.history?.length>1), canRedo:Boolean(room.started&&room.redoHistory?.length), historyEpoch:room.historyEpoch||0, validMoves:active?validTokenMoves(room,active.id):[], message: room.message, tokens: room.tokens, winners: room.winners };
}
function captureGameState(room) { return {turn:room.turn,die:room.die,lastRoll:room.lastRoll?{...room.lastRoll}:null,message:room.message,tokens:Object.fromEntries(Object.entries(room.tokens).map(([id,positions])=>[id,[...positions]])),winners:[...room.winners],killCounts:{...room.killCounts}}; }
function restoreGameState(room,state) { room.turn=state.turn;room.die=state.die;room.lastRoll=state.lastRoll?{...state.lastRoll}:null;room.message=state.message;room.tokens=Object.fromEntries(Object.entries(state.tokens).map(([id,positions])=>[id,[...positions]]));room.winners=[...state.winners];room.killCounts={...(state.killCounts||{})}; }
function recordGameState(room) { room.history.push(captureGameState(room));if(room.history.length>101)room.history.shift();room.redoHistory=[]; }
function send(res, status, data) { res.writeHead(status, {'content-type':'application/json','access-control-allow-origin':'*','cache-control':'no-store'}); res.end(JSON.stringify(data)); }
function sendPrivate(res,status,data,headers={}){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store','pragma':'no-cache','x-content-type-options':'nosniff',...headers});res.end(JSON.stringify(data));}
function body(req,maxBytes=250000) { return new Promise((resolve,reject)=>{let s='',size=0,settled=false;req.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){settled=true;reject(Object.assign(new Error('Request too large'),{statusCode:413}));req.resume();return}if(!settled)s+=chunk});req.on('end',()=>{if(settled)return;try{resolve(JSON.parse(s||'{}'))}catch(e){reject(e)}});req.on('error',reject);}); }
function secureRequest(req){const proto=String(req.headers['x-forwarded-proto']||'http').split(',')[0].trim().toLowerCase();return proto==='https'||process.env.NODE_ENV==='production'}
function adminCookieName(req){return secureRequest(req)?'__Host-ludo-private':'ludo-private'}
function setAdminCookie(req,res,value,maxAge=ADMIN_SESSION_TTL){const secure=secureRequest(req),name=adminCookieName(req);res.setHeader('set-cookie',`${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure?'; Secure':''}`)}
function requestHasSameOrigin(req){const origin=req.headers.origin;if(typeof origin!=='string')return false;try{const parsed=new URL(origin),host=String(req.headers.host||'').toLowerCase(),forwarded=String(req.headers['x-forwarded-proto']||'http').split(',')[0].trim().toLowerCase();return parsed.host.toLowerCase()===host&&parsed.protocol===`${forwarded}:`}catch{return false}}
function adminSessionToken(){const payload=`${Math.floor(Date.now()/1000)+ADMIN_SESSION_TTL}.${crypto.randomBytes(32).toString('base64url')}`,signature=crypto.createHmac('sha256',ADMIN_SESSION_SECRET).update(payload).digest('base64url');return `${payload}.${signature}`}
function validAdminSession(req){if(!privateAccessConfigured())return false;const cookies=String(req.headers.cookie||'').split(';').map(part=>part.trim()),prefix=adminCookieName(req)+'=',token=cookies.find(part=>part.startsWith(prefix))?.slice(prefix.length)||'',parts=token.split('.');if(parts.length!==3||!/^[0-9]{10}$/.test(parts[0]))return false;const expires=Number(parts[0]);if(expires<=Math.floor(Date.now()/1000)||expires>Math.floor(Date.now()/1000)+ADMIN_SESSION_TTL+60)return false;const expected=crypto.createHmac('sha256',ADMIN_SESSION_SECRET).update(`${parts[0]}.${parts[1]}`).digest(),provided=Buffer.from(parts[2],'base64url');return provided.length===expected.length&&crypto.timingSafeEqual(provided,expected)}
function loginRateKey(req){const forwarded=String(req.headers['x-forwarded-for']||'').split(',')[0].trim();return forwarded||req.socket.remoteAddress||'unknown'}
function loginAllowed(req){const key=loginRateKey(req),now=Date.now();if(now-globalAdminLoginAttempts.startedAt>15*60*1000){globalAdminLoginAttempts.startedAt=now;globalAdminLoginAttempts.attempts=0}const bucket=adminLoginAttempts.get(key);if(!bucket||now-bucket.startedAt>15*60*1000)adminLoginAttempts.set(key,{startedAt:now,attempts:0});return globalAdminLoginAttempts.attempts<120&&(adminLoginAttempts.get(key)?.attempts||0)<8}
function recordLoginFailure(req){const key=loginRateKey(req),now=Date.now(),bucket=adminLoginAttempts.get(key);globalAdminLoginAttempts.attempts++;if(!bucket||now-bucket.startedAt>15*60*1000)adminLoginAttempts.set(key,{startedAt:now,attempts:1});else bucket.attempts++;if(adminLoginAttempts.size>5000)for(const [ip,item] of adminLoginAttempts)if(now-item.startedAt>15*60*1000)adminLoginAttempts.delete(ip)}
async function verifyAdminPassword(value){if(typeof value!=='string'||value.length>1024)return false;const candidate=Buffer.from(await scrypt(value,ADMIN_PASSWORD.salt,ADMIN_PASSWORD.hash.length,{N:16384,r:8,p:1}));return candidate.length===ADMIN_PASSWORD.hash.length&&crypto.timingSafeEqual(candidate,ADMIN_PASSWORD.hash)}
function servePrivatePage(res){fs.readFile(path.join(__dirname,'public','private.html'),(error,data)=>{if(error){res.writeHead(404);return res.end('Not found')}res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'private, no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"});res.end(data)})}
async function privateApi(req,res,url){if(!privateAccessConfigured())return sendPrivate(res,404,{error:'Not found.'});if(req.method==='POST'&&url.pathname==='/api/private/login'){if(!requestHasSameOrigin(req))return sendPrivate(res,403,{error:'Request rejected.'});if(!loginAllowed(req))return sendPrivate(res,429,{error:'Too many attempts. Try again later.'},{'retry-after':'900'});try{const input=await body(req,4096),username=typeof input.username==='string'?input.username:'',usernameBuffer=Buffer.from(username),expectedUsername=Buffer.from(ADMIN_USERNAME),usernameMatches=usernameBuffer.length===expectedUsername.length&&crypto.timingSafeEqual(usernameBuffer,expectedUsername),passwordMatches=await verifyAdminPassword(input.password);if(!usernameMatches||!passwordMatches){recordLoginFailure(req);return sendPrivate(res,401,{error:'Sign-in failed.'})}adminLoginAttempts.delete(loginRateKey(req));setAdminCookie(req,res,adminSessionToken());return sendPrivate(res,200,{ok:true})}catch(error){return sendPrivate(res,error.statusCode||400,{error:error.statusCode===413?'Request too large.':'Invalid request.'})}}
 if(req.method==='POST'&&url.pathname==='/api/private/logout'){if(!requestHasSameOrigin(req))return sendPrivate(res,403,{error:'Request rejected.'});setAdminCookie(req,res,'',0);return sendPrivate(res,200,{ok:true})}
 if(!validAdminSession(req))return sendPrivate(res,401,{error:'Sign-in required.'});
 if(req.method==='GET'&&url.pathname==='/api/private/data'){if(!dbPool)return sendPrivate(res,503,{error:'Archive storage is unavailable.'});const limit=24,avatarOffset=Math.max(0,Math.min(100000,Number.parseInt(url.searchParams.get('avatarOffset')||'0',10)||0)),gameOffset=Math.max(0,Math.min(100000,Number.parseInt(url.searchParams.get('gameOffset')||'0',10)||0));try{const [avatars,games,avatarCount,gameCount]=await Promise.all([dbPool.query('SELECT player_id,player_name,player_color,captured_at FROM ludo_captured_avatars ORDER BY captured_at DESC LIMIT $1 OFFSET $2',[limit,avatarOffset]),dbPool.query('SELECT game_id,room_code,status,started_at,finished_at,players,winners,kill_counts FROM ludo_game_archive ORDER BY started_at DESC LIMIT $1 OFFSET $2',[limit,gameOffset]),dbPool.query('SELECT COUNT(*)::int AS total FROM ludo_captured_avatars'),dbPool.query('SELECT COUNT(*)::int AS total FROM ludo_game_archive')]);return sendPrivate(res,200,{avatars:avatars.rows,avatarTotal:avatarCount.rows[0].total,avatarOffset,avatarLimit:limit,games:games.rows,gameTotal:gameCount.rows[0].total,gameOffset,gameLimit:limit})}catch(error){console.error('Private archive query failed:',error.message);return sendPrivate(res,503,{error:'Archive storage is temporarily unavailable.'})}}
 const avatarMatch=url.pathname.match(/^\/api\/private\/avatar\/([0-9a-f-]{36})$/i);if(req.method==='GET'&&avatarMatch){try{const result=await dbPool.query('SELECT image_data FROM ludo_captured_avatars WHERE player_id=$1',[avatarMatch[1]]);if(!result.rowCount)return sendPrivate(res,404,{error:'Photo not found.'});const match=result.rows[0].image_data.match(/^data:image\/(webp|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/);if(!match)return sendPrivate(res,404,{error:'Photo not found.'});const bytes=Buffer.from(match[2],'base64');res.writeHead(200,{'content-type':`image/${match[1]}`,'content-length':bytes.length,'cache-control':'private, no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox"});return res.end(bytes)}catch(error){console.error('Private photo query failed:',error.message);return sendPrivate(res,503,{error:'Photo storage is temporarily unavailable.'})}}
 return sendPrivate(res,404,{error:'Not found.'})}
function current(room) { return room.players[room.turn]; }
function nextTurn(room) { let n=room.players.length; do { room.turn=(room.turn+1)%n; } while(room.winners.includes(room.players[room.turn].id) && room.winners.length<n); }
function validTokenMoves(room, playerId) {
  if(room.die===null) return [];
  return (room.tokens[playerId]||[]).flatMap((position,index)=>position<0?room.die===6?[index]:[]:position+room.die<=57?[index]:[]);
}
function moveToken(room, player, idx) {
  const ts=room.tokens[player.id], old=ts[idx];
  if(old<0 && room.die!==6 || old>=0 && old+room.die>57) return {error:'That token cannot move.'};
  let captures=0; ts[idx]=old<0?0:old+room.die;
  const playerIndex=room.players.findIndex(p=>p.id===player.id), start=startOffsets[playerIndex];
  if(ts[idx]<52) {
    const pos=(start+ts[idx])%52;
    if(![0,8,13,21,26,34,39,47].includes(pos)) for(const op of room.players) if(op.id!==player.id) {const opIndex=room.players.findIndex(p=>p.id===op.id);room.tokens[op.id].forEach((t,i)=>{if(t>=0&&t<52&&(startOffsets[opIndex]+t)%52===pos){room.tokens[op.id][i]=-1;captures++;}});}
  }
  if(captures) room.killCounts[player.id]=(room.killCounts[player.id]||0)+captures;
  const finished=ts[idx]===57; if(finished&&!room.winners.includes(player.id)) room.winners.push(player.id);
  const captured=captures>0,bonus=room.die===6||captured||finished;
  const description=finished?`${player.name} brought a token home!`:captured?`${player.name} captured ${captures} token${captures===1?'':'s'}!`:`${player.name} moved a token.`;
  room.die=null;
  if(room.winners.length===room.players.length-1) {room.winners.push(...room.players.filter(p=>!room.winners.includes(p.id)).map(p=>p.id));room.message='Game over!';}
  else if(!bonus) nextTurn(room);
  return {captured,captures,finished,bonus,description};
}
function api(req,res,url) {
  if(url.pathname==='/archive'||url.pathname==='/archive/')return servePrivatePage(res);
  if(url.pathname.startsWith('/api/private/'))return privateApi(req,res,url);
  if(req.method==='OPTIONS') {res.writeHead(204,{'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type'}); return res.end();}
  (async()=>{
    if(url.pathname==='/api/create' && req.method==='POST') {
      const b=await body(req), name=String(b.name||'').trim().slice(0,18)||'Player 1'; let id=crypto.randomUUID(); let c=code(); while(rooms.has(c)) c=code();
      const host={id,name,color:colors[0],avatar:safeAvatar(b.avatar)};try{await storeAvatar(host)}catch(error){console.error('Avatar archive save failed:',error.message);return send(res,503,{error:'Could not safely store the captured photo. Please try again.'})}
      const room={code:c,host:id,started:false,players:[host],turn:0,die:null,message:'Waiting for friends to join…',tokens:{},winners:[],killCounts:{[id]:0},rollRequests:new Map(),history:[],redoHistory:[],historyEpoch:0};
      rooms.set(c,room); return send(res,200,{playerId:id,room:publicRoom(room)});
    }
    if(url.pathname==='/api/join' && req.method==='POST') {
      const b=await body(req), c=String(b.code||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6), room=rooms.get(c);
      if(!room) return send(res,404,{error:'Room not found. Check the code and try again.'});
      if(room.started) return send(res,409,{error:'This game has already started.'});
      if(room.players.length>=6) return send(res,409,{error:'This room is full.'});
      const id=crypto.randomUUID(), name=String(b.name||'').trim().slice(0,18)||`Player ${room.players.length+1}`,guest={id,name,color:colors[room.players.length],avatar:safeAvatar(b.avatar)};
      try{await storeAvatar(guest)}catch(error){console.error('Avatar archive save failed:',error.message);return send(res,503,{error:'Could not safely store the captured photo. Please try again.'})}
      room.players.push(guest); room.killCounts[id]=0; room.message=`${name} joined the room.`;
      return send(res,200,{playerId:id,room:publicRoom(room)});
    }
    const m=url.pathname.match(/^\/api\/room\/([A-Z0-9]+)$/);
    if(m && req.method==='GET') {const room=rooms.get(m[1]); return room?send(res,200,{room:publicRoom(room)}):send(res,404,{error:'Room not found.'});}
    if(m && req.method==='POST') {
      const room=rooms.get(m[1]); if(!room) return send(res,404,{error:'Room not found.'});
      const b=await body(req), player=room.players.find(p=>p.id===b.playerId); if(!player) return send(res,403,{error:'You are not in this room.'});
      if(room.started&&!room.killCounts) room.killCounts=Object.fromEntries(room.players.map(p=>[p.id,0]));
      if(room.started&&!Array.isArray(room.history)){room.history=[captureGameState(room)];room.redoHistory=[];room.historyEpoch=0;}
      if(b.action==='roll' && typeof b.rollId==='string' && room.rollRequests.has(b.rollId)) {
        return room.rollRequests.get(b.rollId)===player.id?send(res,200,{room:publicRoom(room)}):send(res,409,{error:'This roll request has already been used.'});
      }
      if(b.action==='start') {
        if(player.id!==room.host) return send(res,403,{error:'Only the host can start the game.'});
        if(room.players.length<2) return send(res,409,{error:'Invite at least one friend to start.'});
        if(room.startPromise)await room.startPromise;
        if(!room.started) {const archiveId=crypto.randomUUID(),startedAt=new Date().toISOString();room.startPromise=(async()=>{try{await createArchivedGame(room,archiveId,startedAt);room.archiveGameId=archiveId;room.started=true;room.startedAt=startedAt;room.message='Game started! Roll a six to bring a token out.';room.killCounts=Object.fromEntries(room.players.map(p=>[p.id,0]));for(const p of room.players) room.tokens[p.id]=[-1,-1,-1,-1];room.history=[captureGameState(room)];room.redoHistory=[]}finally{room.startPromise=null}})();try{await room.startPromise}catch(error){console.error('Game archive start failed:',error.message);return send(res,503,{error:'Game history storage is temporarily unavailable. Please try again.'})}}
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
      if(room.started&&room.archiveGameId)try{await syncArchivedGame(room)}catch(error){console.error('Game archive update failed:',error.message)}
      return send(res,200,{room:publicRoom(room)});
    }
    send(res,404,{error:'Not found.'});
  })().catch(()=>send(res,400,{error:'Invalid request.'}));
}
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost'); if(url.pathname==='/archive'||url.pathname==='/archive/'||url.pathname.startsWith('/api/')) return api(req,res,url); const file=path.join(__dirname,'public',url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).replace(/^\/+/,'')); if(!file.startsWith(path.join(__dirname,'public'))) {res.writeHead(403);return res.end()} fs.readFile(file,(e,data)=>{if(e){res.writeHead(404);return res.end('Not found')} res.writeHead(200,{'content-type':types[path.extname(file)]||'application/octet-stream','x-content-type-options':'nosniff'});res.end(data)});});
initializeArchive().then(()=>server.listen(PORT,()=>console.log(`Ludo is ready at http://localhost:${PORT}`))).catch(error=>{console.error('Could not initialize durable archive storage:',error.message);process.exit(1)});
process.on('SIGTERM',()=>server.close(()=>dbPool?.end().finally(()=>process.exit(0))));
