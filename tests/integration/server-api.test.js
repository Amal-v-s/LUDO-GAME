import {beforeEach,afterEach,describe,expect,it} from 'vitest';
const {startServer}=require('../support/server-process.cjs');

let server;
beforeEach(async context => {
  server=await startServer({dice:context.task.name.includes('forced')?[6,2]:context.task.name.includes('no token')?[2,6]:[6,2,1,4,5]});
});
afterEach(async()=>{await server?.close();server=null});

async function post(path,payload) {
  const response=await fetch(server.baseURL+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
  return {status:response.status,body:await response.json()};
}
async function createRoom(name='Host',avatar='') {
  const result=await post('/api/create',{name,avatar});
  expect(result.status).toBe(200);
  return result.body;
}
async function joinRoom(code,name='Guest',avatar='') {
  return post('/api/join',{code,name,avatar});
}
async function startGame(code,playerId) { return post(`/api/room/${code}`,{action:'start',playerId}); }

describe('room and multiplayer HTTP integration',()=>{
  it('creates, joins and synchronizes unique player IDs, assigned colors, and confirmed avatars',async()=>{
    const avatar='data:image/jpeg;base64,'+Buffer.from('test-avatar').toString('base64');
    const host=await createRoom('Host',avatar),joined=await joinRoom(host.room.code,'Friend');
    expect(joined.status).toBe(200);
    expect(joined.body.playerId).not.toBe(host.playerId);
    expect(joined.body.room.players.map(player=>player.color)).toEqual(['coral','green']);
    expect(joined.body.room.players[0].avatar).toBe(avatar);
    expect((await fetch(`${server.baseURL}/api/room/${host.room.code}`).then(response=>response.json())).room.players).toHaveLength(2);
  });

  it('rejects unknown rooms, non-member actions, invalid player actions, and unsupported late joins',async()=>{
    expect((await joinRoom('NOPE00')).status).toBe(404);
    const host=await createRoom(),guest=await joinRoom(host.room.code);
    expect((await post(`/api/room/${host.room.code}`,{action:'start',playerId:guest.body.playerId})).status).toBe(403);
    expect((await post(`/api/room/${host.room.code}`,{action:'roll',playerId:'not-a-member',rollId:'x'})).status).toBe(403);
    expect((await startGame(host.room.code,host.playerId)).status).toBe(200);
    expect((await joinRoom(host.room.code,'Late friend')).status).toBe(409);
    expect((await post(`/api/room/${host.room.code}`,{action:'explode',playerId:host.playerId})).status).toBe(400);
  });

  it('enforces the six-player capacity and keeps repeated display names as distinct room members',async()=>{
    const host=await createRoom('Sam'),members=[host];
    for(let index=1;index<6;index++) {
      const joined=await joinRoom(host.room.code,'Sam');
      expect(joined.status).toBe(200);members.push(joined.body);
    }
    expect(new Set(members.map(member=>member.playerId)).size).toBe(6);
    expect(members.map(member=>member.room.players.at(-1).color)).toEqual(['coral','green','yellow','blue','purple','orange']);
    expect((await joinRoom(host.room.code,'Seventh player')).status).toBe(409);
  });

  it('allows only the active player to roll, requires a roll ID, and makes duplicate roll IDs idempotent',async()=>{
    const host=await createRoom(),guest=await joinRoom(host.room.code);
    await startGame(host.room.code,host.playerId);
    expect((await post(`/api/room/${host.room.code}`,{action:'roll',playerId:guest.body.playerId,rollId:'wrong-turn'})).status).toBe(409);
    expect((await post(`/api/room/${host.room.code}`,{action:'roll',playerId:host.playerId})).status).toBe(400);
    const path=`/api/room/${host.room.code}`,roll={action:'roll',playerId:host.playerId,rollId:'roll-once'};
    const [first,duplicate]=await Promise.all([post(path,roll),post(path,roll)]);
    expect(first.status).toBe(200);expect(duplicate.status).toBe(200);
    expect(first.body.room.lastRoll.value).toBeGreaterThanOrEqual(1);
    expect(first.body.room.lastRoll.value).toBeLessThanOrEqual(6);
    expect(duplicate.body.room.lastRoll).toEqual(first.body.room.lastRoll);
    expect((await post(path,{...roll,rollId:'different-pending-roll'})).status).toBe(409);
  });

  it('rejects selecting a token when the roll result is pending but the index is invalid',async()=>{
    const host=await createRoom(),guest=await joinRoom(host.room.code);
    await startGame(host.room.code,host.playerId);
    await post(`/api/room/${host.room.code}`,{action:'roll',playerId:host.playerId,rollId:'six'});
    expect((await post(`/api/room/${host.room.code}`,{action:'move',playerId:host.playerId,token:4})).status).toBe(400);
    const stillPending=await fetch(`${server.baseURL}/api/room/${host.room.code}`).then(response=>response.json());
    expect(stillPending.room.die).toBe(6);
    expect(stillPending.room.turn).toBe(0);
    expect(guest.body.playerId).toBeTruthy();
  });

  it('automatically moves a sole valid token after its roll',async()=>{
    const host=await createRoom(),guest=await joinRoom(host.room.code);
    await startGame(host.room.code,host.playerId);
    const path=`/api/room/${host.room.code}`;
    let state=(await post(path,{action:'roll',playerId:host.playerId,rollId:'spawn'})).body.room;
    expect(state.die).toBe(6);expect(state.validMoves).toHaveLength(4);
    state=(await post(path,{action:'move',playerId:host.playerId,token:0})).body.room;
    expect(state.tokens[host.playerId][0]).toBe(0);
    state=(await post(path,{action:'roll',playerId:host.playerId,rollId:'forced'})).body.room;
    expect(state.lastRoll.value).toBe(2);
    expect(state.tokens[host.playerId][0]).toBe(2);
    expect(state.die).toBeNull();
    expect(state.turn).toBe(1);
    expect(state.message).toMatch(/Moved automatically/);
    expect(guest.body.playerId).not.toBe(host.playerId);
  });

  it('automatically passes the turn when no token can move',async()=>{
    const host=await createRoom(),guest=await joinRoom(host.room.code);
    await startGame(host.room.code,host.playerId);
    const state=(await post(`/api/room/${host.room.code}`,{action:'roll',playerId:host.playerId,rollId:'no-move'})).body.room;
    expect(state.die).toBeNull();
    expect(state.turn).toBe(1);
    expect(state.message).toMatch(/No moves available/);
    expect(state.players[state.turn].id).toBe(guest.body.playerId);
  });

  it('synchronizes authoritative dice and moves to two independent polling clients',async()=>{
    const host=await createRoom(),guest=await joinRoom(host.room.code);
    await startGame(host.room.code,host.playerId);
    const path=`/api/room/${host.room.code}`;
    const hostView=await fetch(`${server.baseURL}${path}`).then(response=>response.json());
    const guestView=await fetch(`${server.baseURL}${path}`).then(response=>response.json());
    expect(hostView.room.tokens).toEqual(guestView.room.tokens);
    const rolled=(await post(path,{action:'roll',playerId:host.playerId,rollId:'sync-roll'})).body.room;
    expect(rolled.lastRoll.value).toBe(6);
    const moved=(await post(path,{action:'move',playerId:host.playerId,token:0})).body.room;
    const both=await Promise.all([fetch(`${server.baseURL}${path}`).then(r=>r.json()),fetch(`${server.baseURL}${path}`).then(r=>r.json())]);
    expect(both.map(view=>view.room.tokens)).toEqual([moved.tokens,moved.tokens]);
    expect(both[0].room.players.find(player=>player.id===host.playerId).color).toBe('coral');
    expect(guest.body.playerId).toBeTruthy();
  });

  it('applies a simultaneous duplicate move only once',async()=>{
    const host=await createRoom(),guest=await joinRoom(host.room.code);
    await startGame(host.room.code,host.playerId);
    const path=`/api/room/${host.room.code}`;
    await post(path,{action:'roll',playerId:host.playerId,rollId:'duplicate-move-roll'});
    const requests=await Promise.all([
      post(path,{action:'move',playerId:host.playerId,token:0}),
      post(path,{action:'move',playerId:host.playerId,token:0})
    ]);
    expect(requests.map(result=>result.status).sort()).toEqual([200,409]);
    const state=await fetch(`${server.baseURL}${path}`).then(response=>response.json()).then(result=>result.room);
    expect(state.tokens[host.playerId][0]).toBe(0);
    expect(state.killCounts[host.playerId]).toBe(0);
    expect(state.turn).toBe(0);
    expect(guest.body.playerId).not.toBe(host.playerId);
  });

  it('supports undo and redo through the existing HTTP actions',async()=>{
    const host=await createRoom(),guest=await joinRoom(host.room.code);
    await startGame(host.room.code,host.playerId);
    const path=`/api/room/${host.room.code}`;
    await post(path,{action:'roll',playerId:host.playerId,rollId:'undo-roll'});
    const afterMove=(await post(path,{action:'move',playerId:host.playerId,token:0})).body.room;
    expect(afterMove.tokens[host.playerId][0]).toBe(0);
    const undone=(await post(path,{action:'undo',playerId:host.playerId})).body.room;
    expect(undone.tokens[host.playerId][0]).toBe(-1);
    const redone=(await post(path,{action:'redo',playerId:host.playerId})).body.room;
    expect(redone.tokens[host.playerId][0]).toBe(0);
    expect(guest.body.playerId).not.toBe(host.playerId);
  });
});
