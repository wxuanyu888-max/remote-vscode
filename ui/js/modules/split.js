// 分屏编辑器模块
import { state, $ } from './state.js';
import { switchToTab, refreshTabBar, refreshTabContents, openFileTab, openChatTab } from './tabs.js';

export function splitEditor(direction, tabId = null) {
  const editorGroups = $('editor-groups');
  const currentTabId = tabId || state.activeTab;

  // 找到当前标签
  const currentTab = state.openTabs.find(t => t.id === currentTabId);

  const newGroupId = 'group-' + Date.now();
  const newGroup = { id: newGroupId, tabs: [] };
  state.editorGroups.push(newGroup);

  const newGroupEl = document.createElement('div');
  newGroupEl.className = 'editor-group';
  newGroupEl.dataset.groupId = newGroupId;

  newGroupEl.innerHTML = `
    <div class="group-header">
      <button class="group-close-btn" data-group-id="${newGroupId}" title="关闭此分屏">×</button>
    </div>
    <div class="tabs-bar" data-group-tabs="${newGroupId}"></div>
    <div class="tab-contents" data-group-contents="${newGroupId}"></div>
  `;

  newGroupEl.querySelector('.group-close-btn').addEventListener('click', () => {
    closeGroupById(newGroupId);
  });

  newGroupEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  });
  newGroupEl.addEventListener('drop', handleTabDrop);

  const newTabsBar = newGroupEl.querySelector('.tabs-bar');
  if (newTabsBar) {
    newTabsBar.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    newTabsBar.addEventListener('drop', handleTabDrop);
  }

  const handle = document.createElement('div');
  handle.className = 'split-handle';
  handle.dataset.prevGroup = state.activeGroup;
  handle.dataset.nextGroup = newGroupId;

  const lastGroup = editorGroups.lastElementChild;
  editorGroups.insertBefore(handle, lastGroup);
  editorGroups.insertBefore(newGroupEl, lastGroup);

  // 如果有当前标签，将其复制到新分组
  if (currentTab) {
    const newTabId = currentTab.type === 'file'
      ? 'file-' + (++state.tabIdCounter)
      : 'chat-' + (++state.tabIdCounter);

    const newTab = {
      id: newTabId,
      type: currentTab.type,
      name: currentTab.name,
      path: currentTab.path,
      sessionId: currentTab.sessionId,
      groupId: newGroupId
    };

    state.openTabs.push(newTab);
    newGroup.tabs.push(newTabId);
  }

  state.activeGroup = newGroupId;
  refreshTabBar();
  refreshTabContents();

  // 新分屏自动激活第一个标签
  if (newGroup.tabs.length > 0) {
    import('./tabs.js').then(m => m.switchToTab(newGroup.tabs[0]));
  }

  initSplitHandle(handle);
}

function handleTabDrop(e) {
  e.preventDefault();
  e.stopPropagation();

  const targetGroup = e.target.closest('.editor-group');
  const draggedTabId = state.draggedTab?.dataset.tabId;
  const draggedGroupId = state.draggedTab?.dataset.groupId;

  if (!draggedTabId || !draggedGroupId || !targetGroup) return;

  const targetGroupId = targetGroup.dataset.groupId;

  if (targetGroupId !== draggedGroupId) {
    moveTabToGroup(draggedTabId, targetGroupId);
  }
}

export function removeTabFromGroup(tabId) {
  state.editorGroups.forEach(group => {
    const index = group.tabs.indexOf(tabId);
    if (index > -1) {
      group.tabs.splice(index, 1);
    }
  });
}

export function moveTabToGroup(tabId, groupId) {
  const tab = state.openTabs.find(t => t.id === tabId);
  if (!tab) return;

  tab.groupId = groupId;
  removeTabFromGroup(tabId);

  const group = state.editorGroups.find(g => g.id === groupId);
  if (group) {
    group.tabs.push(tabId);
  }

  let targetTabContents;
  if (groupId === 'main') {
    targetTabContents = $('tab-contents');
  } else {
    targetTabContents = document.querySelector(`[data-group-contents="${groupId}"]`);
  }

  const oldContent = document.querySelector(`.tab-content[data-tab-id="${tabId}"]`);
  if (oldContent && targetTabContents) {
    oldContent.dataset.groupId = groupId;
    targetTabContents.appendChild(oldContent);
  }

  refreshTabBar();
  state.activeTab = tabId;
  state.activeGroup = groupId;

  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tabId === tabId);
  });

  document.querySelectorAll('.tab-content').forEach(c => {
    c.classList.toggle('active', c.dataset.tabId === tabId);
  });
}

export function refreshAllGroups() {
  refreshTabBar();
}

export function initSplitHandle(handle) {
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

export function closeGroup(tabId) {
  const editorGroups = $('editor-groups');
  const groups = editorGroups.querySelectorAll('.editor-group');

  if (groups.length <= 1) return;

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

  if (!targetGroup) {
    targetGroupId = state.activeGroup;
    targetGroup = state.editorGroups.find(g => g.id === targetGroupId);
  }

  if (targetGroupId === 'main') return;

  targetGroupEl = editorGroups.querySelector(`[data-group-id="${targetGroupId}"]`);

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
    if (targetGroup.tabs.length > 0) {
      switchToTab(targetGroup.tabs[0]);
    }
  }

  state.editorGroups = state.editorGroups.filter(g => g.id !== targetGroupId);

  if (targetGroupEl) {
    const handle = targetGroupEl.previousElementSibling;
    if (handle && handle.classList.contains('split-handle')) {
      handle.remove();
    }
    targetGroupEl.remove();
  }

  state.activeGroup = 'main';
}

export function closeGroupById(groupId) {
  if (groupId === 'main') return;

  const editorGroups = $('editor-groups');
  const groups = editorGroups.querySelectorAll('.editor-group');

  if (groups.length <= 1) return;

  const targetGroup = state.editorGroups.find(g => g.id === groupId);
  if (!targetGroup) return;

  const targetGroupEl = editorGroups.querySelector(`[data-group-id="${groupId}"]`);

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
    if (targetGroup.tabs.length > 0) {
      switchToTab(targetGroup.tabs[0]);
    }
  }

  state.editorGroups = state.editorGroups.filter(g => g.id !== groupId);

  if (targetGroupEl) {
    const handle = targetGroupEl.previousElementSibling;
    if (handle && handle.classList.contains('split-handle')) {
      handle.remove();
    }
    targetGroupEl.remove();
  }

  state.activeGroup = 'main';
}

export function initSplitHandles() {
  document.querySelectorAll('.split-handle').forEach(handle => {
    initSplitHandle(handle);
  });
}

export function initEditorGroupDrops() {
  document.querySelectorAll('.editor-group').forEach(group => {
    group.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    group.addEventListener('drop', handleTabDrop);
  });

  document.querySelectorAll('.tabs-bar').forEach(tabsBar => {
    tabsBar.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    tabsBar.addEventListener('drop', handleTabDrop);
  });

  document.querySelectorAll('.tab-contents').forEach(contents => {
    contents.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    contents.addEventListener('drop', handleTabDrop);
  });
}
