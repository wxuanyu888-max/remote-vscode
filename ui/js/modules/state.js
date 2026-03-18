// 状态管理模块

export const state = {
  projects: [],
  currentProject: null,
  sessions: [],
  currentSession: null,
  isClaudeWorking: false,
  currentView: 'explorer',
  currentFilePath: '',
  eventSource: null,
  openTabs: [],
  activeTab: 'welcome',
  tabIdCounter: 0,
  editorGroups: [{ id: 'main', tabs: [] }],
  activeGroup: 'main',
  draggedTab: null
};

export function $(id) {
  return document.getElementById(id);
}
