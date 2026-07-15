// Integration test: full game flow with 2 socket.io clients
const io = require('socket.io-client');
const assert = require('assert');

const PORT = 3001;
process.env.PORT = PORT;
require('./server.js');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function connect() {
  return new Promise((resolve, reject) => {
    const s = io('http://localhost:' + PORT, { transports: ['websocket'] });
    const latest = {};
    s.on('connect', () => resolve({ socket: s, latest }));
    s.on('gameState', state => { Object.assign(latest, state); });
    s.on('connect_error', e => reject(e));
    setTimeout(() => reject(new Error('connection timeout')), 5000);
  });
}

function emit(s, ev, ...args) {
  return new Promise(resolve => s.emit(ev, ...args, resolve));
}

async function main() {
  await sleep(600);

  const c1 = await connect();
  const c2 = await connect();
  const s1 = c1.socket, s2 = c2.socket;

  let res = await emit(s1, 'createRoom', 'Alice');
  assert(!res.error, res.error);
  const roomId = res.roomId;
  assert(res.player.isHost);
  console.log('  room:', roomId);

  res = await emit(s2, 'joinRoom', roomId, 'Bob');
  assert(!res.error, res.error);
  assert.strictEqual(res.player.name, 'Bob');

  res = await emit(s1, 'startGame', roomId);
  assert(!res.error, res.error);
  await sleep(300);

  assert.strictEqual(c1.latest.phase, 'drawing');
  assert.strictEqual(c2.latest.phase, 'drawing');
  assert(c1.latest.hand, 'p1 should have hand');
  assert(c2.latest.hand, 'p2 should have hand');
  console.log('  hands: p1=' + c1.latest.hand.length + ' p2=' + c2.latest.hand.length);
  assert.strictEqual(c1.latest.currentPlayerIndex, 0);

  // P1 draws 2
  res = await emit(s1, 'drawCards', roomId, 2);
  assert(!res.error, res.error);
  await sleep(150);
  assert.strictEqual(c1.latest.drawCount, 2);

  // P1 draws 1 more
  res = await emit(s1, 'drawCards', roomId, 1);
  assert(!res.error, res.error);
  await sleep(150);
  assert.strictEqual(c1.latest.drawCount, 3);

  // P1 tries to draw 2 more (exceeds 4) — should fail
  res = await emit(s1, 'drawCards', roomId, 2);
  assert(res.error, 'should fail exceeding max');

  // Finish draw
  res = await emit(s1, 'finishDraw', roomId);
  assert(!res.error, res.error);
  await sleep(200);

  assert.strictEqual(c1.latest.phase, 'playing');
  assert.strictEqual(c1.latest.drawnCards.length, 3);
  console.log('  playing phase, drawn:', c1.latest.drawnCards.length);

  // Place a card
  const cardToPlace = c1.latest.drawnCards[0];
  let er, ec;
  outer: for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
    if (!c1.latest.board[r][c]) { er = r; ec = c; break outer; }
  }
  res = await emit(s1, 'placeCard', roomId, er, ec, cardToPlace.id);
  assert(!res.error, res.error);
  console.log('  placed at', er, ec, cardToPlace.rank + cardToPlace.suit);
  await sleep(200);

  // Now P2's turn
  assert.strictEqual(c2.latest.currentPlayerIndex, 1, 'should be P2 turn');
  assert.strictEqual(c2.latest.phase, 'drawing');
  console.log('  turn passed to P2 ✓');

  // P2 draws 1, finishes, places
  await emit(s2, 'drawCards', roomId, 1);
  await sleep(150);
  await emit(s2, 'finishDraw', roomId);
  await sleep(200);

  const p2card = c2.latest.drawnCards[0];
  let r2, c2c;
  outer2: for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
    if (!c2.latest.board[r][c]) { r2 = r; c2c = c; break outer2; }
  }
  await emit(s2, 'placeCard', roomId, r2, c2c, p2card.id);
  await sleep(200);
  console.log('  P2 placed ✓');

  // Back to P1
  assert.strictEqual(c1.latest.currentPlayerIndex, 0, 'should be P1 turn again');
  console.log('  turn back to P1 ✓');

  s1.disconnect();
  s2.disconnect();
  console.log('\nAll integration tests passed ✓\n');
  process.exit(0);
}

main().catch(e => { console.error('FAIL:', e.message, e.stack); process.exit(1); });
