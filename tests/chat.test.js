/**
 * chat.js 单元测试
 */

import { jest, describe, test, expect } from '@jest/globals';

// 辅助函数（从 chat.js 复制）
function decodeProjectPathSimple(folderName) {
  let result = folderName
    .replace(/^([a-zA-Z])--/, '$1:\\')
    .replace(/--/g, '\\');
  return result;
}

function isWorkingSession(sessionId, stat, activeSessionId) {
  if (activeSessionId && sessionId === activeSessionId) {
    return true;
  }
  const nowMs = Date.now();
  const mtimeMs = stat.mtime.getTime();
  const diffMs = nowMs - mtimeMs;
  return diffMs < 90000;
}

describe('decodeProjectPathSimple', () => {
  test('解码简单路径', () => {
    // 简化版: C--Users-29718 -> C:\Users-29718 (单个 - 不被转换)
    expect(decodeProjectPathSimple('C--Users-29718')).toBe('C:\\Users-29718');
  });

  test('解码深层路径', () => {
    // 连续 -- 变成 \
    expect(decodeProjectPathSimple('C--Users--29718'))
      .toBe('C:\\Users\\29718');
  });

  test('解码小写驱动器', () => {
    expect(decodeProjectPathSimple('d--Projects--test')).toBe('d:\\Projects\\test');
  });

  test('无效格式返回原值', () => {
    expect(decodeProjectPathSimple('invalid')).toBe('invalid');
  });
});

describe('会话状态检测', () => {
  test('活跃会话返回 working', () => {
    const stat = { mtime: new Date() };
    const result = isWorkingSession('session-123', stat, 'session-123');
    expect(result).toBe(true);
  });

  test('非活跃但最近修改的会话返回 working', () => {
    const stat = { mtime: new Date(Date.now() - 30000) }; // 30秒前
    const result = isWorkingSession('session-456', stat, null);
    expect(result).toBe(true);
  });

  test('旧会话返回 idle', () => {
    const stat = { mtime: new Date(Date.now() - 120000) }; // 2分钟前
    const result = isWorkingSession('session-789', stat, null);
    expect(result).toBe(false);
  });

  test('边界情况：刚好90秒返回 working', () => {
    const stat = { mtime: new Date(Date.now() - 89999) }; // 89.999秒
    const result = isWorkingSession('session-border', stat, null);
    expect(result).toBe(true);
  });

  test('超过90秒返回 idle', () => {
    const stat = { mtime: new Date(Date.now() - 90001) }; // 90.001秒
    const result = isWorkingSession('session-old', stat, null);
    expect(result).toBe(false);
  });
});

describe('会话ID生成', () => {
  test('生成唯一会话ID格式', () => {
    const sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
    expect(sessionId).toMatch(/^session-\d+-[a-z0-9]+$/);
  });

  test('会话ID包含时间戳', () => {
    const before = Date.now();
    const sessionId = `session-${Date.now()}-test`;
    const after = Date.now();

    const timestamp = parseInt(sessionId.split('-')[1]);
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
  });
});

describe('消息验证', () => {
  test('空消息无效', () => {
    const message = '';
    expect(!message).toBe(true);
  });

  test('有效消息通过', () => {
    const message = 'Hello Claude';
    expect(!!message).toBe(true);
    expect(message.length).toBeGreaterThan(0);
  });

  test('仅空格消息视为无效', () => {
    const message = '   ';
    expect(!message.trim()).toBe(true);
  });
});

describe('会话标识判断', () => {
  const isNewSession = (sessionId) => !sessionId || sessionId === 'new';

  test('undefined 是新会话', () => {
    expect(isNewSession(undefined)).toBe(true);
  });

  test('null 是新会话', () => {
    expect(isNewSession(null)).toBe(true);
  });

  test('空字符串是新会话', () => {
    expect(isNewSession('')).toBe(true);
  });

  test('字符串 "new" 是新会话', () => {
    expect(isNewSession('new')).toBe(true);
  });

  test('有效会话ID不是新会话', () => {
    expect(isNewSession('session-123456')).toBe(false);
  });

  test('有效会话ID不是新会话（长格式）', () => {
    expect(isNewSession('session-1700000000000-abc12345')).toBe(false);
  });
});

describe('SSE消息格式', () => {
  test('JSON消息格式正确', () => {
    const message = { type: 'output', data: 'Hello', sessionId: 'test-123', timestamp: Date.now() };
    const json = JSON.stringify(message);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  test('SSE格式包含换行符', () => {
    const message = { type: 'update', sessionId: '123' };
    const sseMessage = `data: ${JSON.stringify(message)}\n\n`;
    expect(sseMessage).toMatch(/\n\n$/);
  });

  test('错误消息格式正确', () => {
    const error = { error: 'Session not found' };
    const sseMessage = `data: ${JSON.stringify(error)}\n\n`;
    expect(sseMessage).toContain('Session not found');
  });
});

describe('文件读取大小计算', () => {
  test('计算读取大小不超过限制', () => {
    const lastSize = 1000;
    const statSize = 5000;
    const readSize = Math.min(statSize - lastSize + 10000, 100000);
    expect(readSize).toBe(14000); // 5000 - 1000 + 10000 = 14000
  });

  test('读取大小有上限', () => {
    const lastSize = 0;
    const statSize = 1000000; // 1MB
    const readSize = Math.min(statSize - lastSize + 10000, 100000);
    expect(readSize).toBe(100000); // 达到上限
  });

  test('新内容起始位置计算', () => {
    const startPos = Math.max(0, 5000 - 10000);
    expect(startPos).toBe(0);
  });
});

describe('项目路径解码用于会话', () => {
  test('从编码名称获取项目路径', () => {
    // chat.js 中的简化版本：只处理驱动器字母和连续 --
    const projectId = 'C--Users--29718';
    const projectPath = decodeProjectPathSimple(projectId);
    expect(projectPath).toBe('C:\\Users\\29718');
  });

  test('解码后的路径可用于文件操作', () => {
    // 连续4个 - 被转换成 \\
    const projectId = 'D--Resource----220';
    const projectPath = decodeProjectPathSimple(projectId);
    expect(projectPath).toBe('D:\\Resource\\\\220');
  });
});
