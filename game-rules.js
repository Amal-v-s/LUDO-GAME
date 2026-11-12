'use strict';

const { startOffsets, finishPositions } = require('./public/board-geometry');

function current(room) { return room.players[room.turn]; }
function nextTurn(room) {
  const count = room.players.length;
  do { room.turn = (room.turn + 1) % count; }
  while (room.winners.includes(room.players[room.turn].id) && room.winners.length < count);
}
function validTokenMoves(room, playerId) {
  if (room.die === null) return [];
  const playerIndex = room.players.findIndex(player => player.id === playerId);
  const finish = finishPositions[playerIndex] || 58;
  return (room.tokens[playerId] || []).flatMap((position, index) =>
    position < 0 ? (room.die === 6 ? [index] : []) : position + room.die <= finish ? [index] : []
  );
}
function moveToken(room, player, idx) {
  const tokens = room.tokens[player.id], old = tokens[idx];
  const playerIndex = room.players.findIndex(item => item.id === player.id);
  const finish = finishPositions[playerIndex] || 58;
  if ((old < 0 && room.die !== 6) || (old >= 0 && old + room.die > finish)) return { error: 'That token cannot move.' };

  let captures = 0;
  tokens[idx] = old < 0 ? 0 : old + room.die;
  const start = startOffsets[playerIndex];
  if (tokens[idx] < 52) {
    const position = (start + tokens[idx]) % 52;
    if (![0, 8, 13, 21, 26, 34, 39, 47].includes(position)) {
      for (const opponent of room.players) {
        if (opponent.id === player.id) continue;
        const opponentIndex = room.players.findIndex(item => item.id === opponent.id);
        room.tokens[opponent.id].forEach((opponentPosition, tokenIndex) => {
          if (opponentPosition >= 0 && opponentPosition < 52 &&
              (startOffsets[opponentIndex] + opponentPosition) % 52 === position) {
            room.tokens[opponent.id][tokenIndex] = -1;
            captures++;
          }
        });
      }
    }
  }
  if (captures) room.killCounts[player.id] = (room.killCounts[player.id] || 0) + captures;
  const finished = tokens[idx] === finish;
  if (finished && !room.winners.includes(player.id)) room.winners.push(player.id);
  const captured = captures > 0, bonus = room.die === 6 || captured || finished;
  const description = finished ? `${player.name} brought a token home!` : captured
    ? `${player.name} captured ${captures} token${captures === 1 ? '' : 's'}!`
    : `${player.name} moved a token.`;
  room.die = null;
  if (room.winners.length === room.players.length - 1) {
    room.winners.push(...room.players.filter(item => !room.winners.includes(item.id)).map(item => item.id));
    room.message = 'Game over!';
  } else if (!bonus) nextTurn(room);
  return { captured, captures, finished, bonus, description };
}
function captureGameState(room) {
  return {
    turn: room.turn, die: room.die, lastRoll: room.lastRoll ? { ...room.lastRoll } : null,
    message: room.message,
    tokens: Object.fromEntries(Object.entries(room.tokens).map(([id, positions]) => [id, [...positions]])),
    winners: [...room.winners], killCounts: { ...room.killCounts }
  };
}
function restoreGameState(room, state) {
  room.turn = state.turn;
  room.die = state.die;
  room.lastRoll = state.lastRoll ? { ...state.lastRoll } : null;
  room.message = state.message;
  room.tokens = Object.fromEntries(Object.entries(state.tokens).map(([id, positions]) => [id, [...positions]]));
  room.winners = [...state.winners];
  room.killCounts = { ...(state.killCounts || {}) };
}
function recordGameState(room) {
  room.history.push(captureGameState(room));
  if (room.history.length > 101) room.history.shift();
  room.redoHistory = [];
}

module.exports = {
  startOffsets, finishPositions, current, nextTurn, validTokenMoves, moveToken,
  captureGameState, restoreGameState, recordGameState
};
