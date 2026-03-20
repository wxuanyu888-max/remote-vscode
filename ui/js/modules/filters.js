/**
 * 消息过滤模块
 * 集中所有消息过滤逻辑，避免散落在多处
 */

/**
 * 检查字符串是否看起来像会话ID/UUID而不是实际内容
 */
export function looksLikeSessionId(str) {
  if (!str || typeof str !== 'string') return false;
  // UUID 格式: 8-4-4-4-12 十六进制字符
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (str.length === 36 && (str.match(/-/g) || []).length === 4) {
    return true;
  }
  return false;
}

/**
 * 检查字符串是否看起来像工具调用格式的输出（如 Read(file_path)）
 */
export function looksLikeToolOutput(str) {
  if (!str || typeof str !== 'string') return false;
  // 匹配类似 Read(...), Write(...), Edit(...), Bash(...) 等格式
  // 这些是工具调用的格式化输出，不应该直接显示给用户
  const toolPattern = /^(Read|Write|Edit|Bash|Glob|Grep|TaskCreate|TaskUpdate|TaskOutput|WebSearch|WebFetch|Markedio)\s*\(/i;
  if (toolPattern.test(str.trim())) {
    return true;
  }
  return false;
}

/**
 * 检查是否应该过滤掉某段文本
 * @param {string} text - 要检查的文本
 * @returns {boolean} - true 表示应该过滤掉，false 表示应该保留
 */
export function shouldFilterText(text) {
  if (!text || typeof text !== 'string') return true;
  if (text.includes('<system-reminder>')) return true;
  if (looksLikeSessionId(text.trim())) return true;
  if (looksLikeToolOutput(text.trim())) return true;
  return false;
}

/**
 * 检查消息对象是否应该被过滤
 * @param {object} msg - 消息对象
 * @returns {boolean} - true 表示应该过滤掉
 */
export function shouldFilterMessage(msg) {
  if (!msg) return true;
  // 跳过元消息
  if (msg.isMeta) return true;
  // 检查 JSON 中是否包含 system-reminder
  if (JSON.stringify(msg).includes('<system-reminder>')) return true;
  // 如果消息没有任何 type 或 role 信息，且没有有意义的 content，过滤掉
  // 这可以过滤掉一些空的元数据对象
  if (!msg.type && !msg.role && !msg.content && !msg.message?.content) {
    // 没有有用信息，检查是否只有原始字段
    const keys = Object.keys(msg);
    if (keys.length === 0 || (keys.length === 1 && keys[0] === 'sessionId')) {
      return true;
    }
  }
  return false;
}

/**
 * 统一的过滤检查函数 - 用于所有渲染场景
 * @param {string|object} content - 要检查的内容
 * @returns {boolean} - true 表示应该过滤掉
 */
export function shouldFilter(content) {
  if (!content) return true;
  if (typeof content === 'string') {
    return shouldFilterText(content);
  }
  if (typeof content === 'object') {
    return shouldFilterMessage(content);
  }
  return false;
}

/**
 * 截断文本到指定长度
 * @param {string} text - 要截断的文本
 * @param {number} maxLength - 最大长度
 * @returns {string}
 */
export function truncateText(text, maxLength = 1000) {
  if (!text || typeof text !== 'string') return '';
  return text.substring(0, maxLength);
}
