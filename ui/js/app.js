// Remote VS Code - VS风格前端逻辑

const API_BASE = window.location.origin;
let ws = null;

// 状态
const state = {
  projects: [],
  currentProject: null,
  sessions: [],
  currentSession: null,
  isClaudeWorking: false,
  currentView: 'projects',
  currentFilePath: '',
  eventSource: null  // SSE 连接
};

// ============ 工具函数 ============

function $(id) { return document.getElementById(id); }

function showLoading(element, msg = '加载中...') {
  element.innerHTML = `<div class="loading">${msg}</div>`;
}

async function apiRequest(url, options = {}) {
  try {
    const response = await fetch(`${API_BASE}${url}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers }
    });
    return await response.json();
  } catch (error) {
    console.error('API Error:', error);
    throw error;
  }
}

// ============ WebSocket ============

function connectWS() {
  if (ws && ws.readyState === WebSocket.OPEN) return;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host}`);

  ws.onopen = () => {
    const statusEl = $('ws-status');
    statusEl.innerHTML = '<span class="status-dot"></span>已连接';
    statusEl.className = 'status connected';
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleWSMessage(data);
    } catch (e) {}
  };

  ws.onclose = () => {
    const statusEl = $('ws-status');
    statusEl.innerHTML = '<span class="status-dot"></span>未连接';
    statusEl.className = 'status disconnected';
    setTimeout(connectWS, 3000);
  };
}

function handleWSMessage(data) {
  console.log('[WS] Received:', data.type);

  if (data.type === 'output' || data.type === 'error') {
    console.log('[WS] Output:', data.data.substring(0, 200));
    addSessionOutput(data.data, data.type === 'error' ? 'stderr' : 'stdout');
  } else if (data.type === 'status') {
    updateSessionStatus(data.data);
  } else if (data.type === 'user') {
    addChatMessage(`[你]: ${data.data}`, 'user');
  } else if (data.type === 'done') {
    addSessionOutput(`\n[Claude 完成]`, 'info');
    state.isClaudeWorking = false;
    updateSessionStatus('idle');
  } else if (data.type === 'session_update') {
    loadSessions();
  } else if (data.type === 'terminal') {
    // 终端输出
    addTerminalOutput(data.data, data.subtype || 'stdout');
  }
}

function addSessionOutput(text, type = 'stdout') {
  const output = $('session-output');
  if (!output) return;

  // 检测文件变更格式并以特殊样式显示
  if (text.includes('●') || text.includes('◼') || text.includes('✓') ||
      text.includes('Update(') || text.includes('Create(') || text.includes('Delete(') ||
      text.includes('Added') || text.includes('removed') || text.includes('changed')) {
    // 文件变更信息
    const line = document.createElement('div');
    line.className = `output-line file-change`;
    line.innerHTML = escapeHtml(text).replace(/\n/g, '<br>');
    output.appendChild(line);
    output.scrollTop = output.scrollHeight;
    return;
  }

  // 检测 diff 格式
  if (text.includes('+') || text.includes('-') || text.includes('@@')) {
    const line = document.createElement('div');
    line.className = `output-line diff`;
    line.innerHTML = escapeHtml(text);
    output.appendChild(line);
    output.scrollTop = output.scrollHeight;
    return;
  }

  const line = document.createElement('div');
  line.className = `output-line ${type}`;
  line.textContent = text;
  output.appendChild(line);
  output.scrollTop = output.scrollHeight;
}

function addChatMessage(text, type = 'stdout') {
  const chatMessages = $('chat-messages');
  if (!chatMessages) return;
  const line = document.createElement('div');
  line.className = `output-line ${type}`;
  line.textContent = text;
  chatMessages.appendChild(line);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function addTerminalOutput(text, type = 'stdout') {
  const output = $('terminal-output');
  if (!output) return;
  const line = document.createElement('div');
  line.className = `output-line ${type}`;
  line.textContent = text;
  output.appendChild(line);
  output.scrollTop = output.scrollHeight;
}

function updateSessionStatus(status) {
  const statusEl = $('current-session-status');
  const sessionNameEl = $('current-session-name');
  if (!statusEl || !sessionNameEl) return;

  state.isClaudeWorking = (status === 'working');

  if (status === 'working') {
    statusEl.textContent = '工作中';
    statusEl.className = 'session-status working';
  } else if (status === 'error') {
    statusEl.textContent = '错误';
    statusEl.className = 'session-status error';
  } else {
    statusEl.textContent = '空闲';
    statusEl.className = 'session-status';
  }

  const btn = $('btn-send');
  if (btn) btn.disabled = state.isClaudeWorking;
}

// ============ 视图切换 ============

function initViewSwitcher() {
  document.querySelectorAll('.activity-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      state.currentView = view;

      // 切换活动栏按钮
      document.querySelectorAll('.activity-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // 切换侧边视图
      document.querySelectorAll('.sidebar-view').forEach(v => v.classList.remove('active'));
      $(`view-${view}`)?.classList.add('active');

      // 加载对应内容
      if (view === 'files' && state.currentProject) {
        loadFiles(state.currentProject.path);
      }
    });
  });
}

// ============ 项目列表 ============

async function loadProjects() {
  const projectList = $('project-list');
  showLoading(projectList, '加载项目...');

  try {
    let projects = [];
    try {
      const data = await apiRequest('/api/projects');
      projects = data.projects || [];
    } catch (e) {
      // 使用默认项目
      projects = [
        { name: 'remote-vscode', path: 'C:\\Users\\29718\\remote-vscode' },
        { name: 'home', path: 'C:\\Users\\29718' }
      ];
    }

    state.projects = projects;
    renderProjects();
  } catch (error) {
    projectList.innerHTML = `<div class="loading" style="color: var(--error);">${error.message}</div>`;
  }
}

function renderProjects() {
  const projectList = $('project-list');
  if (!state.projects.length) {
    projectList.innerHTML = '<div class="empty-state"><p>暂无项目</p></div>';
    return;
  }

  projectList.innerHTML = state.projects.map(project => `
    <div class="project-item" data-path="${project.path}" data-name="${project.name}">
      <div class="project-icon">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M1.5 1h6l1 1H14l.5.5v4.5l-.5.5H10l-1 1v4l-1 1H2l-.5-.5v-11L1.5 1zm1 1v10h4v-3h2v3h4V3H7.5l-1-1H2.5z"/>
        </svg>
      </div>
      <span class="project-name">${project.name}</span>
      <span class="project-path">${project.path}</span>
    </div>
  `).join('');

  projectList.querySelectorAll('.project-item').forEach(item => {
    item.addEventListener('click', () => selectProject(item.dataset.path, item.dataset.name));
  });

  // 默认选中第一个
  if (state.projects.length > 0 && !state.currentProject) {
    const firstProject = state.projects[0];
    selectProject(firstProject.path, firstProject.name);
  }
}

function selectProject(path, name) {
  document.querySelectorAll('.project-item').forEach(item => item.classList.remove('active'));

  const targetItem = document.querySelector(`.project-item[data-path="${path}"]`);
  if (targetItem) targetItem.classList.add('active');

  state.currentProject = { path, name };
  state.currentFilePath = path;

  // 传递 projectId 给后端
  const projectId = encodeProjectPath(path);
  loadSessions(projectId);

  // 如果当前是文件视图，加载文件
  if (state.currentView === 'files') {
    loadFiles(path);
  }
}

// 解码项目路径 (projectId -> 实际路径)
function decodeProjectPath(folderName) {
  let result = folderName
    .replace(/^([a-zA-Z])--/, '$1:\\')
    .replace(/--/g, '\\');
  return result;
}

// 编码项目路径为 projectId 格式 (实际路径 -> projectId)
function encodeProjectPath(filePath) {
  // 将 C:\Users\29718\remote-vscode 转换为 C--Users--29718--remote-vscode
  return filePath.replace(/^([a-zA-Z]):/, '$1--').replace(/\\/g, '--');
}

// ============ Session列表 ============

async function loadSessions(projectId = null) {
  const sessionList = $('session-list');
  showLoading(sessionList, '加载Session...');

  try {
    // 如果传入了 projectId，传递给后端
    const url = projectId ? `/api/chat/sessions?projectId=${encodeURIComponent(projectId)}` : '/api/chat/sessions';
    const data = await apiRequest(url);
    state.sessions = data.sessions || [];

    if (!state.sessions.length) {
      sessionList.innerHTML = `
        <div class="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z"/>
            <path d="M12 6v6l4 2"/>
          </svg>
          <p>暂无活跃 Session</p>
          <span>${state.currentProject ? `在 ${state.currentProject.name} 中` : '选择项目开始'}</span>
        </div>
      `;
      return;
    }

    renderSessions();
  } catch (error) {
    sessionList.innerHTML = `<div class="empty-state" style="color: var(--error);">${error.message}</div>`;
  }
}

function renderSessions() {
  const sessionList = $('session-list');
  sessionList.innerHTML = state.sessions.map(session => {
    const isWorking = session.status === 'working';
    const sessionId = session.id || session.sessionId || 'unknown';
    const shortId = sessionId.substring(0, 8);
    const projectPath = session.projectPath || state.currentProject?.path || '';
    const displayPath = projectPath.length > 30 ? '...' + projectPath.slice(-27) : projectPath;

    return `
      <div class="session-item" data-session-id="${sessionId}">
        <div class="session-item-left">
          <span class="session-status-dot ${isWorking ? 'active' : 'idle'}"></span>
          <div class="session-item-info">
            <div class="session-item-name">${session.name || `Session ${shortId}`}</div>
            <div class="session-item-path">${displayPath}</div>
          </div>
        </div>
        <span class="session-item-status ${isWorking ? 'working' : ''}">${isWorking ? '工作中' : '空闲'}</span>
      </div>
    `;
  }).join('');

  sessionList.querySelectorAll('.session-item').forEach(item => {
    item.addEventListener('click', () => selectSession(item.dataset.sessionId));
  });

  if (state.currentSession) {
    const targetSession = document.querySelector(`.session-item[data-session-id="${state.currentSession}"]`);
    if (targetSession) targetSession.classList.add('active');
  }
}

function selectSession(sessionId) {
  document.querySelectorAll('.session-item').forEach(item => item.classList.remove('active'));

  const targetItem = document.querySelector(`.session-item[data-session-id="${sessionId}"]`);
  if (targetItem) targetItem.classList.add('active');

  state.currentSession = sessionId;

  const session = state.sessions.find(s => (s.id || s.sessionId) === sessionId);
  if (session) {
    $('current-session-name').textContent = session.name || `Session ${sessionId.substring(0, 8)}`;
    $('current-session-path').textContent = session.projectPath || state.currentProject?.path || '-';

    const status = session.status || 'idle';
    updateSessionStatus(status);
  }

  $('session-output').innerHTML = `
    <div class="output-line system">=== Session 信息 ===</div>
    <div class="output-line system">Session ID: ${sessionId}</div>
    <div class="output-line system">项目: ${state.currentProject?.name || '未知'}</div>
    <div class="output-line system">正在连接实时流...</div>
  `;

  $('chat-messages').innerHTML = `
    <div class="output-line system">=== 对话记录 ===</div>
    <div class="output-line system">选择 Session 开始对话</div>
  `;

  // 连接 SSE 实时流
  connectSessionStream(sessionId);
}

// 连接会话实时流
function connectSessionStream(sessionId) {
  // 关闭之前的连接
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }

  // 传递 projectId 给后端
  const projectId = state.currentProject ? encodeProjectPath(state.currentProject.path) : null;
  const url = projectId
    ? `${API_BASE}/api/chat/stream/${sessionId}?projectId=${encodeURIComponent(projectId)}`
    : `${API_BASE}/api/chat/stream/${sessionId}`;
  state.eventSource = new EventSource(url);

  state.eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleStreamMessage(data);
    } catch (e) {
      console.error('SSE parse error:', e);
    }
  };

  state.eventSource.onerror = (error) => {
    console.error('SSE error:', error);
    addSessionOutput('[连接断开，尝试重连...]', 'error');
    // 自动重连
    setTimeout(() => {
      if (state.currentSession) {
        connectSessionStream(state.currentSession);
      }
    }, 3000);
  };

  state.eventSource.onopen = () => {
    console.log('SSE connected');
    addSessionOutput('[已连接实时流]', 'info');
  };
}

// 处理实时流消息
function handleStreamMessage(data) {
  console.log('[SSE] Received:', data.type, data.messages?.length || 0);

  if (data.type === 'connected') {
    addSessionOutput(`[已连接到会话: ${data.sessionId}]`, 'info');
  } else if (data.type === 'update' && data.messages) {
    // 显示新消息
    for (const msg of data.messages) {
      // 处理原始文本行（非 JSON）
      if (msg.raw) {
        formatAndDisplayText(msg.raw);
        continue;
      }

      // 处理 progress 类型消息
      if (msg.type === 'progress' && msg.data) {
        const progressData = msg.data;
        if (progressData.type === 'waiting_for_task') {
          addSessionOutput(`[等待任务: ${progressData.taskDescription || '进行中...'}]`, 'info');
        } else if (progressData.toolName) {
          addSessionOutput(`⎿ [${progressData.toolName}]`, 'tool');
        }
        continue;
      }

      // 处理工具结果 (toolUseResult 字段)
      if (msg.toolUseResult) {
        const result = msg.toolUseResult;
        let resultContent = '';

        if (result.stdout) resultContent += result.stdout;
        if (result.stderr) resultContent += '\n[stderr]: ' + result.stderr;

        if (resultContent) {
          const truncated = resultContent.length > 1000 ? resultContent.substring(0, 1000) + '\n... (truncated)' : resultContent;
          addSessionOutput(truncated, 'tool-result');
        }
        continue;
      }

      // 用户消息
      if (msg.type === 'user') {
        let content = '';
        if (typeof msg.message?.content === 'string') {
          content = msg.message.content;
        } else if (Array.isArray(msg.message?.content)) {
          // 可能包含文本块
          for (const c of msg.message.content) {
            if (c.type === 'text') content += c.text;
          }
        }
        if (content) {
          addSessionOutput(`[你]: ${content}`, 'user');
        }
        continue;
      }

      // Assistant 消息
      if (msg.type === 'assistant' && msg.message) {
        const content = msg.message.content;
        if (!content) continue;

        // content 可能是数组
        const contentArray = Array.isArray(content) ? content : [content];

        for (const c of contentArray) {
          if (!c) continue;

          if (c.type === 'text') {
            // 最终文本响应 - 格式化输出
            if (c.text) {
              formatAndDisplayText(c.text);
            }
          } else if (c.type === 'thinking') {
            // 思考过程
            const thinking = c.thinking || c.thought || '';
            if (thinking) {
              addSessionOutput(`[思考] ${thinking}`, 'info');
            }
          } else if (c.type === 'tool_use') {
            // 工具调用 - 格式化显示
            const toolName = c.name || 'unknown';
            const toolId = c.id || '';
            let toolInput = '';
            if (c.input) {
              // 简化显示 input
              const inputStr = JSON.stringify(c.input);
              toolInput = inputStr.length > 150 ? inputStr.substring(0, 150) + '...' : inputStr;
            }
            addSessionOutput(`⎿ [${toolName}] ${toolInput}`, 'tool');
          }
        }
      }

      // 处理工具结果 - 可能通过不同途径传来
      // 1. tool 角色的消息
      // 2. message.content 中的 tool_result
      if (msg.message?.role === 'tool') {
        const toolContent = msg.message.content;
        if (typeof toolContent === 'string') {
          // 工具结果 - 截断过长的内容
          const truncated = toolContent.length > 800 ? toolContent.substring(0, 800) + '\n... (truncated)' : toolContent;
          addSessionOutput(truncated, 'tool-result');
        }
      }
    }

    // 更新工作状态
    if (data.isWorking !== undefined) {
      updateSessionStatus(data.isWorking ? 'working' : 'idle');
    }
  } else if (data.type === 'heartbeat') {
    updateSessionStatus(data.isWorking ? 'working' : 'idle');
  } else if (data.error) {
    addSessionOutput(`[错误]: ${data.error}`, 'error');
  }
}

// ============ 文件浏览 ============

async function loadFiles(path = '') {
  const fileList = $('file-list');
  const targetPath = path || state.currentProject?.path || '';
  state.currentFilePath = targetPath;

  $('current-path').textContent = targetPath;
  showLoading(fileList, '加载文件...');

  try {
    // 使用tree API获取目录树
    const data = await apiRequest(`/api/files/tree?path=${encodeURIComponent(targetPath)}&depth=2`);

    if (!data.tree?.length) {
      fileList.innerHTML = '<div class="loading">空目录</div>';
      return;
    }

    renderFileTree(data.tree);
  } catch (error) {
    // 如果tree失败，尝试用list
    try {
      const data = await apiRequest(`/api/files/list?path=${encodeURIComponent(targetPath)}`);
      if (!data.items?.length) {
        fileList.innerHTML = '<div class="loading">空目录</div>';
        return;
      }
      renderFileList(data.items);
    } catch (err) {
      fileList.innerHTML = `<div class="loading" style="color: var(--error);">${err.message}</div>`;
    }
  }
}

function renderFileTree(treeData) {
  const fileList = $('file-list');

  function buildTreeHTML(items, level = 0) {
    return items.map(item => {
      const hasChildren = item.isDirectory && item.children?.length > 0;
      const toggleClass = hasChildren ? 'collapsed' : 'leaf';

      return `
        <div class="tree-node">
          <div class="tree-item" data-path="${item.path}" data-is-dir="${item.isDirectory}" style="padding-left: ${level * 16 + 12}px">
            <span class="tree-toggle ${toggleClass}"></span>
            <span class="file-icon">${item.isDirectory ? '📁' : '📄'}</span>
            <span class="file-name">${item.name}</span>
          </div>
          ${hasChildren ? `<div class="tree-children">${buildTreeHTML(item.children, level + 1)}</div>` : ''}
        </div>
      `;
    }).join('');
  }

  fileList.innerHTML = buildTreeHTML(treeData);

  // 添加点击事件
  fileList.querySelectorAll('.tree-item').forEach(item => {
    item.addEventListener('click', () => {
      const isDir = item.dataset.isDir === 'true';
      const itemPath = item.dataset.path;

      if (isDir) {
        // 展开/折叠
        const children = item.nextElementSibling;
        const toggle = item.querySelector('.tree-toggle');
        if (children?.classList.contains('tree-children')) {
          children.classList.toggle('expanded');
          toggle.classList.toggle('collapsed', !children.classList.contains('expanded'));
          toggle.classList.toggle('expanded', children.classList.contains('expanded'));
        }
      } else {
        // 点击文件，查看内容
        openFileViewer(itemPath, item.querySelector('.file-name').textContent);
      }
    });
  });
}

// ============ 文件查看器 ============

function openFileViewer(filePath, fileName) {
  const viewer = $('file-viewer');
  const noFileOpen = $('no-file-open');
  const filenameEl = $('viewer-filename');
  const contentEl = $('viewer-content');

  viewer.classList.remove('hidden');
  noFileOpen.classList.add('hidden');
  filenameEl.textContent = fileName;
  contentEl.innerHTML = '<div class="loading">加载中...</div>';

  // 调用API读取文件
  // 直接传绝对路径，不需要root参数
  apiRequest(`/api/files/read?path=${encodeURIComponent(filePath)}`)
    .then(data => {
      if (data.error) {
        contentEl.innerHTML = `<div class="output-line error">${data.error}</div>`;
      } else {
        contentEl.innerHTML = `<div class="output-line">${escapeHtml(data.content || '')}</div>`;
      }
    })
    .catch(err => {
      contentEl.innerHTML = `<div class="output-line error">读取失败: ${err.message}</div>`;
    });
}

function closeFileViewer() {
  const viewer = $('file-viewer');
  const noFileOpen = $('no-file-open');
  viewer.classList.add('hidden');
  noFileOpen.classList.remove('hidden');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 格式化并显示文本输出
function formatAndDisplayText(text) {
  // 如果包含多行，按行处理
  const lines = text.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // 检测 Claude Code CLI 风格的文件变更行
    if (trimmed.includes('●') || trimmed.includes('◼') || trimmed.includes('✓') ||
        trimmed.includes('Update(') || trimmed.includes('Create(') || trimmed.includes('Delete(') ||
        trimmed.includes('Added') || trimmed.includes('removed') || trimmed.includes('changed') ||
        trimmed.includes('+') || trimmed.includes('-')) {
      // 检测是否是多行 diff 内容
      if (trimmed.startsWith('+') || trimmed.startsWith('-') || trimmed.startsWith('@@')) {
        addSessionOutput(line, 'diff');
      } else {
        addSessionOutput(line, 'file-change');
      }
      continue;
    }

    // 检测进度/任务状态行
    if (trimmed.includes('Cogitated') || trimmed.includes('Thinking') ||
        trimmed.includes('Searching') || trimmed.includes('Reading') ||
        trimmed.includes('Working on') || trimmed.includes('ctrl+o')) {
      addSessionOutput(line, 'info');
      continue;
    }

    // 正常文本行
    if (trimmed) {
      addSessionOutput(line, 'stdout');
    }
  }
}

function renderFileList(items) {
  const fileList = $('file-list');
  fileList.innerHTML = items.map(item => `
    <div class="file-item" data-path="${item.path}" data-is-dir="${item.isDirectory}">
      <span class="file-icon">${item.isDirectory ? '📁' : '📄'}</span>
      <span class="file-name">${item.name}</span>
    </div>
  `).join('');

  fileList.querySelectorAll('.file-item').forEach(item => {
    item.addEventListener('click', () => {
      if (item.dataset.isDir === 'true') {
        loadFiles(item.dataset.path);
      } else {
        // 点击文件，查看内容
        openFileViewer(item.dataset.path, item.querySelector('.file-name').textContent);
      }
    });
  });
}

function goUpDirectory() {
  if (!state.currentFilePath) return;
  const parts = state.currentFilePath.replace(/\\/g, '/').split('/');
  parts.pop();
  const parentPath = parts.join('/') || parts[0] + '/';
  if (parentPath && parentPath !== state.currentFilePath) {
    loadFiles(parentPath);
  }
}

// ============ 终端 ============

async function execCommand() {
  const input = $('cmd-input');
  const command = input.value.trim();
  if (!command) return;

  addTerminalOutput(`$ ${command}`, 'cmd');
  input.value = '';

  try {
    const data = await apiRequest('/api/terminal/exec', {
      method: 'POST',
      body: JSON.stringify({
        command,
        cwd: state.currentProject?.path || '.',
        timeout: 60000
      })
    });
    if (data.stdout) addTerminalOutput(data.stdout, 'stdout');
    if (data.stderr) addTerminalOutput(data.stderr, 'stderr');
    if (data.exitCode !== 0) addTerminalOutput(`[退出码: ${data.exitCode}]`, 'info');
  } catch (error) {
    addTerminalOutput(`执行失败: ${error.message}`, 'error');
  }
}

// ============ 对话功能 ============

async function sendMessage() {
  const input = $('chat-input');
  const message = input.value.trim();
  if (!message || state.isClaudeWorking) return;

  input.value = '';
  state.isClaudeWorking = true;
  updateSessionStatus('working');

  addChatMessage(`[你]: ${message}`, 'user');

  try {
    await apiRequest('/api/chat/send', {
      method: 'POST',
      body: JSON.stringify({
        message,
        sessionId: state.currentSession,
        projectPath: state.currentProject?.path
      })
    });
  } catch (error) {
    addChatMessage(`错误: ${error.message}`, 'error');
    state.isClaudeWorking = false;
    updateSessionStatus('error');
  }
}

// ============ 系统信息 ============

async function loadSystemInfo() {
  try {
    const data = await apiRequest('/api/process/system');
    const memPercent = data.memory ? Math.round(data.memory.used / data.memory.total * 100) : 0;
    $('system-info').textContent = `CPU: ${data.cpu || 0}% | 内存: ${memPercent}%`;
  } catch (e) {
    $('system-info').textContent = '';
  }
}

// ============ 事件绑定 ============

function bindEvents() {
  // 刷新项目
  $('btn-refresh-projects')?.addEventListener('click', loadProjects);

  // 刷新Session
  $('btn-refresh-sessions')?.addEventListener('click', loadSessions);

  // 文件操作
  $('btn-file-up')?.addEventListener('click', goUpDirectory);
  $('btn-file-refresh')?.addEventListener('click', () => loadFiles(state.currentFilePath));
  $('btn-close-viewer')?.addEventListener('click', closeFileViewer);

  // 终端
  $('btn-exec')?.addEventListener('click', execCommand);
  $('cmd-input')?.addEventListener('keypress', (e) => { if (e.key === 'Enter') execCommand(); });
  $('btn-clear-terminal')?.addEventListener('click', () => {
    $('terminal-output').innerHTML = '<div class="output-line system">欢迎使用终端</div>';
  });

  // 对话
  $('btn-send')?.addEventListener('click', sendMessage);
  $('chat-input')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // 分割条拖动
  initSplitDrag();
}

// ============ 分割条拖动 ============

function initSplitDrag() {
  const handle = $('split-handle');
  const editorPane = document.querySelector('.editor-pane');
  const chatPane = document.querySelector('.chat-pane');
  if (!handle || !editorPane || !chatPane) return;

  let isDragging = false;

  handle.addEventListener('mousedown', (e) => {
    isDragging = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;

    const container = document.querySelector('.editor-panel');
    const containerRect = container.getBoundingClientRect();
    const containerWidth = containerRect.width;
    let newWidth = e.clientX - containerRect.left;

    // 限制最小宽度
    newWidth = Math.max(200, Math.min(containerWidth - 300, newWidth));

    // 设置宽度
    editorPane.style.flex = 'none';
    editorPane.style.width = newWidth + 'px';
    chatPane.style.flex = '1';
  });

  document.addEventListener('mouseup', () => {
    isDragging = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
}

// ============ 初始化 ============

async function init() {
  connectWS();
  initViewSwitcher();
  bindEvents();
  loadProjects();
  loadSystemInfo();

  setInterval(loadSystemInfo, 5000);
  setInterval(loadSessions, 3000);
}

document.addEventListener('DOMContentLoaded', init);
