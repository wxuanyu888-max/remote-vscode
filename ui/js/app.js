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
  currentView: 'explorer',
  currentFilePath: '',
  eventSource: null,  // SSE 连接
  openTabs: [],       // 打开的标签数组
  activeTab: 'welcome', // 当前激活的标签
  tabIdCounter: 0,     // 标签ID计数器
  editorGroups: [{ id: 'main', tabs: [] }], // 编辑器分组（支持分屏）
  activeGroup: 'main', // 当前激活的分组
  draggedTab: null     // 当前拖拽的标签
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
  // 使用 chat-messages 区域显示
  const output = $('chat-messages') || $('session-output');
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
  // 不再需要 project-list 元素，直接加载
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
    console.error('加载项目失败:', error);
  }
}

function renderProjects() {
  const projectSelect = $('project-select');
  if (!projectSelect) return;

  // 填充下拉框
  projectSelect.innerHTML = '<option value="">选择项目...</option>' +
    state.projects.map(project =>
      `<option value="${project.path}" data-name="${project.name}">${project.name}</option>`
    ).join('');

  // 绑定选择事件
  projectSelect.addEventListener('change', (e) => {
    const path = e.target.value;
    const name = e.target.options[e.target.selectedIndex]?.dataset?.name || path.split(/[/\\]/).pop();
    if (path) {
      selectProject(path, name);
    }
  });

  // 默认选中第一个
  if (state.projects.length > 0 && !state.currentProject) {
    const firstProject = state.projects[0];
    projectSelect.value = firstProject.path;
    selectProject(firstProject.path, firstProject.name);
  }
}

function selectProject(path, name) {
  state.currentProject = { path, name };
  state.currentFilePath = path;

  // 传递 projectId 给后端
  const projectId = encodeProjectPath(path);
  loadSessions(projectId);

  // 始终加载文件
  loadFiles(path);
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
  // 将 C:\Users\29718\remote-vscode 转换为 C--Users-29718-remote-vscode
  // 驱动器号后面的 \ 变成 --，其他 \ 变成 -
  return filePath
    .replace(/^([a-zA-Z]):\\/, '$1--')  // C:\ -> C--
    .replace(/\\/g, '-');                // 其他 \ -> -
}

// ============ Session列表 ============

async function loadSessions(projectId = null) {
  const sessionSelect = $('session-select');
  if (!sessionSelect) return;

  showLoading(sessionSelect, '加载Session...');

  try {
    // 如果传入了 projectId，传递给后端
    const url = projectId ? `/api/chat/sessions?projectId=${encodeURIComponent(projectId)}` : '/api/chat/sessions';
    console.log('[loadSessions] URL:', url);
    const data = await apiRequest(url);
    console.log('[loadSessions] sessions:', data.sessions?.length);
    state.sessions = data.sessions || [];

    if (!state.sessions.length) {
      sessionSelect.innerHTML = '<option value="">暂无 Session</option>';
      showLoading(sessionSelect, '');
      return;
    }

    renderSessions();
  } catch (error) {
    console.error('[loadSessions] Error:', error);
    sessionSelect.innerHTML = `<option value="">加载失败</option>`;
  }
}

function renderSessions() {
  const sessionSelect = $('session-select');
  if (!sessionSelect) return;

  // 过滤出正在运行的 session
  const workingSessions = state.sessions.filter(s => s.status === 'working');

  if (workingSessions.length > 0) {
    // 有正在运行的 session，显示它们
    sessionSelect.innerHTML = '<option value="">选择运行中的 Session...</option>' +
      workingSessions.map(session => {
        const sessionId = session.id || session.sessionId || 'unknown';
        const shortId = sessionId.substring(0, 8);
        return `<option value="${sessionId}">${session.name || `Session ${shortId}`} (工作中)</option>`;
      }).join('');

    // 自动选中第一个正在运行的 session（如果没有选中其他）
    if (!state.currentSession) {
      const firstWorking = workingSessions[0];
      const sessionId = firstWorking.id || firstWorking.sessionId;
      sessionSelect.value = sessionId;
      selectSession(sessionId);
    }
  } else {
    // 没有正在运行的 session，显示所有 idle 的
    sessionSelect.innerHTML = '<option value="">暂无运行中的 Session</option>' +
      state.sessions.slice(0, 5).map(session => {
        const sessionId = session.id || session.sessionId || 'unknown';
        const shortId = sessionId.substring(0, 8);
        return `<option value="${sessionId}">${session.name || `Session ${shortId}`}</option>`;
      }).join('');
  }

  // 绑定选择事件
  sessionSelect.onchange = (e) => {
    const sessionId = e.target.value;
    if (sessionId) {
      selectSession(sessionId);
    }
  };
}

function selectSession(sessionId) {
  // 更新下拉框选中状态
  const sessionSelect = $('session-select');
  if (sessionSelect) {
    sessionSelect.value = sessionId;
  }

  state.currentSession = sessionId;

  const session = state.sessions.find(s => (s.id || s.sessionId) === sessionId);

  // 更新聊天区域
  const chatMessages = $('chat-messages');
  if (chatMessages) {
    chatMessages.innerHTML = `
      <div class="output-line system">=== 会话: ${sessionId.substring(0, 8)} ===</div>
      <div class="output-line system">项目: ${state.currentProject?.name || '未知'}</div>
      <div class="output-line system">正在连接实时流...</div>
    `;
  }

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

// ============ 多标签页管理 ============

// 打开文件标签
function openFileTab(filePath, fileName) {
  // 检查是否已存在该文件的标签
  const existingTab = state.openTabs.find(t => t.type === 'file' && t.path === filePath);
  if (existingTab) {
    switchToTab(existingTab.id);
    return;
  }

  // 创建新标签
  const tabId = 'file-' + (++state.tabIdCounter);
  const tab = {
    id: tabId,
    type: 'file',
    name: fileName,
    path: filePath,
    groupId: state.activeGroup
  };
  state.openTabs.push(tab);

  // 将标签添加到当前分组
  const group = state.editorGroups.find(g => g.id === state.activeGroup);
  if (group) {
    group.tabs.push(tabId);
  }

  // 创建标签元素
  renderTab(tab, state.activeGroup);

  // 创建标签内容
  renderFileTabContent(tab, state.activeGroup);

  // 切换到新标签
  switchToTab(tabId);
}

// 打开对话标签
function openChatTab(sessionId, sessionName) {
  // 检查是否已存在该对话的标签
  const existingTab = state.openTabs.find(t => t.type === 'chat' && t.sessionId === sessionId);
  if (existingTab) {
    switchToTab(existingTab.id);
    return;
  }

  // 创建新标签
  const tabId = 'chat-' + (++state.tabIdCounter);
  const tab = {
    id: tabId,
    type: 'chat',
    name: sessionName || '新对话',
    sessionId: sessionId,
    groupId: state.activeGroup
  };
  state.openTabs.push(tab);

  // 将标签添加到当前分组
  const group = state.editorGroups.find(g => g.id === state.activeGroup);
  if (group) {
    group.tabs.push(tabId);
  }

  // 创建标签元素
  renderTab(tab, state.activeGroup);

  // 创建对话标签内容（复用现有的session-detail）
  renderChatTabContent(tab, state.activeGroup);

  // 切换到新标签
  switchToTab(tabId);
}

// 渲染标签
function renderTab(tab, groupId = 'main') {
  // 根据 groupId 获取正确的 tabs-bar
  let tabsBar;
  if (groupId === 'main') {
    tabsBar = $('tabs-bar');
  } else {
    tabsBar = document.querySelector(`[data-group-tabs="${groupId}"]`);
  }

  if (!tabsBar) {
    console.log('[渲染] 未找到 tabs-bar, groupId:', groupId);
    return;
  }

  const tabEl = document.createElement('div');
  tabEl.className = 'tab';
  tabEl.dataset.tabId = tab.id;
  tabEl.dataset.groupId = groupId;
  tabEl.draggable = true;

  const icon = tab.type === 'file' ? '📄' : '💬';
  tabEl.innerHTML = `
    <span class="tab-icon">${icon}</span>
    <span class="tab-name">${tab.name}</span>
    <span class="tab-actions">
      <button class="split-btn" data-split="vertical" title="分屏">⧈</button>
      <button class="close-btn" title="关闭">×</button>
    </span>
  `;

  // 点击事件处理
  tabEl.addEventListener('click', (e) => {
    const target = e.target;
    if (target.classList.contains('close-btn')) {
      e.stopPropagation();
      closeTab(tab.id);
    } else if (target.classList.contains('split-btn')) {
      e.stopPropagation();
      const splitType = target.dataset.split;
      splitEditor(splitType);
    } else {
      switchToTab(tab.id);
    }
  });

  // 拖拽事件
  tabEl.addEventListener('dragstart', handleTabDragStart);
  tabEl.addEventListener('dragend', handleTabDragEnd);
  tabEl.addEventListener('dragover', handleTabDragOver);
  tabEl.addEventListener('dragleave', handleTabDragLeave);
  tabEl.addEventListener('drop', handleTabDrop);

  tabsBar.appendChild(tabEl);
}

// ============ 标签拖拽功能 ============

function handleTabDragStart(e) {
  const tabEl = e.target.closest('.tab');
  if (!tabEl) {
    return;
  }

  state.draggedTab = tabEl;
  tabEl.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', tabEl.dataset.tabId);

  // 设置拖拽图像
  const dragImage = tabEl.cloneNode(true);
  dragImage.style.opacity = '0.8';
  document.body.appendChild(dragImage);
  e.dataTransfer.setDragImage(dragImage, 50, 20);
  setTimeout(() => dragImage.remove(), 0);
}

function handleTabDragEnd(e) {
  const tabEl = e.target.closest('.tab');
  if (tabEl) {
    tabEl.classList.remove('dragging');
  }
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('drag-over'));
  state.draggedTab = null;
}

function handleTabDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  const tab = e.target.closest('.tab');
  if (tab && tab !== state.draggedTab) {
    tab.classList.add('drag-over');
  }
}

function handleTabDragLeave(e) {
  const tab = e.target.closest('.tab');
  if (tab) {
    tab.classList.remove('drag-over');
  }
}

function handleTabDrop(e) {
  e.preventDefault();
  e.stopPropagation();

  const targetTab = e.target.closest('.tab');
  let targetGroup = e.target.closest('.editor-group');

  // 如果没有找到 editor-group，尝试从 tabs-bar 向上查找
  if (!targetGroup) {
    const tabsBar = e.target.closest('.tabs-bar');
    if (tabsBar) {
      targetGroup = tabsBar.closest('.editor-group');
    }
  }

  // 再尝试从 tab-contents 向上查找
  if (!targetGroup) {
    const tabContents = e.target.closest('.tab-contents');
    if (tabContents) {
      targetGroup = tabContents.closest('.editor-group');
    }
  }

  const draggedTabId = state.draggedTab?.dataset.tabId;
  const draggedGroupId = state.draggedTab?.dataset.groupId;

  if (!draggedTabId || !draggedGroupId) {
    return;
  }

  // 如果拖拽到其他分组的空白区域
  if (targetGroup && targetGroup.dataset.groupId !== draggedGroupId) {
    moveTabToGroup(draggedTabId, targetGroup.dataset.groupId);
    return;
  }

  // 如果拖拽到另一个标签
  if (targetTab && targetTab !== state.draggedTab) {
    const targetTabId = targetTab.dataset.tabId;
    const targetTabGroupId = targetTab.dataset.groupId;

    if (draggedGroupId === targetTabGroupId) {
      // 同组内排序
      reorderTabs(draggedTabId, targetTabId);
    } else {
      // 跨组移动
      moveTabToGroup(draggedTabId, targetTabGroupId);
    }
  }

  if (targetTab) targetTab.classList.remove('drag-over');
}

// 重新排序标签
function reorderTabs(draggedTabId, targetTabId) {
  const draggedIndex = state.openTabs.findIndex(t => t.id === draggedTabId);
  const targetIndex = state.openTabs.findIndex(t => t.id === targetTabId);

  if (draggedIndex === -1 || targetIndex === -1) return;

  // 获取拖拽的标签
  const [draggedTab] = state.openTabs.splice(draggedIndex, 1);

  // 插入到目标位置
  const newIndex = state.openTabs.findIndex(t => t.id === targetTabId);
  state.openTabs.splice(newIndex, 0, draggedTab);

  // 重新渲染标签栏
  refreshTabBar();
}

// 刷新标签栏
function refreshTabBar() {
  // 刷新所有分组的标签栏
  state.editorGroups.forEach(group => {
    // 找到该分组的 tabs-bar
    let tabsBar;
    if (group.id === 'main') {
      tabsBar = $('tabs-bar');
    } else {
      tabsBar = document.querySelector(`[data-group-tabs="${group.id}"]`);
    }

    if (!tabsBar) {
      return;
    }

    // 清空标签栏
    tabsBar.innerHTML = '';

    // 渲染该分组的所有标签
    const groupTabs = state.openTabs.filter(tab => {
      // 检查标签是否属于该分组
      const tabGroupId = tab.groupId || 'main';
      return tabGroupId === group.id;
    });

    groupTabs.forEach(tab => {
      renderTab(tab, group.id);
    });
  });
}

// ============ 分屏功能 ============

// 分屏编辑器
function splitEditor(direction, tabId = null) {
  const editorGroups = $('editor-groups');
  const currentTabId = tabId || state.activeTab;

  // 创建新的分组
  const newGroupId = 'group-' + Date.now();
  const newGroup = { id: newGroupId, tabs: [] };
  state.editorGroups.push(newGroup);

  // 创建新的编辑器分组DOM
  const newGroupEl = document.createElement('div');
  newGroupEl.className = 'editor-group';
  newGroupEl.dataset.groupId = newGroupId;

  // 创建新分组的内容
  newGroupEl.innerHTML = `
    <div class="group-header">
      <button class="group-close-btn" data-group-id="${newGroupId}" title="关闭此分屏">×</button>
    </div>
    <div class="tabs-bar" data-group-tabs="${newGroupId}"></div>
    <div class="tab-contents" data-group-contents="${newGroupId}"></div>
  `;

  // 绑定关闭分组按钮事件
  newGroupEl.querySelector('.group-close-btn').addEventListener('click', () => {
    closeGroupById(newGroupId);
  });

  // 绑定分组的 drop 事件（允许拖拽到其他分屏）
  newGroupEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  });
  newGroupEl.addEventListener('drop', handleTabDrop);

  // 为新建的 tabs-bar 添加事件
  const newTabsBar = newGroupEl.querySelector('.tabs-bar');
  if (newTabsBar) {
    newTabsBar.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    newTabsBar.addEventListener('drop', handleTabDrop);
  }

  // 为新建的 tab-contents 添加事件
  const newTabContents = newGroupEl.querySelector('.tab-contents');
  if (newTabContents) {
    newTabContents.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    newTabContents.addEventListener('drop', handleTabDrop);
  }

  // 添加分隔条
  const handle = document.createElement('div');
  handle.className = 'split-handle';
  handle.dataset.prevGroup = state.activeGroup;
  handle.dataset.nextGroup = newGroupId;

  // 插入新分组
  const lastGroup = editorGroups.lastElementChild;
  if (direction === 'vertical') {
    // 垂直分屏（左右）
    editorGroups.insertBefore(handle, lastGroup);
    editorGroups.insertBefore(newGroupEl, lastGroup);
  } else {
    // 水平分屏（上下）- 需要特殊处理
    // 暂时使用左右分屏
    editorGroups.insertBefore(handle, lastGroup);
    editorGroups.insertBefore(newGroupEl, lastGroup);
  }

  // 激活新分组
  state.activeGroup = newGroupId;

  // 刷新标签栏
  refreshTabBar();

  // 初始化分隔条拖拽
  initSplitHandle(handle);
}

// 从分组中移除标签
function removeTabFromGroup(tabId) {
  state.editorGroups.forEach(group => {
    const index = group.tabs.indexOf(tabId);
    if (index > -1) {
      group.tabs.splice(index, 1);
    }
  });
}

// 将标签移动到指定分组
function moveTabToGroup(tabId, groupId) {
  // 找到标签
  const tab = state.openTabs.find(t => t.id === tabId);
  if (!tab) {
    return;
  }

  // 更新标签的 groupId
  tab.groupId = groupId;

  // 从所有分组中移除
  removeTabFromGroup(tabId);

  // 添加到目标分组
  const group = state.editorGroups.find(g => g.id === groupId);
  if (group) {
    group.tabs.push(tabId);
  }

  // 移动标签内容到正确的分屏
  let targetTabContents;
  if (groupId === 'main') {
    targetTabContents = $('tab-contents');
  } else {
    targetTabContents = document.querySelector(`[data-group-contents="${groupId}"]`);
  }

  // 找到当前标签的内容并移动
  const oldContent = document.querySelector(`.tab-content[data-tab-id="${tabId}"]`);
  if (oldContent && targetTabContents) {
    oldContent.dataset.groupId = groupId;
    targetTabContents.appendChild(oldContent);
  } else if (targetTabContents) {
    // 如果没有内容，创建新的
    if (tab.type === 'file') {
      renderFileTabContent(tab, groupId);
    } else if (tab.type === 'chat') {
      renderChatTabContent(tab, groupId);
    }
  }

  // 刷新标签栏显示
  refreshTabBar();

  // 激活该标签的显示
  state.activeTab = tabId;
  state.activeGroup = groupId;

  // 更新标签激活状态
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tabId === tabId);
  });

  // 更新内容区激活状态 - 找到所有分组的 tab-content
  document.querySelectorAll('.tab-content').forEach(c => {
    c.classList.toggle('active', c.dataset.tabId === tabId);
  });
}

// 刷新所有分组
function refreshAllGroups() {
  refreshTabBar();
}

// 初始化分隔条拖拽
function initSplitHandle(handle) {
  let startX, startWidth, prevGroup, nextGroup;

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    handle.classList.add('dragging');

    startX = e.clientX;
    prevGroup = handle.previousElementSibling;
    nextGroup = handle.nextElementSibling;

    if (prevGroup) {
      startWidth = prevGroup.offsetWidth;
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  function onMouseMove(e) {
    if (!startWidth) return;

    const diff = e.clientX - startX;
    const newWidth = Math.max(200, startWidth + diff);

    if (prevGroup) {
      prevGroup.style.flex = `0 0 ${newWidth}px`;
    }
  }

  function onMouseUp() {
    handle.classList.remove('dragging');
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  }
}

// 关闭分组
function closeGroup(tabId) {
  const editorGroups = $('editor-groups');
  const groups = editorGroups.querySelectorAll('.editor-group');

  // 至少保留一个分组
  if (groups.length <= 1) {
    return;
  }

  // 找到包含该标签的分组
  let targetGroup = null;
  let targetGroupEl = null;
  let targetGroupId = null;

  for (const group of state.editorGroups) {
    if (group.tabs.includes(tabId)) {
      targetGroup = group;
      targetGroupId = group.id;
      break;
    }
  }

  // 如果没找到标签所属分组，尝试关闭当前激活的分组
  if (!targetGroup) {
    targetGroupId = state.activeGroup;
    targetGroup = state.editorGroups.find(g => g.id === targetGroupId);
  }

  // 不能关闭主分组
  if (targetGroupId === 'main') {
    return;
  }

  // 找到分组对应的DOM元素
  targetGroupEl = editorGroups.querySelector(`[data-group-id="${targetGroupId}"]`);

  // 将该分组的标签移动到主分组
  if (targetGroup && targetGroup.tabs.length > 0) {
    targetGroup.tabs.forEach(tid => {
      const tab = state.openTabs.find(t => t.id === tid);
      if (tab) {
        removeTabFromGroup(tid);
        const mainGroup = state.editorGroups.find(g => g.id === 'main');
        if (mainGroup) {
          mainGroup.tabs.push(tid);
        }
      }
    });
    // 切换到第一个标签
    if (targetGroup.tabs.length > 0) {
      switchToTab(targetGroup.tabs[0]);
    }
  }

  // 从状态中移除分组
  state.editorGroups = state.editorGroups.filter(g => g.id !== targetGroupId);

  // 从DOM中移除分组和分隔条
  if (targetGroupEl) {
    // 找到并移除相邻的分隔条
    const handle = targetGroupEl.previousElementSibling;
    if (handle && handle.classList.contains('split-handle')) {
      handle.remove();
    }
    targetGroupEl.remove();
  }

  // 激活主分组
  state.activeGroup = 'main';
}

// 根据分组ID关闭分组
function closeGroupById(groupId) {
  // 不能关闭主分组
  if (groupId === 'main') {
    return;
  }

  const editorGroups = $('editor-groups');
  const groups = editorGroups.querySelectorAll('.editor-group');

  // 至少保留一个分组
  if (groups.length <= 1) {
    return;
  }

  // 找到目标分组
  const targetGroup = state.editorGroups.find(g => g.id === groupId);
  if (!targetGroup) return;

  const targetGroupEl = editorGroups.querySelector(`[data-group-id="${groupId}"]`);

  // 将该分组的标签移动到主分组
  if (targetGroup && targetGroup.tabs.length > 0) {
    targetGroup.tabs.forEach(tid => {
      const tab = state.openTabs.find(t => t.id === tid);
      if (tab) {
        removeTabFromGroup(tid);
        const mainGroup = state.editorGroups.find(g => g.id === 'main');
        if (mainGroup) {
          mainGroup.tabs.push(tid);
        }
      }
    });
    // 切换到第一个标签
    if (targetGroup.tabs.length > 0) {
      switchToTab(targetGroup.tabs[0]);
    }
  }

  // 从状态中移除分组
  state.editorGroups = state.editorGroups.filter(g => g.id !== groupId);

  // 从DOM中移除分组和分隔条
  if (targetGroupEl) {
    // 找到并移除相邻的分隔条
    const handle = targetGroupEl.previousElementSibling;
    if (handle && handle.classList.contains('split-handle')) {
      handle.remove();
    }
    targetGroupEl.remove();
  }

  // 激活主分组
  state.activeGroup = 'main';
}

// 渲染文件标签内容
function renderFileTabContent(tab, groupId = 'main') {
  // 根据 groupId 获取正确的 tabContents
  let tabContents;
  if (groupId === 'main') {
    tabContents = $('tab-contents');
  } else {
    tabContents = document.querySelector(`[data-group-contents="${groupId}"]`);
  }

  if (!tabContents) return;

  const contentEl = document.createElement('div');
  contentEl.className = 'tab-content';
  contentEl.dataset.tabId = tab.id;
  contentEl.dataset.groupId = groupId;
  contentEl.innerHTML = `
    <div class="viewer-header">
      <span class="viewer-title">${tab.name}</span>
    </div>
    <div class="viewer-content">
      <div class="loading">加载中...</div>
    </div>
  `;
  tabContents.appendChild(contentEl);

  // 加载文件内容
  apiRequest(`/api/files/read?path=${encodeURIComponent(tab.path)}`)
    .then(data => {
      const viewerContent = contentEl.querySelector('.viewer-content');
      if (data.error) {
        viewerContent.innerHTML = `<div class="output-line error">${data.error}</div>`;
      } else {
        viewerContent.innerHTML = `<div class="output-line">${escapeHtml(data.content || '')}</div>`;
      }
    })
    .catch(err => {
      contentEl.querySelector('.viewer-content').innerHTML = `<div class="output-line error">读取失败: ${err.message}</div>`;
    });
}

// 渲染对话标签内容
function renderChatTabContent(tab, groupId = 'main') {
  // 根据 groupId 获取正确的 tabContents
  let tabContents;
  if (groupId === 'main') {
    tabContents = $('tab-contents');
  } else {
    tabContents = document.querySelector(`[data-group-contents="${groupId}"]`);
  }

  if (!tabContents) return;

  const contentEl = document.createElement('div');
  contentEl.className = 'tab-content';
  contentEl.dataset.tabId = tab.id;
  contentEl.dataset.groupId = groupId;

  // 复用现有的session-detail结构
  contentEl.innerHTML = `
    <div class="session-header">
      <span class="session-title">活跃 Session</span>
      <button class="icon-btn btn-refresh-sessions" title="刷新Session">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M13.65 2.35A8 8 0 1 0 16 8h-2a6 6 0 1 1-1.75-4.25L10 6h6V0l-2.35 2.35z"/>
        </svg>
      </button>
    </div>
    <div class="session-list">
      <div class="empty-state">
        <p>加载中...</p>
      </div>
    </div>
    <div class="session-detail">
      <div class="detail-header">
        <div class="session-info">
          <span class="session-name">-</span>
          <span class="session-status">空闲</span>
        </div>
        <div class="session-path">-</div>
      </div>
      <div class="work-output">
        <div class="output-header"><span>当前工作</span></div>
        <div class="output-content"><div class="output-line system">选择 Session 后查看工作状态</div></div>
      </div>
      <div class="chat-section">
        <div class="chat-header">对话</div>
        <div class="chat-messages"><div class="output-line system">选择 Session 开始对话</div></div>
        <div class="chat-input-area">
          <input type="text" class="chat-input" placeholder="输入消息...">
          <button class="btn-send">发送</button>
        </div>
      </div>
    </div>
  `;

  tabContents.appendChild(contentEl);
}

// 切换到指定标签
function switchToTab(tabId) {
  state.activeTab = tabId;

  // 更新标签栏激活状态
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tabId === tabId);
  });

  // 更新内容区激活状态
  document.querySelectorAll('.tab-content').forEach(c => {
    c.classList.toggle('active', c.dataset.tabId === tabId);
  });
}

// 关闭标签
function closeTab(tabId) {
  const tabIndex = state.openTabs.findIndex(t => t.id === tabId);
  if (tabIndex === -1) return;

  // 移除标签和数据
  state.openTabs.splice(tabIndex, 1);

  // 移除DOM元素
  document.querySelector(`.tab[data-tab-id="${tabId}"]`)?.remove();
  document.querySelector(`.tab-content[data-tab-id="${tabId}"]`)?.remove();

  // 如果关闭的是当前激活的标签，切换到其他标签
  if (state.activeTab === tabId) {
    if (state.openTabs.length > 0) {
      // 切换到最后一个标签
      switchToTab(state.openTabs[state.openTabs.length - 1].id);
    } else {
      // 显示欢迎页
      state.activeTab = 'welcome';
      switchToTab('welcome');
    }
  }
}

// 切换到欢迎页
function switchToWelcome() {
  state.activeTab = 'welcome';
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  $('tab-content-welcome')?.classList.add('active');
}

// ============ 文件查看器（旧函数保留兼容性）============

function openFileViewer(filePath, fileName) {
  openFileTab(filePath, fileName);
}

function closeFileViewer() {
  if (state.activeTab !== 'welcome') {
    closeTab(state.activeTab);
  }
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

  // 刷新Session（全局）
  $('btn-refresh-sessions')?.addEventListener('click', loadSessions);

  // 文件操作
  $('btn-file-up')?.addEventListener('click', goUpDirectory);
  $('btn-file-refresh')?.addEventListener('click', () => loadFiles(state.currentFilePath));

  // 欢迎页新对话按钮
  $('btn-new-chat')?.addEventListener('click', () => {
    // 切换到对话视图
    document.querySelectorAll('.activity-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('[data-view="explorer"]')?.classList.add('active');
    document.querySelectorAll('.sidebar-view').forEach(v => v.classList.remove('active'));
    $('view-explorer')?.classList.add('active');
  });

  // 终端
  $('btn-exec')?.addEventListener('click', execCommand);
  $('cmd-input')?.addEventListener('keypress', (e) => { if (e.key === 'Enter') execCommand(); });
  $('btn-clear-terminal')?.addEventListener('click', () => {
    $('terminal-output').innerHTML = '<div class="output-line system">欢迎使用终端</div>';
  });

  // 对话发送
  $('btn-send')?.addEventListener('click', sendMessage);
  $('chat-input')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
}
// ============ 初始化 ============

async function init() {
  connectWS();
  initViewSwitcher();
  bindEvents();
  loadProjects();
  loadSystemInfo();
  initSplitHandles();
  initEditorGroupDrops();

  setInterval(loadSystemInfo, 5000);
  setInterval(loadSessions, 3000);
}

// 初始化编辑组分组的 drop 事件
function initEditorGroupDrops() {
  // 为所有 editor-group 添加事件
  document.querySelectorAll('.editor-group').forEach(group => {
    group.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    group.addEventListener('drop', handleTabDrop);
  });

  // 为所有 tabs-bar 添加事件
  document.querySelectorAll('.tabs-bar').forEach(tabsBar => {
    tabsBar.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    tabsBar.addEventListener('drop', handleTabDrop);
  });

  // 为所有 tab-contents 添加事件
  document.querySelectorAll('.tab-contents').forEach(contents => {
    contents.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    contents.addEventListener('drop', handleTabDrop);
  });
}

// 初始化所有分隔条
function initSplitHandles() {
  document.querySelectorAll('.split-handle').forEach(handle => {
    initSplitHandle(handle);
  });
}

document.addEventListener('DOMContentLoaded', init);
