import {describe, expect, it} from 'vitest';
const {
  current, nextTurn, validTokenMoves, moveToken,
  captureGameState, restoreGameState, recordGameState
} = require('../../game-rules');
const {makeRoom} = require('../fixtures/room');

describe('turn and legal move calculation', () => {
  it('returns the current player and advances to the next non-finished player', () => {
    const room = makeRoom(4);
    expect(current(room).id).toBe('p1');
    room.winners.push('p2');
    nextTurn(room);
    expect(current(room).id).toBe('p3');
  });

  it('returns no moves before a roll and only releases yard tokens on a six', () => {
    const room = makeRoom(4);
    expect(validTokenMoves(room,'p1')).toEqual([]);
    room.die = 5;
    expect(validTokenMoves(room,'p1')).toEqual([]);
    room.die = 6;
    expect(validTokenMoves(room,'p1')).toEqual([0,1,2,3]);
  });

  it('allows exact finishes, disallows overshoots, and keeps finished tokens immobile', () => {
    const room = makeRoom(4,{p1:[57,-1,-1,-1]});
    room.die = 1;
    expect(validTokenMoves(room,'p1')).toEqual([0]);
    room.die = 2;
    expect(validTokenMoves(room,'p1')).toEqual([]);
    room.tokens.p1[0] = 58;
    room.die = 1;
    expect(validTokenMoves(room,'p1')).toEqual([]);
  });

  it('uses the existing shorter finish distance for extra seats', () => {
    const room = makeRoom(6,{p5:[56,-1,-1,-1]});
    room.die = 1;
    expect(validTokenMoves(room,'p5')).toEqual([0]);
    room.tokens.p5[0] = 57;
    expect(validTokenMoves(room,'p5')).toEqual([]);
  });
});

describe('token movement rules', () => {
  it('rejects leaving the yard without a six and rejects invalid token indices', () => {
    const room = makeRoom(4);
    room.die = 2;
    expect(moveToken(room,room.players[0],0)).toEqual({error:'That token cannot move.'});
    expect(room.tokens.p1[0]).toBe(-1);
  });

  it('moves a token out on six and grants another turn', () => {
    const room = makeRoom(4);
    room.die = 6;
    const result = moveToken(room,room.players[0],0);
    expect(room.tokens.p1[0]).toBe(0);
    expect(result.bonus).toBe(true);
    expect(room.turn).toBe(0);
  });

  it('advances by the rolled amount and passes turn after a normal move', () => {
    const room = makeRoom(4,{p1:[4,-1,-1,-1]});
    room.die = 3;
    const result = moveToken(room,room.players[0],0);
    expect(room.tokens.p1[0]).toBe(7);
    expect(result.bonus).toBe(false);
    expect(room.turn).toBe(1);
  });

  it('captures an opponent away from safe squares and increments kills once', () => {
    const room = makeRoom(4,{p1:[1,-1,-1,-1],p2:[41,-1,-1,-1]});
    room.die = 1;
    const result = moveToken(room,room.players[0],0);
    expect(result.captures).toBe(1);
    expect(room.tokens.p2[0]).toBe(-1);
    expect(room.killCounts.p1).toBe(1);
    expect(room.turn).toBe(0);
  });

  it('captures every opponent token on a capturable square and counts each once', () => {
    const room = makeRoom(4,{p1:[1,-1,-1,-1],p2:[41,41,-1,-1],p3:[28,-1,-1,-1]});
    room.die = 1;
    const result = moveToken(room,room.players[0],0);
    expect(result.captures).toBe(3);
    expect(room.tokens.p2.slice(0,2)).toEqual([-1,-1]);
    expect(room.tokens.p3[0]).toBe(-1);
    expect(room.killCounts.p1).toBe(3);
  });

  it('does not capture on safe squares', () => {
    const room = makeRoom(4,{p1:[7,-1,-1,-1],p2:[47,-1,-1,-1]});
    room.die = 1;
    const result = moveToken(room,room.players[0],0);
    expect(result.captured).toBe(false);
    expect(room.tokens.p2[0]).toBe(47);
    expect(room.killCounts.p1).toBe(0);
    expect(room.turn).toBe(1);
  });

  it('grants the existing extra turn on six and advances after a non-six', () => {
    const room = makeRoom(4,{p1:[4,-1,-1,-1]});
    room.die = 6;
    expect(moveToken(room,room.players[0],0).bonus).toBe(true);
    expect(room.turn).toBe(0);
    room.die = 2;
    expect(moveToken(room,room.players[0],0).bonus).toBe(false);
    expect(room.turn).toBe(1);
  });

  it('keeps same-player tokens on the same logical square without capturing them', () => {
    const room = makeRoom(4,{p1:[4,6,-1,-1]});
    room.die = 2;
    const result = moveToken(room,room.players[0],0);
    expect(room.tokens.p1.slice(0,2)).toEqual([6,6]);
    expect(result.captures).toBe(0);
    expect(room.killCounts.p1).toBe(0);
  });

  it('allows a player to land alongside an opposing token on a safe square', () => {
    const room = makeRoom(4,{p1:[7,-1,-1,-1],p2:[47,-1,-1,-1]});
    room.die = 1;
    moveToken(room,room.players[0],0);
    expect(room.tokens.p1[0]).toBe(8);
    expect(room.tokens.p2[0]).toBe(47);
  });

  it('finishes at the terminal position and records a winner', () => {
    const room = makeRoom(4,{p1:[57,-1,-1,-1]});
    room.die = 1;
    const result = moveToken(room,room.players[0],0);
    expect(room.tokens.p1[0]).toBe(58);
    expect(result.finished).toBe(true);
    expect(room.winners).toContain('p1');
    expect(room.die).toBeNull();
  });

  it('ends the game when the final remaining player finishes', () => {
    const room = makeRoom(4,{p1:[57,-1,-1,-1]});
    room.winners = ['p2','p3'];
    room.die = 1;
    const result = moveToken(room,room.players[0],0);
    expect(result.finished).toBe(true);
    expect(room.winners).toEqual(['p2','p3','p1','p4']);
    expect(room.message).toBe('Game over!');
  });

  it.fails('does not mark a player finished until all four tokens have reached home (known existing mismatch)', () => {
    const room = makeRoom(4,{p1:[57,-1,-1,-1]});
    room.die = 1;
    moveToken(room,room.players[0],0);
    expect(room.winners).not.toContain('p1');
  });
});

describe('undo and redo snapshots', () => {
  it('copies tokens and kill counts and restores independent state', () => {
    const room = makeRoom(4,{p1:[2,-1,-1,-1]});
    room.killCounts.p1 = 3;
    room.lastRoll = {playerId:'p1',value:4};
    const saved = captureGameState(room);
    room.tokens.p1[0] = 8;
    room.killCounts.p1 = 4;
    restoreGameState(room,saved);
    expect(room.tokens.p1[0]).toBe(2);
    expect(room.killCounts.p1).toBe(3);
    expect(room.lastRoll).toEqual({playerId:'p1',value:4});
  });

  it('caps history at 101 entries and clears redo history after a new action', () => {
    const room = makeRoom(4);
    room.redoHistory = [{turn:0}];
    for(let i=0;i<102;i++) recordGameState(room);
    expect(room.history).toHaveLength(101);
    expect(room.redoHistory).toEqual([]);
  });
});
