/**
 * 文件监控服务
 * 监控文件变化，通过 WebSocket 实时推送
 */

import express from 'express';
import cors from 'cors';
import chokidar from 'chokidar';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
router.use(cors());

// 监控实例管理
const watchers = new Map();
let watcherId = 0;

// 常用忽略模式
const DEFAULT_IGNORES = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/coverage/**',
  '**/*.log',
  '**/.DS_Store'
];

// 创建文件监控
router.post('/watch', (req, res) => {
  const { path: watchPath, ignores } = req.body;

  if (!watchPath) {
    return res.status(400).json({ error: 'path is required' });
  }

  const id = `watch_${++watcherId}`;

  // 合并忽略模式
  const ignorePatterns = [...DEFAULT_IGNORES, ...(ignores || [])];

  const watcher = chokidar.watch(watchPath, {
    ignored: ignorePatterns,
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 100
    }
  });

  watcher.on('add', filePath => {
    broadcastChange(id, 'add', filePath);
  });

  watcher.on('change', filePath => {
    broadcastChange(id, 'change', filePath);
  });

  watcher.on('unlink', filePath => {
    broadcastChange(id, 'unlink', filePath);
  });

  watcher.on('addDir', dirPath => {
    broadcastChange(id, 'addDir', dirPath);
  });

  watcher.on('unlinkDir', dirPath => {
    broadcastChange(id, 'unlinkDir', dirPath);
  });

  watcher.on('error', error => {
    console.error(`Watcher ${id} error:`, error);
    broadcastChange(id, 'error', error.message);
  });

  watchers.set(id, {
    watcher,
    path: watchPath,
    createdAt: Date.now()
  });

  res.json({
    id,
    path: watchPath,
    ignores: ignorePatterns,
    message: '监控已启动'
  });
});

// 停止监控
router.post('/unwatch', (req, res) => {
  const { id } = req.body;

  const watch = watchers.get(id);
  if (watch) {
    watch.watcher.close();
    watchers.delete(id);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: '监控不存在' });
  }
});

// 列出所有监控
router.get('/list', (req, res) => {
  const list = Array.from(watchers.entries()).map(([id, watch]) => ({
    id,
    path: watch.path,
    createdAt: watch.createdAt
  }));

  res.json({ watchers: list });
});

// 停止所有监控
router.post('/unwatch-all', (req, res) => {
  watchers.forEach(watch => {
    watch.watcher.close();
  });
  watchers.clear();
  res.json({ success: true });
});

// WebSocket 广播
function broadcastChange(id, type, data) {
  if (!global.watcherWSS) return;

  const message = JSON.stringify({
    id,
    type,
    data,
    timestamp: Date.now()
  });

  global.watcherWSS.clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(message);
    }
  });
}

export function initWatcherWS(wss) {
  global.watcherWSS = wss;
}

export default router;
