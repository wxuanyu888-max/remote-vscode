// Session 管理模块
import { state, $ } from './state.js';
import { apiRequest } from './api.js';

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

  // 10分钟前的时间戳
  const tenMinutesAgo = Date.now() - 10 * 60 * 1000;

  // 正在运行的session
  const workingSessions = state.sessions.filter(s => s.status === 'working');

  // 10分钟内活跃过的session（包含正在运行的）
  const activeSessions = state.sessions.filter(s => {
    if (s.status === 'working') return true;
    // 检查 lastActivity 字段
    const lastActivity = s.lastActivity ? new Date(s.lastActivity).getTime() : 0;
    return lastActivity > tenMinutesAgo;
  });

  if (activeSessions.length > 0) {
    sessionSelect.innerHTML = '<option value="">选择 Session...</option>' +
      workingSessions.map(session => {
        const sessionId = session.id || session.sessionId || 'unknown';
        const shortId = sessionId.substring(0, 8);
        return `<option value="${sessionId}">${session.name || `Session ${shortId}`} (运行中)</option>`;
      }).join('') +
      activeSessions.filter(s => s.status !== 'working').map(session => {
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
      state.sessions.slice(0, 5).map(session => {
        const sessionId = session.id || session.sessionId || 'unknown';
        const shortId = sessionId.substring(0, 8);
        return `<option value="${sessionId}">${session.name || `Session ${shortId}`}</option>`;
      }).join('');
  }

  sessionSelect.onchange = (e) => {
    const sessionId = e.target.value;
    if (sessionId) {
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

export function selectSession(sessionId) {
  const sessionSelect = $('session-select');
  if (sessionSelect) {
    sessionSelect.value = sessionId;
  }

  state.currentSession = sessionId;
  const session = state.sessions.find(s => (s.id || s.sessionId) === sessionId);

  const chatMessages = $('chat-messages');
  if (chatMessages) {
    chatMessages.innerHTML = `
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
    const output = $('chat-messages');
    if (!output) return;

    const isError = data.content?.type === 'error' || data.subtype === 'error';
    const isInput = data.subtype === 'input';

    const line = document.createElement('div');
    line.className = isError ? 'output-line error' : isInput ? 'output-line input' : 'output-line stdout';

    if (data.content?.type === 'tool_use') {
      line.className = 'output-line tool-use';
      line.textContent = `[工具] ${data.content.name}`;
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
    const output = $('chat-messages');
    if (output) {
      const line = document.createElement('div');
      line.className = 'output-line error';
      line.textContent = `错误: ${data.message}`;
      output.appendChild(line);
      output.scrollTop = output.scrollHeight;
    }
  }
}

export function sendMessage(text) {
  if (!state.currentSession) {
    alert('请先选择一个会话');
    return;
  }

  const output = $('chat-messages');
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
      sessionId: state.currentSession,
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
      loadSessions();
      return data.sessionId;
    }
  } catch (error) {
    console.error('创建会话失败:', error);
  }
  return null;
}
