// State
let token = localStorage.getItem('relay_token') || '';
let pin = '';
let screenInterval = null;
let monitorInterval = null;
let currentTab = 'commander';
let screenQuality = 'medium';

// ── AUTH ──

async function authFetch(url, options = {}) {
  const headers = { ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (options.body && typeof options.body === 'string') headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) { logout(); throw new Error('Session expired'); }
  return res;
}

function pinInput(n) {
  if (pin.length >= 6) return;
  pin += n;
  updatePinDots();
  if (navigator.vibrate) navigator.vibrate(10);
  if (pin.length === 6) setTimeout(attemptLogin, 200);
}

function pinDelete() {
  pin = pin.slice(0, -1);
  updatePinDots();
}

function updatePinDots() {
  const dots = document.querySelectorAll('#pin-dots .dot');
  dots.forEach((d, i) => {
    d.classList.toggle('filled', i < pin.length);
  });
}

async function attemptLogin() {
  try {
    const res = await fetch('/remote/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin })
    });
    const data = await res.json();
    if (data.success && data.token) {
      token = data.token;
      localStorage.setItem('relay_token', token);
      showApp();
    } else {
      showLoginError(data.error || 'PIN incorrect');
      pin = '';
      updatePinDots();
      // Shake animation
      document.querySelector('.pin-dots').classList.add('shake');
      setTimeout(() => document.querySelector('.pin-dots').classList.remove('shake'), 500);
    }
  } catch (e) {
    showLoginError('Connexion impossible');
    pin = '';
    updatePinDots();
  }
}

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 3000);
}

function logout() {
  token = '';
  localStorage.removeItem('relay_token');
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app-screen').classList.add('hidden');
  pin = '';
  updatePinDots();
  stopAllIntervals();
}

function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-screen').classList.remove('hidden');
  document.getElementById('status-dot').classList.add('online');
}

// ── TABS ──

function switchTab(name) {
  // Stop intervals from previous tab
  stopAllIntervals();

  currentTab = name;
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  document.querySelector(`[data-tab="${name}"]`).classList.add('active');

  // Tab-specific init
  if (name === 'monitor') startMonitor();
  if (name === 'files') { if (!document.getElementById('files-list').children.length) loadFiles('~'); }
  if (name === 'screen') captureScreen();
}

function stopAllIntervals() {
  if (screenInterval) { clearInterval(screenInterval); screenInterval = null; }
  if (monitorInterval) { clearInterval(monitorInterval); monitorInterval = null; }
}

// ── COMMANDER TAB ──

async function executeCommand() {
  const input = document.getElementById('command-input');
  const order = input.value.trim();
  if (!order) return;

  const resultEl = document.getElementById('command-result');
  resultEl.classList.remove('hidden');
  resultEl.textContent = '⏳ Execution...';

  try {
    const res = await authFetch('/remote/command', {
      method: 'POST', body: JSON.stringify({ order })
    });
    const data = await res.json();
    resultEl.textContent = data.success
      ? JSON.stringify(data.results, null, 2)
      : 'Erreur: ' + (data.error || 'Unknown');
    addHistory('🎯 ' + order.slice(0, 40));
    input.value = '';
  } catch (e) {
    resultEl.textContent = '❌ ' + e.message;
  }
}

function startVoice() {
  if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
    showToast('Speech non supporté', 'error');
    return;
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new SR();
  recognition.lang = 'fr-FR';
  recognition.interimResults = false;
  const btn = document.getElementById('btn-voice');
  btn.classList.add('recording');
  recognition.onresult = (e) => {
    document.getElementById('command-input').value = e.results[0][0].transcript;
    btn.classList.remove('recording');
  };
  recognition.onerror = () => btn.classList.remove('recording');
  recognition.onend = () => btn.classList.remove('recording');
  recognition.start();
}

// ── QUICK ACTIONS ──

async function quickScreen() {
  const btn = document.querySelector('[data-action="screen"]');
  if (btn) { btn.textContent = '⏳...'; btn.disabled = true; }
  try {
    const res = await authFetch('/remote/screenshot');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    showImageLightbox(URL.createObjectURL(blob));
    addHistory('📸 Screenshot');
  } catch (e) { showToast('❌ ' + e.message, 'error'); }
  finally { if (btn) { btn.textContent = '📸 Screen'; btn.disabled = false; } }
}

async function quickCamera() {
  const btn = document.querySelector('[data-action="camera"]');
  if (btn) { btn.textContent = '⏳...'; btn.disabled = true; }
  try {
    const res = await authFetch('/remote/camera/photo');
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Camera unavailable');
    }
    const blob = await res.blob();
    showImageLightbox(URL.createObjectURL(blob));
    addHistory('📷 Camera');
  } catch (e) { showToast('❌ ' + e.message, 'error'); }
  finally { if (btn) { btn.textContent = '📷 Camera'; btn.disabled = false; } }
}

async function quickClipboard() {
  try {
    const res = await authFetch('/remote/mac/clipboard');
    const data = await res.json();
    showToast('📋 ' + (data.text || '').slice(0, 50), 'info');
    addHistory('📋 Clipboard');
  } catch (e) { showToast('❌ ' + e.message, 'error'); }
}

async function quickStatus() {
  try {
    const res = await authFetch('/remote/mac/status');
    const d = await res.json();
    showToast(`⚡ ${d.battery || '?'} | ${(d.apps||[]).length} apps | Claude: ${d.claudeRunning ? '✅' : '❌'}`, 'info');
    addHistory('⚡ Status');
  } catch (e) { showToast('❌ ' + e.message, 'error'); }
}

async function quickLock() {
  if (!confirm('Verrouiller le Mac ?')) return;
  try {
    await authFetch('/remote/mac/lock', { method: 'POST', body: '{}' });
    showToast('🔒 Mac verrouillé', 'success');
  } catch (e) { showToast('❌ ' + e.message, 'error'); }
}

function quickVolume() {
  switchTab('controls');
}

// ── IMAGE LIGHTBOX ──

function showImageLightbox(url) {
  const overlay = document.createElement('div');
  overlay.className = 'lightbox';
  overlay.innerHTML = `
    <img src="${url}" class="lightbox-img"/>
    <div class="lightbox-actions">
      <button class="lb-btn green" onclick="downloadImage('${url}')">⬇ Download</button>
      <button class="lb-btn" onclick="this.closest('.lightbox').remove()">✕ Close</button>
    </div>
  `;
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

function downloadImage(url) {
  const a = document.createElement('a');
  a.href = url; a.download = 'capture-' + Date.now() + '.png';
  a.click();
}

// ── SCREEN TAB ──

async function captureScreen() {
  const img = document.getElementById('screen-img');
  try {
    const q = document.getElementById('screen-quality')?.value || 'medium';
    const res = await authFetch(`/remote/vision/screenshot?quality=${q}&format=jpeg`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const old = img.src;
    img.src = url;
    if (old && old.startsWith('blob:')) URL.revokeObjectURL(old);
  } catch (e) { console.error('Screen capture error:', e); }
}

function toggleScreenStream() {
  const btn = document.getElementById('btn-stream');
  if (screenInterval) {
    clearInterval(screenInterval);
    screenInterval = null;
    btn.textContent = '▶ Stream';
    btn.classList.remove('active');
  } else {
    const fps = 2; // 2 FPS for mobile
    let frameCount = 0;
    const startTime = Date.now();
    screenInterval = setInterval(async () => {
      await captureScreen();
      frameCount++;
      const elapsed = (Date.now() - startTime) / 1000;
      const hud = document.getElementById('screen-hud');
      if (hud) hud.textContent = Math.round(frameCount / elapsed) + ' fps';
    }, 1000 / fps);
    btn.textContent = '⏹ Stop';
    btn.classList.add('active');
  }
}

function updateScreenQuality() {
  screenQuality = document.getElementById('screen-quality').value;
  if (screenInterval) captureScreen();
}

function handleScreenClick(event) {
  const img = event.target;
  const rect = img.getBoundingClientRect();
  const xRel = (event.clientX - rect.left) / rect.width;
  const yRel = (event.clientY - rect.top) / rect.height;
  // Mac retina resolution approximation
  const x = Math.round(xRel * 2560);
  const y = Math.round(yRel * 1600);

  // Visual ripple
  const ripple = document.createElement('div');
  ripple.className = 'click-ripple';
  ripple.style.left = event.clientX + 'px';
  ripple.style.top = event.clientY + 'px';
  document.body.appendChild(ripple);
  setTimeout(() => ripple.remove(), 600);

  authFetch('/remote/mouse/click', { method: 'POST', body: JSON.stringify({ x, y }) }).catch(() => {});
  // Refresh screen after click
  setTimeout(captureScreen, 500);
}

// ── CLAUDE TAB ──

function showSubTab(name) {
  document.querySelectorAll('.sub-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.sub-tab').forEach(b => b.classList.remove('active'));
  document.getElementById('sub-' + name).classList.add('active');
  event.target.classList.add('active');
}

async function loadClaudeSessions() {
  const el = document.getElementById('sessions-list');
  el.innerHTML = '<p class="empty-msg">Chargement...</p>';
  try {
    const res = await authFetch('/remote/claude/sessions');
    const sessions = await res.json();
    if (!sessions || sessions.length === 0) {
      el.innerHTML = '<p class="empty-msg">Aucune session</p>';
      return;
    }
    el.innerHTML = sessions.map(s => `
      <div class="list-item" onclick="showToast('Session: ${(s.title||'').slice(0,30)}','info')">
        <span class="item-title">${s.title || 'Sans titre'}</span>
        <span class="item-meta">${s.id || ''}</span>
      </div>
    `).join('');
  } catch (e) { el.innerHTML = `<p class="empty-msg" style="color:#ff453a">${e.message}</p>`; }
}

async function loadClaudeProjects() {
  const el = document.getElementById('projects-list');
  el.innerHTML = '<p class="empty-msg">Chargement...</p>';
  try {
    const res = await authFetch('/remote/claude/projects');
    const projects = await res.json();
    if (!projects || projects.length === 0) {
      el.innerHTML = '<p class="empty-msg">Aucun projet</p>';
      return;
    }
    el.innerHTML = projects.map(p => `
      <div class="list-item">
        <span class="item-title">${p.name || 'Sans nom'}</span>
        <span class="item-meta">${p.id || ''}</span>
      </div>
    `).join('');
  } catch (e) { el.innerHTML = `<p class="empty-msg" style="color:#ff453a">${e.message}</p>`; }
}

// ── FILES TAB ──

async function loadFiles(dirPath) {
  const el = document.getElementById('files-list');
  document.getElementById('file-breadcrumb').textContent = dirPath;
  el.innerHTML = '<p class="empty-msg">Chargement...</p>';
  try {
    const res = await authFetch(`/remote/files/list?path=${encodeURIComponent(dirPath)}`);
    const data = await res.json();
    const files = data.files || [];
    if (files.length === 0) { el.innerHTML = '<p class="empty-msg">Dossier vide</p>'; return; }

    // Sort: dirs first, then files
    files.sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name));

    el.innerHTML = files.map(f => {
      const icon = f.isDir ? '📁' : getFileIcon(f.name);
      const size = f.isDir ? '' : formatBytes(f.size || 0);
      const click = f.isDir
        ? `loadFiles('${f.path.replace(/'/g, "\\'")}')`
        : `previewFile('${f.path.replace(/'/g, "\\'")}', '${f.name}')`;
      return `<div class="file-item" onclick="${click}">
        <span class="file-icon">${icon}</span>
        <div class="file-info"><div class="file-name">${f.name}</div><div class="file-meta">${size}</div></div>
      </div>`;
    }).join('');
  } catch (e) { el.innerHTML = `<p class="empty-msg" style="color:#ff453a">${e.message}</p>`; }
}

function getFileIcon(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const m = { pdf:'📄',jpg:'🖼',jpeg:'🖼',png:'🖼',gif:'🎞',mp4:'🎬',mov:'🎬',mp3:'🎵',zip:'🗜',json:'📋',js:'📜',py:'🐍',sh:'⚙️',txt:'📝',md:'📝',html:'🌐',css:'🎨',ts:'📜' };
  return m[ext] || '📄';
}

async function previewFile(path, name) {
  try {
    const res = await authFetch(`/remote/files/read?path=${encodeURIComponent(path)}`);
    const data = await res.json();
    const content = data.content || '';
    // Show in lightbox-style overlay
    const overlay = document.createElement('div');
    overlay.className = 'lightbox';
    overlay.innerHTML = `
      <div class="file-preview">
        <div class="fp-header"><span>${name}</span><button onclick="this.closest('.lightbox').remove()">✕</button></div>
        <pre class="fp-content">${content.slice(0, 5000).replace(/</g,'&lt;')}</pre>
      </div>
    `;
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  } catch (e) { showToast('❌ ' + e.message, 'error'); }
}

// ── MONITOR TAB ──

async function refreshMonitor() {
  try {
    const res = await authFetch('/remote/mac/status');
    const d = await res.json();
    document.getElementById('mon-cpu').textContent = (d.cpu || '--').replace(/.*?(\d+\.\d+%).*/, '$1');
    document.getElementById('mon-battery').textContent = d.battery || '--';
    document.getElementById('mon-disk').textContent = (d.disk || '--').replace(/.*?(\d+%).*/, '$1 used');
    document.getElementById('mon-uptime').textContent = formatDuration(d.uptime || 0);
    document.getElementById('mon-claude').textContent = d.claudeRunning ? '✅ Running' : '⭕ Stopped';
    document.getElementById('mon-apps').textContent = Array.isArray(d.apps) ? d.apps.slice(0, 10).join(', ') : (d.apps || '--');
  } catch {}
}

function startMonitor() {
  refreshMonitor();
  monitorInterval = setInterval(refreshMonitor, 5000);
}

// ── CONTROLS TAB ──

async function setVolume(val) {
  try { await authFetch('/remote/mac/volume', { method: 'POST', body: JSON.stringify({ level: parseInt(val) }) }); }
  catch (e) { showToast('❌ ' + e.message, 'error'); }
}

async function lockMac() {
  if (!confirm('Verrouiller le Mac ?')) return;
  await authFetch('/remote/mac/lock', { method: 'POST', body: '{}' }).catch(() => {});
  showToast('🔒 Verrouillé', 'success');
}

async function sleepMac() {
  if (!confirm('Mettre en veille ?')) return;
  await authFetch('/remote/mac/shell', { method: 'POST', body: JSON.stringify({ command: 'pmset sleepnow' }) }).catch(() => {});
}

async function sendKeyboard() {
  const text = document.getElementById('kb-input').value;
  if (!text) return;
  await authFetch('/remote/keyboard/type', { method: 'POST', body: JSON.stringify({ text }) });
  showToast('⌨️ Envoyé', 'success');
  document.getElementById('kb-input').value = '';
}

async function sendShortcut(combo) {
  await authFetch('/remote/keyboard/shortcut', { method: 'POST', body: JSON.stringify({ combo }) });
  showToast('✅ ' + combo, 'success');
}

async function sendNotif() {
  const title = document.getElementById('notif-title').value;
  const message = document.getElementById('notif-msg').value;
  if (!title && !message) return;
  await authFetch('/remote/mac/notification', { method: 'POST', body: JSON.stringify({ title, message }) });
  showToast('📢 Envoyé', 'success');
  document.getElementById('notif-title').value = '';
  document.getElementById('notif-msg').value = '';
}

// ── UTILITIES ──

function showToast(msg, type = 'info') {
  const colors = { success: '#30d158', error: '#ff453a', info: '#0a84ff' };
  const toast = document.createElement('div');
  toast.style.cssText = `position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:${colors[type]||colors.info};color:#fff;padding:10px 24px;border-radius:24px;font-size:14px;font-weight:600;z-index:9999;white-space:nowrap;box-shadow:0 8px 30px rgba(0,0,0,0.4);animation:toastIn .3s ease;`;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.animation = 'toastOut .3s ease'; setTimeout(() => toast.remove(), 300); }, 2500);
}

function addHistory(label) {
  const el = document.getElementById('history-list');
  if (!el) return;
  const item = document.createElement('div');
  item.className = 'history-item';
  item.innerHTML = `<span>${label}</span><span class="hist-time">${new Date().toLocaleTimeString()}</span>`;
  el.insertBefore(item, el.firstChild);
  while (el.children.length > 15) el.removeChild(el.lastChild);
}

function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

function formatDuration(s) {
  s = Math.floor(s);
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
  return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
}

// ── INIT ──

document.addEventListener('DOMContentLoaded', async () => {
  // Update clock
  setInterval(() => {
    const el = document.getElementById('header-time');
    if (el) el.textContent = new Date().toLocaleTimeString();
  }, 1000);

  // Check existing token
  if (token) {
    try {
      const res = await fetch('/remote/health', { headers: { Authorization: 'Bearer ' + token } });
      if (res.ok) { showApp(); return; }
    } catch {}
  }
  // Show login
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app-screen').classList.add('hidden');

  // Unregister old SW + clear caches
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister()));
    caches.keys().then(keys => keys.forEach(k => caches.delete(k)));
  }
});
