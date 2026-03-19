// 标签页管理模块
import { state, $ } from './state.js';
import { apiRequest } from './api.js';

export function openFileTab(filePath, fileName) {
  // 检查是否已存在该文件的标签
  const existingTab = state.openTabs.find(t => t.path === filePath && t.type === 'file');
  if (existingTab) {
    switchToTab(existingTab.id);
    return;
  }

  const tabId = 'file-' + (++state.tabIdCounter);
  const tab = {
    id: tabId,
    type: 'file',
    name: fileName,
    path: filePath,
    groupId: state.activeGroup
  };
  state.openTabs.push(tab);

  const group = state.editorGroups.find(g => g.id === state.activeGroup);
  if (group) {
    group.tabs.push(tabId);
  }

  renderTab(tab, state.activeGroup);
  renderFileTabContent(tab, state.activeGroup);
  switchToTab(tabId);
}

export function openChatTab(sessionId, sessionName) {
  const existingTab = state.openTabs.find(t => t.sessionId === sessionId && t.type === 'chat');
  if (existingTab) {
    switchToTab(existingTab.id);
    return;
  }

  const tabId = 'chat-' + (++state.tabIdCounter);
  const tab = {
    id: tabId,
    type: 'chat',
    name: sessionName || '新对话',
    sessionId: sessionId,
    groupId: state.activeGroup
  };
  state.openTabs.push(tab);

  const group = state.editorGroups.find(g => g.id === state.activeGroup);
  if (group) {
    group.tabs.push(tabId);
  }

  renderTab(tab, state.activeGroup);
  renderChatTabContent(tab, state.activeGroup);
  switchToTab(tabId);
}

export function openTerminalTab() {
  // 检查是否已存在终端标签
  const existingTab = state.openTabs.find(t => t.type === 'terminal');
  if (existingTab) {
    switchToTab(existingTab.id);
    return;
  }

  const tabId = 'terminal-' + (++state.tabIdCounter);
  const tab = {
    id: tabId,
    type: 'terminal',
    name: '终端',
    groupId: state.activeGroup
  };
  state.openTabs.push(tab);

  const group = state.editorGroups.find(g => g.id === state.activeGroup);
  if (group) {
    group.tabs.push(tabId);
  }

  renderTab(tab, state.activeGroup);
  renderTerminalTabContent(tab, state.activeGroup);
  switchToTab(tabId);
}

export function renderTab(tab, groupId = 'main') {
  let tabsBar;
  if (groupId === 'main') {
    tabsBar = $('tabs-bar');
  } else {
    tabsBar = document.querySelector(`[data-group-tabs="${groupId}"]`);
  }

  if (!tabsBar) return;

  const tabEl = document.createElement('div');
  tabEl.className = 'tab';
  tabEl.dataset.tabId = tab.id;
  tabEl.dataset.groupId = groupId;
  tabEl.draggable = true;

  const icon = tab.type === 'file' ? '📄' : tab.type === 'chat' ? '💬' : '⬛';
  tabEl.innerHTML = `
    <span class="tab-icon">${icon}</span>
    <span class="tab-name">${tab.name}</span>
    <span class="tab-actions">
      <button class="split-btn" data-split="right" title="向右分屏">⫽</button>
      <button class="close-btn" title="关闭">×</button>
    </span>
  `;

  tabEl.addEventListener('click', (e) => {
    const target = e.target;
    if (target.classList.contains('close-btn')) {
      e.stopPropagation();
      closeTab(tab.id);
    } else if (target.classList.contains('split-btn')) {
      e.stopPropagation();
      // 动态导入 split 模块
      import('./split.js').then(m => m.splitEditor(target.dataset.split));
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

// 拖拽处理函数
function handleTabDragStart(e) {
  const tabEl = e.target.closest('.tab');
  if (!tabEl) return;

  state.draggedTab = tabEl;
  tabEl.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', tabEl.dataset.tabId);

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
  const draggedTabId = state.draggedTab?.dataset.tabId;
  const draggedGroupId = state.draggedTab?.dataset.groupId;

  if (!draggedTabId || !draggedGroupId) return;

  if (targetTab && targetTab !== state.draggedTab) {
    const targetTabId = targetTab.dataset.tabId;
    reorderTabs(draggedTabId, targetTabId);
  }

  if (targetTab) targetTab.classList.remove('drag-over');
}

export function reorderTabs(draggedTabId, targetTabId) {
  const draggedIndex = state.openTabs.findIndex(t => t.id === draggedTabId);
  const targetIndex = state.openTabs.findIndex(t => t.id === targetTabId);

  if (draggedIndex === -1 || targetIndex === -1) return;

  const [draggedTab] = state.openTabs.splice(draggedIndex, 1);
  const newIndex = state.openTabs.findIndex(t => t.id === targetTabId);
  state.openTabs.splice(newIndex, 0, draggedTab);

  refreshTabBar();
}

export function refreshTabBar() {
  state.editorGroups.forEach(group => {
    let tabsBar;
    if (group.id === 'main') {
      tabsBar = $('tabs-bar');
    } else {
      tabsBar = document.querySelector(`[data-group-tabs="${group.id}"]`);
    }

    if (!tabsBar) return;

    tabsBar.innerHTML = '';

    const groupTabs = state.openTabs.filter(tab => {
      const tabGroupId = tab.groupId || 'main';
      return tabGroupId === group.id;
    });

    groupTabs.forEach(tab => renderTab(tab, group.id));
  });
}

// 刷新所有分组的标签内容
export function refreshTabContents() {
  state.editorGroups.forEach(group => {
    let tabContents;
    if (group.id === 'main') {
      tabContents = $('tab-contents');
    } else {
      tabContents = document.querySelector(`[data-group-contents="${group.id}"]`);
    }

    if (!tabContents) return;

    // 获取该分组的所有标签
    const groupTabs = state.openTabs.filter(tab => {
      const tabGroupId = tab.groupId || 'main';
      return tabGroupId === group.id;
    });

    // 为每个标签渲染内容
    groupTabs.forEach(tab => {
      // 检查内容是否已存在
      const existingContent = tabContents.querySelector(`[data-tab-id="${tab.id}"]`);
      if (!existingContent) {
        // 内容不存在，需要渲染
        if (tab.type === 'file') {
          renderFileTabContent(tab, group.id);
        } else if (tab.type === 'chat') {
          renderChatTabContent(tab, group.id);
        } else if (tab.type === 'terminal') {
          renderTerminalTabContent(tab, group.id);
        }
      }
    });
  });
}

export function renderFileTabContent(tab, groupId = 'main') {
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

  // 验证路径
  if (!tab.path || tab.path === 'undefined') {
    contentEl.querySelector('.viewer-content').innerHTML = `<div class="output-line error">文件路径无效</div>`;
    return;
  }

  // 读取文件内容
  const rootPath = state.currentProject?.path || '';
  console.log('[renderFileTabContent] tab.path:', tab.path, 'root:', rootPath);
  apiRequest(`/api/files/read?path=${encodeURIComponent(tab.path)}&root=${encodeURIComponent(rootPath)}`)
    .then(data => {
      const contentDiv = contentEl.querySelector('.viewer-content');
      contentDiv.innerHTML = `<pre>${escapeHtml(data.content || '')}</pre>`;
    })
    .catch(err => {
      contentEl.querySelector('.viewer-content').innerHTML = `<div class="output-line error">读取失败: ${err.message}</div>`;
    });
}

export function renderChatTabContent(tab, groupId = 'main') {
  let tabContents;
  if (groupId === 'main') {
    tabContents = $('tab-contents');
  } else {
    tabContents = document.querySelector(`[data-group-contents="${groupId}"]`);
  }

  if (!tabContents) return;

  // 使用动态 ID 以支持多个会话标签
  const chatMessagesId = 'chat-messages-' + tab.id;
  const chatInputId = 'chat-input-' + tab.id;
  const sendBtnId = 'send-' + tab.id;

  const contentEl = document.createElement('div');
  contentEl.className = 'tab-content';
  contentEl.dataset.tabId = tab.id;
  contentEl.dataset.groupId = groupId;
  contentEl.dataset.sessionId = tab.sessionId;

  contentEl.innerHTML = `
    <div class="session-header">
      <span class="session-title">${tab.name || '会话'}</span>
      <button class="icon-btn btn-refresh-sessions" title="刷新Session">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M13.65 2.35A8 8 0 1 0 16 8h-2a6 6 0 1 1-1.75-4.25L10 6h6V0l-2.35 2.35z"/>
        </svg>
      </button>
    </div>
    <div class="session-body">
      <div class="chat-messages" id="${chatMessagesId}"></div>
    </div>
    <div class="session-input">
      <input type="text" class="chat-input" id="${chatInputId}" placeholder="输入消息...">
      <button class="btn-small btn-primary" id="${sendBtnId}">发送</button>
    </div>
  `;

  tabContents.appendChild(contentEl);

  // 绑定发送按钮事件
  const sendBtn = contentEl.querySelector(`#${sendBtnId}`);
  const chatInput = contentEl.querySelector(`#${chatInputId}`);

  if (sendBtn && chatInput) {
    sendBtn.addEventListener('click', () => {
      const text = chatInput.value.trim();
      if (text) {
        import('./sessions.js').then(m => m.sendMessage(text, tab.sessionId));
        chatInput.value = '';
      }
    });

    chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        sendBtn.click();
      }
    });
  }
}

export function renderTerminalTabContent(tab, groupId = 'main') {
  let tabContents;
  if (groupId === 'main') {
    tabContents = $('tab-contents');
  } else {
    tabContents = document.querySelector(`[data-group-contents="${groupId}"]`);
  }

  if (!tabContents) return;

  const contentEl = document.createElement('div');
  contentEl.className = 'tab-content terminal-tab-content';
  contentEl.dataset.tabId = tab.id;
  contentEl.dataset.groupId = groupId;

  // 创建唯一的ID以支持多个终端标签
  const terminalId = 'terminal-' + tab.id;

  contentEl.innerHTML = `
    <div class="terminal-container" id="${terminalId}">
      <div class="terminal-header">
        <span class="terminal-title">终端</span>
        <button class="icon-btn btn-clear-terminal" title="清空">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5"/>
          </svg>
        </button>
      </div>
      <div class="terminal-output" id="${terminalId}-output">
        <div class="output-line system">欢迎使用终端</div>
      </div>
      <div class="terminal-input-area">
        <input type="text" class="cmd-input" id="${terminalId}-input" placeholder="输入命令...">
        <button class="btn-small btn-primary btn-exec">执行</button>
      </div>
    </div>
  `;

  tabContents.appendChild(contentEl);

  // 绑定终端事件
  const cmdInput = contentEl.querySelector(`#${terminalId}-input`);
  const execBtn = contentEl.querySelector('.btn-exec');
  const clearBtn = contentEl.querySelector('.btn-clear-terminal');
  const output = contentEl.querySelector(`#${terminalId}-output`);

  if (execBtn && cmdInput) {
    execBtn.addEventListener('click', () => executeTerminalCommand(cmdInput, output, terminalId));

    cmdInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        executeTerminalCommand(cmdInput, output, terminalId);
      }
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (output) {
        output.innerHTML = '<div class="output-line system">终端已清空</div>';
      }
    });
  }
}

async function executeTerminalCommand(cmdInput, output, terminalId) {
  if (!cmdInput || !output) return;

  const cmd = cmdInput.value.trim();
  if (!cmd) return;

  // 显示输入的命令
  addTerminalOutput(output, `$ ${cmd}`, 'input');
  cmdInput.value = '';

  try {
    const data = await apiRequest('/api/terminal/exec', {
      method: 'POST',
      body: JSON.stringify({ command: cmd })
    });

    if (data.output) {
      addTerminalOutput(output, data.output, 'stdout');
    }
    if (data.error) {
      addTerminalOutput(output, data.error, 'error');
    }
  } catch (error) {
    addTerminalOutput(output, `执行失败: ${error.message}`, 'error');
  }
}

function addTerminalOutput(output, text, type = 'stdout') {
  if (!output) return;

  const line = document.createElement('div');
  line.className = `output-line ${type}`;
  line.textContent = text;
  output.appendChild(line);
  output.scrollTop = output.scrollHeight;
}

export function switchToTab(tabId) {
  // 找到要切换的标签所在分组
  const tab = state.openTabs.find(t => t.id === tabId);
  const groupId = tab?.groupId || 'main';

  state.activeTab = tabId;
  state.activeGroup = groupId;

  // 更新标签激活状态 - 只更新同一分组的标签
  document.querySelectorAll('.tab').forEach(t => {
    const tGroupId = t.dataset.groupId || 'main';
    if (tGroupId === groupId) {
      t.classList.toggle('active', t.dataset.tabId === tabId);
    }
  });

  // 更新内容激活状态 - 只更新同一分组的内容
  // 重要：保持其他分组的激活状态不变
  document.querySelectorAll('.tab-content').forEach(c => {
    const cGroupId = c.dataset.groupId || 'main';
    if (cGroupId === groupId) {
      // 这个分组的内容：只激活对应的标签
      c.classList.toggle('active', c.dataset.tabId === tabId);
    }
    // 其他分组的内容保持不变
  });
}

export function closeTab(tabId) {
  // 从打开的标签中移除
  const index = state.openTabs.findIndex(t => t.id === tabId);
  if (index === -1) return;

  const [closedTab] = state.openTabs.splice(index, 1);
  const closedTabGroupId = closedTab.groupId;

  // 从分组中移除
  state.editorGroups.forEach(group => {
    const idx = group.tabs.indexOf(tabId);
    if (idx > -1) {
      group.tabs.splice(idx, 1);
    }
  });

  // 移除DOM
  const tabEl = document.querySelector(`.tab[data-tab-id="${tabId}"]`);
  if (tabEl) tabEl.remove();

  const contentEl = document.querySelector(`.tab-content[data-tab-id="${tabId}"]`);
  if (contentEl) contentEl.remove();

  // 检查并删除空分组（不包括 main 分组）
  if (closedTabGroupId && closedTabGroupId !== 'main') {
    const group = state.editorGroups.find(g => g.id === closedTabGroupId);
    if (group && group.tabs.length === 0) {
      // 删除空分组
      const groupEl = document.querySelector(`[data-group-id="${closedTabGroupId}"]`);
      if (groupEl) {
        const handle = groupEl.previousElementSibling;
        if (handle && handle.classList.contains('split-handle')) {
          handle.remove();
        }
        groupEl.remove();
      }
      state.editorGroups = state.editorGroups.filter(g => g.id !== closedTabGroupId);

      // 如果当前活跃分组被删除，切换到 main
      if (state.activeGroup === closedTabGroupId) {
        state.activeGroup = 'main';
      }
    }
  }

  // 如果关闭的是当前激活的标签，切换到其他标签
  if (state.activeTab === tabId) {
    // 找到同一分组的其他标签
    const groupTabs = state.openTabs.filter(t => t.groupId === closedTabGroupId);
    if (groupTabs.length > 0) {
      switchToTab(groupTabs[0].id);
    } else if (state.openTabs.length > 0) {
      // 切换到任何其他标签
      switchToTab(state.openTabs[0].id);
    } else {
      // 所有标签都已关闭，清理额外分屏并显示欢迎页
      cleanupExtraGroups();
      switchToWelcome();
    }
  } else if (state.openTabs.length === 0) {
    // 所有标签都已关闭
    cleanupExtraGroups();
    switchToWelcome();
  }
}

// 清理所有额外的分屏，只保留 main 分组
function cleanupExtraGroups() {
  const editorGroups = $('editor-groups');
  if (!editorGroups) return;

  // 获取所有非 main 的分组
  const extraGroups = editorGroups.querySelectorAll('.editor-group[data-group-id]:not([data-group-id="main"])');

  extraGroups.forEach(groupEl => {
    // 删除分隔条
    const handle = groupEl.previousElementSibling;
    if (handle && handle.classList.contains('split-handle')) {
      handle.remove();
    }
    // 删除分组元素
    groupEl.remove();
  });

  // 更新 state，只保留 main 分组
  state.editorGroups = state.editorGroups.filter(g => g.id === 'main');
  state.activeGroup = 'main';
}

export function switchToWelcome() {
  state.activeTab = 'welcome';

  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

  const welcomeTab = document.querySelector('.tab-content[data-tab="welcome"]');
  if (welcomeTab) {
    welcomeTab.classList.add('active');
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
