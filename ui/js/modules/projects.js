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

export function encodeProjectPath(filePath) {
  // 将 C:\Users\29718\remote-vscode 转换为 C--Users-~-29718-~-remote-vscode
  // 驱动器号后的 \ 变成 --，其他 \ 变成 -~- (使用特殊分隔符避免与数字中的 - 混淆)
  return filePath
    .replace(/^([A-Za-z]):\\/, '$1--')  // C:\ -> C--
    .replace(/\\/g, '-~-');             // \ -> -~- (使用特殊分隔符)
}

export function decodeProjectPath(folderName) {
  if (!folderName) return '';

  // 检查是否看起来像 Windows 路径 (字母-- 开头)
  const windowsMatch = folderName.match(/^([a-zA-Z])--(.*)$/);
  if (windowsMatch) {
    // 还原为 Windows 路径格式
    let result = windowsMatch[1] + ':\\' + windowsMatch[2];
    // 将 -~- 还原为 \
    result = result.replace(/-~-/g, '\\');
    return result;
  }

  // 假设是 Unix 路径，将 -~- 替换为 /
  return folderName.replace(/-~-/g, '/');
}

export function refreshProjects() {
  loadProjects();
}
