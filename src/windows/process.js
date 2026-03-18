/**
 * 进程管理服务
 * 列出和管理运行中的进程
 */

import express from 'express';
import cors from 'cors';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
router.use(cors());

// 获取进程列表
router.get('/list', (req, res) => {
  const { keyword } = req.query;

  // Windows: 使用 tasklist
  const cmd = process.platform === 'win32'
    ? 'tasklist /FO CSV /V'
    : 'ps aux';

  exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({ error: error.message });
    }

    try {
      let processes = [];

      if (process.platform === 'win32') {
        // 解析 CSV 格式
        const lines = stdout.split('\n').filter(line => line.trim());
        const headers = lines[0] ? lines[0].split(',').map(h => h.replace(/"/g, '')) : [];

        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || [];
          const proc = {};
          headers.forEach((h, idx) => {
            proc[h] = values[idx] ? values[idx].replace(/"/g, '') : '';
          });

          if (proc['Image Name']) {
            processes.push({
              pid: parseInt(proc['PID']) || 0,
              name: proc['Image Name'],
              mem: proc['Memory Usage'],
              status: proc['Status'],
              user: proc['User Name']
            });
          }
        }
      } else {
        // Unix 格式
        const lines = stdout.split('\n').filter(line => line.trim());
        for (let i = 1; i < lines.length; i++) {
          const parts = lines[i].split(/\s+/);
          if (parts.length >= 11) {
            processes.push({
              user: parts[0],
              pid: parseInt(parts[1]) || 0,
              cpu: parts[2],
              mem: parts[3],
              command: parts.slice(10).join(' ')
            });
          }
        }
      }

      // 按关键字过滤
      if (keyword) {
        const kw = keyword.toLowerCase();
        processes = processes.filter(p =>
          p.name.toLowerCase().includes(kw) ||
          (p.command && p.command.toLowerCase().includes(kw))
        );
      }

      res.json({ processes });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
});

// 获取项目相关的进程（node, npm, python, java 等）
router.get('/project', (req, res) => {
  const { cwd } = req.query;

  const cmd = process.platform === 'win32'
    ? `wmic process where "name='node.exe' or name='npm.cmd' or name='python.exe' or name='java.exe'" get ProcessId,Name,CommandLine,WorkingSetSize /format:csv`
    : 'ps aux | grep -E "node|npm|python|java" | grep -v grep';

  exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout) => {
    if (error) {
      return res.status(500).json({ error: error.message });
    }

    try {
      const processes = [];
      const lines = stdout.split('\n').filter(l => l.trim());

      if (process.platform === 'win32') {
        for (let i = 1; i < lines.length; i++) {
          const parts = lines[i].split(',');
          if (parts.length >= 4) {
            processes.push({
              pid: parseInt(parts[1]) || 0,
              name: parts[2] || '',
              cmd: parts[3] || '',
              mem: parseInt(parts[4]) || 0
            });
          }
        }
      } else {
        const lines = stdout.split('\n');
        for (const line of lines) {
          const parts = line.split(/\s+/);
          if (parts.length >= 11) {
            processes.push({
              pid: parseInt(parts[1]) || 0,
              command: parts.slice(10).join(' ')
            });
          }
        }
      }

      res.json({ processes });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
});

// 终止进程
router.post('/kill', (req, res) => {
  const { pid, name } = req.body;

  let target = '';

  if (pid) {
    target = process.platform === 'win32' ? `/PID ${pid}` : `-${pid}`;
  } else if (name) {
    target = process.platform === 'win32' ? `/IM ${name}` : name;
  }

  if (!target) {
    return res.status(400).json({ error: 'pid or name is required' });
  }

  const cmd = process.platform === 'win32'
    ? `taskkill /F ${target}`
    : `kill -9 ${target}`;

  exec(cmd, (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({
        error: error.message,
        hint: '可能需要管理员权限'
      });
    }

    res.json({
      success: true,
      message: '进程已终止',
      output: stdout
    });
  });
});

// 获取系统信息
router.get('/system', (req, res) => {
  const cmd = process.platform === 'win32'
    ? 'wmic cpu get LoadPercentage /format:csv & wmic os get FreePhysicalMemory,TotalVisibleMemorySize /format:csv'
    : 'uptime && free -m';

  exec(cmd, (error, stdout) => {
    let cpu = 0;
    let mem = { total: 0, free: 0, used: 0 };

    const totalMem = os.totalmem();
    const freeMem = os.freemem();

    mem = {
      total: Math.round(totalMem / 1024 / 1024),
      free: Math.round(freeMem / 1024 / 1024),
      used: Math.round((totalMem - freeMem) / 1024 / 1024)
    };

    // 简单估算 CPU (Windows 上需要额外处理)
    cpu = Math.round(os.loadavg()[0] * 10);

    res.json({
      platform: os.platform(),
      arch: os.arch(),
      cpus: os.cpus().length,
      uptime: os.uptime(),
      cpu,
      memory: mem,
      hostname: os.hostname()
    });
  });
});

export default router;
