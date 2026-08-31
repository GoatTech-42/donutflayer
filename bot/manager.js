const { randomUUID } = require('crypto')
const fs = require('fs')
const path = require('path')
const MineflayerBot = require('./MineflayerBot')

const SERVERS_FILE = process.env.SERVERS_FILE || path.join(__dirname, '..', 'data', 'servers.json')
const BOTS_FILE = process.env.BOTS_FILE || path.join(__dirname, '..', 'data', 'bots.json')

class BotManager {
  constructor(io) {
    this.io = io
    this.bots = new Map()
    this.servers = new Map()
    this.defaultServers = [
      { id: 'donutsmp', name: 'DonutSMP', host: 'donutsmp.net', port: 25565, version: '1.21.4' },
      { id: 'hypixel', name: 'Hypixel', host: 'mc.hypixel.net', port: 25565, version: '1.21.4' }
    ]
    this._loadServers()
  }

  _loadServers() {
    // Start with defaults so the app always has something to connect to.
    this.defaultServers.forEach(s => this.servers.set(s.id, s))
    try {
      if (fs.existsSync(SERVERS_FILE)) {
        const saved = JSON.parse(fs.readFileSync(SERVERS_FILE, 'utf8'))
        if (Array.isArray(saved)) {
          for (const s of saved) {
            if (s && s.host && s.name) {
              // Saved servers override defaults with the same id, otherwise add.
              this.servers.set(s.id || randomUUID().slice(0, 8), { ...s })
            }
          }
        }
      }
    } catch (e) {
      console.warn('[Servers] failed to load servers.json:', e.message)
    }
  }

  _saveServers() {
    try {
      fs.mkdirSync(path.dirname(SERVERS_FILE), { recursive: true })
      // Don't persist the two built-in defaults — they're re-seeded on every boot.
      const custom = this.getServers().filter(s => !this.defaultServers.some(d => d.id === s.id))
      fs.writeFileSync(SERVERS_FILE, JSON.stringify(custom, null, 2))
    } catch (e) {
      console.warn('[Servers] failed to save servers.json:', e.message)
    }
  }

  getServers() {
    return Array.from(this.servers.values())
  }

  addServer(data) {
    // Normalize: name/host required, port/version defaulted, id generated.
    if (!data || !String(data.name || '').trim() || !String(data.host || '').trim()) {
      throw new Error('Name and host are required')
    }
    const id = data.id || randomUUID().slice(0, 8)
    const server = {
      id,
      name: String(data.name).trim(),
      host: String(data.host).trim(),
      port: parseInt(data.port, 10) || 25565,
      version: String(data.version || '1.21.4').trim() || '1.21.4'
    }
    this.servers.set(id, server)
    this._saveServers()
    return server
  }

  removeServer(id) {
    // Don't allow removing the two built-in defaults.
    if (this.defaultServers.some(d => d.id === id)) return
    this.servers.delete(id)
    this._saveServers()
  }

  updateServer(id, data) {
    const existing = this.servers.get(id)
    if (!existing) return null
    const updated = {
      ...existing,
      name: String(data.name || existing.name).trim(),
      host: String(data.host || existing.host).trim(),
      port: parseInt(data.port, 10) || existing.port || 25565,
      version: String(data.version || existing.version || '1.21.4').trim() || '1.21.4'
    }
    if (!updated.name || !updated.host) throw new Error('Name and host are required')
    this.servers.set(id, updated)
    this._saveServers()
    return updated
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
        serverName: server.name,
        serverId: server.id
      },
      this.io
    )

    this.bots.set(id, bot)
    this._saveBots()
    await bot.connect()
    return id
  }

  removeBot(id) {
    const bot = this.bots.get(id)
    if (bot) {
      bot.disconnect()
      this.bots.delete(id)
      this._saveBots()
    }
  }

  botAction(id, action, params) {
    const bot = this.bots.get(id)
    if (bot) bot.action(action, params)
  }

  // Persist bot definitions so they auto-reconnect on restart.
  // (auth tokens are stored in prismarine-auth's profiles folder, not here.)
  _saveBots() {
    try {
      const defs = this.getBots().map(b => ({
        id: b.id,
        username: b.opts.username,
        auth: b.opts.auth,
        serverId: b.opts.serverId
      }))
      fs.mkdirSync(path.dirname(BOTS_FILE), { recursive: true })
      fs.writeFileSync(BOTS_FILE, JSON.stringify(defs, null, 2))
    } catch (e) {
      console.warn('[Bots] failed to save bots.json:', e.message)
    }
  }

  // Reconnect persisted bots on boot. async so it doesn't block startup.
  async restoreBots() {
    let restored = 0
    try {
      if (!fs.existsSync(BOTS_FILE)) return restored
      const defs = JSON.parse(fs.readFileSync(BOTS_FILE, 'utf8'))
      if (!Array.isArray(defs)) return restored
      for (const d of defs) {
        const server = this.servers.get(d.serverId)
        if (!d.username || !server) continue
        try {
          await this.createBot({ username: d.username, auth: d.auth || 'microsoft', serverId: d.serverId })
          restored++
        } catch (e) {
          console.warn(`[Bots] failed to restore ${d.username}:`, e.message)
        }
      }
    } catch (e) {
      console.warn('[Bots] failed to load bots.json:', e.message)
    }
    return restored
  }

  shutdown() {
    for (const bot of this.bots.values()) bot.disconnect()
    this.bots.clear()
  }
}

module.exports = BotManager
