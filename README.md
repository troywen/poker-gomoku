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

### Render / Railway / Heroku（推荐）

项目已含 `Procfile`，直接连接 GitHub 仓库即可自动部署。

1. 将本项目推送到 GitHub
2. 在 Render/Railway 新建 Web Service，指向该仓库
3. 部署完成后获得公开 URL，在手机浏览器打开即可联机

### Docker

```bash
docker build -t poker-gomoku .
docker run -p 3000:3000 poker-gomoku
```

## 手机上玩

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
