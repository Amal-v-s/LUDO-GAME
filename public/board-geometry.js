(function(root, factory) {
  const geometry = factory();
  if (typeof module === 'object' && module.exports) module.exports = geometry;
  else root.LudoBoardGeometry = geometry;
})(typeof globalThis === 'undefined' ? this : globalThis, function() {
  const BOARD_SIZE = 15;
  const FINISH_POSITION = 58;
  const startOffsets = [0, 13, 26, 39, 8, 21];
  const finishPositions = [58, 58, 58, 58, 57, 57];
  const startSections = [
    {color:'coral',arrow:'→',cells:[[7,0],[7,1],[7,2],[7,3],[7,4],[7,5]]},
    {color:'green',arrow:'↓',cells:[[0,7],[1,7],[2,7],[3,7],[4,7],[5,7]]},
    {color:'yellow',arrow:'←',cells:[[7,14],[7,13],[7,12],[7,11],[7,10],[7,9]]},
    {color:'blue',arrow:'↑',cells:[[14,7],[13,7],[12,7],[11,7],[10,7],[9,7]]}
  ];
  const startSquares = [
    {trackIndex:0,color:'coral'}, {trackIndex:13,color:'green'},
    {trackIndex:26,color:'yellow'}, {trackIndex:39,color:'blue'}
  ];
  const extraHomeLanes = [
    [[4,6],[3,6],[2,6],[1,6],[0,6]],
    [[6,11],[7,11],[7,10],[7,9],[7,8]]
  ];
  const boardGeometry = {
    track:[[6,1],[6,2],[6,3],[6,4],[6,5],[5,6],[4,6],[3,6],[2,6],[1,6],[0,6],[0,7],[0,8],[1,8],[2,8],[3,8],[4,8],[5,8],[6,9],[6,10],[6,11],[6,12],[6,13],[6,14],[7,14],[8,14],[8,13],[8,12],[8,11],[8,10],[8,9],[9,8],[10,8],[11,8],[12,8],[13,8],[14,8],[14,7],[14,6],[13,6],[12,6],[11,6],[10,6],[9,6],[8,5],[8,4],[8,3],[8,2],[8,1],[8,0],[7,0],[6,0]],
    safe:[0,8,13,21,26,34,39,47],
    startSquares,
    startSections,
    homeLanes:[...startSections.map(section=>section.cells),...extraHomeLanes],
    bases:[{x:0,y:0,w:6,h:6},{x:9,y:0,w:6,h:6},{x:9,y:9,w:6,h:6},{x:0,y:9,w:6,h:6}]
  };
  const playerPaths = startOffsets.map((offset,index)=>[
    ...Array.from({length:52},(_,step)=>boardGeometry.track[(offset+step)%52]),
    ...(boardGeometry.homeLanes[index]||[])
  ]);
  function playerFinishPosition(playerIndex) {
    return playerPaths[playerIndex]?.length || FINISH_POSITION;
  }
  function positionCell(playerIndex,position) {
    return playerPaths[playerIndex]?.[position] || null;
  }
  return {
    BOARD_SIZE, FINISH_POSITION, startOffsets, finishPositions,
    startSections, startSquares, extraHomeLanes, boardGeometry,
    playerPaths, playerFinishPosition, positionCell
  };
});
