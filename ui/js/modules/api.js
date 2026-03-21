// API 和 WebSocket 模块
import { state } from './state.js';
import { loadSessions, findSessionOutput } from './sessions.js';
import { looksLikeSessionId } from './filters.js';

const API_BASE = window.location.origin;
let ws = null;

// WebSocket 重连退避配置
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 30000; // 最大重连延迟 30 秒
const BASE_RECONNECT_DELAY = 1000;  // 基础重连延迟 1 秒

// 流式输出：每个 session 的当前活动行
const activeLines = new Map(); // key: sessionId, value: { element, type }

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
    reconnectAttempts = 0;  // 重置重连计数
  };

  ws.onclose = () => {
    updateConnectionStatus(false);
    // 指数退避重连
    reconnectAttempts++;
    const delay = Math.min(
      BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts - 1),
      MAX_RECONNECT_DELAY
    );
    console.log(`[WS] Disconnected, reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
    setTimeout(connectWS, delay);
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
  const { type, sessionId } = data;

  // Chat 消息现在只通过 SSE 接收，禁用 WebSocket 的 chat 消息处理
  // 这样可以避免双重通道导致的重复或不同步问题
  if (type === 'output' || type === 'user' || type === 'error' ||
      type === 'status' || type === 'done' || type === 'message') {
    // Chat 消息跳过，由 SSE 处理
    return;
  }

  if (type === 'terminal') {
    addTerminalOutput(data.data, data.subtype || 'stdout');
  }
}

// 处理 Claude 的输出，根据内容类型渲染
function handleClaudeOutput(text, sessionId) {
  if (!text) return;

  console.log('[handleClaudeOutput]', {
    textLength: text.length,
    textPrefix: text.substring(0, 100),
    sessionId: sessionId ? sessionId.substring(0, 8) : null,
    startsWithBrace: text.startsWith('{'),
    startsWithBracket: text.startsWith('[')
  });

  // 尝试解析 JSON
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const json = JSON.parse(text);
      console.log('[handleClaudeOutput] Parsed JSON, type:', json.type, 'role:', json.role);
      renderClaudeMessage(json, sessionId);
      return;
    } catch (e) {
      // 不是有效 JSON，当作文本处理
      console.log('[handleClaudeOutput] JSON parse failed, treating as text');
    }
  }

  // 文本内容追加到当前行
  addSessionOutput(text, 'stdout', sessionId);
}

// 根据 Claude 消息类型渲染
function renderClaudeMessage(msg, sessionId) {
  // 跳过包含无效字段的消息（这些是元数据，不是实际内容）
  if (msg.sourceToolAssistantUUID || msg.userType === 'external') {
    // 这是包含执行上下文的元数据消息，跳过但不记录（避免日志过多）
    return;
  }

  // 跳过元消息（isMeta 标记的消息是 Claude Code 的控制消息）
  if (msg.isMeta) {
    return;
  }

  // 跳过包含工具结果但没有实际内容的消息（这些是执行上下文）
  if (msg.toolUseResult && !msg.content && !msg.message?.content) {
    return;
  }

  // 过滤 system 相关消息（包括 system-reminder）
  if (msg.role === 'system' || msg.type === 'system' ||
      msg.role === 'system-reminder' || msg.type === 'system-reminder') {
    return;
  }

  // 工具调用
  if (msg.type === 'tool_use' || msg.content?.type === 'tool_use') {
    const toolInfo = msg.content || msg;
    const toolName = toolInfo.name || 'Unknown';
    const toolInput = toolInfo.input ? JSON.stringify(toolInfo.input, null, 2).substring(0, 200) : '';
    addSessionOutput(`[${toolName}]${toolInput ? ' ' + toolInput : ''}`, 'tool-use', sessionId);
    return;
  }

  // 工具结果
  if (msg.type === 'tool_result' || msg.content?.type === 'tool_result') {
    const result = msg.content?.content || msg.content || msg.result || '';
    const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    addSessionOutput(text, 'stdout', sessionId);
    return;
  }

  // 用户消息
  if (msg.role === 'user' || msg.type === 'user') {
    const content = msg.message?.content || msg.content;
    if (typeof content === 'string') {
      addSessionOutput(content, 'input', sessionId);
    } else if (Array.isArray(content)) {
      for (const item of content) {
        if (item.type === 'thinking') continue;
        if (item.text && item.text.includes('<system-reminder>')) continue;
        if (item.type === 'text' && item.text) {
          addSessionOutput(item.text, 'input', sessionId);
        } else if (item.type === 'tool_use' && item.name) {
          addSessionOutput(`[${item.name}]`, 'tool-use', sessionId);
        }
      }
    }
    return;
  }

  // 助手消息
  if (msg.role === 'assistant' || msg.type === 'assistant') {
    const content = msg.message?.content || msg.content;
    if (Array.isArray(content)) {
      for (const item of content) {
        if (item.type === 'thinking') continue;
        if (item.text && item.text.includes('<system-reminder>')) continue;
        if (item.type === 'text' && item.text) {
          addSessionOutput(item.text, 'stdout', sessionId);
        } else if (item.type === 'tool_use' && item.name) {
          addSessionOutput(`[${item.name}]`, 'tool-use', sessionId);
        } else if (item.type === 'tool_result' && item.content) {
          const text = typeof item.content === 'string' ? item.content : JSON.stringify(item.content);
          addSessionOutput(text, 'stdout', sessionId);
        }
      }
    } else if (typeof content === 'string') {
      addSessionOutput(content, 'stdout', sessionId);
    } else if (content && typeof content === 'object') {
      // content 是单个对象 { type: 'text', text: '...' } 或 { type: 'tool_use', name: '...' }
      if (content.type === 'text' && content.text) {
        addSessionOutput(content.text, 'stdout', sessionId);
      } else if (content.type === 'tool_use' && content.name) {
        addSessionOutput(`[${content.name}]`, 'tool-use', sessionId);
      } else if (content.type === 'tool_result' && content.content) {
        const text = typeof content.content === 'string' ? content.content : JSON.stringify(content.content);
        addSessionOutput(text, 'stdout', sessionId);
      }
    }
    return;
  }

  // 跳过其他未知消息类型（不显示原始 JSON）
}

function addSessionOutput(text, type = 'stdout', sessionId = null) {
  // 过滤 <system-reminder>
  if (text && text.includes('<system-reminder>')) return;

  // 过滤看起来像会话ID的字符串
  if (looksLikeSessionId(text.trim())) return;

  // 使用 findSessionOutput 查找 output（现在优先使用主 #chat-messages）
  let output = findSessionOutput(sessionId);

  if (!output) {
    console.log('[addSessionOutput] CRITICAL: No output element found!');
    return;
  }

  // 统一使用 ● 标记
  const line = document.createElement('div');
  line.className = `output-line ${type}`;

  if (type === 'stdout') {
    // marked.parse 返回 HTML，需要清理危险标签
    const rawHtml = typeof marked !== 'undefined' ? marked.parse(text) : escapeHtml(text);
    // 移除 script、iframe 等危险标签，允许安全标签
    const safeHtml = rawHtml.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                           .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
                           .replace(/on\w+="[^"]*"/gi, '')
                           .replace(/on\w+='[^']*'/gi, '');
    line.innerHTML = `<span class="msg-bullet">●</span><span class="msg-text">${safeHtml}</span>`;
  } else if (type === 'input') {
    line.innerHTML = `<span class="msg-bullet">●</span><span class="msg-text">> ${escapeHtml(text)}</span>`;
  } else if (type === 'tool-use') {
    // 工具调用
    line.innerHTML = `<span class="msg-bullet">●</span><span class="msg-text">${escapeHtml(text)}</span>`;
  } else if (type === 'tool-result') {
    // 工具结果
    line.innerHTML = `<span class="msg-bullet">●</span><span class="msg-text">${escapeHtml(text)}</span>`;
  } else if (type === 'error') {
    // 错误
    line.innerHTML = `<span class="msg-bullet">●</span><span class="msg-text">${escapeHtml(text)}</span>`;
  } else if (type === 'file-change') {
    // 文件变更
    line.innerHTML = `<span class="msg-bullet">●</span><span class="msg-text">${escapeHtml(text)}</span>`;
  } else {
    // 其他类型
    line.innerHTML = `<span class="msg-bullet">●</span><span class="msg-text">${escapeHtml(text)}</span>`;
  }

  output.appendChild(line);
  output.scrollTop = output.scrollHeight;
}

// HTML 转义
export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
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
