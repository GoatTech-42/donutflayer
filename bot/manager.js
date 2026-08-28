const { randomUUID } = require('crypto')
const MineflayerBot = require('./MineflayerBot')

class BotManager {
  constructor(io) {
    this.io = io
    this.bots = new Map()
    this.servers = new Map()
    this.defaultServers = [
      { id: 'donutsmp', name: 'DonutSMP', host: 'donutsmp.net', port: 25565, version: '1.21.4' },
      { id: 'hypixel', name: 'Hypixel', host: 'mc.hypixel.net', port: 25565, version: '1.21.4' }
    ]
    this.defaultServers.forEach(s => this.servers.set(s.id, s))
  }

  getServers() {
    return Array.from(this.servers.values())
  }

  addServer(data) {
    const id = data.id || randomUUID().slice(0, 8)
    const server = { id, ...data }
    this.servers.set(id, server)
    return server
  }

  removeServer(id) {
    this.servers.delete(id)
  }

  getBots() {
    return Array.from(this.bots.values())
  }
  getBot(id) {
    return this.bots.get(id)
  }

  async createBot(data) {
    const id = randomUUID().slice(0, 8)
    const server = this.servers.get(data.serverId)
    if (!server) throw new Error('Server not found')

    const bot = new MineflayerBot(
      id,
      {
        username: data.username,
        auth: data.auth || 'microsoft',
        host: server.host,
        port: server.port,
        version: server.version,
        serverName: server.name
      },
      this.io
    )

    this.bots.set(id, bot)
    await bot.connect()
    return id
  }

  removeBot(id) {
    const bot = this.bots.get(id)
    if (bot) {
      bot.disconnect()
      this.bots.delete(id)
    }
  }

  botAction(id, action, params) {
    const bot = this.bots.get(id)
    if (bot) bot.action(action, params)
  }

  shutdown() {
    for (const bot of this.bots.values()) bot.disconnect()
    this.bots.clear()
  }
}

module.exports = BotManager
