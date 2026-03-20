/**
 * Claude 对话服务
 * 复用现有 Claude Code 会话
 */

import express from 'express';
import cors from 'cors';
import { spawn, exec } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// 当前活跃的 Claude 进程（使用 Map 支持多会话）
const activeProcesses = new Map();

// 广播消息
function broadcastClaude(type, data, sessionId = null) {
  if (!global.claudeWSS) {
    console.log('[Broadcast] No WebSocket server');
    return;
  }

  const message = JSON.stringify({ type, data, sessionId, timestamp: Date.now() });
  let sentCount = 0;
  let errCount = 0;
  global.claudeWSS.clients.forEach(client => {
    if (client.readyState === 1) {
      try {
        client.send(message);
        sentCount++;
      } catch (e) {
        console.log(`[Broadcast] send error: ${e.message}`);
        errCount++;
      }
    }
  });
  console.log(`[Broadcast] ${type} -> ${sentCount} clients, ${errCount} errors, sessionId=${sessionId}`);
}

// 清理进程记录
function cleanupProcess(sessionId) {
  if (activeProcesses.has(sessionId)) {
    activeProcesses.delete(sessionId);
  }
}

// 获取 Claude 配置目录
function getClaudeProjectsDir() {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  return path.join(home, '.claude', 'projects');
}

// 解码项目路径
function decodeProjectPath(folderName) {
  let result = folderName
    .replace(/^([a-zA-Z])--/, '$1:\\')
    .replace(/--/g, '\\');
  return result;
}

// 查找所有 Claude 会话（从项目目录）
router.get('/sessions', async (req, res) => {
  const { projectId } = req.query;
  const projectsDir = getClaudeProjectsDir();
  const sessions = [];

  // 判断 session 是否正在运行：检查文件是否在最近 90 秒内被修改
  const isWorking = (sessionIdFromFile, stat) => {
    // 如果这个 session 正在当前进程中运行，直接返回 working
    if (activeProcesses.has(sessionIdFromFile)) {
      return true;
    }

    // 直接用文件时间戳（已是 UTC 转换后的值）和当前时间比较
    // stat.mtime 是一个 Date 对象
    const nowMs = Date.now();
    const mtimeMs = stat.mtime.getTime();

    // 计算差值（毫秒）
    const diffMs = nowMs - mtimeMs;

    // 调试日志
    console.log(`[isWorking] session=${sessionIdFromFile.substring(0,8)}, now=${nowMs}, mtime=${mtimeMs}, diff=${diffMs}ms`);

    // 如果文件在最近 90 秒内被修改，认为是工作中
    return diffMs < 90000;
  };

  try {
    // 如果指定了项目，只获取该项目下的会话
    if (projectId) {
      const projectDir = path.join(projectsDir, projectId);
      if (fs.existsSync(projectDir)) {
        const files = fs.readdirSync(projectDir);
        const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));

        for (const file of jsonlFiles) {
          const filePath = path.join(projectDir, file);
          const stat = fs.statSync(filePath);
          const sessionId = file.replace('.jsonl', '');
          sessions.push({
            id: sessionId,
            sessionId: sessionId,
            name: `Session ${file.substring(0, 8)}`,
            projectPath: decodeProjectPath(projectId),
            projectId,
            status: isWorking(sessionId, stat) ? 'working' : 'idle',
            lastActivity: stat.mtime,
            size: stat.size
          });
        }
      }
    } else {
      // 获取所有项目的会话
      if (fs.existsSync(projectsDir)) {
        const entries = fs.readdirSync(projectsDir, { withFileTypes: true });

        for (const entry of entries) {
          if (entry.isDirectory()) {
            const projectDir = path.join(projectsDir, entry.name);
            const files = fs.readdirSync(projectDir);
            const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));

            for (const file of jsonlFiles) {
              const filePath = path.join(projectDir, file);
              const stat = fs.statSync(filePath);
              const sessionId = file.replace('.jsonl', '');
              sessions.push({
                id: sessionId,
                sessionId: sessionId,
                name: `Session ${file.substring(0, 8)}`,
                projectPath: decodeProjectPath(entry.name),
                projectId: entry.name,
                status: isWorking(sessionId, stat) ? 'working' : 'idle',
                lastActivity: stat.mtime,
                size: stat.size
              });
            }
          }
        }
      }
    }

    // 按最后活动时间排序
    sessions.sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));

    res.json({ sessions });
  } catch (e) {
    res.json({ sessions: [], error: e.message });
  }
});

// 创建新会话
router.post('/sessions', async (req, res) => {
  const { projectId } = req.body;
  const projectsDir = getClaudeProjectsDir();

  try {
    let targetDir;

    if (projectId) {
      targetDir = path.join(projectsDir, projectId);
    } else {
      // 默认使用第一个项目目录
      if (fs.existsSync(projectsDir)) {
        const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
        const firstProject = entries.find(e => e.isDirectory());
        if (firstProject) {
          targetDir = path.join(projectsDir, firstProject.name);
        }
      }
    }

    if (!targetDir || !fs.existsSync(targetDir)) {
      return res.status(400).json({ error: 'No project directory found' });
    }

    // 生成新的 session ID
    const sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
    const filePath = path.join(targetDir, `${sessionId}.jsonl`);

    // 创建空的 session 文件
    fs.writeFileSync(filePath, '', 'utf8');

    console.log(`[createSession] Created: ${filePath}`);

    res.json({ sessionId });
  } catch (error) {
    console.error('[createSession] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 获取会话详情
router.get('/session/:id', async (req, res) => {
  const { projectId } = req.query;
  const projectsDir = getClaudeProjectsDir();

  // 尝试在项目中查找会话文件
  let sessionFile = null;

  if (projectId) {
    const projectDir = path.join(projectsDir, projectId);
    if (fs.existsSync(projectDir)) {
      const filePath = path.join(projectDir, `${req.params.id}.jsonl`);
      if (fs.existsSync(filePath)) {
        sessionFile = filePath;
      }
    }
  }

  // 如果没找到，搜索所有项目
  if (!sessionFile && fs.existsSync(projectsDir)) {
    const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const filePath = path.join(projectsDir, entry.name, `${req.params.id}.jsonl`);
        if (fs.existsSync(filePath)) {
          sessionFile = filePath;
          break;
        }
      }
    }
  }

  try {
    if (!sessionFile) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // 读取会话内容
    const content = fs.readFileSync(sessionFile, 'utf-8');

    res.json({
      id: req.params.id,
      path: sessionFile,
      content: content.slice(-10000)  // 最近 10KB
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 查找session文件路径的辅助函数
function findSessionFile(sessionId, projectsDir) {
  if (!fs.existsSync(projectsDir)) return null;

  const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const filePath = path.join(projectsDir, entry.name, `${sessionId}.jsonl`);
      if (fs.existsSync(filePath)) {
        return { filePath, projectId: entry.name };
      }
    }
  }
  return null;
}

// 重命名session
router.put('/session/:id', async (req, res) => {
  const { name } = req.body;
  const { projectId } = req.query;
  const projectsDir = getClaudeProjectsDir();

  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }

  try {
    let sessionInfo;

    if (projectId) {
      const projectDir = path.join(projectsDir, projectId);
      const filePath = path.join(projectDir, `${req.params.id}.jsonl`);
      if (fs.existsSync(filePath)) {
        sessionInfo = { filePath, projectId };
      }
    }

    if (!sessionInfo) {
      sessionInfo = findSessionFile(req.params.id, projectsDir);
    }

    if (!sessionInfo) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // 重命名：在jsonl文件所在目录创建.name文件存储新名称
    const nameFile = sessionInfo.filePath.replace('.jsonl', '.name');
    fs.writeFileSync(nameFile, name, 'utf8');

    console.log(`[renameSession] Renamed session ${req.params.id} to "${name}"`);

    res.json({ success: true, name });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 删除session
router.delete('/session/:id', async (req, res) => {
  const { projectId } = req.query;
  const projectsDir = getClaudeProjectsDir();

  try {
    let sessionFile;

    if (projectId) {
      const projectDir = path.join(projectsDir, projectId);
      const filePath = path.join(projectDir, `${req.params.id}.jsonl`);
      if (fs.existsSync(filePath)) {
        sessionFile = filePath;
      }
    }

    if (!sessionFile) {
      const sessionInfo = findSessionFile(req.params.id, projectsDir);
      if (sessionInfo) {
        sessionFile = sessionInfo.filePath;
      }
    }

    if (!sessionFile) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // 删除jsonl文件和name文件
    fs.unlinkSync(sessionFile);
    const nameFile = sessionFile.replace('.jsonl', '.name');
    if (fs.existsSync(nameFile)) {
      fs.unlinkSync(nameFile);
    }

    console.log(`[deleteSession] Deleted session ${req.params.id}`);

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 发送消息到指定会话 - 使用 Claude Code 的 --continue 或新对话
router.post('/send', async (req, res) => {
  const { message, sessionId, projectPath } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  // 判断是否是新 session（只有 null/undefined 才是新 session，'new' 字符串也是无效的）
  const isNewSession = !sessionId || sessionId === 'new';
  // 对于新 session，使用 'new' 作为标识；对于有效 sessionId，使用真实的 sessionId
  const currentSessionId = isNewSession ? 'new' : sessionId;

  // 终止该 session 之前的进程（如果存在）
  if (activeProcesses.has(currentSessionId)) {
    const oldProc = activeProcesses.get(currentSessionId);
    oldProc.kill();
    cleanupProcess(currentSessionId);
  }

  broadcastClaude('user', message, currentSessionId);

  // 彻底清除所有 Claude 相关环境变量，避免嵌套检测
  const env = {};
  for (const key of Object.keys(process.env)) {
    if (!key.toLowerCase().includes('claude')) {
      env[key] = process.env[key];
    }
  }
  // 显式设置 CLAUDECODE 为空字符串，确保子进程不会检测到嵌套会话
  env.CLAUDECODE = '';
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '';

  // 使用 -p 模式发送消息
  // 只有当 sessionId 是有效的真实 session ID 时才使用 --continue
  // 'new' 或空值表示新 session，不使用 --continue
  // 注意：session-* 格式的 ID 是通过 API 新创建的，--continue 可能无法识别，使用 -p 即可
  // --dangerously-skip-permissions: 自动批准所有权限请求，无需手动确认
  let args;
  if (sessionId && sessionId !== 'new' && !sessionId.startsWith('session-')) {
    args = ['--continue', sessionId, '--dangerously-skip-permissions', '-p', message];
  } else {
    args = ['--dangerously-skip-permissions', '-p', message];
  }

  const cwd = projectPath && fs.existsSync(projectPath) ? projectPath : process.cwd();

  const claude = spawn('claude', args, {
    shell: true,
    cwd: cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  // 使用 Map 存储进程，以 sessionId 为 key
  const procInfo = {
    process: claude,
    output: '',
    responseSent: false,
    timeoutId: null,
    isTimeout: false  // 标记是否超时
  };
  activeProcesses.set(currentSessionId, claude);

  // 发送响应的辅助函数，确保只发送一次
  const sendResponse = (statusCode, data) => {
    if (!procInfo.responseSent) {
      procInfo.responseSent = true;
      res.status(statusCode).json(data);
    }
  };

  // 使用闭包中的 currentSessionId，避免竞态
  claude.stdout.on('data', (data) => {
    const text = data.toString();
    procInfo.output += text;
    broadcastClaude('output', text, currentSessionId);
  });

  claude.stderr.on('data', (data) => {
    broadcastClaude('error', data.toString(), currentSessionId);
  });

  claude.on('close', (code) => {
    cleanupProcess(currentSessionId);
    if (procInfo.timeoutId) {
      clearTimeout(procInfo.timeoutId);
    }
    // 如果是超时导致的关闭，不发送正常响应（超时已经通过 broadcastClaude 通知了）
    if (procInfo.isTimeout) {
      return;
    }
    broadcastClaude('status', 'done', currentSessionId);
    broadcastClaude('done', { exitCode: code }, currentSessionId);
    sendResponse(200, { response: procInfo.output, sessionId: currentSessionId });
  });

  claude.on('error', (error) => {
    cleanupProcess(currentSessionId);
    if (procInfo.timeoutId) {
      clearTimeout(procInfo.timeoutId);
    }
    broadcastClaude('error', error.message, currentSessionId);
    sendResponse(500, { error: error.message });
  });

  // 5分钟超时
  procInfo.timeoutId = setTimeout(() => {
    if (activeProcesses.has(currentSessionId)) {
      procInfo.isTimeout = true;  // 标记为超时，防止 close 事件重复响应
      claude.kill();
      cleanupProcess(currentSessionId);
      broadcastClaude('status', 'timeout', currentSessionId);
    }
  }, 300000);
});

// 停止当前 Claude
router.post('/stop', (req, res) => {
  const { sessionId } = req.body;

  if (sessionId && activeProcesses.has(sessionId)) {
    // 停止指定 session 的进程
    const proc = activeProcesses.get(sessionId);
    proc.kill();
    cleanupProcess(sessionId);
    broadcastClaude('status', 'idle', sessionId);
  } else if (!sessionId) {
    // 停止所有活跃进程
    for (const [sid, proc] of activeProcesses) {
      proc.kill();
      cleanupProcess(sid);
    }
    broadcastClaude('status', 'idle');
  }
  res.json({ success: true });
});

// 健康检查
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    activeSessionCount: activeProcesses.size
  });
});

// 实时流 - SSE 推送会话最新输出
router.get('/stream/:id', (req, res) => {
  const { id } = req.params;
  const { projectId } = req.query;
  const projectsDir = getClaudeProjectsDir();

  // 设置 SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // 查找会话文件
  let sessionFile = null;
  let lastSize = 0;

  const findSessionFile = () => {
    // 如果指定了 projectId，先在该项目中查找
    if (projectId) {
      const projectDir = path.join(projectsDir, projectId);
      if (fs.existsSync(projectDir)) {
        const filePath = path.join(projectDir, `${id}.jsonl`);
        if (fs.existsSync(filePath)) {
          return filePath;
        }
      }
    }

    // 全局搜索所有项目
    if (fs.existsSync(projectsDir)) {
      const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const filePath = path.join(projectsDir, entry.name, `${id}.jsonl`);
          if (fs.existsSync(filePath)) {
            return filePath;
          }
        }
      }
    }
    return null;
  };

  sessionFile = findSessionFile();

  if (!sessionFile) {
    res.write(`data: ${JSON.stringify({ error: 'Session not found' })}\n\n`);
    res.end();
    return;
  }

  // 获取初始文件大小
  try {
    const stat = fs.statSync(sessionFile);
    lastSize = stat.size;
  } catch (e) {}

  // 发送初始状态
  res.write(`data: ${JSON.stringify({ type: 'connected', sessionId: id })}\n\n`);

  // 定时检查新内容
  const interval = setInterval(() => {
    try {
      const stat = fs.statSync(sessionFile);

      // 文件有新内容
      if (stat.size > lastSize) {
        try {
          // 使用固定大小的缓冲区读取文件末尾
          const readSize = Math.min(stat.size - lastSize + 10000, 100000); // 最多读取 100KB
          const startPos = Math.max(0, stat.size - readSize);

          // 创建缓冲区并读取文件末尾
          const fd = fs.openSync(sessionFile, 'r');
          const buffer = Buffer.alloc(readSize);
          const bytesRead = fs.readSync(fd, buffer, 0, readSize, startPos);
          fs.closeSync(fd);

          const content = buffer.toString('utf-8', 0, bytesRead);
          const newContent = startPos > lastSize ? content : content.slice(lastSize - startPos);

          console.log(`[SSE] ${id}: read ${bytesRead} bytes, newContent length = ${newContent.length}, lastSize = ${lastSize}, newSize = ${stat.size}`);

          // 解析 JSONL 行
          const lines = newContent.trim().split('\n').filter(l => l.trim());
          const messages = [];

          for (const line of lines) {
            try {
              const obj = JSON.parse(line);
              messages.push(obj);
            } catch (e) {
              // 不是 JSON，可能是纯文本
              messages.push({ raw: line });
            }
          }

          console.log(`[SSE] ${id}: parsed ${messages.length} messages`);

          if (messages.length > 0) {
            // 只发送最新的 5 条消息，避免数据量过大
            const recentMessages = messages.slice(-5);
            res.write(`data: ${JSON.stringify({
              type: 'update',
              sessionId: id,
              messages: recentMessages,
              newSize: stat.size
            })}\n\n`);
          }

          lastSize = stat.size;
        } catch (e) {
          console.error(`[SSE] ${id}: error reading file: ${e.message}`);
          lastSize = stat.size; // 即使出错也更新，避免一直重试
        }
      }

      // 检查文件是否还在增大（判断是否还在工作）
      const isWorking = stat.size > lastSize;

      // 每隔几秒发送心跳
      res.write(`data: ${JSON.stringify({
        type: 'heartbeat',
        sessionId: id,
        isWorking,
        size: stat.size
      })}\n\n`);

    } catch (e) {
      res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
    }
  }, 2000);  // 每 2 秒检查一次

  // 客户端断开时清理
  req.on('close', () => {
    clearInterval(interval);
    console.log(`SSE client disconnected: ${id}`);
  });
});

export function initClaudeWS(wss) {
  global.claudeWSS = wss;
}

// 日志写入接口
router.post('/log', async (req, res) => {
  const { content } = req.body;
  if (!content) {
    return res.status(400).json({ error: 'Content is required' });
  }

  // 使用绝对路径，确保无论从哪个目录启动都能正确写入
  const logDir = path.join(os.homedir(), '.claude', 'logs');
  const logPath = path.join(logDir, 'session-raw.log');

  // 确保目录存在
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  // 追加写入
  fs.appendFileSync(logPath, content + '\n');
  res.json({ success: true });
});

export default router;
