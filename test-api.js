// Test the Vercel API route (api/index.js) with in-memory KV fallback
const assert = require('assert');

// Mock Vercel KV (the API uses in-memory fallback when kv is unavailable)
const handler = require('./api/index.js');

function makeReq(method, body, query) {
  const url = query ? '/api?' + new URLSearchParams(query) : '/api';
  return {
    method,
    url,
    json: async () => body,
  };
}

function makeRes() {
  const r = { _status: 200, _headers: {}, _body: '' };
  r.status = (s) => { r._status = s; return r; };
  r.setHeader = (k, v) => { r._headers[k] = v; return r; };
  r.send = (b) => { r._body = b; return r; };
  r.json = (b) => { r._body = JSON.stringify(b); return r; };
  return r;
}

async function call(method, body, query) {
  const req = makeReq(method, body, query);
  const res = makeRes();
  await handler(req, res);
  return JSON.parse(res._body);
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓', name); passed++; }
  catch(e) { console.log('  ✗', name, '\n    ', e.message); failed++; }
}

(async () => {
  console.log('\nAPI route tests:\n');

  const roomId = 'TEST01';
  const name1 = 'Alice', name2 = 'Bob';

  await test('createRoom returns roomId and player', async () => {
    const data = await call('POST', { roomId, action: 'createRoom', payload: { name: name1, roomId } });
    assert(!data.error, data.error);
    assert.strictEqual(data.roomId, roomId);
    assert.strictEqual(data.player.id, 'p0');
    assert(data.player.isHost);
  });

  await test('joinRoom adds second player', async () => {
    const data = await call('POST', { roomId, action: 'joinRoom', payload: { name: name2, roomId } });
    assert(!data.error, data.error);
    assert.strictEqual(data.player.id, 'p1');
  });

  await test('joinRoom to full room fails', async () => {
    const data = await call('POST', { roomId, action: 'joinRoom', payload: { name: 'Eve', roomId } });
    assert(data.error);
  });

  await test('startGame transitions to drawing phase', async () => {
    const data = await call('POST', { roomId, action: 'startGame', payload: { name: name1 } });
    assert(!data.error, data.error);
    assert.strictEqual(data.state.phase, 'drawing');
    assert.strictEqual(data.state.currentPlayerIndex, 0);
    assert(data.state.players[0].hand.length === 5);
    assert(data.state.players[1].hand.length === 5);
  });

  await test('GET state returns board and players', async () => {
    const data = await call('GET', null, { roomId, playerId: 'p0' });
    assert(!data.error, data.error);
    assert(data.board);
    assert.strictEqual(data.board.length, 5);
    assert.strictEqual(data.players.length, 2);
  });

  await test('drawCards adds to drawnCards pool', async () => {
    const data = await call('POST', { roomId, action: 'drawCards', payload: { name: name1, count: 2 } });
    assert(!data.error, data.error);
    assert.strictEqual(data.state.drawnCards.length, 2);
  });

  await test('drawCards exceeds max fails', async () => {
    const data = await call('POST', { roomId, action: 'drawCards', payload: { name: name1, count: 3 } });
    assert(data.error); // 2+3 > 4
  });

  await test('finishDraw transitions to playing', async () => {
    const data = await call('POST', { roomId, action: 'finishDraw', payload: { name: name1 } });
    assert(!data.error, data.error);
    assert.strictEqual(data.state.phase, 'playing');
  });

  await test('placeCard places card and passes turn', async () => {
    const getState = await call('GET', null, { roomId, playerId: 'p0' });
    const cardId = getState.drawnCards[0].id;
    const data = await call('POST', { roomId, action: 'placeCard', payload: { name: name1, row: 0, col: 0, cardId } });
    assert(!data.error, data.error);
    assert.strictEqual(data.state.board[0][0].card.id, cardId);
    assert.strictEqual(data.state.currentPlayerIndex, 1); // turn passed
    assert.strictEqual(data.state.phase, 'drawing'); // next player draws
  });

  await test('rejoinRoom returns player and state', async () => {
    const data = await call('POST', { roomId, action: 'rejoinRoom', payload: { name: name2 } });
    assert(!data.error, data.error);
    assert.strictEqual(data.player.name, name2);
    assert(data.state);
  });

  await test('GET non-existent room returns 404', async () => {
    const data = await call('GET', null, { roomId: 'NOPE99', playerId: 'p0' });
    assert(data.error);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
