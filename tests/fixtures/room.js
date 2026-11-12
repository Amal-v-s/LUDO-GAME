const colors = ['coral', 'green', 'yellow', 'blue', 'purple', 'orange'];

function makeRoom(count = 4, positions = {}) {
  const players = Array.from({length: count}, (_, index) => ({
    id: `p${index + 1}`, name: `Player ${index + 1}`, color: colors[index]
  }));
  const tokens = Object.fromEntries(players.map(player => [
    player.id, positions[player.id] ? [...positions[player.id]] : [-1, -1, -1, -1]
  ]));
  return {
    code: 'ABC123', host: players[0].id, started: true, players, turn: 0,
    die: null, lastRoll: null, message: '', tokens, winners: [],
    killCounts: Object.fromEntries(players.map(player => [player.id, 0])),
    history: [], redoHistory: []
  };
}

module.exports = {makeRoom, colors};
