const mineflayer = require('mineflayer');
const pathfinder = require('mineflayer-pathfinder');
const mcData = require('minecraft-data');
const { Movements, goals } = pathfinder;
const AUTH_FOLDER = process.env.AUTH_FOLDER || require('path').join(__dirname, '..', 'auth');

class MineflayerBot {
  constructor(id, opts, io) {
    this.id = id;
    this.opts = opts;
    this.io = io;
    this.bot = null;
    this.connected = false;
    this.status = 'disconnected';
    this.mode = 'idle';
    this.stats = { blocksMined: 0, itemsCollected: 0, uptime: 0, reconnects: 0, startTime: Date.now() };
    this._reconnectDelay = 3000;
    this._maxReconnectDelay = 30000;
    this._intervals = [];
    this._chatLog = [];
    this._maxChatLog = 200;
    this._authState = null;
    this._spawned = false;
    this._reconnectTimer = null;
  }

  getStatus() {
    return {
      id: this.id,
      username: this.opts.username,
      server: this.opts.serverName,
      host: this.opts.host,
      port: this.opts.port,
      status: this.status,
      mode: this.mode,
      connected: this.connected,
      position: this.bot?.entity?.position ? {
        x: +this.bot.entity.position.x.toFixed(1),
        y: +this.bot.entity.position.y.toFixed(1),
        z: +this.bot.entity.position.z.toFixed(1)
      } : null,
      health: this.bot?.health ?? null,
      food: this.bot?.food ?? null,
      level: this.bot?.experience?.level ?? null,
      dimension: this.bot?.game?.dimension ?? null,
      stats: {
        blocksMined: this.stats.blocksMined,
        itemsCollected: this.stats.itemsCollected,
        uptime: Math.floor((Date.now() - this.stats.startTime) / 1000),
        reconnects: this.stats.reconnects
      },
      chatLog: this._chatLog.slice(-50),
      authState: this._authState
    };
  }

  _emit(event, data) {
    this.io.emit('bot:event', { botId: this.id, event, data });
  }

  _log(msg, level = 'info') {
    const entry = { time: new Date().toISOString(), msg, level };
    this._chatLog.push(entry);
    if (this._chatLog.length > this._maxChatLog) this._chatLog.shift();
    this._emit('log', entry);
    console.log(`[${this.opts.username}] ${msg}`);
  }

  connect() {
    this.status = 'connecting';
    this._emit('status', this.status);

    const opts = {
      host: this.opts.host,
      port: this.opts.port,
      username: this.opts.username,
      auth: this.opts.auth,
      version: this.opts.version,
      hideErrors: true,
      checkTimeoutInterval: 60000
    };

    if (this.opts.auth === 'microsoft') {
      const { Authflow, Titles } = require('prismarine-auth');
      this._authState = { status: 'authenticating', flow: 'microsoft' };
      this._emit('auth', this._authState);

      opts.auth = 'microsoft';
      opts.profilesFolder = AUTH_FOLDER;

      const flow = new Authflow(
        this.opts.username,
        opts.profilesFolder,
        {
          authTitle: Titles.Minecraft,
          deviceCodeCallback: (code) => {
            this._authState = {
              status: 'auth_required',
              flow: 'microsoft',
              code: code.user_code,
              url: code.verification_uri,
              fullUrl: `${code.verification_uri}?otc=${code.user_code}`,
              expiresIn: code.expires_in,
              message: code.message
            };
            this._emit('auth', this._authState);
            this._log(`Auth required: Go to ${code.verification_uri} and enter ${code.user_code}`);
          }
        }
      );
    }

    this.bot = mineflayer.createBot(opts);
    this.bot.loadPlugin(pathfinder);

    this.bot.on('spawn', () => {
      this.connected = true;
      this.status = 'online';
      this._reconnectDelay = 3000;
      this.stats.startTime = Date.now();
      if (this._spawned) this.stats.reconnects++;
      this._spawned = true;
      this._authState = { status: 'authenticated', flow: 'microsoft' };
      this._emit('auth', this._authState);
      this._log('Connected and spawned');
      this._emit('status', this.status);
      this._startBehaviors();
    });

    this.bot.on('kicked', (reason) => {
      this._log(`Kicked: ${reason}`, 'warn');
      this._handleDisconnect();
    });

    this.bot.on('end', () => {
      this._log('Disconnected');
      this._handleDisconnect();
    });

    this.bot.on('error', (err) => {
      this._log(`Error: ${err.message}`, 'error');
    });

    this.bot.on('message', (jsonMsg) => {
      const text = jsonMsg.toString();
      this._chatLog.push({ time: new Date().toISOString(), msg: text, type: 'chat' });
      if (this._chatLog.length > this._maxChatLog) this._chatLog.shift();
      this._emit('chat', { msg: text });
    });

    this.bot.on('death', () => {
      this._log('Died — respawning');
      this._emit('death');
    });
  }

  _handleDisconnect() {
    this.connected = false;
    this.status = 'reconnecting';
    this._stopBehaviors();
    this._emit('status', this.status);

    this._reconnectTimer = setTimeout(() => {
      if (this.bot) { this.bot.removeAllListeners(); this.bot = null; }
      this.connect();
    }, this._reconnectDelay);

    this._reconnectDelay = Math.min(this._reconnectDelay * 1.5, this._maxReconnectDelay);
  }

  disconnect() {
    this._stopBehaviors();
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    if (this.bot) { try { this.bot.removeAllListeners(); this.bot.quit(); } catch (_) {} this.bot = null; }
    this.connected = false;
    this.status = 'disconnected';
  }

  _startBehaviors() {
    this._intervals.push(setInterval(() => this._humanLook(), 3000 + Math.random() * 5000));
    this._intervals.push(setInterval(() => this._humanSway(), 1500 + Math.random() * 3000));

    if (this.mode === 'mine') this._startMining();
    if (this.mode === 'afk') this._startAfk();
    if (this.mode === 'explore') this._startExplore();
  }

  _stopBehaviors() {
    this._intervals.forEach(clearInterval);
    this._intervals = [];
    if (this._mineInterval) { clearInterval(this._mineInterval); this._mineInterval = null; }
    if (this._afkInterval) { clearInterval(this._afkInterval); this._afkInterval = null; }
    if (this._exploreInterval) { clearInterval(this._exploreInterval); this._exploreInterval = null; }
  }

  _humanLook() {
    if (!this.bot?.entity) return;
    const yaw = this.bot.entity.yaw + (Math.random() - 0.5) * 0.3;
    const pitch = (Math.random() - 0.5) * 0.2;
    this.bot.look(yaw, pitch, false);
  }

  _humanSway() {
    if (!this.bot?.entity || !this.connected) return;
    if (Math.random() < 0.25) {
      this.bot.setControlState('sneak', true);
      setTimeout(() => this.bot.setControlState('sneak', false), 200 + Math.random() * 300);
    }
  }

  _startMining() {
    if (this._mineInterval) clearInterval(this._mineInterval);
    this.mode = 'mine';
    this._emit('mode', this.mode);
    this._log('Started mining');

    const doMine = async () => {
      if (!this.bot || !this.connected) return;
      try {
        const block = this.bot.findBlock({
          matching: (b) => b.name.endsWith('_ore') || b.name.endsWith('_log') || b.name === 'stone',
          maxDistance: 64,
          count: 1
        });
        if (!block) { this._humanWalk(); return; }

        const data = mcData(this.bot.version);
        const movements = new Movements(this.bot, data);
        this.bot.pathfinder.setMovements(movements);
        await this.bot.pathfinder.goto(new goals.GoalBlock(block.position.x, block.position.y, block.position.z));

        this.bot.lookAt(block.position.offset(0.5, 0.5, 0.5), true);
        await this._sleep(150 + Math.random() * 250);
        await this.bot.dig(block);
        this.stats.blocksMined++;
        this.stats.itemsCollected++;
      } catch (e) {
        this._log(`Mining error: ${e.message}`, 'warn');
      }

      await this._sleep(400 + Math.random() * 800);
    };

    this._mineInterval = setInterval(doMine, 1800 + Math.random() * 2000);
  }

  _humanWalk() {
    if (!this.bot || !this.connected) return;
    try {
      const data = mcData(this.bot.version);
      const movements = new Movements(this.bot, data);
      this.bot.pathfinder.setMovements(movements);

      const dir = Math.random() * Math.PI * 2;
      const dist = 3 + Math.random() * 8;
      const x = this.bot.entity.position.x + Math.cos(dir) * dist;
      const z = this.bot.entity.position.z + Math.sin(dir) * dist;
      this.bot.pathfinder.goto(new goals.GoalNear(x, this.bot.entity.position.y, z, 2));
    } catch (e) {
      this._log(`Walk error: ${e.message}`, 'warn');
    }
  }

  _startAfk() {
    if (this._afkInterval) clearInterval(this._afkInterval);
    this.mode = 'afk';
    this._emit('mode', this.mode);
    this._log('Started AFK');

    this._afkInterval = setInterval(() => {
      if (!this.bot || !this.connected) return;
      if (Math.random() < 0.2) {
        const action = Math.random() < 0.5 ? 'sneak' : 'jump';
        this.bot.setControlState(action, true);
        setTimeout(() => this.bot.setControlState(action, false), 100 + Math.random() * 200);
      }
    }, 4000 + Math.random() * 8000);
  }

  _startExplore() {
    if (this._exploreInterval) clearInterval(this._exploreInterval);
    this.mode = 'explore';
    this._emit('mode', this.mode);
    this._log('Started exploring');

    this._exploreInterval = setInterval(() => this._humanWalk(), 6000 + Math.random() * 6000);
  }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  action(type, params = {}) {
    if (!this.bot || !this.connected) return;

    switch (type) {
      case 'mine': this._startMining(); break;
      case 'afk': this._startAfk(); break;
      case 'explore': this._startExplore(); break;
      case 'stop':
        this._stopBehaviors();
        this.mode = 'idle';
        this._emit('mode', this.mode);
        this._log('Stopped');
        break;
      case 'chat': this.bot.chat(params.message || ''); break;
      case 'mount': this._mountNearest(); break;
      case 'dismount': if (this.bot.riding) this.bot.dismount(); break;
    }
  }

  async _mountNearest() {
    const entity = this.bot.nearestEntity(e =>
      e.type === 'object' && (e.name?.includes('boat') || e.name?.includes('minecart') || e.name?.includes('horse') || e.name?.includes('pig'))
    );
    if (entity) {
      try {
        const data = mcData(this.bot.version);
        const movements = new Movements(this.bot, data);
        this.bot.pathfinder.setMovements(movements);
        await this.bot.pathfinder.goto(new goals.GoalNear(entity.position.x, entity.position.y, entity.position.z, 2));
        this.bot.mount(entity);
        this._log(`Mounted ${entity.name}`);
      } catch (e) {
        this._log(`Mount failed: ${e.message}`);
      }
    }
  }
}

module.exports = MineflayerBot;
