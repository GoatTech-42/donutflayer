const socket = io()
let state = { servers: [], bots: [], selectedBot: null, activity: [] }

socket.on('init', data => {
  state.servers = data.servers || []
  state.bots = data.bots || []
  renderAll()
})

socket.on('bot:event', data => {
  const bot = state.bots.find(b => b.id === data.botId)
  if (!bot) return

  switch (data.event) {
    case 'status':
      bot.status = data.data
      break
    case 'mode':
      bot.mode = data.data
      break
    case 'auth':
      bot.authState = data.data
      if (data.data.status === 'auth_required') {
        showAuthBanner(data.data, bot.username)
      } else if (data.data.status === 'authenticated') {
        hideAuthBanner()
        addActivity(`Authenticated: ${bot.username}`)
      }
      break
    case 'chat':
      if (!bot.chatLog) bot.chatLog = []
      bot.chatLog.push(data.data)
      if (bot.chatLog.length > 200) bot.chatLog.shift()
      addActivity(`[${bot.username}] ${data.data.msg}`)
      if (state.selectedBot?.id === bot.id) updateDetailPanel(bot)
      break
    case 'log':
      if (!bot.chatLog) bot.chatLog = []
      bot.chatLog.push(data.data)
      addActivity(`[${bot.username}] ${data.data.msg}`, data.data.level)
      break
    case 'death':
      addActivity(`[${bot.username}] Died`, 'warn')
      break
  }

  renderBots()
  updateOverview()
})

socket.on('bot:created', data => {
  state.bots.push({
    id: data.id,
    username: data.username,
    server: data.serverName,
    host: data.host,
    status: 'connecting',
    mode: 'idle',
    stats: { blocksMined: 0, uptime: 0, reconnects: 0 },
    chatLog: [],
    authState: null
  })
  renderBots()
  updateOverview()
  addActivity(`Bot created: ${data.username}`)
})

socket.on('bot:removed', data => {
  const bot = state.bots.find(b => b.id === data.id)
  state.bots = state.bots.filter(b => b.id !== data.id)
  if (state.selectedBot?.id === data.id) {
    state.selectedBot = null
    closeModal()
  }
  renderBots()
  updateOverview()
  if (bot) addActivity(`Bot removed: ${bot.username}`)
})

socket.on('server:added', data => {
  state.servers.push(data)
  renderServers()
  updateOverview()
})

socket.on('server:removed', data => {
  state.servers = state.servers.filter(s => s.id !== data.id)
  renderServers()
  updateOverview()
})

socket.on('bot:error', data => {
  addActivity(`Error: ${data.error}`, 'error')
})

// Tabs
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'))
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'))
    btn.classList.add('active')
    const tab = btn.dataset.tab
    document.getElementById(tab + '-tab').classList.add('active')
    document.getElementById('page-title').textContent =
      tab === 'dashboard' ? 'Dashboard' : tab === 'bots' ? 'Bots' : 'Servers'

    const actions = document.getElementById('topbar-actions')
    if (tab === 'bots') {
      actions.innerHTML = '<button class="btn btn-primary" onclick="openAddBot()">+ Add Bot</button>'
    } else if (tab === 'servers') {
      actions.innerHTML = '<button class="btn btn-primary" onclick="openAddServer()">+ Add Server</button>'
    } else {
      actions.innerHTML = ''
    }
  })
})

function renderAll() {
  renderBots()
  renderServers()
  updateOverview()
  updateSystemStats()
}

function updateOverview() {
  document.getElementById('ov-bots').textContent = state.bots.filter(b => b.status === 'online').length
  document.getElementById('ov-servers').textContent = state.servers.length
  document.getElementById('ov-mined').textContent = state.bots.reduce(
    (s, b) => s + (b.stats?.blocksMined || 0),
    0
  )
  const totalUptime = state.bots.reduce((s, b) => s + (b.stats?.uptime || 0), 0)
  document.getElementById('ov-uptime').textContent = formatTime(totalUptime)
}

function updateSystemStats() {
  document.getElementById('s-bot-count').textContent = state.bots.length
  fetch('/api/health')
    .then(r => r.json())
    .then(d => {
      document.getElementById('s-memory').textContent = d.memory.rss + ' MB'
    })
    .catch(() => {})
  setTimeout(updateSystemStats, 5000)
}

function renderBots() {
  const el = document.getElementById('bots-grid')
  if (!state.bots.length) {
    el.innerHTML =
      '<div class="empty-state" style="grid-column:1/-1">No bots running. Click "+ Add Bot" to create one.</div>'
    return
  }

  el.innerHTML = state.bots
    .map(
      b => `
    <div class="bot-card" onclick="openBotDetail('${b.id}')">
      <div class="bot-card-header">
        <div>
          <div class="bot-card-name">${esc(b.username || 'Unknown')}</div>
          <div class="bot-card-server">${esc(b.server || b.host || '')}</div>
        </div>
        <div class="status-dot ${b.status}" title="${b.status}"></div>
      </div>
      <div class="bot-card-stats">
        <div class="bot-stat"><div class="bot-stat-label">Mode</div><div class="bot-stat-value">${b.mode || 'idle'}</div></div>
        <div class="bot-stat"><div class="bot-stat-label">Mined</div><div class="bot-stat-value">${b.stats?.blocksMined || 0}</div></div>
        <div class="bot-stat"><div class="bot-stat-label">Uptime</div><div class="bot-stat-value">${formatTime(b.stats?.uptime || 0)}</div></div>
      </div>
    </div>
  `
    )
    .join('')
}

function renderServers() {
  const el = document.getElementById('servers-grid')
  if (!state.servers.length) {
    el.innerHTML = '<div class="empty-state" style="grid-column:1/-1">No servers configured.</div>'
    return
  }

  el.innerHTML = state.servers
    .map(
      s => `
    <div class="server-card">
      <div class="server-card-header">
        <div>
          <div class="server-card-name">${esc(s.name)}</div>
          <div class="server-card-host">${esc(s.host)}:${s.port}</div>
        </div>
        <button class="btn-delete" onclick="event.stopPropagation(); removeServer('${s.id}')" title="Remove">&times;</button>
      </div>
      <div style="font-size:11px;color:var(--text3)">MC ${esc(s.version)}</div>
    </div>
  `
    )
    .join('')
}

function addActivity(msg, level = 'info') {
  state.activity.unshift({ time: new Date(), msg, level })
  if (state.activity.length > 50) state.activity.pop()
  renderActivity()
}

function renderActivity() {
  const el = document.getElementById('activity-feed')
  if (!state.activity.length) {
    el.innerHTML = '<div class="empty-state">No activity yet</div>'
    return
  }

  el.innerHTML = state.activity
    .slice(0, 20)
    .map(
      a => `
    <div class="activity-item">
      <span class="activity-time">${a.time.toLocaleTimeString()}</span>
      <span class="activity-msg ${a.level === 'error' ? 'error' : a.level === 'warn' ? 'warn' : ''}">${esc(a.msg)}</span>
    </div>
  `
    )
    .join('')
}

let authCountdown = null

function showAuthBanner(data, username) {
  if (authCountdown) clearInterval(authCountdown)

  const banner = document.getElementById('auth-banner')
  banner.style.display = 'block'

  let remaining = data.expiresIn || 600

  const rawCode = data.code
  banner.innerHTML = `
    <div class="auth-banner">
      <div class="auth-banner-header">
        <div class="auth-banner-icon">M</div>
        <div>
          <div class="auth-banner-title">Microsoft Authentication Required</div>
          <div class="auth-banner-subtitle">Bot: ${esc(username)}</div>
        </div>
      </div>
      <div class="auth-code-box" id="auth-code-box" title="Click to copy">
        <div style="flex:1">
          <div class="auth-code-label">Device Code</div>
          <div class="auth-code-value">${esc(rawCode)}</div>
        </div>
        <div class="copy-hint" id="copy-hint">Click to copy</div>
      </div>
      <div class="auth-url">
        1. Open <a href="${esc(data.fullUrl)}" target="_blank" rel="noopener">${esc(data.url)}</a><br>
        2. Enter the code above
      </div>
      <div class="auth-timer" id="auth-timer">Expires in ${formatAuthTime(remaining)}</div>
    </div>
  `
  document.getElementById('auth-code-box').addEventListener('click', () => copyAuthCode(rawCode))

  authCountdown = setInterval(() => {
    remaining--
    const el = document.getElementById('auth-timer')
    if (el) el.textContent = `Expires in ${formatAuthTime(remaining)}`
    if (remaining <= 0) {
      clearInterval(authCountdown)
      authCountdown = null
    }
  }, 1000)
}

function formatAuthTime(s) {
  if (s <= 0) return 'Expired'
  const m = Math.floor(s / 60)
  const sec = s % 60
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`
}

function copyAuthCode(code) {
  navigator.clipboard
    .writeText(code)
    .then(() => {
      const hint = document.getElementById('copy-hint')
      if (hint) {
        hint.textContent = 'Copied!'
        setTimeout(() => {
          hint.textContent = 'Click to copy'
        }, 2000)
      }
    })
    .catch(() => {})
}

function hideAuthBanner() {
  document.getElementById('auth-banner').style.display = 'none'
}

function openBotDetail(id) {
  const bot = state.bots.find(b => b.id === id)
  if (!bot) return
  state.selectedBot = bot

  const html = `
    <div class="modal-box" style="max-width:560px">
      <div class="modal-head">
        <h3>${esc(bot.username)}</h3>
        <button class="modal-close-btn" onclick="closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="detail-panel">
          <div class="detail-stat"><div class="detail-stat-label">Status</div><div class="detail-stat-value">${bot.status}</div></div>
          <div class="detail-stat"><div class="detail-stat-label">Mode</div><div class="detail-stat-value">${bot.mode || 'idle'}</div></div>
          <div class="detail-stat"><div class="detail-stat-label">Health</div><div class="detail-stat-value">${bot.health ?? '-'}</div></div>
          <div class="detail-stat"><div class="detail-stat-label">Food</div><div class="detail-stat-value">${bot.food ?? '-'}</div></div>
          <div class="detail-stat"><div class="detail-stat-label">Mined</div><div class="detail-stat-value">${bot.stats?.blocksMined || 0}</div></div>
          <div class="detail-stat"><div class="detail-stat-label">Uptime</div><div class="detail-stat-value">${formatTime(bot.stats?.uptime || 0)}</div></div>
        </div>

        <div class="btn-group" style="margin-bottom:16px">
          <button class="btn btn-primary" onclick="botAction('${bot.id}','mine')">Mine</button>
          <button class="btn" onclick="botAction('${bot.id}','afk')">AFK</button>
          <button class="btn" onclick="botAction('${bot.id}','explore')">Explore</button>
          <button class="btn" onclick="botAction('${bot.id}','mount')">Mount</button>
          <button class="btn btn-danger" onclick="botAction('${bot.id}','stop')">Stop</button>
        </div>

        <div class="chat-panel">
          <div class="chat-messages" id="detail-chat">
            ${(bot.chatLog || [])
              .slice(-50)
              .map(e => {
                const text = typeof e === 'string' ? e : e.msg || ''
                return `<div class="chat-msg">${esc(text)}</div>`
              })
              .join('')}
          </div>
          <div class="chat-input-row">
            <input class="chat-input" id="chat-input" placeholder="Type a message..." onkeydown="if(event.key==='Enter')sendChat('${bot.id}')">
            <button class="chat-send" onclick="sendChat('${bot.id}')">Send</button>
          </div>
        </div>

        <div style="margin-top:16px;display:flex;justify-content:flex-end">
          <button class="btn btn-danger" onclick="removeBot('${bot.id}')">Remove Bot</button>
        </div>
      </div>
    </div>
  `

  document.getElementById('modal-container').innerHTML = html
  document.getElementById('modal-overlay').style.display = 'flex'

  const chatEl = document.getElementById('detail-chat')
  if (chatEl) chatEl.scrollTop = chatEl.scrollHeight
}

function updateDetailPanel(bot) {
  if (state.selectedBot?.id !== bot.id) return
  const chatEl = document.getElementById('detail-chat')
  if (!chatEl) return
  const text = bot.chatLog?.length ? bot.chatLog[bot.chatLog.length - 1] : null
  if (text) {
    const msgText = typeof text === 'string' ? text : text.msg || ''
    chatEl.innerHTML += `<div class="chat-msg">${esc(msgText)}</div>`
    chatEl.scrollTop = chatEl.scrollHeight
  }
  const viewerChat = document.getElementById('viewer-chat')
  if (viewerChat && msgText) {
    viewerChat.innerHTML += `<div class="chat-msg">${esc(msgText)}</div>`
    viewerChat.scrollTop = viewerChat.scrollHeight
  }
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open')
  document.getElementById('modal-overlay').style.display = 'none'
  state.selectedBot = null
  // Also exit fullscreen bot stage if open
  const fs = document.getElementById('bot-fullscreen')
  if (fs) fs.remove()
}

document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target.id === 'modal-overlay') closeModal()
})

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeModal()
    const fs = document.getElementById('bot-fullscreen')
    if (fs) fs.remove()
  }
})

// Fullscreen bot stage — click any bot card → immersive controls + viewer
function openFullscreenBot(bot) {
  state.selectedBot = bot
  let fs = document.getElementById('bot-fullscreen')
  if (fs) fs.remove()
  fs = document.createElement('div')
  fs.id = 'bot-fullscreen'
  fs.className = 'bot-fullscreen'
  fs.innerHTML = `
    <div class="bot-fullscreen-head">
      <b>${esc(bot.username)}</b><span class="badge">${esc(bot.server)} · ${esc(bot.status)}</span>
      <button class="btn" onclick="document.getElementById('bot-fullscreen').remove()">✕ Close</button>
    </div>
    <div class="bot-fullscreen-body">
      <div class="bot-fullscreen-left">
        <div class="chat-panel" style="height:100%">
          <div class="chat-messages" id="viewer-chat" style="height:280px">${(bot.chatLog || [])
            .slice(-30)
            .map(e => `<div class="chat-msg">${esc(typeof e === 'string' ? e : e.msg || '')}</div>`)
            .join('')}</div>
          <div class="chat-input-row"><input class="chat-input" id="fs-chat-input" placeholder="Type as ${esc(bot.username)}…"><button class="chat-send" onclick="fsSendChat('${bot.id}')">Send</button></div>
        </div>
        <div class="btn-group" style="margin-top:10px; flex-wrap:wrap">
          <button class="btn btn-primary" onclick="botAction('${bot.id}','mine')">Mine</button>
          <button class="btn" onclick="botAction('${bot.id}','afk')">AFK</button>
          <button class="btn" onclick="botAction('${bot.id}','explore')">Explore</button>
          <button class="btn" onclick="botAction('${bot.id}','mount')">Mount</button>
          <button class="btn btn-danger" onclick="botAction('${bot.id}','stop')">Stop</button>
        </div>
        <div class="btn-group" style="margin-top:8px; flex-wrap:wrap">
          <button class="btn" onclick="viewerMove('${bot.id}','forward')">Forward</button>
          <button class="btn" onclick="viewerMove('${bot.id}','left')">Left</button>
          <button class="btn" onclick="viewerMove('${bot.id}','back')">Back</button>
          <button class="btn" onclick="viewerMove('${bot.id}','right')">Right</button>
          <button class="btn" onclick="viewerMove('${bot.id}','jump')">Jump</button>
          <button class="btn" onclick="viewerMove('${bot.id}','sneak')">Sneak</button>
          <button class="btn" onclick="viewerMove('${bot.id}','sprint')">Sprint</button>
        </div>
      </div>
      <div class="bot-fullscreen-right">
        <div id="fs-viewer-root" style="height:420px; border:1px solid var(--border); border-radius:8px; background:#0a0a0a; display:grid; place-items:center; color:var(--text2)">Prismarine viewer — ${esc(bot.username)}</div>
        <p style="margin-top:8px; color:var(--text2); font-size:12px">Prismarine viewer (prismarine-viewer) renders the world around the bot when enabled server-side. Movement keys drive the pathfinder.</p>
      </div>
    </div>
  `
  document.body.appendChild(fs)
  const inp = document.getElementById('fs-chat-input')
  if (inp)
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') fsSendChat(bot.id)
    })
}
function fsSendChat(botId) {
  const inp = document.getElementById('fs-chat-input')
  if (!inp) return
  const msg = inp.value.trim()
  if (!msg) return
  socket.emit('bot:action', { id: botId, action: 'chat', params: { message: msg } })
  inp.value = ''
}
function viewerMove(botId, dir) {
  socket.emit('bot:action', { id: botId, action: 'move', params: { dir } })
}

function sendChat(botId) {
  const input = document.getElementById('chat-input')
  if (!input) return
  const msg = input.value.trim()
  if (!msg) return
  socket.emit('bot:action', { id: botId, action: 'chat', params: { message: msg } })
  input.value = ''
}

function botAction(id, action) {
  socket.emit('bot:action', { id, action })
  if (action === 'stop') addActivity(`Bot stopped`, 'warn')
}

function removeBot(id) {
  socket.emit('bot:remove', { id })
  closeModal()
}

function openAddBot() {
  // Hook quick-login: allow login directly via the UI without terminal device-code copy/paste
  const qForm = document.getElementById('quick-login-form')
  if (qForm && !qForm._bound) {
    qForm._bound = true
    qForm.addEventListener('submit', e => {
      e.preventDefault()
      const u = document.getElementById('quick-username').value.trim()
      const sid = document.getElementById('quick-server').value
      const auth = document.getElementById('quick-auth').value
      if (!u) return
      socket.emit('bot:create', { username: u, serverId: sid, auth })
      const hint = document.getElementById('quick-login-hint')
      if (hint) hint.textContent = 'Connecting — device-code will appear above if Microsoft auth is required.'
    })
    const updQuickServers = () => {
      const sel = document.getElementById('quick-server')
      if (sel)
        sel.innerHTML = state.servers.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')
    }
    const origRenderAll = typeof renderAll === 'function' ? renderAll : null
    if (origRenderAll) {
      /* keep original renderAll — quick-login select re-renders via socket init */
    }
  }
  const serverOpts = state.servers.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')

  document.getElementById('modal-container').innerHTML = `
    <div class="modal-box">
      <div class="modal-head">
        <h3>Add Bot</h3>
        <button class="modal-close-btn" onclick="closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">Username</label>
          <input class="form-input" id="f-username" placeholder="Bot username...">
        </div>
        <div class="form-group">
          <label class="form-label">Server</label>
          <select class="form-select" id="f-server">${serverOpts}</select>
        </div>
        <div class="form-group">
          <label class="form-label">Authentication</label>
          <select class="form-select" id="f-auth">
            <option value="microsoft">Microsoft (OAuth)</option>
          </select>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="createBot()">Create</button>
      </div>
    </div>
  `
  document.getElementById('modal-overlay').style.display = 'flex'
  document.getElementById('f-username').focus()
}

function createBot() {
  const username = document.getElementById('f-username').value.trim()
  const serverId = document.getElementById('f-server').value
  const auth = document.getElementById('f-auth').value
  if (!username) return
  socket.emit('bot:create', { username, serverId, auth })
  closeModal()
}

function openAddServer() {
  document.getElementById('modal-container').innerHTML = `
    <div class="modal-box">
      <div class="modal-head">
        <h3>Add Server</h3>
        <button class="modal-close-btn" onclick="closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">Name</label>
          <input class="form-input" id="f-srv-name" placeholder="My Server">
        </div>
        <div class="form-group">
          <label class="form-label">Host</label>
          <input class="form-input" id="f-srv-host" placeholder="mc.example.com">
        </div>
        <div class="form-group">
          <label class="form-label">Port</label>
          <input class="form-input" id="f-srv-port" type="number" value="25565">
        </div>
        <div class="form-group">
          <label class="form-label">Version</label>
          <input class="form-input" id="f-srv-version" value="1.21.4">
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="createServer()">Add</button>
      </div>
    </div>
  `
  document.getElementById('modal-overlay').style.display = 'flex'
  document.getElementById('f-srv-name').focus()
}

function createServer() {
  const name = document.getElementById('f-srv-name').value.trim()
  const host = document.getElementById('f-srv-host').value.trim()
  const port = parseInt(document.getElementById('f-srv-port').value) || 25565
  const version = document.getElementById('f-srv-version').value.trim()
  if (!name || !host) return
  socket.emit('server:add', { name, host, port, version })
  closeModal()
}

function removeServer(id) {
  socket.emit('server:remove', { id })
}

function formatTime(s) {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${sec}s`
}

function esc(str) {
  if (!str) return ''
  const d = document.createElement('div')
  d.textContent = String(str)
  return d.innerHTML
}

// Auto-refresh dashboard while idle — matches tracker
setInterval(() => {
  if (document.hidden) return
  fetch('/api/health')
    .then(r => (r.ok ? r.json() : null))
    .then(d => d && typeof renderAll === 'function' && renderAll())
    .catch(() => {})
}, 45000)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden)
    fetch('/api/health')
      .then(r => (r.ok ? r.json() : null))
      .then(d => d && renderAll())
      .catch(() => {})
})
