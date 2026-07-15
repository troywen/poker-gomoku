const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ─── Constants ────────────────────────────────────────────────
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const RED_SUITS = new Set(['♥', '♦']);
const BOARD_SIZE = 5; // 横竖各5格为限
const HAND_MAX = 5;
const DRAW_MIN = 1;
const DRAW_MAX = 4;

// ─── Deck ─────────────────────────────────────────────────────
function makeDeck() {
  const deck = [];
  for (const s of SUITS) {
    for (const r of RANKS) {
      deck.push({ suit: s, rank: r, id: r + s });
    }
  }
  deck.push({ suit: '🃏', rank: 'Joker', id: 'RedJoker', color: 'red' });
  deck.push({ suit: '🃏', rank: 'Joker', id: 'BlackJoker', color: 'black' });
  return deck;
}

function isRed(card) {
  if (card.color !== undefined) return card.color === 'red';
  return RED_SUITS.has(card.suit);
}

function isJoker(card) { return card.id === 'RedJoker' || card.id === 'BlackJoker'; }

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── Room ─────────────────────────────────────────────────────
const rooms = new Map();

class Room {
  constructor(id, hostName) {
    this.id = id;
    this.players = [];
    this.board = [];
    this.deck = shuffle(makeDeck());
    this.discardPile = [];
    this.currentPlayerIndex = 0;
    this.phase = 'waiting';   // waiting | drawing | playing | gameover
    this.drawnCards = [];      // pool of cards drawn this turn (1-4)
    this.lastAction = null;

    for (let r = 0; r < BOARD_SIZE; r++) {
      this.board[r] = [];
      for (let c = 0; c < BOARD_SIZE; c++) this.board[r][c] = null;
    }

    this.addPlayer(hostName, true);
  }

  addPlayer(name, isHost = false) {
    if (this.players.length >= 2) return null;
    const id = 'p' + this.players.length;
    const p = { id, name, hand: [], score: 0, socketId: null, isHost };
    this.players.push(p);
    return p;
  }

  startGame() {
    if (this.players.length < 2) return false;
    for (const p of this.players) {
      p.hand = [];
      p.score = 0;
      while (p.hand.length < HAND_MAX && this.deck.length) p.hand.push(this.deck.pop());
    }
    this.phase = 'drawing';
    this.currentPlayerIndex = 0;
    this.drawnCards = [];
    return true;
  }

  get currentPlayer() { return this.players[this.currentPlayerIndex]; }

  // Move remaining drawn cards into hand, trim to HAND_MAX
  settleDrawnCards() {
    const cp = this.currentPlayer;
    for (const c of this.drawnCards) cp.hand.push(c);
    this.drawnCards = [];
    // trim excess (discard oldest)
    while (cp.hand.length > HAND_MAX) {
      this.discardPile.push(cp.hand.shift());
    }
  }

  nextTurn() {
    this.settleDrawnCards();
    this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
    this.drawnCards = [];
    this.phase = 'drawing';
    if (this.deck.length === 0 && this.currentPlayer.hand.length === 0) {
      this.endGame();
    }
  }

  endGame() {
    this.phase = 'gameover';
    const scores = this.players.map(p => ({ name: p.name, score: p.score }));
    scores.sort((a, b) => b.score - a.score);
    this.lastAction = { type: 'gameover', scores };
  }
}

// ─── Scoring ──────────────────────────────────────────────────
const RANK_ORDER = { A:1,'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,J:11,Q:12,K:13 };

function rankVal(r) { return RANK_ORDER[r] || 0; }

// Find all cards of playerId in a direction from (row,col), skipping gaps
function lineCells(board, row, col, dr, dc, playerId) {
  const cells = [];
  // forward (including center at i=0)
  for (let i = 0; i < BOARD_SIZE; i++) {
    const r = row + dr*i, c = col + dc*i;
    if (r<0||r>=BOARD_SIZE||c<0||c>=BOARD_SIZE) break;
    const cell = board[r][c];
    if (cell === null) continue;        // gap — skip
    if (cell.playerId !== playerId) break;
    cells.push({ row:r, col:c, card:cell.card });
  }
  // backward (exclude center)
  for (let i = 1; i < BOARD_SIZE; i++) {
    const r = row - dr*i, c = col - dc*i;
    if (r<0||r>=BOARD_SIZE||c<0||c>=BOARD_SIZE) break;
    const cell = board[r][c];
    if (cell === null) continue;
    if (cell.playerId !== playerId) break;
    cells.unshift({ row:r, col:c, card:cell.card });
  }
  return cells;
}

function scorePlacement(room, row, col, playerId) {
  const board = room.board;
  let points = 0;
  let messages = [];
  const toRemove = []; // cells to remove after scoring (pairs)

  const DIRS = [[0,1],[1,0],[1,1],[1,-1]];

  for (const [dr,dc] of DIRS) {
    const cells = lineCells(board, row, col, dr, dc, playerId);
    if (cells.length < 2) continue;

    // ── 成五: consecutive same-color runs of length 3+ ──
    const runs = findConsecutiveRuns(cells);
    for (const run of runs) {
      if (run.length >= 3 && run.every(c => isRed(c.card) === isRed(run[0].card))) {
        let pts;
        if (run.length >= 5) pts = 10;       // 成五 双倍
        else if (run.length === 4) pts = 6;
        else pts = 3;
        points += pts;
        const label = run.length >= 5 ? '成五(双倍!)' : run.length === 4 ? '四连' : '三连';
        messages.push(`${run[0].card.rank}起 ${label} ${isRed(run[0].card)?'红':'黑'} +${pts}`);
      }
    }

    // ── 成对: same rank pairs (jokers only pair with each other) ──
    const pairs = findPairs(cells);
    for (const pair of pairs) {
      let pts, label;
      if (isJoker(pair[0].card) && isJoker(pair[1].card)) {
        // must be opposite jokers
        const ids = [pair[0].card.id, pair[1].card.id].sort();
        if (ids[0]==='RedJoker' && ids[1]==='BlackJoker') {
          pts = 5; label = '王炸成对';
          toRemove.push(pair[0], pair[1]);
        } else continue;
      } else if (!isJoker(pair[0].card) && !isJoker(pair[1].card)) {
        pts = 2; label = `${pair[0].card.rank}成对`;
        toRemove.push(pair[0], pair[1]);
      } else continue;
      points += pts;
      messages.push(`${label} +${pts}`);
    }
  }

  // Remove paired cards from board
  for (const cell of toRemove) {
    if (board[cell.row][cell.col]) board[cell.row][cell.col] = null;
  }

  const player = room.players.find(p => p.id === playerId);
  if (player) player.score += points;
  return { points, messages, removed: toRemove };
}

// Find maximal consecutive-rank runs within a line of cells
function findConsecutiveRuns(cells) {
  if (cells.length < 2) return [];
  const runs = [];
  let cur = [cells[0]];
  for (let i = 1; i < cells.length; i++) {
    if (rankVal(cells[i].card.rank) === rankVal(cur[cur.length-1].card.rank) + 1) {
      cur.push(cells[i]);
    } else {
      if (cur.length >= 3) runs.push([...cur]);
      cur = [cells[i]];
    }
  }
  if (cur.length >= 3) runs.push(cur);
  // also check for runs of exactly 5 within longer runs (for scoring)
  return runs;
}

// Find same-rank pairs in a line
function findPairs(cells) {
  const groups = {};
  for (const c of cells) {
    const key = isJoker(c.card) ? c.card.id : c.card.rank;
    if (!groups[key]) groups[key] = [];
    groups[key].push(c);
  }
  const pairs = [];
  for (const key of Object.keys(groups)) {
    if (groups[key].length >= 2) pairs.push(groups[key].slice(0, 2));
  }
  // joker cross-pair
  const rj = cells.filter(c => c.card.id === 'RedJoker');
  const bj = cells.filter(c => c.card.id === 'BlackJoker');
  if (rj.length && bj.length) pairs.push([rj[0], bj[0]]);
  return pairs;
}

// ─── Socket ───────────────────────────────────────────────────
io.on('connection', (socket) => {

  socket.on('createRoom', (name, cb) => {
    const id = Math.random().toString(36).slice(2,8).toUpperCase();
    const room = new Room(id, name || '玩家');
    rooms.set(id, room);
    const p = room.players[0];
    p.socketId = socket.id;
    socket.join(id);
    cb({ roomId: id, player: { id:p.id, name:p.name, isHost:p.isHost } });
    broadcast(room);
  });

  socket.on('joinRoom', (roomId, name, cb) => {
    const room = rooms.get(roomId);
    if (!room || room.players.length >= 2) return cb({ error: '房间不存在或已满' });
    const p = room.addPlayer(name || '玩家');
    p.socketId = socket.id;
    socket.join(roomId);
    cb({ roomId, player: { id:p.id, name:p.name, isHost:p.isHost } });
    broadcast(room);
  });

  socket.on('startGame', (roomId, cb) => {
    const room = rooms.get(roomId);
    if (!room) return cb({ error: '房间不存在' });
    const me = room.players.find(p => p.socketId === socket.id);
    if (!me || !me.isHost) return cb({ error: '只有房主可以开始' });
    if (room.players.length < 2) return cb({ error: '需要2名玩家' });
    room.startGame();
    cb({ ok: true });
    broadcast(room);
  });

  // Draw N cards into the turn's drawn pool
  socket.on('drawCards', (roomId, count, cb) => {
    const room = rooms.get(roomId);
    if (!room || room.phase !== 'drawing') return cb({ error: '现在不能抽牌' });
    const cp = room.currentPlayer;
    if (cp.socketId !== socket.id) return cb({ error: '不是你的回合' });
    if (room.drawnCards.length + count > DRAW_MAX) return cb({ error: '最多抽4张' });

    for (let i = 0; i < count; i++) {
      if (room.deck.length) room.drawnCards.push(room.deck.pop());
    }
    cb({ ok: true });
    broadcast(room);
  });

  // Finish drawing, move to playing phase
  socket.on('finishDraw', (roomId, cb) => {
    const room = rooms.get(roomId);
    if (!room || room.phase !== 'drawing') return cb({ error: '现在不能结束抽牌' });
    const cp = room.currentPlayer;
    if (cp.socketId !== socket.id) return cb({ error: '不是你的回合' });
    if (room.drawnCards.length < DRAW_MIN) return cb({ error: '至少抽1张' });
    room.phase = 'playing';
    cb({ ok: true });
    broadcast(room);
  });

  // Place a card from the drawn pool onto the board
  socket.on('placeCard', (roomId, row, col, cardId, cb) => {
    const room = rooms.get(roomId);
    if (!room || room.phase !== 'playing') return cb({ error: '现在不能出牌' });
    const cp = room.currentPlayer;
    if (cp.socketId !== socket.id) return cb({ error: '不是你的回合' });

    const idx = room.drawnCards.findIndex(c => c.id === cardId);
    if (idx === -1) return cb({ error: '此牌不在本回合抽的牌中' });
    if (room.board[row][col] !== null) return cb({ error: '该位置已有棋子' });

    const card = room.drawnCards.splice(idx, 1)[0];
    room.board[row][col] = { card, playerId: cp.id };

    const result = scorePlacement(room, row, col, cp.id);

    room.lastAction = { type:'place', row, col, card, playerId:cp.id, ...result };
    room.nextTurn();
    cb({ ok: true, result });
    broadcast(room);
  });

  // ── Rejoin after disconnect ──
  socket.on('rejoinRoom', (roomId, name, cb) => {
    const room = rooms.get(roomId);
    if (!room) return cb({ error: '房间已不存在' });
    // Find a disconnected player by name, or reattach by socket history
    let player = room.players.find(p => p.socketId === null && p.name === name);
    if (!player) player = room.players.find(p => p.name === name);
    if (!player) return cb({ error: '未找到你的玩家记录' });
    player.socketId = socket.id;
    socket.join(roomId);
    cb({ ok: true, player: { id: player.id, name: player.name, isHost: player.isHost } });
    broadcast(room);
  });

  socket.on('disconnect', () => {
    for (const [id, room] of rooms) {
      const idx = room.players.findIndex(p => p.socketId === socket.id);
      if (idx !== -1) {
        // Keep player for 90s to allow reconnection; clear socket binding
        room.players[idx].socketId = null;
        broadcast(room);
        setTimeout(() => {
          const p2 = room.players.find(pp => pp.id === room.players[idx]?.id && pp.socketId === null);
          if (!p2) return; // reconnected in time
          room.players.splice(room.players.indexOf(p2), 1);
          broadcast(room);
          if (room.players.length === 0) rooms.delete(id);
        }, 90000);
      }
    }
  });
});

function broadcast(room) {
  const pub = publicState(room);
  io.to(room.id).emit('gameState', pub);
  for (const p of room.players) {
    if (p.socketId) {
      io.to(p.socketId).emit('gameState', { ...pub, hand: p.hand, playerId: p.id });
    }
  }
}

function publicState(room) {
  const board = room.board.map(row =>
    row.map(cell => cell ? { playerId: cell.playerId, card: { suit:cell.card.suit, rank:cell.card.rank, id:cell.card.id, color:cell.card.color } } : null)
  );
  return {
    roomId: room.id,
    phase: room.phase,
    currentPlayerIndex: room.currentPlayerIndex,
    board,
    players: room.players.map(p => ({ id:p.id, name:p.name, score:p.score, handCount:p.hand.length })),
    drawnCards: room.drawnCards.map(c => ({ suit:c.suit, rank:c.rank, id:c.id, color:c.color })),
    deckCount: room.deck.length,
    drawCount: room.drawnCards.length,
    lastAction: room.lastAction,
  };
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Poker Gomoku → http://localhost:${PORT}`));
