# DonutFlayer

Minecraft bot dashboard with Mineflayer, Microsoft OAuth device code auth, and real-time chat.

## Features

- Create and manage Mineflayer bots
- Microsoft OAuth device code authentication (copy code + countdown on dashboard)
- Real-time chat send/receive per bot
- Bot actions: Mine, AFK, Explore, Mount, Stop
- Server management (add/remove Minecraft servers)
- Live activity feed
- Dark theme UI

## Setup

```bash
npm install
node server.js
```

Dashboard runs on port 3000.

## Docker

```bash
docker build -t donutflayer .
docker run -d -p 3000:3000 donutflayer
```

## Stack

- Node.js + Express + Socket.IO
- Mineflayer (bot engine)
- Vanilla HTML/CSS/JS frontend
