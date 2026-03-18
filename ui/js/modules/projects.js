// 项目管理模块
import { state, $ } from './state.js';
import { apiRequest } from './api.js';
import { loadSessions } from './sessions.js';
import { loadFiles, renderFileTree } from './files.js';

export async function loadProjects() {
  try {
    let projects = [];
    try {
      const data = await apiRequest('/api/projects');
      projects = data.projects || [];
    } catch (e) {
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

export function renderProjects() {
  const projectSelect = $('project-select');
  if (!projectSelect) return;

  projectSelect.innerHTML = '<option value="">选择项目...</option>' +
    state.projects.map(project =>
      `<option value="${project.path}" data-name="${project.name}">${project.name}</option>`
    ).join('');

  projectSelect.addEventListener('change', (e) => {
    const path = e.target.value;
    const name = e.target.options[e.target.selectedIndex]?.dataset?.name || path.split(/[/\\]/).pop();
    if (path) {
      selectProject(path, name);
    }
  });

  if (state.projects.length > 0 && !state.currentProject) {
    const firstProject = state.projects[0];
    projectSelect.value = firstProject.path;
    selectProject(firstProject.path, firstProject.name);
  }
}

export function selectProject(path, name) {
  state.currentProject = { path, name };
  state.currentFilePath = path;

  const projectId = encodeProjectPath(path);
  loadSessions(projectId);
  loadFiles(path);
}

export function decodeProjectPath(folderName) {
  let result = folderName
    .replace(/^([a-zA-Z])--/, '$1:\\')
    .replace(/--/g, '\\');
  return result;
}

export function encodeProjectPath(filePath) {
  // 将 C:\Users\29718\remote-vscode 转换为 C--Users-29718-remote-vscode
  // 驱动器号后面的 \ 变成 --，其他 \ 变成 -
  return filePath
    .replace(/^([a-zA-Z]):\\/, '$1--')
    .replace(/\\/g, '-');
}

export function refreshProjects() {
  loadProjects();
}
