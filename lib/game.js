// Shared game logic — used by both local server.js and Vercel API routes
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const RED_SUITS = new Set(['♥', '♦']);
const BOARD_SIZE = 5;
const HAND_MAX = 5;
const DRAW_MIN = 1;
const DRAW_MAX = 4;
const RANK_ORDER = { A:1,'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,J:11,Q:12,K:13 };

function makeDeck() {
  const deck = [];
  for (const s of SUITS) {
    for (const r of RANKS) deck.push({ suit: s, rank: r, id: r + s });
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
function rankVal(r) { return RANK_ORDER[r] || 0; }

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function emptyBoard() {
  return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
}

// ─── Scoring ──────────────────────────────────────────────────
function lineCells(board, row, col, dr, dc, playerId) {
  const cells = [];
  for (let i = 0; i < BOARD_SIZE; i++) {
    const r = row + dr*i, c = col + dc*i;
    if (r<0||r>=BOARD_SIZE||c<0||c>=BOARD_SIZE) break;
    const cell = board[r][c];
    if (cell === null) continue;
    if (cell.playerId !== playerId) break;
    cells.push({ row:r, col:c, card:cell.card });
  }
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
  return runs;
}

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
  const rj = cells.filter(c => c.card.id === 'RedJoker');
  const bj = cells.filter(c => c.card.id === 'BlackJoker');
  if (rj.length && bj.length) pairs.push([rj[0], bj[0]]);
  return pairs;
}

function scorePlacement(board, playerId, row, col) {
  let points = 0;
  let messages = [];
  const toRemove = [];

  for (const [dr,dc] of [[0,1],[1,0],[1,1],[1,-1]]) {
    const cells = lineCells(board, row, col, dr, dc, playerId);
    if (cells.length < 2) continue;

    const runs = findConsecutiveRuns(cells);
    for (const run of runs) {
      if (run.length >= 3 && run.every(c => isRed(c.card) === isRed(run[0].card))) {
        let pts = run.length >= 5 ? 10 : run.length === 4 ? 6 : 3;
        points += pts;
        const label = run.length >= 5 ? '成五(双倍!)' : run.length === 4 ? '四连' : '三连';
        messages.push(`${run[0].card.rank}起 ${label} ${isRed(run[0].card)?'红':'黑'} +${pts}`);
      }
    }

    const pairs = findPairs(cells);
    for (const pair of pairs) {
      if (isJoker(pair[0].card) && isJoker(pair[1].card)) {
        const ids = [pair[0].card.id, pair[1].card.id].sort();
        if (ids[0]==='RedJoker' && ids[1]==='BlackJoker') {
          points += 5; messages.push(`王炸成对 +5`);
          toRemove.push(pair[0], pair[1]);
        }
      } else if (!isJoker(pair[0].card) && !isJoker(pair[1].card)) {
        points += 2; messages.push(`${pair[0].card.rank}成对 +2`);
        toRemove.push(pair[0], pair[1]);
      }
    }
  }

  for (const cell of toRemove) {
    if (board[cell.row][cell.col]) board[cell.row][cell.col] = null;
  }
  return { points, messages, removed: toRemove };
}

// ─── Room (serializable for KV storage) ──────────────────────
function createRoom(id, hostName) {
  return {
    id,
    players: [{ id:'p0', name:hostName, hand:[], score:0, socketId:null, isHost:true }],
    board: emptyBoard(),
    deck: shuffle(makeDeck()),
    discardPile: [],
    currentPlayerIndex: 0,
    phase: 'waiting',
    drawnCards: [],
    lastAction: null,
    version: 0,
  };
}

function addPlayer(room, name) {
  if (room.players.length >= 2) return null;
  const id = 'p' + room.players.length;
  const p = { id, name, hand:[], score:0, socketId:null, isHost:false };
  room.players.push(p);
  return p;
}

function startGame(room) {
  if (room.players.length < 2) return false;
  for (const p of room.players) {
    p.hand = []; p.score = 0;
    while (p.hand.length < HAND_MAX && room.deck.length) p.hand.push(room.deck.pop());
  }
  room.phase = 'drawing';
  room.currentPlayerIndex = 0;
  room.drawnCards = [];
  room.version++;
  return true;
}

function getCP(room) { return room.players[room.currentPlayerIndex]; }

function settleDrawnCards(room) {
  const cp = getCP(room);
  for (const c of room.drawnCards) cp.hand.push(c);
  room.drawnCards = [];
  while (cp.hand.length > HAND_MAX) room.discardPile.push(cp.hand.shift());
}

function nextTurn(room) {
  settleDrawnCards(room);
  room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
  room.drawnCards = [];
  room.phase = 'drawing';
  if (room.deck.length === 0 && getCP(room).hand.length === 0) {
    room.phase = 'gameover';
    const scores = room.players.map(p => ({ name:p.name, score:p.score }));
    scores.sort((a,b) => b.score - a.score);
    room.lastAction = { type:'gameover', scores };
  }
  room.version++;
}

function publicState(room, playerId) {
  const board = room.board.map(row =>
    row.map(cell => cell ? { playerId:cell.playerId, card:{ suit:cell.card.suit, rank:cell.card.rank, id:cell.card.id, color:cell.card.color } } : null)
  );
  const pub = {
    roomId: room.id,
    phase: room.phase,
    currentPlayerIndex: room.currentPlayerIndex,
    board,
    players: room.players.map(p => ({ id:p.id, name:p.name, score:p.score, handCount:p.hand.length, hand: p.hand })),
    drawnCards: room.drawnCards.map(c => ({ suit:c.suit, rank:c.rank, id:c.id, color:c.color })),
    deckCount: room.deck.length,
    drawCount: room.drawnCards.length,
    lastAction: room.lastAction,
    version: room.version,
  };
  // Include private hand for the requesting player
  if (playerId) {
    const me = room.players.find(p => p.id === playerId);
    if (me) pub.hand = me.hand;
  }
  return pub;
}

module.exports = {
  makeDeck, isRed, isJoker, rankVal, shuffle, emptyBoard,
  lineCells, findConsecutiveRuns, findPairs, scorePlacement,
  createRoom, addPlayer, startGame, getCP, settleDrawnCards, nextTurn, publicState,
  BOARD_SIZE, HAND_MAX, DRAW_MIN, DRAW_MAX,
};
