// Session 管理模块
import { state, $ } from './state.js';
import { apiRequest } from './api.js';

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

  // 正在运行的session
  const workingSessions = state.sessions.filter(s => s.status === 'working');

  // 只显示最近10分钟活着的session（最多50个）
  const allSessions = state.sessions.filter(isAlive).slice(0, 50);

  if (allSessions.length > 0) {
    sessionSelect.innerHTML = '<option value="">选择 Session...</option>' +
      '<option value="new">+ 新建 Session</option>' +
      workingSessions.map(session => {
        const sessionId = session.id || session.sessionId || 'unknown';
        const shortId = sessionId.substring(0, 8);
        return `<option value="${sessionId}" style="font-weight:bold">${session.name || `Session ${shortId}`} (运行中)</option>`;
      }).join('') +
      allSessions.filter(s => s.status !== 'working').map(session => {
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
    // 也过滤最近10分钟活着的session
    const aliveSessions = state.sessions.filter(isAlive).slice(0, 5);
    sessionSelect.innerHTML = '<option value="">暂无 Session</option>' +
      '<option value="new">+ 新建 Session</option>' +
      aliveSessions.map(session => {
        const sessionId = session.id || session.sessionId || 'unknown';
        const shortId = sessionId.substring(0, 8);
        return `<option value="${sessionId}">${session.name || `Session ${shortId}`}</option>`;
      }).join('');
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

          // 根据消息类型渲染
          const role = msg.message?.role || msg.type;
          const content = msg.message?.content || msg.content;

          if (role === 'user') {
            // 用户消息
            const text = extractText(content);
            if (text) {
              addMessage(chatMessages, text, 'input');
            }
          } else if (role === 'assistant') {
            // 助手消息
            if (content) {
              const text = extractText(content);
              if (text) {
                addMessage(chatMessages, text, 'stdout');
              }
              // 检查是否有工具调用
              if (Array.isArray(content)) {
                content.forEach(c => {
                  if (c.type === 'tool_use') {
                    const lineEl = document.createElement('div');
                    lineEl.className = 'output-line tool-use';
                    lineEl.style.cssText = 'background: transparent !important;';
                    lineEl.innerHTML = `<span class="tool-name">[Edit] ${c.name}</span>`;
                    chatMessages.appendChild(lineEl);
                  }
                });
              }
            }
          } else if (msg.toolUseResult) {
            // 工具结果
            const text = extractText(msg.toolUseResult);
            if (text) {
              addMessage(chatMessages, `[结果] ${text.substring(0, 500)}`, 'tool-result');
            }
          }
        } catch (e) {
          // 非 JSON 行直接显示
          if (line.trim() && line.trim().length < 500) {
            addMessage(chatMessages, line.trim(), '');
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

// 从content中提取纯文本
function extractText(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    // 过滤掉 thinking 类型
    const filtered = content.filter(c => c.type !== 'thinking');
    return filtered.map(c => {
      if (c.type === 'text') return c.text || '';
      if (c.type === 'tool_use') return `[Edit] ${c.name}`;
      if (c.type === 'tool_result') return c.content || '';
      return JSON.stringify(c);
    }).join('');
  }
  if (content.text) return content.text;
  return JSON.stringify(content).substring(0, 1000);
}

// 添加消息到界面
function addMessage(container, text, type) {
  if (!text || !text.trim()) return;
  const lineEl = document.createElement('div');
  lineEl.className = 'output-line ' + type;
  const truncatedText = text.substring(0, 3000);

  if (type === 'stdout') {
    // stdout 使用 Markdown 渲染，前面加 ●
    let contentHtml;
    if (typeof marked !== 'undefined') {
      contentHtml = marked.parse(truncatedText);
    } else {
      contentHtml = escapeHtml(truncatedText);
    }
    lineEl.innerHTML = `<span class="msg-bullet">●</span><span class="msg-text">${contentHtml}</span>`;
  } else if (type === 'input') {
    // input 不加 ●，使用纯文本
    lineEl.textContent = truncatedText;
  } else {
    lineEl.textContent = truncatedText;
  }
  container.appendChild(lineEl);
}

// HTML 转义函数
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
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
  if (data.type === 'content' || data.type === 'message') {
    let output = null;

    // 优先查找当前 session 对应的标签页
    if (state.currentSession) {
      const tab = state.openTabs.find(t => t.sessionId === state.currentSession && t.type === 'chat');
      if (tab) {
        output = document.querySelector(`#chat-messages-${tab.id}`);
      }
    }

    // 如果没找到，使用默认的 chat-messages
    if (!output) {
      output = $('chat-messages');
    }

    if (!output) return;

    const isError = data.content?.type === 'error' || data.subtype === 'error';
    const isInput = data.subtype === 'input';

    const line = document.createElement('div');
    line.className = isError ? 'output-line error' : isInput ? 'output-line input' : 'output-line stdout';

    if (data.content?.type === 'tool_use') {
      line.className = 'output-line tool-use';
      line.style.cssText = 'background: transparent !important;';
      line.innerHTML = `<span class="tool-name">[Edit] ${data.content.name}</span>`;
    } else if (data.content?.type === 'tool_result') {
      line.className = 'output-line tool-result';
      line.textContent = `[结果] ${data.content.content || ''}`;
    } else {
      line.textContent = data.content?.text || data.content || data.text || '';
    }

    output.appendChild(line);
    output.scrollTop = output.scrollHeight;
  } else if (data.type === 'status') {
    const statusEl = $('claude-status');
    if (statusEl) {
      statusEl.textContent = data.status === 'working' ? '工作中...' : '空闲';
    }
    if (data.status === 'completed' || data.status === 'idle') {
      loadSessions();
    }
  } else if (data.type === 'error') {
    let output = null;

    if (state.currentSession) {
      const tab = state.openTabs.find(t => t.sessionId === state.currentSession && t.type === 'chat');
      if (tab) {
        output = document.querySelector(`#chat-messages-${tab.id}`);
      }
    }

    if (!output) {
      output = $('chat-messages');
    }

    if (output) {
      const line = document.createElement('div');
      line.className = 'output-line error';
      line.textContent = `错误: ${data.message}`;
      output.appendChild(line);
      output.scrollTop = output.scrollHeight;
    }
  }
}

export function sendMessage(text, sessionId = null) {
  const targetSessionId = sessionId || state.currentSession;
  if (!targetSessionId) {
    alert('请先选择一个会话');
    return;
  }

  // 查找对应的 chat-messages 元素
  let output = null;
  if (sessionId) {
    // 查找该 session 对应的标签页中的 chat-messages
    const tab = state.openTabs.find(t => t.sessionId === sessionId && t.type === 'chat');
    if (tab) {
      output = document.querySelector(`#chat-messages-${tab.id}`);
    }
  }

  // 如果没找到，使用默认的 chat-messages
  if (!output) {
    output = $('chat-messages');
  }

  if (output) {
    const line = document.createElement('div');
    line.className = 'output-line input';
    line.textContent = `> ${text}`;
    output.appendChild(line);
    output.scrollTop = output.scrollHeight;
  }

  apiRequest('/api/chat/send', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: targetSessionId,
      message: text
    })
  }).catch(err => {
    console.error('发送消息失败:', err);
    alert('发送失败: ' + err.message);
  });
}

export async function createNewSession() {
  try {
    const data = await apiRequest('/api/chat/sessions', {
      method: 'POST',
      body: JSON.stringify({})
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
