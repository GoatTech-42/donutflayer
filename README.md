# DonutFlayer — Minecraft Bot Dashboard

Web dashboard for managing Mineflayer bots: Microsoft auth, viewer, real-time controls, and live telemetry.

## Run

```bash
npm install
npm start          # http://localhost:3000
```

## Docker

```bash
docker build -t donutflayer .
docker run -d --name donutflayer --restart unless-stopped \
  -p 4202:3000 -v flayer-auth:/app/auth donutflayer
```

The `flayer-auth` volume persists Microsoft auth tokens; `data/servers.json` persists custom server profiles.

## Features

- **Connect a bot** — Microsoft device-code flow in-browser, or offline mode
- **Servers** — add/edit/remove server profiles (DonutSMP + Hypixel seeded by default)
- **Playground** — tap a bot for a fullscreen terminal: live position/health/food/dimension, mode controls (mine/AFK/explore/mount), WASD + jump/sneak/sprint, chat
- **Auto-reconnect** — exponential backoff, kick/end/death handling

## Architecture

- `server.js` — Express + Socket.IO, REST endpoints, bot actions
- `bot/manager.js` — bot lifecycle + server profile persistence
- `bot/MineflayerBot.js` — Mineflayer wrapper (pathfinder, movements, behaviors)

## Notes

- Bots run `mineflayer-pathfinder` (plugin loaded via `pathfinder.pathfinder`)
- Server profiles survive restarts via `data/servers.json` (defaults re-seeded each boot)
