/**
 * Remote VS Code - 数据流版
 * 通过 WebSocket 实时推送终端输出、文件变化、进程状态
 */

import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import path from 'path';
import os from 'os';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

import filesRouter from './files.js';
import chatRouter, { initClaudeWS } from './chat.js';
import terminalRouter, { initTerminalWS } from './terminal.js';
import watcherRouter, { initWatcherWS } from './watcher.js';
import processRouter from './process.js';
import projectsRouter from './projects.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json());

// API 路由（必须在静态文件之前）
app.use('/api/files', filesRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/chat', chatRouter);
app.use('/api/terminal', terminalRouter);
app.use('/api/watcher', watcherRouter);
app.use('/api/process', processRouter);

// UI 静态文件（必须在API路由之后）
app.use(express.static(path.join(__dirname, '../../ui')));

// 获取本机IP
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// UI 静态文件
app.use(express.static(path.join(__dirname, '../../ui')));

// 根路径返回服务信息
app.get('/', (req, res) => {
  const localIP = getLocalIP();

  res.json({
    name: 'Remote VS Code',
    version: '2.0.0',
    platform: 'Windows',
    mode: 'data-stream',
    services: {
      files: `http://${localIP}:${PORT}/api/files`,
      terminal: `http://${localIP}:${PORT}/api/terminal`,
      watcher: `http://${localIP}:${PORT}/api/watcher`,
      process: `http://${localIP}:${PORT}/api/process`,
      chat: `http://${localIP}:${PORT}/api/chat`
    },
    ws: `ws://${localIP}:${PORT}`,
    webUI: `http://${localIP}:${PORT}/`
  });
});

// 创建 HTTP 服务器
const server = createServer(app);

// WebSocket 服务器
const wss = new WebSocketServer({ server });

// 广播消息到所有 WebSocket 客户端
function broadcast(type, data) {
  const message = JSON.stringify({ type, data, timestamp: Date.now() });
  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(message);
    }
  });
}

// WebSocket 连接处理
wss.on('connection', (ws, req) => {
  console.log('WebSocket client connected');

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log('WS message:', data.type);
    } catch (e) {
      console.error('WS message parse error:', e);
    }
  });

  ws.on('close', () => {
    console.log('WebSocket client disconnected');
  });
});

// 初始化各服务的 WebSocket
initTerminalWS(wss);
initWatcherWS(wss);
initClaudeWS(wss);

// 启动服务
server.listen(PORT, '0.0.0.0', () => {
  const localIP = getLocalIP();
  console.log('='.repeat(50));
  console.log('Remote VS Code 数据流版 已启动');
  console.log('='.repeat(50));
  console.log(`本地访问: http://localhost:${PORT}`);
  console.log(`局域网访问: http://${localIP}:${PORT}`);
  console.log('');
  console.log('Web UI:');
  console.log(`  - 管理界面: http://${localIP}:${PORT}/`);
  console.log('');
  console.log('API 端点:');
  console.log(`  GET  /api/files/list    - 获取文件列表`);
  console.log(`  GET  /api/files/read   - 读取文件内容`);
  console.log(`  POST /api/terminal/exec - 执行命令`);
  console.log(`  POST /api/watcher/watch - 监控文件变化`);
  console.log(`  GET  /api/process/list  - 进程列表`);
  console.log(`  GET  /api/process/project - 项目进程`);
  console.log(`  POST /api/process/kill  - 终止进程`);
  console.log('');
  console.log('WebSocket:');
  console.log(`  ws://${localIP}:${PORT} - 实时数据流`);
  console.log('='.repeat(50));
});
