# Remote VS Code - 需求文档

## 核心功能

### 1. 项目管理
- 从 VS Code 配置中获取项目列表
- 显示项目名称和路径
- 支持刷新项目列表

### 2. Claude Session 管理
- 获取项目的 Claude 会话列表
- 实时查看会话状态（工作中/空闲）
- 查看会话历史记录
- 选择会话进行对话

### 3. 数据流提取（核心）
- 实时获取 Claude Code 的输出
- 监控当前会话的工作状态
- 推送工具调用、代码生成等信息

### 4. 文件浏览
- 查看项目目录结构
- 文件列表/树形视图切换

---

## API 设计

### 项目相关
```
GET /api/projects          - 获取项目列表
GET /api/projects/:name    - 获取项目详情
```

### Claude 会话相关
```
GET  /api/claude/sessions              - 获取所有会话
GET  /api/claude/sessions/:id          - 获取会话详情
GET  /api/claude/stream/:id            - 实时获取会话输出 (SSE)
POST /api/claude/send                  - 发送消息到会话
DELETE /api/claude/sessions/:id        - 删除会话
```

### 文件相关
```
GET /api/files/list?path=xxx           - 获取文件列表
GET /api/files/read?path=xxx           - 读取文件内容
GET /api/files/tree?path=xxx&depth=2    - 获取目录树
```

---

## 前端页面结构

```
┌─────────────────────────────────────────────────────────┐
│  Header: 状态栏 + 系统信息                               │
├─────────────┬───────────────────────────────────────────┤
│             │  Session 列表                            │
│  项目列表   ├───────────────────────────────────────────┤
│  (侧边栏)   │  工作输出区域 (实时显示 Claude 输出)       │
│             ├───────────────────────────────────────────┤
│             │  对话区域 (发送消息)                      │
└─────────────┴───────────────────────────────────────────┘
```

---

## 数据来源

### 项目列表来源
1. VS Code `workspaces.json` 配置
2. Claude Code 项目配置
3. 用户主目录下的常见项目

### Session 来源
- `.claude/sessions/` 目录下的会话文件夹
- 每个会话包含 `.jsonl` 日志文件

### 数据流提取方式
- 轮询读取会话的最新日志
- 或监听文件变化 (chokidar)
