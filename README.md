# Remote VS Code

通过手机或浏览器远程访问 VS Code 工作环境的 Web 服务。

## 功能特性

- **文件浏览** - 远程查看电脑上的文件结构
- **终端执行** - 远程执行命令，实时获取输出
- **文件监控** - 监控项目文件变化，实时推送
- **进程管理** - 查看和管理运行中的进程
- **Claude 会话监控** - 实时查看 Claude Code 的输出

## 技术栈

- **后端**: Node.js + Express.js + WebSocket
- **前端**: 原生 HTML/CSS/JavaScript
- **依赖**: chokidar, ws, novnc, cors, uuid

## 快速开始

```bash
# 安装依赖
npm install

# 启动服务
npm start
```

服务启动后显示访问地址：

```
本地访问: http://localhost:3000
局域网访问: http://192.168.x.x:3000
```

## 项目结构

```
remote-vscode/
├── src/windows/       # 后端服务
│   ├── index.js      # 主入口
│   ├── files.js     # 文件服务
│   ├── terminal.js  # 终端服务
│   ├── watcher.js   # 文件监控
│   ├── process.js   # 进程管理
│   ├── chat.js      # Claude 会话
│   └── projects.js  # 项目管理
├── ui/               # 前端界面
│   ├── index.html
│   ├── css/         # 样式文件
│   └── js/          # 脚本文件
└── docs/            # 文档
```

## API 端点

### 文件服务

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/files/list` | GET | 获取目录文件列表 |
| `/api/files/read` | GET | 读取文件内容 |
| `/api/files/tree` | GET | 获取目录树结构 |

### 终端服务

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/terminal/exec` | POST | 执行单次命令 |
| `/api/terminal/create` | POST | 创建终端会话 |
| `/api/terminal/input` | POST | 向终端发送命令 |
| `/api/terminal/close` | POST | 关闭终端 |

### 进程管理

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/process/list` | GET | 获取进程列表 |
| `/api/process/project` | GET | 获取项目相关进程 |
| `/api/process/kill` | POST | 终止进程 |
| `/api/process/system` | GET | 获取系统信息 |

### Claude 会话

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/chat/sessions` | GET | 获取会话列表 |
| `/api/chat/session/:id` | GET | 获取会话详情 |
| `/api/chat/stream/:id` | GET | 实时获取会话输出 |
| `/api/chat/send` | POST | 发送消息 |

### 文件监控

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/watcher/watch` | POST | 启动文件监控 |
| `/api/watcher/unwatch` | POST | 停止监控 |
| `/api/watcher/list` | GET | 列出所有监控 |

## WebSocket 实时通信

连接 `ws://localhost:3000` 接收实时推送：

```javascript
const ws = new WebSocket('ws://localhost:3000');
ws.onmessage = (event) => {
  const { type, data } = JSON.parse(event.data);
  // type: terminal | watcher | claude | process
};
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| PORT | 3000 | 服务端口 |

## 安全说明

- 目录穿越防护 - 验证路径是否在允许的根目录内
- 文件大小限制 - 读取文件最大 1MB
- 隐藏文件过滤 - 自动跳过 `.` 开头的文件和 `node_modules`
- 当前版本无认证，建议仅在局域网使用

## License

MIT
