/**
 * Windows 文件浏览服务
 * 提供HTTP接口返回目录文件列表
 */

import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
router.use(cors());
router.use(express.json());

// 默认浏览的根目录 - 用户主目录
const DEFAULT_ROOT = process.env.ROOT_DIR || process.env.USERPROFILE || process.env.HOME || 'C:\\';

// 获取文件列表
router.get('/list', (req, res) => {
  const dirPath = req.query.path || DEFAULT_ROOT;
  const relativePath = req.query.relative || '';

  try {
    const fullPath = path.join(dirPath, relativePath);
    const normalizedDirPath = path.normalize(dirPath).replace(/\//g, '\\');
    const normalizedFullPath = path.normalize(fullPath).replace(/\//g, '\\');

    // 安全检查：防止目录穿越
    // 使用 path.resolve 来获取绝对路径并规范化
    let resolvedDirPath, resolvedFullPath;
    try {
      resolvedDirPath = path.resolve(dirPath);
      resolvedFullPath = path.resolve(fullPath);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    // 规范化路径（处理 .. 和 . ）
    const safeDirPath = path.normalize(resolvedDirPath).toLowerCase();
    const safeFullPath = path.normalize(resolvedFullPath).toLowerCase();

    // 确保目标路径在允许的目录范围内
    if (!safeFullPath.startsWith(safeDirPath + path.sep) && safeFullPath !== safeDirPath) {
      return res.status(403).json({ error: 'Access denied: path traversal detected' });
    }

    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'Path not found' });
    }

    const items = fs.readdirSync(fullPath, { withFileTypes: true });

    console.log('[DEBUG] items sample:', items.slice(0, 2).map(i => ({ name: i.name, isDir: i.isDirectory() })));

    const result = items.map(item => ({
      name: item.name,
      isDirectory: Boolean(item.isDirectory()),
      path: path.join(relativePath, item.name).replace(/\\/g, '/')
    }));

    console.log('[DEBUG] result sample:', result.slice(0, 2));

    // 目录排在前面
    result.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    res.json({
      currentPath: relativePath,
      rootPath: dirPath,
      items: result
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 读取文件内容
router.get('/read', (req, res) => {
  // 支持两种方式：1) root + path 拼接，2) 直接传完整路径
  let fullPath = req.query.path;

  if (!fullPath) {
    return res.status(400).json({ error: 'File path required' });
  }

  // 如果传入的是相对路径，需要结合root
  const dirPath = req.query.root || DEFAULT_ROOT;
  if (!path.isAbsolute(fullPath)) {
    fullPath = path.join(dirPath, fullPath);
  }

  // 安全检查：确保路径在允许的目录内（使用与浏览相同的根目录）
  const normalizedDirPath = path.normalize(dirPath).replace(/\\/g, '/').toLowerCase();
  const normalizedFullPath = path.normalize(fullPath).replace(/\\/g, '/').toLowerCase();
  if (!normalizedFullPath.startsWith(normalizedDirPath)) {
    return res.status(403).json({ error: 'Access denied: ' + fullPath });
  }

  // Windows: 把正斜杠转为反斜杠
  fullPath = fullPath.replace(/\//g, '\\');

  try {
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      return res.status(400).json({ error: 'Cannot read directory as file' });
    }

    // 限制文件大小 (1MB)
    if (stat.size > 1024 * 1024) {
      return res.status(400).json({ error: 'File too large' });
    }

    const content = fs.readFileSync(fullPath, 'utf-8');
    res.json({ content, size: stat.size });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取目录树（用于项目结构展示）
router.get('/tree', (req, res) => {
  const dirPath = req.query.path || DEFAULT_ROOT;
  const depth = parseInt(req.query.depth) || 2;

  function buildTree(dir, currentDepth) {
    if (currentDepth > depth) return null;

    try {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      const result = [];

      for (const item of items) {
        // 跳过隐藏文件和常见忽略目录
        if (item.name.startsWith('.') ||
            item.name === 'node_modules' ||
            item.name === '__pycache__') {
          continue;
        }

        const itemPath = path.join(dir, item.name).replace(/\\/g, '/');
        const treeItem = {
          name: item.name,
          path: itemPath,
          isDirectory: Boolean(item.isDirectory())
        };

        if (item.isDirectory() && currentDepth < depth) {
          treeItem.children = buildTree(itemPath, currentDepth + 1);
        }

        result.push(treeItem);
      }

      return result.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });
    } catch (error) {
      return [];
    }
  }

  try {
    const tree = buildTree(dirPath, 0);
    res.json({ tree, root: dirPath });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
