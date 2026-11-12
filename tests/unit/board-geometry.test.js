import {describe, expect, it} from 'vitest';
const {
  BOARD_SIZE, FINISH_POSITION, startOffsets, finishPositions,
  startSections, startSquares, boardGeometry, playerPaths,
  playerFinishPosition, positionCell
} = require('../../public/board-geometry');

describe('shared Ludo board geometry', () => {
  it('defines a 15 by 15 board with a 52-cell outer track', () => {
    expect(BOARD_SIZE).toBe(15);
    expect(boardGeometry.track).toHaveLength(52);
    expect(new Set(boardGeometry.track.map(cell => cell.join(','))).size).toBe(52);
    expect(boardGeometry.track.flat().every(value => Number.isInteger(value) && value >= 0 && value < BOARD_SIZE)).toBe(true);
  });

  it('keeps the four home bases in red, green, yellow, blue corner order', () => {
    expect(boardGeometry.bases).toEqual([
      {x:0,y:0,w:6,h:6}, {x:9,y:0,w:6,h:6},
      {x:9,y:9,w:6,h:6}, {x:0,y:9,w:6,h:6}
    ]);
  });

  it('keeps each standard starting square at its designated track coordinate', () => {
    expect(startSquares.map(({trackIndex, color}) => [color, boardGeometry.track[trackIndex]])).toEqual([
      ['coral',[6,1]], ['green',[1,8]], ['yellow',[8,13]], ['blue',[13,6]]
    ]);
  });

  it('keeps the four colored six-cell lanes pointed inward', () => {
    expect(startSections.map(section => [section.color, section.arrow, section.cells])).toEqual([
      ['coral','→',[[7,0],[7,1],[7,2],[7,3],[7,4],[7,5]]],
      ['green','↓',[[0,7],[1,7],[2,7],[3,7],[4,7],[5,7]]],
      ['yellow','←',[[7,14],[7,13],[7,12],[7,11],[7,10],[7,9]]],
      ['blue','↑',[[14,7],[13,7],[12,7],[11,7],[10,7],[9,7]]]
    ]);
  });

  it('preserves all eight safe squares', () => {
    expect(boardGeometry.safe).toEqual([0,8,13,21,26,34,39,47]);
  });

  it('routes Yellow left from its home-lane entry while preserving the outer-track route through that same cell', () => {
    expect(positionCell(2, 50)).toEqual([7,14]);
    expect(positionCell(2, 51)).toEqual([8,14]);
    expect(positionCell(2, 52)).toEqual([7,14]);
    expect(positionCell(2, 53)).toEqual([7,13]);
  });

  it.each([
    [0,[7,0],[7,1]], [1,[0,7],[1,7]], [2,[7,14],[7,13]], [3,[14,7],[13,7]]
  ])('maps player %i home-lane positions in the expected direction', (player, first, second) => {
    expect(positionCell(player, 52)).toEqual(first);
    expect(positionCell(player, 53)).toEqual(second);
    expect(playerFinishPosition(player)).toBe(FINISH_POSITION);
    expect(playerPaths[player]).toHaveLength(FINISH_POSITION);
  });

  it('leaves the two additional-player path lengths unchanged', () => {
    expect(finishPositions).toEqual([58,58,58,58,57,57]);
    expect([playerFinishPosition(4), playerFinishPosition(5)]).toEqual([57,57]);
    expect(startOffsets).toEqual([0,13,26,39,8,21]);
  });
});
