/**
 * Ensemble Web UI — Frontend Logic (Phase 2)
 * Manages team sidebar, team creation, terminal panels (xterm.js),
 * dynamic 3+ agent layout with tabbed right panel, and input bar.
 */

const API_BASE = window.location.origin;

// ─── State ───
let teams = [];
let selectedTeamId = null;
let serverCwd = '';
// Primary panels (always tech-lead + lead-critic)
let primaryTerminals = { left: null, right: null }; // { term, fitAddon, ws, resizeObserver }
// Tab terminals (extra agents beyond the two primaries)
let tabTerminals = []; // array of { agent, term, fitAddon, ws, resizeObserver, containerId }
let activeTabIndex = 0;
let focusedPanel = null; // 'left', 'right', or 'tab-N'

// ─── Team Sidebar ───

async function fetchTeams() {
  try {
    const res = await fetch(`${API_BASE}/api/ensemble/teams`);
    const data = await res.json();
    teams = data.teams || [];
    renderTeamList();
  } catch (err) {
    console.error('Failed to fetch teams:', err);
  }
}

function renderTeamList() {
  const list = document.getElementById('team-list');
  if (!list) return;

  list.innerHTML = teams.map(team => {
    const isActive = team.id === selectedTeamId;
    const statusClass = team.status || 'disbanded';
    const agentCount = team.agents?.length || 0;
    const desc = team.description
      ? team.description.slice(0, 50) + (team.description.length > 50 ? '...' : '')
      : '';

    return `
      <div class="team-item ${isActive ? 'active' : ''}"
           onclick="selectTeam('${team.id}')">
        <div class="team-name">
          <span class="status-dot ${statusClass}"></span>
          ${escapeHtml(team.name)}
        </div>
        <div class="team-meta">${agentCount} agents${desc ? ' &mdash; ' + escapeHtml(desc) : ''}</div>
      </div>
    `;
  }).join('');
}

// ─── Team Creation ───

async function createTeam() {
  const btn = document.getElementById('launch-btn');
  const errorDiv = document.getElementById('launch-error');
  const templateSelect = document.getElementById('template-select');
  const taskTextarea = document.getElementById('task-input');

  if (!btn || !templateSelect || !taskTextarea) return;

  const description = taskTextarea.value.trim();
  const templateName = templateSelect.value;

  if (!description) {
    if (errorDiv) {
      errorDiv.textContent = 'Please enter a task description.';
      errorDiv.style.display = 'block';
    }
    return;
  }

  // Disable button, show launching state
  btn.disabled = true;
  btn.textContent = 'Launching...';
  if (errorDiv) {
    errorDiv.textContent = '';
    errorDiv.style.display = 'none';
  }

  const timestamp = Date.now();
  const random4 = Math.random().toString(36).substring(2, 6);
  const name = `collab-${timestamp}-${random4}`;

  try {
    const res = await fetch(`${API_BASE}/api/ensemble/teams`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        description,
        templateName,
        workingDirectory: document.getElementById('cwd-input')?.value || serverCwd,
        feedMode: 'live',
      }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || errData.message || `HTTP ${res.status}`);
    }

    const data = await res.json();
    const newTeamId = data.team?.id || data.id;

    // Clear form
    taskTextarea.value = '';

    // Re-enable button
    btn.disabled = false;
    btn.textContent = 'Launch';

    // Refresh teams and select the new one
    await fetchTeams();
    if (newTeamId) {
      selectTeam(newTeamId);
    }
  } catch (err) {
    console.error('Failed to create team:', err);
    if (errorDiv) {
      errorDiv.textContent = `Launch failed: ${err.message}`;
      errorDiv.style.display = 'block';
    }
    btn.disabled = false;
    btn.textContent = 'Launch';
  }
}

// ─── Team Selection ───

function selectTeam(teamId) {
  if (selectedTeamId === teamId) return;
  selectedTeamId = teamId;

  closeAllTerminals();

  const team = teams.find(t => t.id === teamId);

  // Show/hide Resume vs Disband based on team status
  const resumeBtn = document.getElementById('resume-btn');
  const disbandBtn = document.getElementById('disband-btn');
  if (team && (team.status === 'disbanded' || team.status === 'completed')) {
    if (resumeBtn) resumeBtn.style.display = '';
    if (disbandBtn) disbandBtn.style.display = 'none';
  } else {
    if (resumeBtn) resumeBtn.style.display = 'none';
    if (disbandBtn) disbandBtn.style.display = '';
  }

  if (!team || !team.agents || team.agents.length === 0) {
    showPlaceholder('left-terminal', 'Waiting for agents to spawn...');
    showPlaceholder('right-terminal', 'Waiting for agents to spawn...');
    updateHeaders(null, null);
    updateLayout(0);
    renderTeamList();
    return;
  }

  const agents = team.agents;

  // Role-based placement: find agents by name
  const leftAgent = agents.find(a => a.name && a.name.includes('tech-lead')) || null;
  const rightAgent = agents.find(a =>
    a.name && (a.name.includes('lead-critic') || a.name.includes('critic'))
  ) || null;

  // Remaining agents go to tabs
  const tabAgents = agents.filter(a => a !== leftAgent && a !== rightAgent);

  // Update layout based on total agent count
  updateLayout(agents.length);

  // Update headers for primary panels
  updateHeaders(leftAgent, rightAgent);

  // Update target dropdown with ALL agents
  updateTargetDropdown(agents);

  // Connect primary terminals
  if (leftAgent) {
    primaryTerminals.left = createTerminal('left-terminal', team.id, leftAgent.name);
  } else {
    showPlaceholder('left-terminal', 'No agent');
  }

  if (rightAgent) {
    primaryTerminals.right = createTerminal('right-terminal', team.id, rightAgent.name);
  } else {
    showPlaceholder('right-terminal', 'No agent');
  }

  // Create tab terminals for extra agents
  if (tabAgents.length > 0) {
    createTabTerminals(team.id, tabAgents);
  }

  renderTeamList();
}

// ─── Dynamic Layout ───

function updateLayout(agentCount) {
  const app = document.getElementById('app');
  const panelExtra = document.getElementById('panel-extra');
  if (!app) return;

  // Remove existing layout classes
  app.classList.remove('layout-2', 'layout-3plus');

  if (agentCount >= 3) {
    app.classList.add('layout-3plus');
    app.style.gridTemplateColumns = 'var(--sidebar-width) 1fr 1fr 0.85fr';
    if (panelExtra) panelExtra.style.display = 'flex';
  } else {
    app.classList.add('layout-2');
    app.style.gridTemplateColumns = 'var(--sidebar-width) 1fr 1fr';
    if (panelExtra) panelExtra.style.display = 'none';
  }
}

// ─── Terminal Creation Helper ───

function createTerminal(containerId, teamId, agentName) {
  const container = document.getElementById(containerId);
  if (!container) return null;

  container.innerHTML = '';

  const term = new Terminal({
    cursorBlink: true,
    fontSize: 13,
    fontFamily: "'SF Mono', 'Menlo', 'Monaco', 'Courier New', monospace",
    scrollback: 5000,
    theme: {
      background: '#000000',
      foreground: '#e6edf3',
      cursor: '#58a6ff',
      selectionBackground: '#264f78',
    },
    allowProposedApi: true,
  });

  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(container);


  // Fit after layout settles — use multiple attempts to ensure grid is computed
  requestAnimationFrame(() => {
    fitAddon.fit();
    // Second fit after a longer delay for grid layout to fully resolve
    setTimeout(() => fitAddon.fit(), 100);
    setTimeout(() => fitAddon.fit(), 500);
  });

  // Use initial fit dimensions, but will resize via ResizeObserver once connected
  const cols = term.cols || 120;
  const rows = term.rows || 40;
  const wsUrl = `ws://${window.location.host}/ws/terminal/${teamId}/${agentName}?cols=${cols}&rows=${rows}`;
  const ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    updateStatusForTerminal(containerId, 'connected');
    // Re-fit now that connection is established and layout is stable
    fitAddon.fit();
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    }
  };

  ws.onmessage = (event) => {
    const data = event.data;
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'error') {
        term.write(`\r\n\x1b[31m${msg.message}\x1b[0m\r\n`);
        return;
      }
      if (msg.type === 'exit') {
        term.write(`\r\n\x1b[90m${msg.message}\x1b[0m\r\n`);
        updateStatusForTerminal(containerId, 'ended');
        return;
      }
    } catch {
      // Not JSON — raw terminal output
    }
    term.write(data);
  };

  ws.onclose = () => {
    updateStatusForTerminal(containerId, 'disconnected');
  };

  ws.onerror = () => {
    updateStatusForTerminal(containerId, 'error');
  };

  term.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input', data }));
    }
  });

  const resizeObserver = new ResizeObserver(() => {
    fitAddon.fit();
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    }
  });
  resizeObserver.observe(container);

  return { term, fitAddon, ws, resizeObserver };
}

// ─── Tab Terminals ───

function createTabTerminals(teamId, tabAgents) {
  const tabBar = document.getElementById('tab-bar');
  const tabTerminalsContainer = document.getElementById('tab-terminals');
  if (!tabBar || !tabTerminalsContainer) return;

  // Clear existing tabs
  tabBar.innerHTML = '';
  tabTerminalsContainer.innerHTML = '';
  tabTerminals = [];
  activeTabIndex = 0;

  tabAgents.forEach((agent, index) => {
    // Create tab button
    const tabBtn = document.createElement('div');
    tabBtn.className = 'tab-item' + (index === 0 ? ' active' : '');
    tabBtn.textContent = agent.name;
    tabBtn.dataset.tabIndex = index;
    tabBtn.addEventListener('click', () => switchTab(index));
    tabBar.appendChild(tabBtn);

    // Create terminal container div
    const containerId = `tab-terminal-${index}`;
    const containerDiv = document.createElement('div');
    containerDiv.id = containerId;
    containerDiv.className = 'tab-terminal-body' + (index === 0 ? ' active' : '');
    tabTerminalsContainer.appendChild(containerDiv);

    // Connect terminal (ALL tabs connect immediately, stay connected in background)
    const termObj = createTerminal(containerId, teamId, agent.name);
    if (termObj) {
      tabTerminals.push({
        agent,
        term: termObj.term,
        fitAddon: termObj.fitAddon,
        ws: termObj.ws,
        resizeObserver: termObj.resizeObserver,
        containerId,
      });
    }
  });

  // Fit the first (visible) tab terminal
  if (tabTerminals.length > 0 && tabTerminals[0].fitAddon) {
    requestAnimationFrame(() => {
      tabTerminals[0].fitAddon.fit();
    });
  }
}

function switchTab(index) {
  if (index < 0 || index >= tabTerminals.length) return;
  activeTabIndex = index;

  // Toggle active class on tab buttons
  const tabBar = document.getElementById('tab-bar');
  if (tabBar) {
    const tabs = tabBar.querySelectorAll('.tab-item');
    tabs.forEach((tab, i) => {
      tab.classList.toggle('active', i === index);
    });
  }

  // Toggle active class on terminal bodies
  const tabTerminalsContainer = document.getElementById('tab-terminals');
  if (tabTerminalsContainer) {
    const bodies = tabTerminalsContainer.querySelectorAll('.tab-terminal-body');
    bodies.forEach((body, i) => {
      body.classList.toggle('active', i === index);
    });
  }

  // Fit the newly visible terminal
  if (tabTerminals[index] && tabTerminals[index].fitAddon) {
    requestAnimationFrame(() => {
      tabTerminals[index].fitAddon.fit();
    });
  }
}

// ─── Cleanup ───

function closeAllTerminals() {
  // Close primary terminals
  for (const side of ['left', 'right']) {
    const entry = primaryTerminals[side];
    if (entry) {
      if (entry.ws) entry.ws.close();
      if (entry.resizeObserver) entry.resizeObserver.disconnect();
      if (entry.term) entry.term.dispose();
      primaryTerminals[side] = null;
    }
    showPlaceholder(side === 'left' ? 'left-terminal' : 'right-terminal', 'Select a team to begin');
    updateStatus(side, '');
  }

  // Close all tab terminals
  for (const tabEntry of tabTerminals) {
    if (tabEntry.ws) tabEntry.ws.close();
    if (tabEntry.resizeObserver) tabEntry.resizeObserver.disconnect();
    if (tabEntry.term) tabEntry.term.dispose();
  }
  tabTerminals = [];

  // Remove tab DOM elements
  const tabBar = document.getElementById('tab-bar');
  if (tabBar) tabBar.innerHTML = '';
  const tabTerminalsContainer = document.getElementById('tab-terminals');
  if (tabTerminalsContainer) tabTerminalsContainer.innerHTML = '';

  // Reset tab index
  activeTabIndex = 0;
}

// ─── Placeholders ───

function showPlaceholder(containerId, text) {
  const container = document.getElementById(containerId);
  if (container) {
    container.innerHTML = `<div class="panel-placeholder">${escapeHtml(text)}</div>`;
  }
}

// ─── Focus Management ───

function setFocus(panelId) {
  focusedPanel = panelId;

  // Remove .focused from all panel bodies and tab terminal bodies
  document.querySelectorAll('.panel-body').forEach(el => el.classList.remove('focused'));
  document.querySelectorAll('.tab-terminal-body').forEach(el => el.classList.remove('focused'));

  // Determine which element to focus
  if (panelId === 'left') {
    const el = document.getElementById('left-terminal');
    if (el) el.classList.add('focused');
    if (primaryTerminals.left) primaryTerminals.left.term.focus();
  } else if (panelId === 'right') {
    const el = document.getElementById('right-terminal');
    if (el) el.classList.add('focused');
    if (primaryTerminals.right) primaryTerminals.right.term.focus();
  } else if (panelId.startsWith('tab-')) {
    const tabIndex = parseInt(panelId.replace('tab-', ''), 10);
    if (tabTerminals[tabIndex]) {
      const container = document.getElementById(tabTerminals[tabIndex].containerId);
      if (container) container.classList.add('focused');
      tabTerminals[tabIndex].term.focus();
    }
  }
}

// ─── Headers & Status ───

function updateHeaders(leftAgent, rightAgent) {
  const leftName = document.getElementById('left-agent-name');
  const leftProgram = document.getElementById('left-agent-program');
  const rightName = document.getElementById('right-agent-name');
  const rightProgram = document.getElementById('right-agent-program');

  if (leftName) leftName.textContent = leftAgent?.name || '\u2014';
  if (leftProgram) {
    leftProgram.textContent = leftAgent?.program || '';
    leftProgram.style.display = leftAgent ? '' : 'none';
  }

  if (rightName) rightName.textContent = rightAgent?.name || '\u2014';
  if (rightProgram) {
    rightProgram.textContent = rightAgent?.program || '';
    rightProgram.style.display = rightAgent ? '' : 'none';
  }
}

function updateStatus(side, status) {
  const el = document.getElementById(side === 'left' ? 'left-agent-status' : 'right-agent-status');
  if (!el) return;
  applyStatus(el, status);
}

function updateStatusForTerminal(containerId, status) {
  // Map container ID to the appropriate status element
  if (containerId === 'left-terminal') {
    updateStatus('left', status);
  } else if (containerId === 'right-terminal') {
    updateStatus('right', status);
  }
  // Tab terminals don't have dedicated status elements in the current layout
}

function applyStatus(el, status) {
  const labels = {
    connected: '\u25cf connected',
    disconnected: '\u25cb disconnected',
    ended: '\u25cb session ended',
    error: '\u25cf error',
    '': '',
  };
  const colors = {
    connected: '#3fb950',
    disconnected: '#484f58',
    ended: '#484f58',
    error: '#f85149',
    '': '',
  };

  el.textContent = labels[status] || status;
  el.style.color = colors[status] || '';
}

// ─── Target Dropdown ───

function updateTargetDropdown(agents) {
  const select = document.getElementById('msg-target');
  if (!select) return;

  select.innerHTML = '<option value="team">team</option>';
  for (const agent of agents) {
    const opt = document.createElement('option');
    opt.value = agent.name;
    opt.textContent = agent.name;
    select.appendChild(opt);
  }
}

// ─── Input Bar ───

async function sendMessage() {
  if (!selectedTeamId) return;

  const input = document.getElementById('msg-input');
  const target = document.getElementById('msg-target');
  const content = input.value.trim();
  if (!content) return;

  try {
    await fetch(`${API_BASE}/api/ensemble/teams/${selectedTeamId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'user',
        to: target.value,
        content,
      }),
    });
    input.value = '';
  } catch (err) {
    console.error('Failed to send message:', err);
  }
}

// ─── Utilities ───

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ─── Initialization ───

document.addEventListener('DOMContentLoaded', () => {
  // Fetch server working directory
  fetch(`${API_BASE}/api/v1/cwd`)
    .then(res => res.json())
    .then(data => {
      serverCwd = data.cwd || data.workingDirectory || '';
      const cwdInput = document.getElementById('cwd-input');
      if (cwdInput) {
        cwdInput.value = serverCwd;
        cwdInput.placeholder = serverCwd;
      }
    })
    .catch(err => {
      console.error('Failed to fetch server cwd:', err);
    });

  // Wire up input bar
  document.getElementById('msg-send')?.addEventListener('click', sendMessage);
  document.getElementById('msg-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMessage();
  });

  // Wire up disband button
  document.getElementById('disband-btn')?.addEventListener('click', async () => {
    if (!selectedTeamId) return;
    const btn = document.getElementById('disband-btn');
    if (!confirm('Disband this team? All agents will be stopped.')) return;
    btn.disabled = true;
    btn.textContent = 'Disbanding...';
    try {
      await fetch(`${API_BASE}/api/ensemble/teams/${selectedTeamId}/disband`, { method: 'POST' });
      closeAllTerminals();
      selectedTeamId = null;
      await fetchTeams();
    } catch (err) {
      console.error('Disband failed:', err);
    }
    btn.disabled = false;
    btn.textContent = 'Disband';
  });

  // Wire up resume button
  document.getElementById('resume-btn')?.addEventListener('click', async () => {
    if (!selectedTeamId) return;
    const btn = document.getElementById('resume-btn');
    btn.disabled = true;
    btn.textContent = 'Resuming...';
    try {
      const res = await fetch(`${API_BASE}/api/ensemble/teams/${selectedTeamId}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workingDirectory: document.getElementById('cwd-input')?.value || serverCwd,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const newTeamId = data.team?.id;
      await fetchTeams();
      if (newTeamId) {
        selectedTeamId = null; // force re-select
        selectTeam(newTeamId);
      }
    } catch (err) {
      console.error('Resume failed:', err);
      alert('Resume failed: ' + err.message);
    }
    btn.disabled = false;
    btn.textContent = 'Resume';
  });

  // Global wheel handler: allow scroll only inside xterm viewports and team list.
  // Block everywhere else (prevents select dropdowns from cycling, page from scrolling).
  document.addEventListener('wheel', (e) => {
    const target = e.target;
    // Allow: xterm viewport (terminal scroll history)
    if (target.closest('.xterm-viewport') || target.closest('.xterm-screen')) return;
    // Allow: team list scrolling
    if (target.closest('#team-list')) return;
    // Allow: task textarea scrolling
    if (target.closest('#task-input')) return;
    // Block everything else
    e.preventDefault();
  }, { passive: false });

  // Wire up launch button
  document.getElementById('launch-btn')?.addEventListener('click', createTeam);

  // Wire up browse button — opens native folder picker
  document.getElementById('browse-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('browse-btn');
    btn.textContent = '...';
    btn.disabled = true;
    try {
      const res = await fetch(`${API_BASE}/api/v1/pick-folder`);
      const data = await res.json();
      if (data.folder) {
        document.getElementById('cwd-input').value = data.folder;
      }
    } catch (err) {
      console.error('Folder picker failed:', err);
    }
    btn.textContent = 'Browse';
    btn.disabled = false;
  });

  // Wire up focus clicks on primary panels
  document.getElementById('left-terminal')?.addEventListener('click', () => setFocus('left'));
  document.getElementById('right-terminal')?.addEventListener('click', () => setFocus('right'));

  // Fetch teams and start polling
  fetchTeams();
  setInterval(fetchTeams, 5000);

  // Auto-select first active team after initial fetch
  setTimeout(() => {
    const activeTeam = teams.find(t => t.status === 'active');
    if (activeTeam) selectTeam(activeTeam.id);
  }, 1000);

  // Re-check for agents if selected team has none yet
  setInterval(() => {
    if (!selectedTeamId) return;
    const team = teams.find(t => t.id === selectedTeamId);
    if (team && team.agents && team.agents.length > 0
        && !primaryTerminals.left && !primaryTerminals.right) {
      // Force re-select to pick up newly spawned agents
      const id = selectedTeamId;
      selectedTeamId = null;
      selectTeam(id);
    }
  }, 3000);
});
