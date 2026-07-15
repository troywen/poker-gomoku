// Test socket reconnection / rejoinRoom flow
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

  // Create room and start game
  const c1 = await connect();
  const res = await emit(c1.socket, 'createRoom', 'Alice');
  const roomId = res.roomId;
  await emit(c1.socket, 'joinRoom', roomId, 'Bob'); // join as second player (will be rejected - room full)
  // Actually createRoom adds host, need a second client to join
  const c2 = await connect();
  await emit(c2.socket, 'joinRoom', roomId, 'Bob');
  await emit(c1.socket, 'startGame', roomId);
  await sleep(200);

  // c2 disconnects (simulates network loss)
  c2.socket.disconnect();
  await sleep(200);

  // c2 reconnects with a new socket
  const c2b = await connect();
  const rejoinRes = await emit(c2b.socket, 'rejoinRoom', roomId, 'Bob');
  assert(!rejoinRes.error, 'rejoin should succeed: ' + (rejoinRes.error || ''));
  assert.strictEqual(rejoinRes.player.name, 'Bob');
  await sleep(200);

  // Verify c2b received game state with board and hand
  assert(c2b.latest.board, 'should have board after rejoin');
  assert(c2b.latest.hand, 'should have hand after rejoin');
  console.log('  rejoin preserved board + hand ✓');

  // Now test rejoin to non-existent room
  const c3 = await connect();
  const badRes = await emit(c3.socket, 'rejoinRoom', 'NOPE123', 'Stranger');
  assert(badRes.error, 'should fail for non-existent room');
  console.log('  non-existent room rejected ✓');

  c1.socket.disconnect();
  c2b.socket.disconnect();
  c3.socket.disconnect();
  console.log('\nRejoin tests passed ✓\n');
  process.exit(0);
}

main().catch(e => { console.error('FAIL:', e.message, e.stack); process.exit(1); });
