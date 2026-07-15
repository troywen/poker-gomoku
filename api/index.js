// Edge Config storage (Vercel native KV store)
// Falls back to in-memory store for local dev without EDGE_CONFIG
const memStore = new Map();

// Parse Edge Config connection string once
let ecBase = null;
let ecToken = null;
if (process.env.EDGE_CONFIG) {
  try {
    const u = new URL(process.env.EDGE_CONFIG);
    ecBase = `${u.protocol}//${u.host}${u.pathname}`;
    ecToken = u.searchParams.get('token');
  } catch(e) {}
}

async function ecGet(key) {
  if (!ecBase || !ecToken) return undefined;
  try {
    const res = await fetch(`${ecBase}items/${encodeURIComponent(key)}?token=${ecToken}`);
    if (!res.ok) return undefined;
    const data = await res.json();
    return data.value;
  } catch(e) { return undefined; }
}

async function ecSet(key, value) {
  if (!ecBase || !ecToken) {
    memStore.set(key, value);
    return true;
  }
  try {
    const res = await fetch(`${ecBase}items?token=${ecToken}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ op: 'upsert', key, value }] })
    });
    return res.ok;
  } catch(e) { return false; }
}

const G = require('../lib/game.js');
const { DRAW_MIN, DRAW_MAX } = G;

// kvGet/kvSet: store raw JS values (no double-stringification)
async function kvGet(key) {
  const val = await ecGet(key);
  if (val !== undefined) return val;
  return memStore.get(key);
}
async function kvSet(key, val) {
  const ok = await ecSet(key, val);
  if (!ok) memStore.set(key, val);
  return true;
}

const TTL = 7200; // 2h room lifetime (Edge Config doesn't support per-key TTL, but we keep the param for API compat)

function ok(data) { return { status:200, headers:{'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'}, body: JSON.stringify(data) }; }
function err(msg, code=400) { return { status:code, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}, body: JSON.stringify({ error: msg }) }; }

async function getRoom(roomId) {
  return await kvGet('room:'+roomId) || null;
}
async function saveRoom(room) {
  await kvSet('room:'+room.id, room);
}

async function handleGet(req) {
  const url = new URL(req.url || 'http://localhost', 'http://localhost');
  const roomId = url.searchParams.get('roomId');
  const playerId = url.searchParams.get('playerId');
  if (!roomId) return err('missing roomId');
  const room = await getRoom(roomId);
  if (!room) return err('房间不存在', 404);
  return ok({ ...G.publicState(room, playerId), playerId });
}

// Read request body — works in Vercel serverless (Node.js IncomingMessage) and Web API
async function readBody(req) {
  if (req.body !== undefined && req.body !== null) return req.body;
  // Web API Request (has text())
  if (typeof req.text === 'function') {
    try { const t = await req.text(); return t ? JSON.parse(t) : {}; } catch(e) { return {}; }
  }
  // Node.js IncomingMessage (stream)
  return new Promise(resolve => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch(e) { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

async function handlePost(req) {
  const body = await readBody(req);
  const { roomId, action, payload } = body;
  if (!roomId || !action) return err('missing roomId or action');

  switch (action) {
    case 'createRoom': return doCreateRoom(roomId, payload);
    case 'joinRoom': return doJoinRoom(roomId, payload);
    case 'startGame': return doStartGame(roomId, payload);
    case 'drawCards': return doDrawCards(roomId, payload);
    case 'finishDraw': return doFinishDraw(roomId, payload);
    case 'placeCard': return doPlaceCard(roomId, payload);
    case 'discardCard': return doDiscardCard(roomId, payload);
    case 'rejoinRoom': return doRejoinRoom(roomId, payload);
    default: return err('unknown action: ' + action);
  }
}

async function doCreateRoom(roomId, { name }) {
  const room = G.createRoom(roomId, name || '玩家');
  room.version = 1;
  const p = room.players[0];
  await saveRoom(room);
  return ok({ roomId, player: { id:p.id, name:p.name, isHost:p.isHost } });
}

async function doJoinRoom(roomId, { name }) {
  const room = await getRoom(roomId);
  if (!room) return err('房间不存在');
  if (room.players.length >= 2) return err('房间已满');
  const p = G.addPlayer(room, name || '玩家');
  await saveRoom(room);
  return ok({ roomId, player: { id:p.id, name:p.name, isHost:p.isHost } });
}

async function doStartGame(roomId, { name }) {
  const room = await getRoom(roomId);
  if (!room) return err('房间不存在');
  const me = room.players.find(p => p.name === name);
  if (!me || !me.isHost) return err('只有房主可以开始');
  if (room.players.length < 2) return err('需要2名玩家');
  G.startGame(room);
  await saveRoom(room);
  return ok({ ok:true, state: G.publicState(room, me.id) });
}

async function doDrawCards(roomId, { name, count }) {
  const room = await getRoom(roomId);
  if (!room) return err('房间不存在');
  if (room.phase !== 'drawing') return err('现在不能抽牌');
  const cp = G.getCP(room);
  if (cp.name !== name) return err('不是你的回合');
  if (room.drawnCards.length + count > DRAW_MAX) return err('最多抽4张');
  for (let i = 0; i < count; i++) {
    if (room.deck.length) room.drawnCards.push(room.deck.pop());
  }
  room.version++;
  await saveRoom(room);
  return ok({ ok:true, state: G.publicState(room, cp.id) });
}

async function doFinishDraw(roomId, { name }) {
  const room = await getRoom(roomId);
  if (!room) return err('房间不存在');
  if (room.phase !== 'drawing') return err('现在不能结束抽牌');
  const cp = G.getCP(room);
  if (cp.name !== name) return err('不是你的回合');
  if (room.drawnCards.length < DRAW_MIN) return err('至少抽1张');
  room.phase = 'playing';
  room.version++;
  await saveRoom(room);
  return ok({ ok:true, state: G.publicState(room, cp.id) });
}

async function doPlaceCard(roomId, { name, row, col, cardId }) {
  const room = await getRoom(roomId);
  if (!room) return err('房间不存在');
  if (room.phase !== 'playing') return err('现在不能出牌');
  const cp = G.getCP(room);
  if (cp.name !== name) return err('不是你的回合');

  const idx = room.drawnCards.findIndex(c => c.id === cardId);
  if (idx === -1) return err('此牌不在本回合抽的牌中');
  if (room.board[row][col] !== null) return err('该位置已有棋子');

  const card = room.drawnCards.splice(idx, 1)[0];
  room.board[row][col] = { card, playerId: cp.id };

  const result = G.scorePlacement(room.board, cp.id, row, col);
  room.lastAction = { type:'place', row, col, card, playerId:cp.id, ...result };
  G.nextTurn(room);
  await saveRoom(room);
  return ok({ ok:true, result, state: G.publicState(room, cp.id) });
}

async function doDiscardCard(roomId, { name, cardId }) {
  const room = await getRoom(roomId);
  if (!room) return err('房间不存在');
  if (room.phase !== 'playing') return err('现在不能弃牌');
  const cp = G.getCP(room);
  if (cp.name !== name) return err('不是你的回合');
  const idx = room.drawnCards.findIndex(c => c.id === cardId);
  if (idx === -1) return err('此牌不在本回合抽的牌中');
  const card = room.drawnCards.splice(idx, 1)[0];
  room.discardPile.push(card);
  room.lastAction = { type:'discard', card, playerId:cp.id };
  G.nextTurn(room);
  await saveRoom(room);
  return ok({ ok:true, state: G.publicState(room, cp.id) });
}

async function doRejoinRoom(roomId, { name }) {
  const room = await getRoom(roomId);
  if (!room) return err('房间已不存在');
  let player = room.players.find(p => p.name === name);
  if (!player) return err('未找到你的玩家记录');
  room.version++;
  await saveRoom(room);
  return ok({ ok:true, player: { id:player.id, name:player.name, isHost:player.isHost }, state: G.publicState(room, player.id) });
}

// ─── Entry ────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).setHeader('Access-Control-Allow-Origin','*')
      .setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS')
      .setHeader('Access-Control-Allow-Headers','Content-Type')
      .send('');
  }
  let result;
  try {
    if (req.method === 'GET') result = await handleGet(req);
    else if (req.method === 'POST') result = await handlePost(req);
    else return res.status(405).json({ error: 'Method not allowed' });
  } catch(e) {
    console.error('API error:', e);
    return res.status(500).json({ error: 'Server error: ' + e.message });
  }
  res.status(result.status);
  for (const [k,v] of Object.entries(result.headers||{})) res.setHeader(k,v);
  res.send(result.body);
};
