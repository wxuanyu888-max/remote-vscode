/**
 * 项目服务
 * 从 Claude Code 配置中获取项目列表和会话
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

// Claude 配置目录
const CLAUDE_DIR = process.env.CLAUDE_DIR || path.join(process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\29718', '.claude');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');

// 解码文件夹名称为实际路径
function decodeProjectPath(folderName) {
  let result = folderName;

  // 1. C-- -> C:\
  result = result.replace(/^([a-zA-Z])--/, '$1:\\');

  // 2. 驱动器后：把连续 - 变成 \
  const driveMatch = result.match(/^([A-Za-z]:\\)(.+)/);
  if (driveMatch) {
    let pathPart = driveMatch[2];

    // 先把连续 - 变成 \（临时）
    let withSlash = pathPart.replace(/-{2,}/g, '|||SPLIT|||');

    // 按临时标记分割
    const parts = withSlash.split('|||SPLIT|||');

    if (parts.length > 1) {
      // 最后一个是项目名
      let lastPart = parts.pop();

      // 目录部分：处理每个 - 为 \
      const dirParts = parts.map(p => {
        // 保护连字符
        p = p.replace(/([a-zA-Z]+)-([a-zA-Z]+)/g, '$1~C~$2');
        p = p.replace(/(\d+)-(\d+)/g, '$1~N~$2');
        // 剩余的 - 变 \
        p = p.replace(/-/g, '\\');
        // 恢复
        p = p.replace(/~C~/g, '-').replace(/~N~/g, '-');
        return p;
      });

      // 项目名：恢复 - 为连字符（因为已经都被转成 \ 了）
      lastPart = lastPart.replace(/\\-/g, '-');

      result = driveMatch[1] + dirParts.join('\\') + '\\' + lastPart;
    } else {
      // 只有一个部分
      // 保护连字符，然后 - 变 \
      result = result.replace(/([a-zA-Z]+)-([a-zA-Z]+)/g, '$1~C~$2');
      result = result.replace(/(\d+)-(\d+)/g, '$1~N~$2');
      result = result.replace(/-/g, '\\');
      result = result.replace(/~C~/g, '-').replace(/~N~/g, '-');
    }
  }

  return result;
}

// 编码路径为文件夹名称
function encodeProjectPath(projectPath) {
  // C:\Users\29718\remote-vscode -> C--Users-29718-remote-vscode
  // D:\Resource\200\220\220\005-mul-agent -> D--Resource-200-~-220-~-220-005-mul-agent
  return projectPath
    .replace(/^([A-Za-z]):/, '$1--')  // C: -> C--
    .replace(/\\/g, '-~-');            // \ -> -~- (使用特殊分隔符避免与数字中的-混淆)
}

// 获取项目列表
router.get('/', (req, res) => {
  const projects = [];

  try {
    if (!fs.existsSync(PROJECTS_DIR)) {
      return res.json({ projects: [] });
    }

    const entries = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const projectPath = decodeProjectPath(entry.name);
        const projectDir = path.join(PROJECTS_DIR, entry.name);

        // 检查项目目录是否存在
        const exists = fs.existsSync(projectPath);

        // 获取会话数量
        let sessionCount = 0;
        let lastActivity = null;

        try {
          const files = fs.readdirSync(projectDir);
          sessionCount = files.filter(f => f.endsWith('.jsonl')).length;

          // 获取最后修改时间
          if (sessionCount > 0) {
            const stat = fs.statSync(projectDir);
            lastActivity = stat.mtime;
          }
        } catch (e) {
          // 忽略读取错误
        }

        projects.push({
          id: entry.name,
          name: path.basename(projectPath),
          path: projectPath,
          exists,
          sessionCount,
          lastActivity
        });
      }
    }

    // 按最后活动时间排序
    projects.sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));

    res.json({ projects });
  } catch (error) {
    res.status(500).json({ error: error.message, projects: [] });
  }
});

// 获取指定项目详情
router.get('/:id', (req, res) => {
  const { id } = req.params;
  const projectDir = path.join(PROJECTS_DIR, id);

  try {
    if (!fs.existsSync(projectDir)) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const projectPath = decodeProjectPath(id);
    const files = fs.readdirSync(projectDir);
    const sessions = files
      .filter(f => f.endsWith('.jsonl'))
      .map(f => {
        const filePath = path.join(projectDir, f);
        const stat = fs.statSync(filePath);
        return {
          id: f.replace('.jsonl', ''),
          file: f,
          size: stat.size,
          modified: stat.mtime
        };
      })
      .sort((a, b) => b.modified - a.modified);

    res.json({
      id,
      path: projectPath,
      sessions
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取项目的会话列表
router.get('/:id/sessions', (req, res) => {
  const { id } = req.params;
  const projectDir = path.join(PROJECTS_DIR, id);

  try {
    if (!fs.existsSync(projectDir)) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const files = fs.readdirSync(projectDir);
    const sessions = files
      .filter(f => f.endsWith('.jsonl'))
      .map(f => {
        const filePath = path.join(projectDir, f);
        const stat = fs.statSync(filePath);
        return {
          id: f.replace('.jsonl', ''),
          file: f,
          size: stat.size,
          modified: stat.mtime
        };
      })
      .sort((a, b) => b.modified - a.modified);

    res.json({ sessions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
