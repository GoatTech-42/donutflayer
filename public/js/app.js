/* =====================================================================
   DonutFlayer — Minecraft bot dashboard
   Matches pulse's Cosmos glass theme + routing pattern.
   Data sources: /api/bots, /api/servers, /api/health, socket.io events.
   ===================================================================== */

const $  = (sel, root = document) => root.querySelector(sel)
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)]

const fmtNum   = n => Number(n || 0).toLocaleString('en-US')
const fmtPct   = n => (n > 0 ? '+' : '') + (n || 0).toFixed(1) + '%'

function relative(date) {
  if (!date) return '—'
  const s = Math.max(0, Math.round((Date.now() - new Date(date).getTime()) / 1000))
  if (s < 60)   return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function toast(msg, isError = false) {
  const node = document.createElement('div')
  node.className = 'toast' + (isError ? ' error' : '')
  node.textContent = msg
  $('#toast-region').appendChild(node)
  setTimeout(() => node.remove(), 4000)
}

async function api(path, options = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 30000)
  try {
    const res = await fetch(path, { ...options, signal: ctrl.signal })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    return data
  } finally {
    clearTimeout(timer)
  }
}

const state = {
  view: 'dashboard',
  servers: [],
  bots: [],
  authBanner: null,
  fullscreenBotId: null
}

const titles = {
  dashboard:   ['Bot',     'Dashboard'],
  bots:        ['Bot',     'Bots'],
  servers:     ['Bot',     'Servers'],
  playground:  ['Play',    'Playground']
}

function navigate(view) {
  if (!titles[view]) view = 'dashboard'
  state.view = view
  $$('.view').forEach(node => node.classList.toggle('active', node.dataset.view === view))
  $$('.nav-link').forEach(node => node.classList.toggle('active', node.dataset.view === view))
  $('#sidebar').classList.remove('open')
  $('#page-eyebrow').textContent = titles[view][0]
  $('#page-title').textContent   = titles[view][1]
  history.replaceState(null, '', '#' + view)
  if (view === 'dashboard') loadDashboard()
  else if (view === 'bots') loadBots()
  else if (view === 'servers') loadServers()
  else if (view === 'playground') loadPlayground()
}

$$('.nav-link').forEach(node =>
  node.addEventListener('click', () => navigate(node.dataset.view))
)
$('#menu-button')?.addEventListener('click', () =>
  $('#sidebar').classList.toggle('open')
)

/* ---------- Top bar ---------- */
$('#top-refresh')?.addEventListener('click', () => navigate(state.view))
$('#auth-refresh')?.addEventListener('click', () => loadDashboard())
$('#create-bot-btn')?.addEventListener('click', () => { navigate('dashboard'); setTimeout(() => $('#quick-username')?.focus(), 50) })
$('#bots-new-btn')?.addEventListener('click', () => { navigate('dashboard'); setTimeout(() => $('#quick-username')?.focus(), 50) })
$('#servers-new-btn')?.addEventListener('click', () => openAddServer())

function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

function bindQuickLogin() {
  const qForm = $('#quick-login-form')
  if (!qForm || qForm._bound) return
  qForm._bound = true
  qForm.addEventListener('submit', e => {
    e.preventDefault()
    const u = $('#quick-username').value.trim()
    const sid = $('#quick-server').value
    const auth = $('#quick-auth').value
    if (!u) return
    const btn = qForm.querySelector('button[type=submit]')
    const hint = $('#quick-login-hint')
    if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = 'Connecting…' }
    if (hint) hint.textContent = 'Connecting — device-code will appear above if Microsoft auth is required.'
    socket.emit('bot:create', { username: u, serverId: sid, auth })
    const unlock = () => {
      if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label || 'Connect' }
    }
    socket.once('bot:created', unlock)
    socket.once('bot:error', unlock)
  })
}

/* ---------- DASHBOARD ---------- */
async function loadDashboard() {
  try {
    const data = await api('/api/bots')
    state.bots = data.bots || []
    state.servers = data.servers || state.servers
    renderStatus({ ...data, servers: state.servers })
    renderOverview()
    renderActivity()
    renderQuickLogin()
  } catch (e) {
    toast(e.message, true)
  }
}

function renderStatus(data) {
  const live = data.bots?.length ? 'online' : 'idle'
  $('#source-label').textContent = live
  const totalUptime = (data.bots || []).reduce((s, b) => s + (b.stats?.uptime || 0), 0)
  $('#source-note').textContent = `${fmtNum((data.bots || []).filter(b => b.status === 'online').length)} bots online · ${fmtNum((data.bots || []).length)} total · uptime ${formatTime(totalUptime)}`
  $('#s-bot-count').textContent = (data.bots || []).length
  fetch('/api/health')
    .then(r => r.json())
    .then(h => $('#s-memory').textContent = `${h.memory?.rss || 0} MB`)
    .catch(() => {})
}

function formatTime(s) {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${Math.floor(s % 60)}s`
}

function renderOverview() {
  const online = (state.bots || []).filter(b => b.status === 'online').length
  $('#ov-bots').textContent = fmtNum(online)
  $('#ov-servers').textContent = fmtNum((state.servers || []).length)
  const mined = (state.bots || []).reduce((s, b) => s + (b.stats?.blocksMined || 0), 0)
  $('#ov-mined').textContent = fmtNum(mined)
  const totalUptime = (state.bots || []).reduce((s, b) => s + (b.stats?.uptime || 0), 0)
  $('#ov-uptime').textContent = formatTime(totalUptime)
}

function renderQuickLogin() {
  const sel = $('#quick-server')
  if (sel) {
    const cur = sel.value
    sel.innerHTML = (state.servers || [])
      .map(s => `<option value="${escHtml(s.id)}">${escHtml(s.name)}</option>`)
      .join('')
    if (cur && (state.servers || []).some(s => s.id === cur)) sel.value = cur
  }
  bindQuickLogin()
}

function renderActivity() {
  const feed = $('#activity-feed')
  if (!feed) return
  const items = (state.bots || []).slice().sort((a, b) => (b.stats?.uptime || 0) - (a.stats?.uptime || 0)).slice(0, 8)
  if (!items.length) {
    feed.innerHTML = `<div class="placeholder">No activity yet.</div>`
    return
  }
  feed.innerHTML = items.map(b => `
    <div class="row" data-bot="${escHtml(b.id)}">
      <span><b>${escHtml(b.username || 'Unknown')}</b> · ${escHtml(b.serverName || '')}</span>
      <span class="badge ${b.status === 'online' ? 'risk-low' : b.status === 'kicked' ? 'risk-high' : ''}">${escHtml(b.status || 'idle')}</span>
      <small>${formatTime(b.stats?.uptime || 0)}</small>
    </div>
  `).join('')
}

/* ---------- AUTH BANNER ---------- */
function showAuthBanner(data, username) {
  const banner = $('#auth-banner')
  if (!banner) return
  banner.style.display = 'block'
  banner.innerHTML = `
    <div class="card" style="border-color: rgba(64,78,191,0.4); background: rgba(64,78,191,0.08)">
      <header>
        <span class="eyebrow">Microsoft auth required</span>
        <strong>${escHtml(username || 'Bot')}</strong>
        <button class="btn-small" onclick="this.closest('.card').style.display='none'">Dismiss</button>
      </header>
      <div style="margin-top: 10px; padding: 14px; border-radius: 8px; background: var(--bg); border: 1px solid var(--border); display: flex; align-items: center; gap: 12px; cursor: pointer" onclick="navigator.clipboard?.writeText('${escHtml(data.code || '')}')">
        <div style="flex: 1">
          <div style="font-size: 10px; color: var(--text3); letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 4px; font-weight: 600">Device code</div>
          <div style="font-size: 28px; font-weight: 800; letter-spacing: 6px; font-family: var(--mono); color: var(--accent)">${escHtml(data.code || '')}</div>
        </div>
        <div style="font-size: 11px; color: var(--text3)">Click to copy</div>
      </div>
      <p style="margin-top: 10px; color: var(--text2); font-size: 13px; line-height: 1.6">
        1. Open <a href="${escHtml(data.fullUrl || data.url || '#')}" target="_blank" rel="noopener" style="color: var(--accent); font-weight: 600">${escHtml(data.url || 'microsoft.com/devicelogin')}</a><br>
        2. Enter the code above · Expires in ${Math.round((data.expiresIn || 600) / 60)} min
      </p>
    </div>
  `
}
function hideAuthBanner() {
  const banner = $('#auth-banner')
  if (banner) banner.style.display = 'none'
}

/* ---------- BOTS ---------- */
async function loadBots() {
  const grid = $('#bots-grid')
  if (!grid) return
  try {
    const data = await api('/api/bots')
    state.bots = data.bots || []
    state.servers = data.servers || state.servers
    if (!state.bots.length) {
      grid.innerHTML = `<div class="card placeholder" style="grid-column: 1 / -1; text-align: center; padding: 32px">No bots running. Tap <b>+ New bot</b> above.</div>`
      return
    }
    grid.innerHTML = state.bots.map(b => `
      <div class="card bot-card" data-bot="${escHtml(b.id)}" onclick="openBot('${escHtml(b.id)}')">
        <div class="bot-card-header">
          <div>
            <div class="bot-card-name">${escHtml(b.username || 'Unknown')}</div>
            <div class="bot-card-server">${escHtml(b.serverName || b.host || '')}</div>
          </div>
          <span class="badge ${b.status === 'online' ? 'risk-low' : b.status === 'kicked' ? 'risk-high' : ''}">${escHtml(b.status || 'idle')}</span>
        </div>
        <div class="bot-card-stats">
          <div class="bot-stat"><div class="bot-stat-label">Mode</div><div class="bot-stat-value">${escHtml(b.mode || 'idle')}</div></div>
          <div class="bot-stat"><div class="bot-stat-label">Mined</div><div class="bot-stat-value">${fmtNum(b.stats?.blocksMined || 0)}</div></div>
          <div class="bot-stat"><div class="bot-stat-label">Uptime</div><div class="bot-stat-value">${formatTime(b.stats?.uptime || 0)}</div></div>
        </div>
        <div class="bot-card-actions">
          ${b.status === 'online'
            ? `<button class="btn" onclick="event.stopPropagation();socket.emit('bot:action',{id:'${escHtml(b.id)}',action:'stop'})">Stop</button>`
            : `<button class="btn btn-primary" onclick="event.stopPropagation();socket.emit('bot:action',{id:'${escHtml(b.id)}',action:'mine'})">Start</button>`}
        </div>
      </div>
    `).join('')
  } catch (e) {
    grid.innerHTML = `<div class="card placeholder">${escHtml(e.message)}</div>`
  }
}

function openBot(botId) {
  const b = (state.bots || []).find(x => x.id === botId)
  if (!b) return
  navigate('playground')
  openBotFullscreen(b)
}

function openBotFullscreen(b) {
  state.fullscreenBotId = b.id
  let fs = $('#bot-fullscreen')
  if (fs) fs.remove()
  fs = document.createElement('div')
  fs.id = 'bot-fullscreen'
  fs.className = 'bot-fullscreen'
  fs.innerHTML = `
    <div class="bot-fullscreen-head">
      <b>${escHtml(b.username)}</b><span class="badge">${escHtml(b.serverName || '')} · ${escHtml(b.status)}</span>
      <button class="btn" onclick="this.closest('#bot-fullscreen').remove()">✕ Close</button>
    </div>
    <div class="bot-fullscreen-body">
      <div class="bot-fullscreen-left">
        <div style="margin-bottom: 10px; display: flex; flex-wrap: wrap; gap: 6px">
          <button class="btn btn-primary" onclick="socket.emit('bot:action',{id:'${b.id}',action:'mine'})">Mine</button>
          <button class="btn" onclick="socket.emit('bot:action',{id:'${b.id}',action:'afk'})">AFK</button>
          <button class="btn" onclick="socket.emit('bot:action',{id:'${b.id}',action:'explore'})">Explore</button>
          <button class="btn" onclick="socket.emit('bot:action',{id:'${b.id}',action:'mount'})">Mount</button>
          <button class="btn" style="background: var(--red); color: white; border-color: var(--red)" onclick="socket.emit('bot:action',{id:'${b.id}',action:'stop'})">Stop</button>
        </div>
        <div style="display: flex; flex-wrap: wrap; gap: 6px">
          <button class="btn" onclick="socket.emit('bot:action',{id:'${b.id}',action:'move',params:{dir:'forward'}})">Forward</button>
          <button class="btn" onclick="socket.emit('bot:action',{id:'${b.id}',action:'move',params:{dir:'left'}})">Left</button>
          <button class="btn" onclick="socket.emit('bot:action',{id:'${b.id}',action:'move',params:{dir:'back'}})">Back</button>
          <button class="btn" onclick="socket.emit('bot:action',{id:'${b.id}',action:'move',params:{dir:'right'}})">Right</button>
          <button class="btn" onclick="socket.emit('bot:action',{id:'${b.id}',action:'move',params:{dir:'jump'}})">Jump</button>
          <button class="btn" onclick="socket.emit('bot:action',{id:'${b.id}',action:'move',params:{dir:'sneak'}})">Sneak</button>
          <button class="btn" onclick="socket.emit('bot:action',{id:'${b.id}',action:'move',params:{dir:'sprint'}})">Sprint</button>
        </div>
        <div style="margin-top: 14px; padding: 12px; border-radius: 8px; background: var(--bg); border: 1px solid var(--border)">
          <div style="font-size: 11px; color: var(--text3); margin-bottom: 6px; letter-spacing: 0.06em; text-transform: uppercase; font-weight: 600">Activity</div>
          <div id="fs-activity" style="max-height: 160px; overflow-y: auto; font-family: var(--mono); font-size: 12px; line-height: 1.5">
            ${((b.chatLog || []).slice(-30).map(e => {
              const m = typeof e === 'string' ? e : (e.msg || JSON.stringify(e))
              return `<div style="padding: 2px 0">${escHtml(m)}</div>`
            }).join('')) || '<div style="color: var(--text3)">No activity yet.</div>'}
          </div>
        </div>
        <div style="margin-top: 10px; display: flex; gap: 6px">
          <input id="fs-chat-input" type="text" placeholder="Type chat as ${escHtml(b.username)}…" style="flex: 1; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg); color: var(--text)" />
          <button class="btn btn-primary" onclick="fsChat('${b.id}')">Send</button>
        </div>
      </div>
      <div class="bot-fullscreen-right">
        <div class="bot-terminal">
          <div class="term-stat"><span class="term-label">Status</span><b id="fs-status">${escHtml(b.status || '—')}</b></div>
          <div class="term-stat"><span class="term-label">Mode</span><b id="fs-mode">${escHtml(b.mode || 'idle')}</b></div>
          <div class="term-stat"><span class="term-label">Position</span><b id="fs-pos">${b.position ? `${b.position.x}, ${b.position.y}, ${b.position.z}` : '—'}</b></div>
          <div class="term-stat"><span class="term-label">Health</span><b id="fs-health">${b.health != null ? b.health : '—'}</b></div>
          <div class="term-stat"><span class="term-label">Food</span><b id="fs-food">${b.food != null ? b.food : '—'}</b></div>
          <div class="term-stat"><span class="term-label">Dimension</span><b id="fs-dim">${escHtml(b.dimension || '—')}</b></div>
          <div class="term-stat"><span class="term-label">Blocks mined</span><b>${fmtNum(b.stats?.blocksMined || 0)}</b></div>
          <div class="term-stat"><span class="term-label">Uptime</span><b>${formatTime(b.stats?.uptime || 0)}</b></div>
        </div>
        <p style="margin-top: 8px; color: var(--text3); font-size: 12px">Live telemetry from the bot. Values refresh as the bot reports health and position updates.</p>
      </div>
    </div>
  `
  document.body.appendChild(fs)
  const inp = $('#fs-chat-input')
  if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter') fsChat(b.id) })
  updateFullscreenState(b)
}

function updateFullscreenState(b) {
  if (state.fullscreenBotId !== b.id) return
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v }
  set('fs-status', b.status || '—')
  set('fs-mode', b.mode || 'idle')
  set('fs-pos', b.position ? `${b.position.x}, ${b.position.y}, ${b.position.z}` : '—')
  set('fs-health', b.health != null ? b.health : '—')
  set('fs-food', b.food != null ? b.food : '—')
  set('fs-dim', b.dimension || '—')
}

function fsChat(botId) {
  const inp = $('#fs-chat-input')
  if (!inp) return
  const msg = inp.value.trim()
  if (!msg) return
  socket.emit('bot:action', { id: botId, action: 'chat', params: { message: msg } })
  inp.value = ''
}

/* ---------- SERVERS ---------- */
function openAddServer() {
  const overlay = $('#modal-overlay')
  const container = $('#modal-container')
  if (!overlay || !container) return
  container.innerHTML = `
    <div class="modal-box">
      <div class="modal-head">
        <h3>Add server</h3>
        <button class="modal-close-btn" onclick="closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group"><label class="form-label">Name</label><input class="form-input" id="srv-name" placeholder="e.g. My SMP" /></div>
        <div class="form-group"><label class="form-label">Host</label><input class="form-input" id="srv-host" placeholder="mc.example.com" /></div>
        <div class="form-group"><label class="form-label">Port</label><input class="form-input" id="srv-port" type="number" value="25565" /></div>
        <div class="form-group"><label class="form-label">Version</label><input class="form-input" id="srv-version" value="1.21.4" /></div>
        <p id="srv-error" style="color: var(--down); font-size: 12px; display: none"></p>
      </div>
      <div class="modal-foot">
        <button class="btn" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="addServer()">Add</button>
      </div>
    </div>
  `
  overlay.style.display = 'flex'
  const name = $('#srv-name')
  if (name) name.focus()
}

function closeModal() {
  const overlay = $('#modal-overlay')
  if (overlay) overlay.style.display = 'none'
}

function addServer() {
  const name = $('#srv-name')?.value.trim()
  const host = $('#srv-host')?.value.trim()
  const port = parseInt($('#srv-port')?.value, 10) || 25565
  const version = $('#srv-version')?.value.trim() || '1.21.4'
  const errEl = $('#srv-error')
  if (!name || !host) {
    if (errEl) { errEl.textContent = 'Name and host are required.'; errEl.style.display = 'block' }
    return
  }
  socket.emit('server:add', { name, host, port, version })
  closeModal()
}

function openEditServer(id) {
  const s = (state.servers || []).find(x => x.id === id)
  if (!s) return
  const overlay = $('#modal-overlay')
  const container = $('#modal-container')
  if (!overlay || !container) return
  container.innerHTML = `
    <div class="modal-box">
      <div class="modal-head">
        <h3>Edit server</h3>
        <button class="modal-close-btn" onclick="closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group"><label class="form-label">Name</label><input class="form-input" id="srv-name" value="${escHtml(s.name)}" /></div>
        <div class="form-group"><label class="form-label">Host</label><input class="form-input" id="srv-host" value="${escHtml(s.host)}" /></div>
        <div class="form-group"><label class="form-label">Port</label><input class="form-input" id="srv-port" type="number" value="${s.port || 25565}" /></div>
        <div class="form-group"><label class="form-label">Version</label><input class="form-input" id="srv-version" value="${escHtml(s.version || '1.21.4')}" /></div>
        <p id="srv-error" style="color: var(--down); font-size: 12px; display: none"></p>
      </div>
      <div class="modal-foot">
        <button class="btn" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="updateServer('${escHtml(id)}')">Save</button>
      </div>
    </div>
  `
  overlay.style.display = 'flex'
}

function updateServer(id) {
  const name = $('#srv-name')?.value.trim()
  const host = $('#srv-host')?.value.trim()
  const port = parseInt($('#srv-port')?.value, 10) || 25565
  const version = $('#srv-version')?.value.trim() || '1.21.4'
  const errEl = $('#srv-error')
  if (!name || !host) {
    if (errEl) { errEl.textContent = 'Name and host are required.'; errEl.style.display = 'block' }
    return
  }
  socket.emit('server:update', { id, name, host, port, version })
  closeModal()
}

async function loadServers() {
  const grid = $('#servers-grid')
  if (!grid) return
  try {
    const data = await api('/api/servers')
    state.servers = data.servers || []
    if (!state.servers.length) {
      grid.innerHTML = `<div class="card placeholder" style="grid-column: 1 / -1">No servers configured.</div>`
      return
    }
    grid.innerHTML = state.servers.map(s => `
      <div class="card server-card">
        <div class="bot-card-header">
          <div>
            <div class="bot-card-name">${escHtml(s.name || s.id)}</div>
            <div class="bot-card-server">${escHtml(s.host)}:${s.port || 25565}</div>
          </div>
          <div style="display: flex; gap: 6px">
            <button class="btn" onclick="openEditServer('${escHtml(s.id)}')">Edit</button>
            <button class="btn" onclick="socket.emit('server:remove',{id:'${escHtml(s.id)}'})">Remove</button>
          </div>
        </div>
        ${s.version ? `<div class="bot-stat" style="margin-top: 8px"><div class="bot-stat-label">Version</div><div class="bot-stat-value">${escHtml(s.version)}</div></div>` : ''}
      </div>
    `).join('')
  } catch (e) {
    grid.innerHTML = `<div class="card placeholder">${escHtml(e.message)}</div>`
  }
}

/* ---------- PLAYGROUND ---------- */
function loadPlayground() {
  // The playground opens via openBot() → openBotFullscreen(). Nothing to render
  // here — the "pick a bot" placeholder lives in the static HTML.
}

/* ---------- SOCKET ---------- */
const socket = io()

socket.on('init', data => {
  state.servers = data.servers || []
  state.bots = data.bots || []
  if (typeof navigate === 'function') navigate(state.view || 'dashboard')
})

socket.on('bot:event', data => {
  const bot = (state.bots || []).find(b => b.id === data.botId)
  if (!bot) return
  switch (data.event) {
    case 'status': bot.status = data.data; break
    case 'mode':   bot.mode   = data.data; break
    case 'health':
      bot.health = data.data?.health ?? null
      bot.food = data.data?.food ?? null
      break
    case 'auth':
      if (data.data.status === 'auth_required') {
        showAuthBanner(data.data, bot.username)
        navigate('dashboard')
      } else if (data.data.status === 'authenticated') {
        hideAuthBanner()
        toast(`Authenticated ${bot.username}`)
      }
      break
    case 'chat':
    case 'log':
      if (!bot.chatLog) bot.chatLog = []
      bot.chatLog.push(data.data)
      if (bot.chatLog.length > 200) bot.chatLog.shift()
      break
  }
  // Live refresh of any open fullscreen terminal
  if (typeof updateFullscreenState === 'function') updateFullscreenState(bot)
  if (typeof loadBots === 'function') loadBots()
  if (typeof loadDashboard === 'function') loadDashboard()
})

socket.on('bot:created', data => {
  toast(`Bot created: ${data.username || data.id}`)
  navigate('bots')
})

socket.on('bot:error', data => {
  toast(`Bot error: ${data.error}`, true)
  navigate('dashboard')
})

socket.on('server:added', () => {
  toast('Server added')
  loadServers()
  loadDashboard()
})

socket.on('servers:updated', servers => {
  state.servers = servers || state.servers
  if (state.view === 'servers') loadServers()
  if (state.view === 'dashboard') loadDashboard()
})

socket.on('server:removed', () => {
  toast('Server removed')
  loadServers()
})

socket.on('server:error', data => {
  toast(data.error || 'Server error', true)
})

socket.on('connect_error', () => {
  const el = $('#feed-status')
  if (el) el.textContent = 'Reconnecting'
})

// Auto-refresh active view
setInterval(() => {
  if (document.hidden) return
  if (state.view === 'dashboard') loadDashboard()
  else if (state.view === 'bots') loadBots()
  else if (state.view === 'servers') loadServers()
}, 45000)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return
  if (state.view === 'dashboard') loadDashboard()
  else if (state.view === 'bots') loadBots()
  else if (state.view === 'servers') loadServers()
})

/* ---------- BOOT ---------- */
bindQuickLogin()
const initial = location.hash.slice(1)
if (titles[initial]) navigate(initial)
else navigate('dashboard')
loadDashboard()
