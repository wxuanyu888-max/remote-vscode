// Remote VS Code - 主入口
import { state } from './modules/state.js';
import { connectWS, apiRequest } from './modules/api.js';
import { loadProjects, refreshProjects } from './modules/projects.js';
import { loadSessions } from './modules/sessions.js';
import { loadFiles, goUpDirectory, refreshFiles } from './modules/files.js';
import { initTerminal } from './modules/terminal.js';
import { initSplitHandles, initEditorGroupDrops } from './modules/split.js';

function initViewSwitcher() {
  const activityBtns = document.querySelectorAll('.activity-btn');

  activityBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;

      // 更新活动栏按钮状态
      activityBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // 更新侧边栏视图
      const sidebarViews = document.querySelectorAll('.sidebar-view');
      sidebarViews.forEach(v => v.classList.remove('active'));

      const targetView = document.getElementById(`view-${view}`);
      if (targetView) {
        targetView.classList.add('active');
      }

      state.currentView = view;
    });
  });
}

function bindEvents() {
  // 项目刷新按钮
  const refreshBtn = document.getElementById('btn-refresh-projects');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', refreshProjects);
  }

  // 文件导航按钮
  const fileUpBtn = document.getElementById('btn-file-up');
  if (fileUpBtn) {
    fileUpBtn.addEventListener('click', goUpDirectory);
  }

  const fileRefreshBtn = document.getElementById('btn-file-refresh');
  if (fileRefreshBtn) {
    fileRefreshBtn.addEventListener('click', refreshFiles);
  }

  // 终端清空按钮
  const clearTerminalBtn = document.getElementById('btn-clear-terminal');
  if (clearTerminalBtn) {
    clearTerminalBtn.addEventListener('click', () => {
      const output = document.getElementById('terminal-output');
      if (output) {
        output.innerHTML = '<div class="output-line system">终端已清空</div>';
      }
    });
  }

  // 新建对话按钮
  const newChatBtn = document.getElementById('btn-new-chat');
  if (newChatBtn) {
    newChatBtn.addEventListener('click', async () => {
      const sessionId = await createNewSession();
      if (sessionId) {
        import('./modules/tabs.js').then(m => m.openChatTab(sessionId, '新对话'));
      }
    });
  }
}

async function createNewSession() {
  try {
    const data = await apiRequest('/api/chat/sessions', {
      method: 'POST',
      body: JSON.stringify({})
    });
    if (data.sessionId) {
      loadSessions();
      return data.sessionId;
    }
  } catch (error) {
    console.error('创建会话失败:', error);
  }
  return null;
}

async function loadSystemInfo() {
  try {
    const data = await apiRequest('/api/process/system');
    const infoEl = document.getElementById('system-info');
    if (infoEl && data) {
      const cpu = data.cpu || 0;
      const memory = data.memory || 0;
      infoEl.textContent = `CPU: ${cpu}% | 内存: ${memory}%`;
    }
  } catch (error) {
    console.error('获取系统信息失败:', error);
  }
}

async function init() {
  connectWS();
  initViewSwitcher();
  bindEvents();
  loadProjects();
  loadSystemInfo();
  initTerminal();
  initSplitHandles();
  initEditorGroupDrops();

  setInterval(loadSystemInfo, 5000);
  setInterval(loadSessions, 3000);
}

document.addEventListener('DOMContentLoaded', init);
