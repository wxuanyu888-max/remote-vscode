/**
 * 终端服务
 * 捕获命令输出，通过 WebSocket 实时推送
 */

import express from 'express';
import cors from 'cors';
import { spawn } from 'child_process';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
router.use(cors());

// 终端会话管理
const terminals = new Map();
let terminalId = 0;

// 创建新终端
router.post('/create', (req, res) => {
  const { cwd, shell } = req.body;
  const id = `term_${++terminalId}`;

  const workDir = cwd || process.cwd();
  const shellCmd = shell || (process.platform === 'win32' ? 'cmd.exe' : '/bin/bash');

  // 创建子进程
  const proc = spawn(shellCmd, [], {
    cwd: workDir,
    shell: true,
    env: { ...process.env }
  });

  terminals.set(id, {
    proc,
    cwd: workDir,
    createdAt: Date.now()
  });

  // 捕获输出
  proc.stdout.on('data', (data) => {
    broadcastTerminal(id, 'stdout', data.toString());
  });

  proc.stderr.on('data', (data) => {
    broadcastTerminal(id, 'stderr', data.toString());
  });

  proc.on('close', (code) => {
    broadcastTerminal(id, 'exit', code);
    terminals.delete(id);
  });

  res.json({
    id,
    cwd: workDir,
    shell: shellCmd,
    message: '终端已创建'
  });
});

// 发送命令到终端
router.post('/input', (req, res) => {
  const { id, command } = req.body;

  const term = terminals.get(id);
  if (!term) {
    return res.status(404).json({ error: '终端不存在' });
  }

  if (term.proc.stdin.writable) {
    term.proc.stdin.write(command + '\n');
    res.json({ success: true });
  } else {
    res.status(400).json({ error: '终端不可写' });
  }
});

// 调整终端大小
router.post('/resize', (req, res) => {
  const { id, cols, rows } = req.body;

  const term = terminals.get(id);
  if (!term) {
    return res.status(404).json({ error: '终端不存在' });
  }

  // node-pty would support this, but basic spawn doesn't
  res.json({ success: true, message: 'resize not supported in basic mode' });
});

// 关闭终端
router.post('/close', (req, res) => {
  const { id } = req.body;

  const term = terminals.get(id);
  if (term) {
    // 监听 close 事件再返回响应，确保进程已退出
    term.proc.on('close', () => {
      terminals.delete(id);
      res.json({ success: true });
    });
    term.proc.kill();
    // 如果 5 秒后还没关闭，直接删除并返回
    setTimeout(() => {
      if (terminals.has(id)) {
        terminals.delete(id);
        res.json({ success: true });
      }
    }, 5000);
  } else {
    res.status(404).json({ error: '终端不存在' });
  }
});

// 列出所有终端
router.get('/list', (req, res) => {
  const list = Array.from(terminals.entries()).map(([id, term]) => ({
    id,
    cwd: term.cwd,
    createdAt: term.createdAt
  }));

  res.json({ terminals: list });
});

// 快速命令 - 执行单次命令并返回输出
router.post('/exec', (req, res) => {
  const { command, cwd, timeout } = req.body;

  if (!command) {
    return res.status(400).json({ error: 'command is required' });
  }

  const workDir = cwd || process.cwd();
  const proc = spawn(command, {
    shell: true,
    cwd: workDir
  });

  let stdout = '';
  let stderr = '';

  proc.stdout.on('data', (data) => {
    stdout += data.toString();
  });

  proc.stderr.on('data', (data) => {
    stderr += data.toString();
  });

  const timeoutMs = timeout || 30000;

  proc.on('close', (code) => {
    res.json({
      command,
      cwd: workDir,
      exitCode: code,
      stdout,
      stderr
    });
  });

  setTimeout(() => {
    proc.kill();
    res.json({
      command,
      cwd: workDir,
      exitCode: -1,
      stdout,
      stderr: stderr + '\n[超时]'
    });
  }, timeoutMs);
});

// WebSocket 广播
function broadcastTerminal(id, type, data) {
  if (!global.terminalWSS) return;

  global.terminalWSS.clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(JSON.stringify({ id, type, data }));
    }
  });
}

export function initTerminalWS(wss) {
  global.terminalWSS = wss;
}

export default router;
