# 扑克五子棋 (Poker Gomoku)

双人对战扑克五子棋 — 在 5×5 棋盘上用扑克牌落子，凑成同色连号或同点数对即得分。

## 本地运行

```bash
cd poker-gomoku
npm install
npm start
# 打开 http://localhost:3000
```

## 线上部署

### Vercel（推荐，国内可访问）

1. 将本项目推送到 GitHub
2. 登录 [vercel.com](https://vercel.com)（用 GitHub 账号）
3. **Add New Project** → 导入 `troywen/poker-gomoku`
4. 部署前，先在 Vercel 项目设置中开启 **Storage → Vercel KV**（免费，用于房间状态存储）
5. 点 **Deploy**，等待 1-2 分钟
6. 部署完成后获得 `https://poker-gomoku-xxxx.vercel.app` 网址，国内可直接访问

### 本地运行（Socket.IO 模式）

```bash
cd poker-gomoku
npm install
npm start
# 打开 http://localhost:3000
```

### 手机上玩

部署后在手机浏览器（Chrome）打开 URL：
- 点击浏览器菜单 → **"添加到主屏幕"**，即可像 App 一样启动（PWA 支持）
- 分享房间号给朋友，两人即可对战

## 规则简述

- **棋盘**：5×5，横竖各5格
- **抽牌**：每回合抽 1–4 张，选一张放到棋盘，其余加入手牌
- **成五**：同色且点数连号 ≥3 个即得分，凑满 5 个双倍（10分）
- **成对**：同点数即成对（不看花色），+2分；大小王只能互相对（王炸 +5分，并消除）
- **方向**：横、竖、斜均可；中间空档忽略；多方向同时成立均可得分

## 测试

```bash
node test-logic.js        #  scoring rule unit tests
node test-integration.js  #  full 2-player socket flow
node test-rejoin.js       #  reconnect / rejoin
```
