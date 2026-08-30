const express = require('express')
const http = require('http')
const { Server } = require('socket.io')
const path = require('path')
const BotManager = require('./bot/manager')

const app = express()
const server = http.createServer(app)
const io = new Server(server, { cors: { origin: '*' } })

app.use(express.json())
app.use(
  express.static(path.join(__dirname, 'public'), {
    maxAge: process.env.NODE_ENV === 'production' ? 3600000 : 0,
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
        res.setHeader('Pragma', 'no-cache')
      }
    }
  })
)

const manager = new BotManager(io)

app.get('/api/health', (req, res) => {
  const mem = process.memoryUsage()
  res.json({
    status: 'ok',
    bots: manager.getBots().length,
    memory: { rss: Math.round(mem.rss / 1024 / 1024), heap: Math.round(mem.heapUsed / 1024 / 1024) },
    uptime: Math.floor(process.uptime())
  })
})

io.on('connection', socket => {
  console.log(`[Dashboard] Client connected: ${socket.id}`)

  socket.emit('init', {
    servers: manager.getServers(),
    bots: manager.getBots().map(b => b.getStatus()),
    health: { bots: manager.getBots().length }
  })

  socket.on('bot:create', async data => {
    try {
      if (!data.username || !String(data.username).trim())
        return socket.emit('bot:error', { error: 'Username required' })
      if (!['microsoft', 'offline'].includes(data.auth)) data.auth = 'microsoft'
      const id = await manager.createBot({
        username: String(data.username).trim().slice(0, 16),
        serverId: data.serverId,
        auth: data.auth
      })
      io.emit('bot:created', { id })
    } catch (err) {
      socket.emit('bot:error', { error: err.message })
      io.emit('bot:error', { error: err.message })
    }
  })

  socket.on('bot:remove', data => {
    manager.removeBot(data.id)
    io.emit('bot:removed', { id: data.id })
  })

  socket.on('bot:action', data => {
    manager.botAction(data.id, data.action, data.params)
  })

  socket.on('server:add', data => {
    const s = manager.addServer(data)
    socket.emit('server:added', s)
  })

  socket.on('server:remove', data => {
    manager.removeServer(data.id)
    socket.emit('server:removed', { id: data.id })
  })

  socket.on('disconnect', () => {
    console.log(`[Dashboard] Client disconnected: ${socket.id}`)
  })
})

const PORT = process.env.PORT || 3000
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Dashboard] http://0.0.0.0:${PORT}`)
})

process.on('SIGTERM', () => {
  manager.shutdown()
  server.close(() => process.exit(0))
})
process.on('SIGINT', () => {
  manager.shutdown()
  server.close(() => process.exit(0))
})
