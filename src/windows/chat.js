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
router.use(cors());
router.use(express.json());

// 当前活跃的 Claude 进程
let activeProcess = null;

// 广播消息
function broadcastClaude(type, data) {
  if (!global.claudeWSS) {
    console.log('[Broadcast] No WebSocket server');
    return;
  }

  const clientCount = global.claudeWSS.clients.size;
  console.log(`[Broadcast] Sending ${type} to ${clientCount} clients`);

  const message = JSON.stringify({ type, data, timestamp: Date.now() });
  global.claudeWSS.clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(message);
    }
  });
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
          sessions.push({
            id: file.replace('.jsonl', ''),
            sessionId: file.replace('.jsonl', ''),
            name: `Session ${file.substring(0, 8)}`,
            projectPath: decodeProjectPath(projectId),
            projectId,
            status: 'idle',
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
              sessions.push({
                id: file.replace('.jsonl', ''),
                sessionId: file.replace('.jsonl', ''),
                name: `Session ${file.substring(0, 8)}`,
                projectPath: decodeProjectPath(entry.name),
                projectId: entry.name,
                status: 'idle',
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

// 发送消息到指定会话 - 使用 Claude Code 的 --continue 或新对话
router.post('/send', async (req, res) => {
  const { message, sessionId, projectPath } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  // 终止之前的进程
  if (activeProcess) {
    activeProcess.kill();
    activeProcess = null;
  }

  broadcastClaude('user', message);

  // 检查是否有 CLAUDECODE 环境变量（嵌套会话检测）
  const env = { ...process.env };
  delete env.CLAUDECODE;

  // 使用 -p 模式发送消息
  let args;
  if (sessionId) {
    args = ['--continue', sessionId, '-p', message];
  } else {
    args = ['-p', message];
  }

  const cwd = projectPath && fs.existsSync(projectPath) ? projectPath : process.cwd();

  const claude = spawn('claude', args, {
    shell: true,
    cwd: cwd,
    env
  });

  activeProcess = claude;
  let output = '';
  let sentFirst = false;

  const sendResponse = () => {
    if (!sentFirst) {
      sentFirst = true;
      res.json({ response: output, sessionId: sessionId || 'new' });
    }
  };

  claude.stdout.on('data', (data) => {
    const text = data.toString();
    output += text;
    broadcastClaude('output', text);
  });

  claude.stderr.on('data', (data) => {
    broadcastClaude('error', data.toString());
  });

  claude.on('close', (code) => {
    activeProcess = null;
    broadcastClaude('status', 'done');
    broadcastClaude('done', { exitCode: code });
    sendResponse();
  });

  claude.on('error', (error) => {
    activeProcess = null;
    broadcastClaude('error', error.message);
    if (!sentFirst) {
      res.status(500).json({ error: error.message });
    }
  });

  sendResponse();

  // 5分钟超时
  setTimeout(() => {
    if (activeProcess) {
      activeProcess.kill();
      broadcastClaude('status', 'timeout');
    }
  }, 300000);
});

// 停止当前 Claude
router.post('/stop', (req, res) => {
  if (activeProcess) {
    activeProcess.kill();
    activeProcess = null;
    broadcastClaude('status', 'idle');
  }
  res.json({ success: true });
});

// 健康检查
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    hasActiveSession: activeProcess !== null
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

export default router;
