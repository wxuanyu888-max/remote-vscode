// API 和 WebSocket 模块
import { state } from './state.js';
import { loadSessions } from './sessions.js';

const API_BASE = window.location.origin;
let ws = null;

export async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

export function connectWS() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    updateConnectionStatus(true);
  };

  ws.onclose = () => {
    updateConnectionStatus(false);
    // 重连
    setTimeout(connectWS, 3000);
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleWSMessage(data);
    } catch (e) {
      console.error('WS消息解析失败:', e);
    }
  };

  ws.onerror = (error) => {
    console.error('WebSocket错误:', error);
  };
}

function updateConnectionStatus(connected) {
  const statusEl = document.getElementById('ws-status');
  if (statusEl) {
    statusEl.innerHTML = `
      <span class="status-dot ${connected ? 'connected' : ''}"></span>
      ${connected ? '已连接' : '未连接'}
    `;
  }
}

function handleWSMessage(data) {
  if (data.type === 'session' || data.type === 'message') {
    addSessionOutput(data.content || data.text, data.subtype || 'stdout');
  } else if (data.type === 'status') {
    updateSessionStatus(data.status, data.sessionId);
  } else if (data.type === 'system') {
    loadSessions();
  } else if (data.type === 'terminal') {
    addTerminalOutput(data.data, data.subtype || 'stdout');
  }
}

function addSessionOutput(text, type = 'stdout') {
  const output = document.getElementById('chat-messages') || document.getElementById('session-output');
  if (!output) return;

  // 检测文件变更格式
  if (text.includes('●') || text.includes('◼') || text.includes('✓') ||
      text.includes('Update(') || text.includes('Create(') || text.includes('Delete(') ||
      text.includes('Added') || text.includes('removed') || text.includes('changed')) {
    const line = document.createElement('div');
    line.className = 'output-line file-change';
    line.textContent = text;
    output.appendChild(line);
  } else if (type === 'error') {
    const line = document.createElement('div');
    line.className = 'output-line error';
    line.textContent = text;
    output.appendChild(line);
  } else if (type === 'input') {
    const line = document.createElement('div');
    line.className = 'output-line input';
    line.textContent = `> ${text}`;
    output.appendChild(line);
  } else {
    const line = document.createElement('div');
    line.className = 'output-line stdout';
    line.textContent = text;
    output.appendChild(line);
  }

  output.scrollTop = output.scrollHeight;
}

function addChatMessage(text, type = 'stdout') {
  const output = document.getElementById('chat-messages');
  if (!output) return;

  const line = document.createElement('div');
  line.className = `output-line ${type}`;
  line.textContent = text;
  output.appendChild(line);
  output.scrollTop = output.scrollHeight;
}

function addTerminalOutput(text, type = 'stdout') {
  const output = document.getElementById('terminal-output');
  if (!output) return;

  const line = document.createElement('div');
  line.className = `output-line ${type}`;
  line.textContent = text;
  output.appendChild(line);
  output.scrollTop = output.scrollHeight;
}

function updateSessionStatus(status, sessionId) {
  state.isClaudeWorking = (status === 'working');

  const statusEl = document.getElementById('claude-status');
  if (statusEl) {
    statusEl.textContent = status === 'working' ? '工作中...' : '空闲';
  }

  // 如果完成工作了，刷新session列表
  if (status === 'idle' || status === 'completed') {
    loadSessions();
  }
}
