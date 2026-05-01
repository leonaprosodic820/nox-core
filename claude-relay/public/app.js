const state = {
  currentSessionId: null,
  currentIteration: 0,
  instances: new Map(),
  ws: null,
  wsReconnectAttempts: 0,
  wsMaxReconnect: 10
};

let nextCliNumber = 1;
const API = '';
const COLORS = ['#58a6ff','#3fb950','#f85149','#d29922','#bc8cff','#f778ba','#79c0ff','#56d364','#ff7b72','#e3b341','#f0883e','#a5d6ff'];

function generateInstanceColor(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash) + id.charCodeAt(i);
  return COLORS[Math.abs(hash) % COLORS.length];
}

function init() {
  loadSessions();
  connectWS();
  if (Notification.permission === 'default') Notification.requestPermission();
  setInterval(updateRelativeTimestamps, 10000);
}

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  state.ws = new WebSocket(`${proto}//${location.host}`);
  state.ws.onopen = () => {
    state.wsReconnectAttempts = 0;
    updateWSStatus(true);
  };
  state.ws.onclose = () => {
    updateWSStatus(false);
    if (state.wsReconnectAttempts < state.wsMaxReconnect) {
      const delay = 2000 * Math.pow(1.5, state.wsReconnectAttempts);
      state.wsReconnectAttempts++;
      setTimeout(connectWS, delay);
    }
  };
  state.ws.onerror = () => updateWSStatus(false);
  state.ws.onmessage = (e) => {
    try { dispatchWSEvent(JSON.parse(e.data)); } catch {}
  };
}

function updateWSStatus(connected) {
  document.querySelectorAll('[id^="ws-indicator"]').forEach(el => {
    el.classList.toggle('ws-on', connected);
    el.classList.toggle('ws-off', !connected);
  });
}

function dispatchWSEvent(data) {
  if (data.instanceId && data.event !== 'connected') {
    switch (data.event) {
      case 'analyzed':
        showInstanceSubPanel(data.instanceId, data.analysis);
        updateInstanceStatus(data.instanceId, 'waiting_result');
        notifyBrowser(`${data.label} \u2014 Analyse terminee`);
        break;
      case 'result_saved':
        updateInstanceStatus(data.instanceId, 'idle');
        notifyBrowser(`${data.label} \u2014 Resultat recu`);
        break;
      case 'instance_registered':
        if (data.instance) addInstancePanel(data.instance);
        break;
      case 'instance_removed':
        removeInstancePanel(data.instanceId);
        break;
    }
    updateHistory();
    return;
  }
  switch (data.event) {
    case 'analyzed':
      if (data.sessionId === state.currentSessionId) showDirectSubPanels(data.analysis);
      break;
    case 'result_saved':
      if (data.sessionId === state.currentSessionId) {
        state.currentIteration++;
        document.getElementById('sess-iter').textContent = state.currentIteration;
      }
      break;
    case 'session_completed':
      if (data.sessionId === state.currentSessionId) goHome();
      break;
  }
  updateHistory();
}

function notifyBrowser(body) {
  if (document.hidden && Notification.permission === 'granted') {
    new Notification('Claude Relay', { body });
  }
}

async function loadSessions() {
  const res = await fetch(`${API}/sessions`);
  const sessions = await res.json();
  const list = document.getElementById('session-list');
  if (sessions.length === 0) {
    list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)"><p style="font-size:40px;margin-bottom:12px">\uD83D\uDCC2</p><p>Aucune session. Cree ton premier projet.</p></div>';
    return;
  }
  list.innerHTML = sessions.map(s => `
    <div class="session-item">
      <div>
        <strong>${esc(s.name)}</strong>
        <div class="session-meta">
          <span>${s.id.slice(0,8)}</span>
          <span>Cree le ${new Date(s.createdAt).toLocaleDateString('fr-FR')}</span>
          <span>Iterations: ${s.currentIteration}</span>
          <span class="badge ${s.status==='active'?'badge-green':'badge-grey'}">${s.status}</span>
        </div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn-primary btn-sm" onclick="loadSession('${s.id}')">&#x25B6; Reprendre</button>
        <button class="btn-ghost btn-sm" onclick="if(confirm('Supprimer cette session ?'))deleteSessionFile('${s.id}')">&#x1F5D1;</button>
      </div>
    </div>
  `).join('');
}

async function createSession() {
  const input = document.getElementById('new-session-name');
  const name = input.value.trim();
  if (!name) { input.classList.add('shake'); setTimeout(() => input.classList.remove('shake'), 300); return; }
  const res = await fetch(`${API}/sessions/new`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})});
  const data = await res.json();
  loadSession(data.id);
}

async function loadSession(id) {
  const res = await fetch(`${API}/sessions/${id}`);
  const session = await res.json();
  state.currentSessionId = id;
  state.currentIteration = session.currentIteration;

  document.getElementById('sess-name').textContent = session.name;
  document.getElementById('sess-id').textContent = id.slice(0,8);
  document.getElementById('sess-iter').textContent = state.currentIteration;
  document.getElementById('sess-status').textContent = session.status.toUpperCase();
  document.getElementById('sess-status').className = `badge ${session.status==='active'?'badge-green':'badge-grey'}`;

  hide('screen-home'); show('screen-session');
  renderHistory(session.iterations);
  loadInstances();
}

function goHome() {
  state.currentSessionId = null;
  state.instances.clear();
  hide('screen-session'); show('screen-home');
  document.getElementById('instances-grid').innerHTML = '';
  document.getElementById('instances-sidebar').innerHTML = '';
  hide('direct-panel');
  loadSessions();
}

async function deleteSessionFile(id) {
  await fetch(`${API}/sessions/${id}/complete`, {method:'POST',headers:{'Content-Type':'application/json'}});
  loadSessions();
}

// ── INSTANCES ──

async function loadInstances() {
  const res = await fetch(`${API}/instances`);
  const list = await res.json();
  const filtered = list.filter(i => i.sessionId === state.currentSessionId);
  state.instances.clear();
  document.getElementById('instances-sidebar').innerHTML = '';
  document.getElementById('instances-grid').innerHTML = '';
  filtered.forEach(i => addInstancePanel(i));
  nextCliNumber = filtered.length > 0 ? Math.max(...filtered.map(i => i.cliNumber)) + 1 : 1;
  document.getElementById('modal-cli-number').value = nextCliNumber;
}

function showNewInstanceModal() {
  document.getElementById('modal-project-name').value = '';
  document.getElementById('modal-cli-number').value = nextCliNumber;
  show('modal-new-instance');
  document.getElementById('modal-project-name').focus();
}

async function registerInstance() {
  const projectName = document.getElementById('modal-project-name').value.trim();
  const cliNumber = parseInt(document.getElementById('modal-cli-number').value, 10);
  if (!projectName) return;

  const res = await fetch(`${API}/instances/register`, {
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({projectName, cliNumber, sessionId: state.currentSessionId})
  });
  const data = await res.json();
  if (!data.already_exists) {
    const instRes = await fetch(`${API}/instances`);
    const all = await instRes.json();
    const inst = all.find(i => i.instanceId === data.instanceId);
    if (inst) addInstancePanel(inst);
  }
  hide('modal-new-instance');
  nextCliNumber = cliNumber + 1;
}

function addInstancePanel(inst) {
  state.instances.set(inst.instanceId, inst);
  const color = generateInstanceColor(inst.instanceId);

  const sidebar = document.getElementById('instances-sidebar');
  if (!document.getElementById(`sb-${inst.instanceId}`)) {
    const card = document.createElement('div');
    card.className = 'instance-card';
    card.id = `sb-${inst.instanceId}`;
    card.style.borderLeftColor = color;
    card.onclick = () => focusInstance(inst.instanceId);
    card.innerHTML = `
      <div class="inst-label">${esc(inst.label)}</div>
      <span class="badge ${statusBadge(inst.status)}" id="sb-status-${inst.instanceId}">${inst.status}</span>
      <div class="inst-time" data-ts="${Date.now()}" id="sb-time-${inst.instanceId}">maintenant</div>
      <button class="inst-close" onclick="event.stopPropagation();removeInstance('${inst.instanceId}')">&times;</button>
    `;
    sidebar.appendChild(card);
  }

  const grid = document.getElementById('instances-grid');
  if (!document.getElementById(`ip-${inst.instanceId}`)) {
    const panel = document.createElement('div');
    panel.className = 'instance-panel';
    panel.id = `ip-${inst.instanceId}`;
    panel.style.borderLeftColor = color;
    panel.style.borderColor = color;
    panel.innerHTML = buildInstancePanel(inst, color);
    grid.appendChild(panel);
  }
}

function buildInstancePanel(inst, color) {
  const id = inst.instanceId;
  return `
    <div class="ip-header">
      <h4 style="color:${color}">${esc(inst.label)}</h4>
      <div style="display:flex;gap:6px;align-items:center">
        <span class="badge ${statusBadge(inst.status)}" id="ip-status-${id}">${inst.status}</span>
        <span class="badge badge-blue hidden" id="ip-type-${id}"></span>
        <button class="btn-ghost btn-sm" onclick="removeInstance('${id}')">&times;</button>
      </div>
    </div>
    <div>
      <label style="font-size:12px;color:var(--text-muted);margin-bottom:6px;display:block">&#x1F4E5; Reponse Claude Chat</label>
      <textarea id="ip-input-${id}" rows="6" placeholder="Colle ici..."></textarea>
      <div style="display:flex;gap:8px;align-items:center;margin-top:8px">
        <button class="btn-primary btn-sm" onclick="analyzeInstance('${id}')">&#x1F50D; Analyser</button>
        <span id="ip-analysis-${id}" class="hidden" style="font-size:12px;color:var(--accent-blue)"></span>
      </div>
    </div>
    <div id="ip-sub-${id}" style="margin-top:12px"></div>
    <div class="ip-footer">
      <span>Session: ${esc((inst.sessionId||'').slice(0,8))}</span>
      <span class="inst-time" data-ts="${Date.now()}" id="ip-time-${id}">maintenant</span>
    </div>`;
}

async function analyzeInstance(instanceId) {
  const ta = document.getElementById(`ip-input-${instanceId}`);
  const text = ta.value.trim();
  if (!text) { ta.classList.add('shake'); setTimeout(() => ta.classList.remove('shake'), 300); return; }

  const res = await fetch(`${API}/instances/${instanceId}/ingest`, {
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})
  });
  const data = await res.json();
  const ar = document.getElementById(`ip-analysis-${instanceId}`);
  ar.textContent = `${data.analysis.type} (${data.analysis.confidence}%)`;
  ar.classList.remove('hidden');
  showInstanceSubPanel(instanceId, data.analysis);
  updateInstanceStatus(instanceId, 'waiting_result');
  updateHistory();
}

function showInstanceSubPanel(instanceId, analysis) {
  const container = document.getElementById(`ip-sub-${instanceId}`);
  if (!container) return;

  const typeBadge = document.getElementById(`ip-type-${instanceId}`);
  if (typeBadge) {
    typeBadge.textContent = analysis.type.toUpperCase();
    typeBadge.classList.remove('hidden');
    const bm = {prompt:'badge-blue',question:'badge-purple',options:'badge-yellow',tests:'badge-green',confirmation:'badge-green',error:'badge-red',mixed:'badge-purple'};
    typeBadge.className = `badge ${bm[analysis.type]||'badge-blue'}`;
  }

  let html = '';
  const id = instanceId;

  if (analysis.elements.prompt) {
    html += `<div class="sub-panel"><div class="card glass" style="padding:16px">
      <div style="font-size:13px;font-weight:600;margin-bottom:8px">&#x1F4E4; Prompt &rarr; Claude Code</div>
      <textarea id="ip-prompt-${id}" rows="10" readonly class="mono">${esc(analysis.elements.prompt)}</textarea>
      <button class="btn-primary btn-sm" style="margin-top:8px" onclick="copyPrompt('${id}')">&#x1F4CB; Copier vers Claude Code</button>
    </div>
    <div class="card glass" style="padding:16px;margin-top:8px">
      <div style="font-size:13px;font-weight:600;margin-bottom:8px">&#x1F4E5; Resultat &larr; Claude Code</div>
      <textarea id="ip-result-${id}" rows="8" placeholder="Colle le resultat..." class="mono"></textarea>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn-success btn-sm" onclick="submitInstanceResult('${id}')">&#x2705; Soumettre</button>
        <button class="btn-ghost btn-sm" onclick="completeSession()">&#x1F3C1; Completer</button>
      </div>
    </div></div>`;
  }

  if (analysis.elements.options) {
    html += `<div class="sub-panel"><div class="card glass" style="padding:16px;margin-top:8px">
      <div style="font-size:13px;font-weight:600;margin-bottom:8px">&#x26A0;&#xFE0F; Choisis une option</div>
      <div class="radio-group">`;
    analysis.elements.options.forEach(o => {
      html += `<label><input type="radio" name="opt-${id}" value="${esc(o.label)}" ${o.recommended?'checked':''}><span><strong>${esc(o.label)}</strong> &mdash; ${esc(o.description)} ${o.recommended?'<span class="badge badge-yellow">\u2B50 Recommande</span>':''}</span></label>`;
    });
    html += `</div><button class="btn-success btn-sm" style="margin-top:8px" onclick="chooseInstanceOption('${id}')">&#x2705; Choisir</button></div></div>`;
  }

  if (analysis.elements.questions) {
    html += `<div class="sub-panel"><div class="card glass" style="padding:16px;margin-top:8px">
      <div style="font-size:13px;font-weight:600;margin-bottom:8px">&#x1F4AC; Questions</div>`;
    analysis.elements.questions.forEach((q, i) => {
      if (q.answerType === 'confirm') {
        html += `<div class="q-item"><label>Q${i+1}: ${esc(q.text)}</label><div class="confirm-btns" id="qcb-${id}-${i}"><button class="btn-success btn-sm" onclick="this.parentElement.dataset.answer='Oui';this.style.opacity=1;this.nextElementSibling.style.opacity=.4">Oui</button><button class="btn-danger btn-sm" onclick="this.parentElement.dataset.answer='Non';this.style.opacity=1;this.previousElementSibling.style.opacity=.4">Non</button></div></div>`;
      } else {
        html += `<div class="q-item"><label>Q${i+1}: ${esc(q.text)}</label><textarea rows="2" id="qa-${id}-${i}" placeholder="Reponse..." class="mono"></textarea></div>`;
      }
    });
    html += `<button class="btn-primary btn-sm" style="margin-top:8px" onclick="submitInstanceAnswers('${id}',${analysis.elements.questions.length})">&#x1F4E4; Generer la reponse</button>
      <textarea id="ip-answer-${id}" rows="3" readonly class="hidden mono" style="margin-top:8px"></textarea>
      <button id="ip-copy-answer-${id}" class="btn-success btn-sm hidden" style="margin-top:6px" onclick="copyToClipboard(document.getElementById('ip-answer-${id}').value,this)">&#x1F4CB; Copier</button>
    </div></div>`;
  }

  if (analysis.elements.tests) {
    html += `<div class="sub-panel"><div class="card glass" style="padding:16px;margin-top:8px">
      <div style="font-size:13px;font-weight:600;margin-bottom:8px">&#x1F9EA; Tests Chrome</div>
      <button class="btn-primary btn-sm" style="margin-bottom:8px" onclick="runAllInstanceTests('${id}',${analysis.elements.tests.length})">&#x25B6; Tout executer</button>`;
    analysis.elements.tests.forEach((t, i) => {
      html += `<div class="test-item"><div><strong>Step ${t.step}:</strong> ${esc(t.action)}</div>
        ${t.expected?`<div style="color:var(--text-muted);font-size:12px">&rarr; ${esc(t.expected)}</div>`:''}
        <div style="display:flex;gap:6px;align-items:center">
          ${t.jsCommand?`<button class="btn-primary btn-sm" onclick="copyToClipboard(\`${t.jsCommand.replace(/`/g,'\\`')}\`,this)">&#x1F4CB; Copier</button>`:''}
          <button class="btn-success btn-sm" onclick="markInstanceTest('${id}',${i},true)">&#x2705;</button>
          <button class="btn-danger btn-sm" onclick="markInstanceTest('${id}',${i},false)">&#x274C;</button>
          <span class="badge badge-grey" id="it-status-${id}-${i}">\u23F3</span>
        </div></div>`;
    });
    html += '</div></div>';
  }

  if (analysis.elements.confirmation) {
    html += `<div class="sub-panel"><div class="panel-confirm" style="margin-top:8px"><div class="big-icon">&#x2705;</div><p>${esc(analysis.elements.confirmation.message)}</p>
      <div style="display:flex;gap:8px;justify-content:center;margin-top:16px">
        <button class="btn-primary btn-sm" onclick="nextInstanceIteration('${id}')">&#x27A1;&#xFE0F; Suivant</button>
        <button class="btn-ghost btn-sm" onclick="completeSession()">&#x1F3C1; Terminer</button>
      </div></div></div>`;
  }

  if (analysis.elements.error) {
    const errPrompt = `[CC_START]\nCorrection: ${(analysis.elements.error.message||'').replace(/"/g,'&quot;')}\n[CC_END]`;
    html += `<div class="sub-panel"><div class="panel-error-box" style="margin-top:8px"><div class="big-icon">&#x274C;</div>
      <p>${esc(analysis.elements.error.message)}</p>
      <p style="color:var(--text-muted);font-size:12px;margin-top:8px">${esc(analysis.elements.error.suggestion)}</p>
      <textarea id="ip-err-${id}" rows="4" readonly class="mono" style="margin-top:12px">${esc(errPrompt)}</textarea>
      <button class="btn-danger btn-sm" style="margin-top:8px" onclick="copyToClipboard(document.getElementById('ip-err-${id}').value,this)">&#x1F501; Copier corrige</button>
    </div></div>`;
  }

  container.innerHTML = html;
  updateTimestamp(instanceId);
}

function copyPrompt(instanceId) {
  const ta = document.getElementById(`ip-prompt-${instanceId}`);
  if (!ta) return;
  copyToClipboard(ta.value, ta.parentElement.querySelector('button'));
  ta.classList.add('flash-green');
  setTimeout(() => ta.classList.remove('flash-green'), 600);
}

async function submitInstanceResult(instanceId) {
  const ta = document.getElementById(`ip-result-${instanceId}`);
  const val = ta.value.trim();
  if (!val) { ta.classList.add('shake'); setTimeout(() => ta.classList.remove('shake'), 300); return; }

  await fetch(`${API}/instances/${instanceId}/result`, {
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({result:val})
  });
  const sub = document.getElementById(`ip-sub-${instanceId}`);
  if (sub) sub.innerHTML = '<div class="panel-confirm" style="padding:20px"><div class="big-icon">&#x2705;</div><p>Resultat soumis</p></div>';
  const input = document.getElementById(`ip-input-${instanceId}`);
  if (input) input.value = '';
  updateInstanceStatus(instanceId, 'idle');
  updateHistory();
}

async function chooseInstanceOption(instanceId) {
  const sel = document.querySelector(`input[name="opt-${instanceId}"]:checked`);
  if (!sel) return;
  const inst = state.instances.get(instanceId);
  if (!inst) return;
  await fetch(`${API}/sessions/${inst.sessionId}/option`, {
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chosenOption:sel.value})
  });
}

async function submitInstanceAnswers(instanceId, count) {
  const inst = state.instances.get(instanceId);
  if (!inst) return;
  for (let i = 0; i < count; i++) {
    const cb = document.getElementById(`qcb-${instanceId}-${i}`);
    const ta = document.getElementById(`qa-${instanceId}-${i}`);
    const answer = cb ? (cb.dataset.answer || 'Non repondu') : (ta ? ta.value || 'Non repondu' : 'Non repondu');
    await fetch(`${API}/sessions/${inst.sessionId}/answer`, {
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({questionIndex:i,answer})
    });
  }
}

function markInstanceTest(instanceId, idx, passed) {
  const badge = document.getElementById(`it-status-${instanceId}-${idx}`);
  if (badge) { badge.textContent = passed ? '\u2705' : '\u274C'; badge.className = `badge ${passed?'badge-green':'badge-red'}`; }
}

async function runAllInstanceTests(instanceId, count) {
  for (let i = 0; i < count; i++) {
    markInstanceTest(instanceId, i, true);
    await new Promise(r => setTimeout(r, 500));
  }
}

function nextInstanceIteration(instanceId) {
  const input = document.getElementById(`ip-input-${instanceId}`);
  const sub = document.getElementById(`ip-sub-${instanceId}`);
  if (input) input.value = '';
  if (sub) sub.innerHTML = '';
  const analysis = document.getElementById(`ip-analysis-${instanceId}`);
  if (analysis) analysis.classList.add('hidden');
  const typeBadge = document.getElementById(`ip-type-${instanceId}`);
  if (typeBadge) typeBadge.classList.add('hidden');
}

function updateInstanceStatus(instanceId, status) {
  const inst = state.instances.get(instanceId);
  if (inst) inst.status = status;
  ['sb-status-','ip-status-'].forEach(prefix => {
    const el = document.getElementById(`${prefix}${instanceId}`);
    if (el) { el.textContent = status; el.className = `badge ${statusBadge(status)}`; }
  });
}

function statusBadge(s) {
  return s === 'idle' ? 'badge-grey' : s === 'waiting_result' ? 'badge-yellow' : 'badge-green';
}

function focusInstance(instanceId) {
  document.querySelectorAll('.instance-card').forEach(c => c.classList.remove('selected'));
  const sb = document.getElementById(`sb-${instanceId}`);
  if (sb) sb.classList.add('selected');
  const panel = document.getElementById(`ip-${instanceId}`);
  if (panel) panel.scrollIntoView({behavior:'smooth',block:'start'});
}

async function removeInstance(instanceId) {
  await fetch(`${API}/instances/${instanceId}`, {method:'DELETE'});
  removeInstancePanel(instanceId);
}

function removeInstancePanel(instanceId) {
  state.instances.delete(instanceId);
  ['sb-','ip-'].forEach(prefix => {
    const el = document.getElementById(`${prefix}${instanceId}`);
    if (el) el.remove();
  });
}

function updateTimestamp(instanceId) {
  ['sb-time-','ip-time-'].forEach(prefix => {
    const el = document.getElementById(`${prefix}${instanceId}`);
    if (el) { el.dataset.ts = Date.now(); el.textContent = 'maintenant'; }
  });
}

function updateRelativeTimestamps() {
  document.querySelectorAll('.inst-time[data-ts]').forEach(el => {
    const diff = Math.floor((Date.now() - parseInt(el.dataset.ts)) / 1000);
    if (diff < 10) el.textContent = 'maintenant';
    else if (diff < 60) el.textContent = `il y a ${diff}s`;
    else if (diff < 3600) el.textContent = `il y a ${Math.floor(diff/60)}m`;
    else el.textContent = `il y a ${Math.floor(diff/3600)}h`;
  });
}

// ── DIRECT MODE ──

function toggleDirectPanel() {
  document.getElementById('direct-panel').classList.toggle('hidden');
}

async function analyzeInputDirect() {
  const raw = document.getElementById('input-raw').value.trim();
  if (!raw) { document.getElementById('input-raw').classList.add('shake'); setTimeout(() => document.getElementById('input-raw').classList.remove('shake'), 300); return; }
  const res = await fetch(`${API}/sessions/${state.currentSessionId}/ingest`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:raw})});
  const data = await res.json();
  const ar = document.getElementById('analysis-result');
  ar.textContent = `${data.analysis.type} (${data.analysis.confidence}%) \u2014 ${data.analysis.suggestedAction}`;
  ar.classList.remove('hidden');
  showDirectSubPanels(data.analysis);
  updateHistory();
}

function showDirectSubPanels(analysis) {
  const c = document.getElementById('direct-subpanels');
  let h = '';
  if (analysis.elements.prompt) {
    h += `<div class="card glass"><div class="two-col">
      <div><div class="panel-header">&#x1F4E4; Prompt</div><textarea id="d-prompt" rows="12" readonly class="mono">${esc(analysis.elements.prompt)}</textarea>
        <button class="btn-primary" style="margin-top:8px;width:100%" onclick="copyToClipboard(document.getElementById('d-prompt').value,this)">&#x1F4CB; Copier</button></div>
      <div><div class="panel-header">&#x1F4E5; Resultat</div><textarea id="d-result" rows="12" placeholder="Colle le resultat..." class="mono"></textarea>
        <div style="display:flex;gap:8px;margin-top:8px"><button class="btn-success" style="flex:1" onclick="submitDirectResult()">&#x2705; Soumettre</button>
        <button class="btn-ghost" onclick="completeSession()">&#x1F3C1;</button></div></div></div></div>`;
  }
  if (analysis.elements.confirmation) h += `<div class="panel-confirm"><div class="big-icon">&#x2705;</div><p>${esc(analysis.elements.confirmation.message)}</p></div>`;
  if (analysis.elements.error) h += `<div class="panel-error-box"><div class="big-icon">&#x274C;</div><p>${esc(analysis.elements.error.message)}</p></div>`;
  c.innerHTML = h;
}

async function submitDirectResult() {
  const ta = document.getElementById('d-result');
  const val = ta.value.trim();
  if (!val) return;
  await fetch(`${API}/sessions/${state.currentSessionId}/result`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({result:val})});
  state.currentIteration++;
  document.getElementById('sess-iter').textContent = state.currentIteration;
  document.getElementById('input-raw').value = '';
  document.getElementById('direct-subpanels').innerHTML = '';
  document.getElementById('analysis-result').classList.add('hidden');
  updateHistory();
}

async function completeSession() {
  await fetch(`${API}/sessions/${state.currentSessionId}/complete`, {method:'POST',headers:{'Content-Type':'application/json'}});
  goHome();
}

// ── HISTORY ──

async function updateHistory() {
  if (!state.currentSessionId) return;
  const res = await fetch(`${API}/sessions/${state.currentSessionId}/history`);
  const data = await res.json();
  renderHistory(data.iterations);
}

function renderHistory(iterations) {
  const list = document.getElementById('history-list');
  if (!iterations || iterations.length === 0) {
    list.innerHTML = '<p style="color:var(--text-muted);font-size:13px">Aucune iteration</p>';
    return;
  }
  list.innerHTML = iterations.map(it => `
    <div class="history-item">
      <div class="history-header" onclick="this.nextElementSibling.classList.toggle('open')">
        <span>It. ${it.index} &mdash; [${it.analysisType}] ${it.instanceLabel?'&mdash; '+esc(it.instanceLabel):''} &mdash; ${new Date(it.timestamp).toLocaleTimeString()}</span>
        <span style="transition:transform .2s">&#x25BC;</span>
      </div>
      <div class="history-body">
        ${it.prompt?`<div style="margin-bottom:8px"><strong>Prompt:</strong><pre>${esc(it.prompt.length>200?it.prompt.slice(0,200)+'...':it.prompt)}</pre></div>`:''}
        ${it.result?`<div style="margin-bottom:8px"><strong>Resultat:</strong><pre>${esc(it.result.length>200?it.result.slice(0,200)+'...':it.result)}</pre></div>`:''}
        ${it.chosenOption?`<div><strong>Option:</strong> ${esc(it.chosenOption)}</div>`:''}
      </div>
    </div>
  `).join('');
}

// ── UTILS ──

function copyToClipboard(text, btnEl) {
  navigator.clipboard.writeText(text).then(() => {
    if (btnEl) {
      const orig = btnEl.textContent;
      btnEl.textContent = '\u2705 Copie !';
      setTimeout(() => { btnEl.textContent = orig; }, 2000);
    }
  });
}

function show(id) { document.getElementById(id).classList.remove('hidden'); }
function hide(id) { document.getElementById(id).classList.add('hidden'); }
function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

document.addEventListener('DOMContentLoaded', init);
