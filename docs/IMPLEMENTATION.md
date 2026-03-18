# Remote VS Code 实现文档

## 项目概述

Remote VS Code 是一个让你通过手机或浏览器远程查看 VS Code 工作环境的 Web 服务。主要功能包括：

1. **文件浏览** - 远程查看电脑上的文件结构
2. **终端执行** - 远程执行命令，实时获取输出
3. **文件监控** - 监控项目文件变化，实时推送
4. **进程管理** - 查看和管理运行中的进程
5. **Claude 会话监控** - 实时查看 Claude Code 的输出（数据流提取）

---

## 架构设计

### 技术栈

```
┌─────────────────────────────────────────────────────┐
│                    移动端/浏览器                      │
│            (手机、平板、电脑访问 Web 界面)             │
└─────────────────────┬───────────────────────────────┘
                      │ HTTP / WebSocket
                      ▼
┌─────────────────────────────────────────────────────┐
│                 Express.js 服务端                     │
│                     Port: 3000                       │
├─────────────┬─────────────────┬────────────────────┤
│  /api/files │    /api/terminal │    /api/watcher   │
│  (文件服务)  │    (终端服务)    │    (文件监控)      │
├─────────────┼─────────────────┼────────────────────┤
│  /api/process│   /api/claude  │    WebSocket       │
│  (进程管理)  │  (Claude会话)   │   (实时数据流)      │
└─────────────┴─────────────────┴────────────────────┘
```

---

## 核心模块实现

### 1. 主入口 (index.js)

**职责**：启动 Express 服务，注册路由，返回服务信息

```javascript
const app = express();
app.use('/api/files', filesRouter);
app.use('/api/terminal', terminalRouter);
app.use('/api/watcher', watcherRouter);
app.use('/api/process', processRouter);
app.use('/api/claude', claudeRouter);

server.listen(PORT, '0.0.0.0', () => {});
```

---

### 2. 文件服务 (files.js)

**职责**：提供 HTTP API 浏览本地文件系统

#### API 端点

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/files/list` | GET | 获取目录文件列表 |
| `/api/files/read` | GET | 读取文件内容 |
| `/api/files/tree` | GET | 获取目录树结构 |

#### 安全机制

1. **目录穿越防护** - 验证路径是否在允许的根目录内
2. **文件大小限制** - 读取文件最大 1MB
3. **隐藏文件过滤** - 跳过 `.` 开头的文件和 `node_modules`

---

### 3. 终端服务 (terminal.js)

**职责**：执行命令并通过 WebSocket 实时推送输出

#### API 端点

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/terminal/create` | POST | 创建新的终端会话 |
| `/api/terminal/input` | POST | 向终端发送命令 |
| `/api/terminal/exec` | POST | 执行单次命令 |
| `/api/terminal/list` | GET | 列出所有终端 |
| `/api/terminal/close` | POST | 关闭终端 |

---

### 4. 文件监控服务 (watcher.js)

**职责**：监控文件变化，通过 WebSocket 实时推送

#### API 端点

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/watcher/watch` | POST | 启动文件监控 |
| `/api/watcher/unwatch` | POST | 停止监控 |
| `/api/watcher/list` | GET | 列出所有监控 |

#### 监控事件

- `add` - 新建文件
- `change` - 文件修改
- `unlink` - 文件删除
- `addDir` - 新建目录
- `unlinkDir` - 删除目录

---

### 5. 进程管理服务 (process.js)

**职责**：列出和管理运行中的进程

#### API 端点

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/process/list` | GET | 获取进程列表 |
| `/api/process/project` | GET | 获取项目相关进程 |
| `/api/process/kill` | POST | 终止进程 |
| `/api/process/system` | GET | 获取系统信息 |

---

### 6. Claude 会话服务 (claude.js) ⭐ 核心功能

**职责**：数据流提取 - 实时获取 Claude Code 会话输出

**核心思路**：不启动新的 Claude 进程，而是监控/读取现有的 Claude Code 会话数据流。

#### 两种工作模式

**模式一：实时监控（推荐）**
- 监控 Claude Code 的输出文件或日志
- 实时推送最新输出给前端
- 适合查看当前正在进行的会话

**模式二：历史会话回放**
- 读取 `.claude/sessions/` 下的历史会话
- 支持会话选择和历史查看
- 适合回顾之前的对话

#### API 端点

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/claude/sessions` | GET | 获取所有会话列表 |
| `/api/claude/session/:id` | GET | 获取指定会话详情 |
| `/api/claude/stream/:id` | GET | 实时获取会话输出流 |
| `/api/claude/projects` | GET | 获取 Claude 配置的项目 |
| `/api/claude/current` | GET | 获取当前活跃会话 |

#### 会话数据结构

```javascript
{
  id: "2025-03-18-xxx",
  path: "C:\\Users\\xxx\\.claude\\sessions\\2025-03-18-xxx",
  lastActivity: "2025-03-18T10:30:00.000Z",
  hasLogs: true
}
```

#### 实时流实现

```javascript
// 方式一：轮询读取会话输出文件
router.get('/stream/:id', (req, res) => {
  const sessionPath = getSessionPath(req.params.id);

  // 设置 SSE (Server-Sent Events) 推送
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // 定时检查新内容
  const interval = setInterval(() => {
    const newContent = readNewLogs(sessionPath);
    if (newContent) {
      res.write(`data: ${JSON.stringify({ content: newContent })}\n\n`);
    }
  }, 1000);

  req.on('close', () => clearInterval(interval));
});
```

---

### 7. WebSocket 实时通信

**职责**：统一管理所有实时数据推送

#### 消息类型

```javascript
// 终端输出
{ type: 'terminal', id: 'term_1', data: '...', stream: 'stdout|stderr' }

// 文件变化
{ type: 'watcher', id: 'watch_1', event: 'add|change|unlink', path: '...' }

// Claude 会话输出
{ type: 'claude', sessionId: 'xxx', content: '...', done: false }

// 进程状态
{ type: 'process', data: { ... } }
```

---

## 启动方式

```bash
# 安装依赖
npm install

# 启动服务
npm start

# 或指定端口
PORT=8080 npm start
```

服务启动后显示：

```
Remote VS Code 服务已启动
==================================================
本地访问: http://localhost:3000
局域网访问: http://192.168.1.xxx:3000
```

---

## 扩展功能（待实现）

1. **noVNC 集成** - 浏览器远程桌面
2. **认证系统** - 登录密码保护
3. **会话导出** - 导出 Claude 会话为 Markdown

---

## 安全考虑

1. **目录穿越防护** - 验证路径前缀
2. **文件大小限制** - 最大读取 1MB
3. **隐藏文件过滤** - 自动跳过 `.` 开头的文件
4. **无认证** - 当前版本无认证（局域网使用，风险可控）
