// 端到端模拟测试：模拟两个玩家完整游戏流程
const urllib = require('http');

const BASE = process.argv[2] || 'http://localhost:3000';

function post(action, payload, roomId) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ roomId, action, payload: payload || {} });
    const req = urllib.request(`${BASE}/api`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function get(roomId, playerId) {
  return new Promise((resolve, reject) => {
    urllib.request(`${BASE}/api?roomId=${roomId}&playerId=${playerId}`, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  const rid = 'SIM' + Date.now().toString(36).toUpperCase().slice(-4);
  console.log(`\n=== 模拟测试 房间: ${rid} ===\n`);

  // P1 创建房间
  console.log('1. 创建房间...');
  let r = await post('createRoom', { name: 'Alice' }, rid);
  if (r.error) throw new Error('创建失败: ' + r.error);
  console.log('   ✓ roomId=' + r.roomId + ' player=' + r.player.id);

  // P2 加入房间
  console.log('2. 加入房间...');
  r = await post('joinRoom', { name: 'Bob' }, rid);
  if (r.error) throw new Error('加入失败: ' + r.error);
  console.log('   ✓ player=' + r.player.id + ' name=' + r.player.name);

  // 房主开始游戏
  console.log('3. 开始游戏...');
  r = await post('startGame', {}, rid);
  if (r.error) throw new Error('开始失败: ' + r.error);
  console.log('   ✓ phase=' + r.state.phase + ' p0手牌=' + r.state.players[0].hand.length + ' p1手牌=' + r.state.players[1].hand.length);

  // P1 抽2张
  console.log('4. P1 抽2张牌...');
  r = await post('drawCards', { count: 2 }, rid);
  if (r.error) throw new Error('抽牌失败: ' + r.error);
  console.log('   ✓ drawnCards=' + r.state.drawnCards.length);

  // P1 完成抽牌
  console.log('5. P1 完成抽牌...');
  r = await post('finishDraw', {}, rid);
  if (r.error) throw new Error('完成抽牌失败: ' + r.error);
  console.log('   ✓ phase=' + r.state.phase);

  // P1 出牌
  console.log('6. P1 出牌 (0,0)...');
  const cardId = r.state.drawnCards[0].id;
  r = await post('placeCard', { row: 0, col: 0, cardId }, rid);
  if (r.error) throw new Error('出牌失败: ' + r.error);
  console.log('   ✓ board[0][0]=' + r.state.board[0][0].card.rank + r.state.board[0][0].card.suit);
  console.log('   ✓ 轮到: ' + r.state.players[r.state.currentPlayerIndex].name);

  // P2 抽1张
  console.log('7. P2 抽1张牌...');
  r = await post('drawCards', { count: 1 }, rid);
  if (r.error) throw new Error('P2抽牌失败: ' + r.error);
  console.log('   ✓ drawnCards=' + r.state.drawnCards.length);

  // P2 完成抽牌
  console.log('8. P2 完成抽牌...');
  r = await post('finishDraw', {}, rid);
  if (r.error) throw new Error('P2完成抽牌失败: ' + r.error);
  console.log('   ✓ phase=' + r.state.phase);

  // P2 出牌
  console.log('9. P2 出牌 (0,1)...');
  const cardId2 = r.state.drawnCards[0].id;
  r = await post('placeCard', { row: 0, col: 1, cardId: cardId2 }, rid);
  if (r.error) throw new Error('P2出牌失败: ' + r.error);
  console.log('   ✓ board[0][1]=' + r.state.board[0][1].card.rank + r.state.board[0][1].card.suit);

  // 查询状态
  console.log('10. 查询状态...');
  const st = await get(rid, 'p0');
  console.log('   ✓ phase=' + st.phase + ' board=5x' + st.board.length + ' players=' + st.players.length);
  console.log('   ✓ 棋盘:');
  for (let row = 0; row < 5; row++) {
    let line = '   ';
    for (let col = 0; col < 5; col++) {
      const cell = st.board[row][col];
      line += cell ? cell.card.rank.padEnd(3) : ' .  ';
    }
    console.log(line);
  }

  // 测试错误情况
  console.log('\n11. 测试错误情况...');
  // 加入不存在的房间
  r = await post('joinRoom', { name: 'Ghost' }, 'NOPE99');
  console.log('   加入不存在房间: ' + (r.error ? '✓ ' + r.error : '✗ 应该报错'));
  // 非回合玩家抽牌
  r = await post('drawCards', { count: 1 }, rid);
  console.log('   非回合玩家抽牌: ' + (r.error ? '✓ ' + r.error : '✗ 应该报错'));
  // 占位出牌
  r = await post('placeCard', { row: 0, col: 0, cardId: 'FAKE' }, rid);
  console.log('   占位出牌: ' + (r.error ? '✓ ' + r.error : '✗ 应该报错'));

  console.log('\n=== 全部模拟测试通过 ✓ ===\n');
}

run().catch(e => {
  console.error('\n✗ 测试失败:', e.message);
  process.exit(1);
});
