// 文件浏览模块
import { state, $ } from './state.js';
import { apiRequest } from './api.js';
import { openFileTab } from './tabs.js';

export async function loadFiles(dirPath = null) {
  const projectPath = state.currentProject?.path;
  if (!projectPath) {
    console.error('No project selected');
    return;
  }

  const targetPath = dirPath || projectPath;

  try {
    const data = await apiRequest(`/api/files/list?path=${encodeURIComponent(targetPath)}`);
    console.log('[DEBUG] API response:', data);
    console.log('[DEBUG] items sample:', (data.items || []).slice(0, 3));
    state.currentFilePath = targetPath;

    const currentPathEl = $('current-path');
    if (currentPathEl) {
      currentPathEl.textContent = data.rootPath || targetPath;
    }

    renderFileTree(data.items || [], data.rootPath);
  } catch (error) {
    console.error('加载文件失败:', error);
    const fileList = $('file-list');
    if (fileList) {
      fileList.innerHTML = `<div class="loading" style="color: var(--error);">加载失败: ${error.message}</div>`;
    }
  }
}

export function renderFileTree(items, currentPath) {
  const fileList = $('file-list');
  if (!fileList) return;

  if (!items.length) {
    fileList.innerHTML = '<div class="loading">目录为空</div>';
    return;
  }

  const html = items.map(item => {
    const icon = item.isDirectory ? '📁' : '📄';
    const ext = item.name.split('.').pop()?.toLowerCase();
    const codeExts = ['js', 'ts', 'py', 'html', 'css', 'json', 'md', 'txt', 'xml', 'yaml', 'yml', 'sh', 'bat', 'ps1'];
    const isCode = codeExts.includes(ext);

    return `
      <div class="file-item ${item.isDirectory ? 'directory' : 'file'}"
           data-parent-path="${currentPath.replace(/\\/g, '/')}"
           data-name="${item.name}"
           data-is-dir="${item.isDirectory}">
        <span class="file-icon">${icon}</span>
        <span class="file-name ${isCode ? 'code-file' : ''}">${item.name}</span>
      </div>
    `;
  }).join('');

  fileList.innerHTML = html;

  // 绑定点击事件
  fileList.querySelectorAll('.file-item').forEach(item => {
    item.addEventListener('click', () => {
      const isDir = item.dataset.isDir === 'true';
      const parentPath = item.dataset.parentPath;
      const name = item.dataset.name;

      console.log('[click] isDir:', isDir, 'parentPath:', parentPath, 'name:', name);

      if (!parentPath) {
        console.error('No parent path');
        return;
      }

      if (isDir) {
        // 进入目录 - 使用 path.join 逻辑（统一使用 / 分隔符）
        const newPath = parentPath.replace(/\/$/, '') + '/' + name;
        console.log('[click] Navigating to:', newPath);
        loadFiles(newPath);
      } else {
        // 打开文件
        const fullPath = parentPath.replace(/\/$/, '') + '/' + name;
        console.log('[click] Opening file:', fullPath);
        openFileTab(fullPath, name);
      }
    });
  });
}

export function goUpDirectory() {
  const currentPath = state.currentFilePath;
  if (!currentPath) return;

  // Windows 路径处理
  const parts = currentPath.split(/[/\\]/);
  if (parts.length <= 1) return;

  parts.pop();
  const parentPath = parts.join('\\');

  if (parentPath) {
    state.currentFilePath = parentPath;
    loadFiles(parentPath);
  }
}

export function refreshFiles() {
  loadFiles();
}
