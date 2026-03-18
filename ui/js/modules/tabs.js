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

  const icon = tab.type === 'file' ? '📄' : '💬';
  tabEl.innerHTML = `
    <span class="tab-icon">${icon}</span>
    <span class="tab-name">${tab.name}</span>
    <span class="tab-actions">
      <button class="split-btn" data-split="vertical" title="分屏">⧈</button>
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

  const contentEl = document.createElement('div');
  contentEl.className = 'tab-content';
  contentEl.dataset.tabId = tab.id;
  contentEl.dataset.groupId = groupId;

  contentEl.innerHTML = `
    <div class="session-header">
      <span class="session-title">活跃 Session</span>
      <button class="icon-btn btn-refresh-sessions" title="刷新Session">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M13.65 2.35A8 8 0 1 0 16 8h-2a6 6 0 1 1-1.75-4.25L10 6h6V0l-2.35 2.35z"/>
        </svg>
      </button>
    </div>
    <div class="session-body">
      <div class="chat-messages" id="chat-messages"></div>
    </div>
    <div class="session-input">
      <input type="text" id="chat-input" placeholder="输入消息...">
      <button class="btn-small btn-primary" id="btn-send">发送</button>
    </div>
  `;

  tabContents.appendChild(contentEl);

  // 绑定发送按钮事件
  const sendBtn = contentEl.querySelector('#btn-send');
  const chatInput = contentEl.querySelector('#chat-input');

  if (sendBtn && chatInput) {
    sendBtn.addEventListener('click', () => {
      const text = chatInput.value.trim();
      if (text) {
        import('./sessions.js').then(m => m.sendMessage(text));
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

  // 如果关闭的是当前激活的标签，切换到其他标签
  if (state.activeTab === tabId) {
    if (state.openTabs.length > 0) {
      switchToTab(state.openTabs[state.openTabs.length - 1].id);
    } else {
      switchToWelcome();
    }
  }
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
