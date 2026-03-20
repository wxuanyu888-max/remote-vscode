// Session 管理模块
import { state, $ } from './state.js';
import { apiRequest } from './api.js';
import { decodeProjectPath, encodeProjectPath } from './projects.js';

// HTML 转义函数
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 工具名称转义
function escapeToolName(name) {
  if (!name) return 'Unknown';
  return String(name).replace(/[<>"]/g, '');
}

// 右键菜单相关变量
let contextMenuSessionId = null;

// 导出函数，供 api.js 使用 - 查找 session 对应的 output 元素
export function findSessionOutput(sessionId) {
  const targetSessionId = sessionId || state.currentSession;
  if (!targetSessionId) return null;

  const tab = state.openTabs.find(t => t.sessionId === targetSessionId && t.type === 'chat');
  if (!tab) return null;

  return document.querySelector(`#chat-messages-${tab.id}`);
}

// 查找输出元素（带 fallback）
function findOutputElement(sessionId) {
  let output = findSessionOutput(sessionId);
  if (!output && state.currentSession && state.currentSession !== sessionId) {
    output = findSessionOutput(state.currentSession);
  }
  if (!output) {
    const activeTabContent = document.querySelector('.tab-content.active');
    if (activeTabContent) {
      output = activeTabContent.querySelector('.chat-messages');
    }
  }
  if (!output) {
    output = $('chat-messages') || document.getElementById('session-output');
  }
  return output;
}

// 加载并显示 session 历史消息
async function loadSessionHistory(sessionId, maxLength = 5000) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5秒超时

    const data = await apiRequest(`/api/chat/session/${sessionId}`);
    clearTimeout(timeout);

    // 限制返回内容大小
    let content = data.content || '';
    if (content.length > maxLength) {
      content = content.slice(-maxLength);
    }
    return content;
  } catch (error) {
    console.error('[loadSessionHistory] Error:', error);
    return '';
  }
}

export async function loadSessions(projectId = null) {
  const sessionSelect = $('session-select');
  if (!sessionSelect) return;

  try {
    const url = projectId
      ? `/api/chat/sessions?projectId=${encodeURIComponent(projectId)}`
      : '/api/chat/sessions';
    const data = await apiRequest(url);
    state.sessions = data.sessions || [];

    if (!state.sessions.length) {
      sessionSelect.innerHTML = '<option value="">暂无 Session</option>';
      return;
    }

    renderSessions();
  } catch (error) {
    console.error('[loadSessions] Error:', error);
    sessionSelect.innerHTML = '<option value="">加载失败</option>';
  }
}

export function renderSessions() {
  const sessionSelect = $('session-select');
  if (!sessionSelect) return;

  // 只显示最近10分钟还活着的session
  const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
  const isAlive = (session) => {
    // 运行中的session认为是活的
    if (session.status === 'working') return true;
    // 有最近活动的session也认为是活的
    if (session.lastActivity) {
      const lastTime = new Date(session.lastActivity).getTime();
      return lastTime > tenMinutesAgo;
    }
    return false;
  };

  // 只显示最近10分钟活着的session（排除运行中的，最多50个）
  const aliveSessions = state.sessions.filter(isAlive).slice(0, 50);
  const workingSessions = aliveSessions.filter(s => s.status === 'working');
  const stoppedSessions = aliveSessions.filter(s => s.status !== 'working');

  if (aliveSessions.length > 0) {
    sessionSelect.innerHTML = '<option value="">选择 Session...</option>' +
      '<option value="new">+ 新建 Session</option>' +
      workingSessions.map(session => {
        const sessionId = session.id || session.sessionId || 'unknown';
        const shortId = sessionId.substring(0, 8);
        return `<option value="${sessionId}" style="font-weight:bold">${session.name || `Session ${shortId}`} (运行中)</option>`;
      }).join('') +
      stoppedSessions.map(session => {
        const sessionId = session.id || session.sessionId || 'unknown';
        const shortId = sessionId.substring(0, 8);
        const timeStr = formatTimeAgo(session.lastActivity);
        return `<option value="${sessionId}">${session.name || `Session ${shortId}`} (${timeStr})</option>`;
      }).join('');

    // 自动选中第一个正在运行的session
    if (!state.currentSession && workingSessions.length > 0) {
      const firstWorking = workingSessions[0];
      const sessionId = firstWorking.id || firstWorking.sessionId;
      sessionSelect.value = sessionId;
      selectSession(sessionId);
    }
  } else {
    sessionSelect.innerHTML = '<option value="">暂无 Session</option>' +
      '<option value="new">+ 新建 Session</option>';
  }

  sessionSelect.onchange = async (e) => {
    const sessionId = e.target.value;
    if (sessionId === 'new') {
      // 新建 Session
      const newSessionId = await createNewSession();
      if (newSessionId) {
        selectSession(newSessionId);
      }
      // 重置下拉框显示
      e.target.value = state.currentSession || '';
    } else if (sessionId) {
      selectSession(sessionId);
    }
  };

  // 添加右键菜单
  setupContextMenu(sessionSelect);
}

// 右键菜单
function setupContextMenu(sessionSelect) {
  // 移除已存在的菜单
  const existingMenu = document.getElementById('session-context-menu');
  if (existingMenu) existingMenu.remove();

  sessionSelect.oncontextmenu = (e) => {
    e.preventDefault();
    const sessionId = sessionSelect.value;
    if (!sessionId || sessionId === 'new') return;

    contextMenuSessionId = sessionId;

    // 创建菜单
    const menu = document.createElement('div');
    menu.id = 'session-context-menu';
    menu.style.cssText = `
      position: fixed;
      left: ${e.clientX}px;
      top: ${e.clientY}px;
      background: white;
      border: 1px solid #ccc;
      border-radius: 4px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
      z-index: 10000;
      min-width: 120px;
    `;

    const renameBtn = document.createElement('div');
    renameBtn.textContent = '重命名';
    renameBtn.style.cssText = 'padding: 8px 16px; cursor: pointer;';
    renameBtn.onmouseenter = () => renameBtn.style.background = '#f0f0f0';
    renameBtn.onmouseleave = () => renameBtn.style.background = 'white';
    renameBtn.onclick = () => {
      menu.remove();
      handleRenameSession(sessionId);
    };

    const deleteBtn = document.createElement('div');
    deleteBtn.textContent = '删除';
    deleteBtn.style.cssText = 'padding: 8px 16px; cursor: pointer; color: #d32f2f;';
    deleteBtn.onmouseenter = () => deleteBtn.style.background = '#f0f0f0';
    deleteBtn.onmouseleave = () => deleteBtn.style.background = 'white';
    deleteBtn.onclick = () => {
      menu.remove();
      handleDeleteSession(sessionId);
    };

    menu.appendChild(renameBtn);
    menu.appendChild(deleteBtn);
    document.body.appendChild(menu);

    // 点击其他地方关闭菜单
    const closeMenu = (evt) => {
      if (!menu.contains(evt.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  };
}

// 重命名session
async function handleRenameSession(sessionId) {
  const session = state.sessions.find(s => (s.id || s.sessionId) === sessionId);
  const currentName = session?.name || '';

  const newName = prompt('请输入新名称:', currentName);
  if (!newName || newName === currentName) return;

  try {
    await apiRequest(`/api/chat/session/${sessionId}`, {
      method: 'PUT',
      body: JSON.stringify({ name: newName })
    });
    loadSessions();
  } catch (error) {
    alert('重命名失败: ' + error.message);
  }
}

// 删除session
async function handleDeleteSession(sessionId) {
  if (!confirm('确定要删除这个会话吗？此操作不可恢复。')) return;

  try {
    await apiRequest(`/api/chat/session/${sessionId}`, {
      method: 'DELETE'
    });

    // 如果删除的是当前选中的session，清除选中状态
    if (state.currentSession === sessionId) {
      state.currentSession = null;
    }

    loadSessions();
  } catch (error) {
    alert('删除失败: ' + error.message);
  }
}

function formatTimeAgo(timestamp) {
  if (!timestamp) return '未知';
  const now = Date.now();
  const time = new Date(timestamp).getTime();
  const diff = now - time;

  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  return `${Math.floor(diff / 86400000)}天前`;
}

export async function selectSession(sessionId) {
  const sessionSelect = $('session-select');
  if (sessionSelect) {
    sessionSelect.value = sessionId;
  }

  state.currentSession = sessionId;
  const session = state.sessions.find(s => (s.id || s.sessionId) === sessionId);

  // 设置当前项目 - 根据 session 的 projectId 找到对应的项目
  if (session?.projectId) {
    const project = state.projects.find(p => encodeProjectPath(p.path) === session.projectId);
    if (project) {
      state.currentProject = { path: project.path, name: project.name };
    } else {
      // 如果没在 state.projects 中找到，尝试解码 projectId 获取路径
      const decodedPath = decodeProjectPath(session.projectId);
      state.currentProject = { path: decodedPath, name: session.projectPath?.split(/[/\\]/).pop() || '未知' };
    }
  }

  // 查找是否存在该 session 的标签
  const existingTab = state.openTabs.find(t => t.sessionId === sessionId && t.type === 'chat');

  let chatMessages;

  if (existingTab) {
    // 如果已存在标签，切换到该标签
    const { switchToTab } = await import('./tabs.js');
    switchToTab(existingTab.id);
    // 获取对应的 chat-messages 元素
    chatMessages = document.querySelector(`#chat-messages-${existingTab.id}`);
  } else {
    // 如果不存在，创建新标签
    const sessionName = session?.name || `Session ${sessionId.substring(0, 8)}`;
    const { openChatTab } = await import('./tabs.js');
    const newTab = await openChatTab(sessionId, sessionName);
    // 获取新创建的 chat-messages 元素
    chatMessages = document.querySelector(`#chat-messages-${newTab.id}`);
  }

  // 显示会话头信息
  if (chatMessages) {
    chatMessages.innerHTML = `
      <div class="output-line system">=== 会话: ${sessionId.substring(0, 8)} ===</div>
      <div class="output-line system">项目: ${state.currentProject?.name || '未知'}</div>
      <div class="output-line system">正在加载历史消息...</div>
    `;
  }

  // 加载历史消息
  try {
    const historyContent = await loadSessionHistory(sessionId);

    if (chatMessages && historyContent) {
      // 解析历史消息并显示
      const lines = historyContent.trim().split('\n');

      chatMessages.innerHTML = `
        <div class="output-line system">=== 会话: ${sessionId.substring(0, 8)} ===</div>
        <div class="output-line system">项目: ${state.currentProject?.name || '未知'}</div>
      `;

      // 显示最后 30 条消息
      const recentLines = lines.slice(-30);
      recentLines.forEach(line => {
        try {
          const msg = JSON.parse(line);
          renderHistoryMessage(chatMessages, msg);
        } catch (e) {
          // 非 JSON 行直接显示，但过滤掉 system-reminder
          const trimmed = line.trim();
          if (trimmed && trimmed.length < 500 &&
              !trimmed.includes('system-reminder')) {
            addMessage(chatMessages, trimmed, '');
          }
        }
      });
      chatMessages.scrollTop = chatMessages.scrollHeight;
    } else if (chatMessages) {
      chatMessages.innerHTML += '<div class="output-line system">无历史消息</div>';
    }
  } catch (error) {
    console.error('[selectSession] 加载历史消息失败:', error);
    if (chatMessages) {
      chatMessages.innerHTML += '<div class="output-line error">加载历史消息失败: ' + error.message + '</div>';
    }
  }

  // 同时更新 welcome 页面的 chat-messages（保持兼容性）
  const welcomeChatMessages = $('chat-messages');
  if (welcomeChatMessages) {
    welcomeChatMessages.innerHTML = `
      <div class="output-line system">=== 会话: ${sessionId.substring(0, 8)} ===</div>
      <div class="output-line system">项目: ${state.currentProject?.name || '未知'}</div>
      <div class="output-line system">正在连接实时流...</div>
    `;
  }

  connectSessionStream(sessionId);
}

// 格式化工具调用显示
function formatToolUse(item) {
  const name = escapeToolName(item.name);
  const input = item.input || {};

  // 根据工具类型提取关键信息
  switch (name) {
    case 'Bash':
      return `[Bash] ${input.command || ''}${input.description ? ' - ' + input.description : ''}`;
    case 'Write':
      // 显示文件路径和内容预览
      if (input.file_path) {
        const preview = input.content ? input.content.substring(0, 80).replace(/\n/g, ' ') : '';
        return `[Write] ${input.file_path}${preview ? ' - ' + preview + (input.content.length > 80 ? '...' : '') : ''}`;
      }
      return `[Write]`;
    case 'Edit':
      // 显示 Claude 风格的 diff 格式
      if (input.old_string && input.new_string) {
        const oldLines = input.old_string.split('\n');
        const newLines = input.new_string.split('\n');
        const added = newLines.length - oldLines.length;
        const removed = oldLines.length - newLines.length;
        let diff = `Update(${input.file_path || ''})\n`;
        if (added > 0) diff += `  ⎿  Added ${added} lines${removed > 0 ? `, removed ${removed} lines` : ''}\n`;
        else if (removed > 0) diff += `  ⎿  Removed ${removed} lines\n`;
        else diff += `  ⎿  Modified ${oldLines.length} lines\n`;
        // 显示具体变化的部分（只显示前几行）
        const showLines = Math.min(6, Math.max(oldLines.length, newLines.length));
        for (let i = 0; i < showLines; i++) {
          const oldLine = oldLines[i] || '';
          const newLine = newLines[i] || '';
          if (oldLine !== newLine) {
            if (oldLine) diff += `-${oldLine.substring(0, 100)}\n`;
            if (newLine) diff += `+${newLine.substring(0, 100)}\n`;
          }
        }
        if (oldLines.length > showLines || newLines.length > showLines) {
          diff += `... (${Math.max(oldLines.length, newLines.length) - showLines} more lines)\n`;
        }
        return diff.trim();
      }
      return `Edit(${input.file_path || ''})`;
    case 'Read':
      // Read 工具只显示文件路径，actual content 在 tool_result 中
      return `Read(${input.file_path || ''})`;
    case 'Glob':
      return `[Glob] ${input.pattern || ''}`;
    case 'Grep':
      return `[Grep] ${input.pattern || ''} in ${input.path || ''}`;
    case 'TaskCreate':
      return `[TaskCreate] ${input.subject || ''}`;
    case 'TaskUpdate':
      return `[TaskUpdate] #${input.taskId} - ${input.status || ''}`;
    case 'TaskOutput':
      return `[TaskOutput] ${input.task_id || ''}`;
    case 'WebSearch':
      return `[WebSearch] ${input.query || ''}`;
    case 'WebFetch':
      return `[WebFetch] ${input.url || ''}`;
    case 'Markedio':
      return `[Markedio] ${input.url || input.text ? (input.url || input.text).substring(0, 50) : ''}`;
    default:
      // 对于未知工具，只显示工具名
      return `[${name}]`;
  }
}

// 格式化工具结果
function formatToolResult(content) {
  if (!content) return '';
  if (typeof content === 'string') {
    // 如果看起来像 JSON，尝试解析
    if (content.startsWith('{') || content.startsWith('[')) {
      try {
        const parsed = JSON.parse(content);
        return formatToolResult(parsed);
      } catch (e) {
        // 解析失败，返回原字符串
      }
    }
    // 工具结果通常包含有意义的内容，不过度截断
    // 如果是 Read 工具结果（包含行号），保留更多内容
    if (content.includes('→') || (content.includes('\n') && content.length > 100)) {
      return content.substring(0, 2000);
    }
    return content.substring(0, 500);
  }
  if (typeof content === 'object') {
    // 尝试提取 result、stdout、message 等字段
    const result = content.result || content.stdout || content.message || content.content || content.error;
    if (result) {
      if (typeof result === 'string') {
        if (result.includes('→') || (result.includes('\n') && result.length > 100)) {
          return result.substring(0, 2000);
        }
        return result.substring(0, 500);
      }
      return formatToolResult(result);
    }
    // 返回空字符串避免显示 [object Object]
    return '';
  }
  return String(content).substring(0, 500);
}

// 从content中提取纯文本
function extractText(content) {
  if (!content) return '';
  if (typeof content === 'string') {
    // 如果是 JSON 字符串，尝试解析后提取
    if (content.startsWith('[') || content.startsWith('{')) {
      try {
        const parsed = JSON.parse(content);
        return extractText(parsed);
      } catch (e) {
        // 解析失败，如果是短字符串可能是实际内容
        if (content.length < 100 && !content.includes('":')) {
          return content;
        }
        return '';
      }
    }
    // 普通字符串
    return content;
  }
  if (Array.isArray(content)) {
    // 过滤掉 thinking 类型，提取所有文本内容
    const texts = [];
    for (const c of content) {
      if (c.type === 'thinking') continue;
      if (c.type === 'text' && c.text) {
        texts.push(c.text);
      } else if (c.type === 'input' && c.text) {
        // 用户输入类型
        texts.push(c.text);
      } else if (c.type === 'tool_use') {
        // 工具调用显示为单独 DOM，这里只返回工具名
        texts.push(`[${c.name || 'Unknown'}]`);
      } else if (c.type === 'tool_result' && c.content) {
        // 工具结果由 formatToolResult 处理，这里返回空
      } else if (c.text) {
        // 其他有 text 字段的类型
        texts.push(c.text);
      }
    }
    return texts.join('');
  }
  if (typeof content === 'object') {
    // 尝试从各种对象结构中提取有用信息
    if (content.text) return content.text;
    if (content.stdout) return content.stdout;
    if (content.message) {
      // message 可能是字符串或对象
      if (typeof content.message === 'string') return content.message;
      if (content.message.content) return extractText(content.message.content);
    }
    if (content.result) return typeof content.result === 'string' ? content.result : '';
    // Fallback: 返回 JSON 字符串而不是空
    try {
      return JSON.stringify(content).substring(0, 1000);
    } catch (e) {
      return '';
    }
  }
  return '';
}

// 添加消息到界面
function addMessage(container, text, type) {
  if (!text || !text.trim()) return;

  // 过滤 <system-reminder>
  if (text.includes('<system-reminder>')) return;

  // 过滤看起来像会话ID的字符串
  if (looksLikeSessionId(text.trim())) return;

  const lineEl = document.createElement('div');
  lineEl.className = 'output-line ' + type;
  const truncatedText = text.substring(0, 1000);

  if (type === 'stdout') {
    // stdout 使用 Markdown 渲染，前面加 ●
    let contentHtml;
    if (typeof marked !== 'undefined') {
      contentHtml = marked.parse(truncatedText);
    } else {
      contentHtml = escapeHtml(truncatedText);
    }
    // 清理危险标签
    const safeHtml = contentHtml.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                             .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
                             .replace(/on\w+="[^"]*"/gi, '')
                             .replace(/on\w+='[^']*'/gi, '');
    lineEl.innerHTML = `<span class="msg-bullet">●</span><span class="msg-text">${safeHtml}</span>`;
  } else if (type === 'input') {
    // input 不加 ●，使用纯文本
    lineEl.textContent = truncatedText;
  } else {
    lineEl.textContent = truncatedText;
  }
  container.appendChild(lineEl);
}

// 渲染历史消息到容器
function renderHistoryMessage(container, msg) {
  const role = msg.message?.role || msg.type;
  const content = msg.message?.content || msg.content;
  if (role === 'user') {
    console.log('[renderHistoryMessage] user msg:', JSON.stringify(msg).substring(0, 500));
  }

  if (role === 'user') {
    // user 消息可能是工具结果或用户输入，统一用 extractText 处理
    const text = extractText(content);
    if (text) addMessage(container, text, 'input');
    // 工具结果单独显示
    if (Array.isArray(content)) {
      content.forEach(c => {
        if (c.type === 'tool_result' && c.content) {
          const resultText = formatToolResult(c.content);
          if (resultText) addMessage(container, resultText, 'stdout');
        }
      });
    }
  } else if (role === 'assistant') {
    if (content) {
      const text = extractText(content);
      if (text) addMessage(container, text, 'stdout');
      // 检查是否有工具调用或工具结果
      if (Array.isArray(content)) {
        content.forEach(c => {
          if (c.type === 'tool_use') {
            const lineEl = document.createElement('div');
            lineEl.className = 'output-line tool-use';
            lineEl.style.cssText = 'background: transparent !important;';
            lineEl.innerHTML = `<span class="tool-name">${formatToolUse(c)}</span>`;
            container.appendChild(lineEl);
          } else if (c.type === 'tool_result' && c.content) {
            const text = formatToolResult(c.content);
            if (text) addMessage(container, text, 'stdout');
          }
        });
      }
    }
  } else if (msg.toolUseResult) {
    const text = extractText(msg.toolUseResult);
    if (text) addMessage(container, `[结果] ${text.substring(0, 1000)}`, 'tool-result');
  }
}

export function connectSessionStream(sessionId) {
  if (state.eventSource) {
    state.eventSource.close();
  }

  state.eventSource = new EventSource(`/api/chat/stream/${sessionId}`);

  state.eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleStreamMessage(data);
    } catch (e) {
      console.error('SSE消息解析失败:', e);
    }
  };

  state.eventSource.onerror = (error) => {
    console.error('SSE连接错误:', error);
    state.eventSource.close();
    state.eventSource = null;
  };
}

function handleStreamMessage(data) {
  // 统一的输出元素查找 - 如果没有 sessionId，使用当前 session
  const sessionId = data.sessionId || state.currentSession;
  const output = findOutputElement(sessionId);
  if (!output) return;

  // 直接处理所有消息，不管 type 是什么
  const content = data.messages || data.content || data.message?.content;

  // 如果有 messages 数组（update 类型）
  if (Array.isArray(data.messages)) {
    renderMessages(output, data.messages);
    output.scrollTop = output.scrollHeight;
    return;
  }

  // 如果有 content 数组
  if (Array.isArray(content)) {
    renderContentArray(output, content, data.message?.role || 'assistant');
    output.scrollTop = output.scrollHeight;
    return;
  }

  // 如果有字符串 content
  if (typeof content === 'string' && content.trim()) {
    if (!content.includes('<system-reminder>') && !looksLikeSessionId(content)) {
      addMessage(output, content, data.type === 'user' ? 'input' : 'stdout');
      output.scrollTop = output.scrollHeight;
    }
    return;
  }
}

// 检查字符串是否看起来像会话ID/UUID而不是实际内容
function looksLikeSessionId(str) {
  if (!str || typeof str !== 'string') return false;
  // UUID 格式: 8-4-4-4-12 十六进制字符
  // 或者类似 3412d4de-f81b-430f-9474-65e67ba0518b 这样的会话ID
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  // 简化检测：如果字符串是 36 个字符且包含 4 个短横线，很可能是 UUID
  if (str.length === 36 && (str.match(/-/g) || []).length === 4) {
    return true;
  }
  return false;
}

// 渲染消息数组到输出元素
function renderMessages(output, messages) {
  for (const msg of messages) {
    // 跳过元消息
    if (msg.isMeta) {
      continue;
    }

    // 尝试解析 message.content 或 content
    const content = msg.message?.content || msg.content;
    const role = msg.message?.role || msg.type;

    // 统一处理：如果是数组，交给 renderContentArray
    if (Array.isArray(content)) {
      renderContentArray(output, content, role);
    } else if (typeof content === 'string') {
      // 字符串直接显示
      if (!content.includes('<system-reminder>') && !looksLikeSessionId(content)) {
        addMessage(output, content, role === 'user' ? 'input' : 'stdout');
      }
    }
  }
}

// 渲染 content 数组
function renderContentArray(output, content, defaultRole = 'assistant') {
  if (!content) return;
  if (!Array.isArray(content)) {
    if (typeof content === 'string' && !content.includes('<system-reminder>') && !looksLikeSessionId(content)) {
      addMessage(output, content, defaultRole === 'user' ? 'input' : 'stdout');
    }
    return;
  }

  for (const item of content) {
    if (item.type === 'thinking') continue;
    if (JSON.stringify(item).includes('<system-reminder>')) continue;

    if (item.type === 'text' && item.text) {
      // 检查 item.text 是否是被 JSON.stringify 处理过的字符串
      let text = item.text;
      try {
        // 尝试解析被转义的 JSON 字符串
        const parsed = JSON.parse(text);
        if (typeof parsed === 'string') {
          text = parsed;
        } else if (Array.isArray(parsed)) {
          // 如果解析后是数组，递归处理
          renderContentArray(output, parsed, defaultRole);
          continue;
        } else if (typeof parsed === 'object' && parsed !== null) {
          // 如果解析后是对象，尝试提取 text 字段
          if (parsed.type === 'text' && parsed.text) {
            text = parsed.text;
          } else if (parsed.type === 'tool_use' && parsed.name) {
            const line = document.createElement('div');
            line.className = 'output-line tool-use';
            line.innerHTML = `<span class="tool-name">${formatToolUse(parsed)}</span>`;
            output.appendChild(line);
            continue;
          } else {
            // 无法识别的对象，跳过
            continue;
          }
        } else {
          // 其他类型（数字、布尔等），保持原样
          text = String(parsed);
        }
      } catch (e) {
        // 不是 JSON 字符串，保持原样
      }
      // 过滤掉看起来像会话ID的字符串和 system-reminder
      if (!text.includes('<system-reminder>') && !looksLikeSessionId(text)) {
        addMessage(output, text, defaultRole === 'user' ? 'input' : 'stdout');
      }
    } else if (item.type === 'tool_use' && item.name) {
      const line = document.createElement('div');
      line.className = 'output-line tool-use';
      line.innerHTML = `<span class="tool-name">${formatToolUse(item)}</span>`;
      output.appendChild(line);
    } else if (item.type === 'tool_result' && item.content) {
      const text = formatToolResult(item.content);
      if (text) addMessage(output, text, 'stdout');
    }
  }
}

export function sendMessage(text, sessionId = null) {
  const targetSessionId = sessionId || state.currentSession;
  console.log('[sendMessage]', { text: text.substring(0, 50), sessionId, targetSessionId, currentSession: state.currentSession });
  if (!targetSessionId) {
    alert('请先选择一个会话');
    return;
  }

  // 查找对应的 chat-messages 元素
  let output = findSessionOutput(targetSessionId);
  console.log('[sendMessage] findSessionOutput:', output ? 'found' : 'null', 'targetSessionId:', targetSessionId);

  // 如果没找到，使用默认的 chat-messages
  if (!output) {
    output = $('chat-messages');
    console.log('[sendMessage] fallback to $("chat-messages"):', output ? 'found' : 'null');
  }

  // 用户消息由 SSE 返回后显示，这里不直接添加避免重复
  // 但如果 output 确实存在，可以先显示，等 SSE 返回时会忽略重复
  if (output) {
    // 使用 data-source="pending" 标记为待确认的消息
    const line = document.createElement('div');
    line.className = 'output-line input';
    line.setAttribute('data-source', 'pending');
    let contentHtml;
    if (typeof marked !== 'undefined') {
      contentHtml = marked.parse(text);
    } else {
      contentHtml = escapeHtml(text);
    }
    // 清理危险标签
    const safeHtml = contentHtml.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                             .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
                             .replace(/on\w+="[^"]*"/gi, '')
                             .replace(/on\w+='[^']*'/gi, '');
    line.innerHTML = `<span class="msg-bullet">●</span><span class="msg-text">${safeHtml}</span>`;
    output.appendChild(line);
    output.scrollTop = output.scrollHeight;
    console.log('[sendMessage] appended line to output (pending)');
  } else {
    console.log('[sendMessage] NO OUTPUT ELEMENT FOUND');
  }

  // 确保 SSE 已连接
  if (!state.eventSource || state.eventSource.readyState === EventSource.CLOSED) {
    console.log('[sendMessage] SSE not connected, reconnecting...');
    connectSessionStream(targetSessionId);
  }

  apiRequest('/api/chat/send', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: targetSessionId,
      message: text,
      projectPath: state.currentProject?.path
    })
  }).catch(err => {
    console.error('发送消息失败:', err);
    alert('发送失败: ' + err.message);
  });
}

export async function createNewSession() {
  try {
    // 获取当前项目的 projectId
    const projectId = state.currentProject ? encodeProjectPath(state.currentProject.path) : null;
    const data = await apiRequest('/api/chat/sessions', {
      method: 'POST',
      body: JSON.stringify({ projectId })
    });

    if (data.sessionId) {
      await loadSessions();
      return data.sessionId;
    }
  } catch (error) {
    console.error('创建会话失败:', error);
  }
  return null;
}
