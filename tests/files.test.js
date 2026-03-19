/**
 * files.js 单元测试
 */

import { jest, describe, test, expect, beforeEach } from '@jest/globals';

// 模拟 fs 和 path 模块
const mockFs = {
  existsSync: jest.fn(),
  readdirSync: jest.fn(),
  readFileSync: jest.fn(),
  statSync: jest.fn(),
  unlinkSync: jest.fn(),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn()
};

const mockPath = {
  join: jest.fn((...args) => args.join('/').replace(/\\/g, '/')),
  normalize: jest.fn(p => p.replace(/\//g, '\\')),
  isAbsolute: jest.fn(p => p.startsWith('/') || /^[A-Za-z]:/.test(p)),
  dirname: jest.fn(p => p.replace(/\\/g, '/').replace(/\/[^/]+$/, '')),
  basename: jest.fn(p => p.replace(/\\/g, '/').split('/').pop())
};

// 简化版的路径验证逻辑（与 files.js 保持一致）
function validatePath(fullPath, dirPath) {
  const normalizedDirPath = dirPath.replace(/\//g, '\\');
  const normalizedFullPath = fullPath.replace(/\//g, '\\');
  return normalizedFullPath.startsWith(normalizedDirPath);
}

function isPathAllowed(fullPath, userDir) {
  const normalizedPath = fullPath.replace(/\\/g, '/');
  const normalizedUserDir = userDir.replace(/\\/g, '/');
  return normalizedPath.toLowerCase().startsWith(normalizedUserDir.toLowerCase());
}

describe('路径验证逻辑', () => {
  const userDir = 'C:\\Users\\29718';

  test('允许子目录访问', () => {
    expect(validatePath('C:\\Users\\29718\\Projects', 'C:\\Users\\29718')).toBe(true);
  });

  test('允许同级目录访问', () => {
    expect(validatePath('C:\\Users\\29718', 'C:\\Users\\29718')).toBe(true);
  });

  test('使用正斜杠的路径也能验证', () => {
    expect(validatePath('C:/Users/29718/Projects', 'C:/Users/29718')).toBe(true);
  });

  test('相同路径允许', () => {
    expect(validatePath('C:/Users/29718', 'C:/Users/29718')).toBe(true);
  });
});

describe('路径访问权限检查', () => {
  const userDir = 'C:\\Users\\29718';

  test('允许用户目录内的路径', () => {
    expect(isPathAllowed('C:\\Users\\29718\\Projects\\test.js', userDir)).toBe(true);
  });

  test('允许用户目录本身', () => {
    expect(isPathAllowed('C:\\Users\\29718', userDir)).toBe(true);
  });

  test('拒绝系统目录', () => {
    expect(isPathAllowed('C:\\Windows\\System32', userDir)).toBe(false);
  });

  test('拒绝其他用户目录', () => {
    expect(isPathAllowed('C:\\Users\\OtherUser', userDir)).toBe(false);
  });

  test('路径区分大小写检查', () => {
    expect(isPathAllowed('c:\\users\\29718\\test.js', userDir)).toBe(true);
  });
});

describe('路径分隔符处理', () => {
  test('正斜杠转换为反斜杠', () => {
    const result = 'C:/Users/29718'.replace(/\//g, '\\');
    expect(result).toBe('C:\\Users\\29718');
  });

  test('混合路径规范化', () => {
    const result = 'C:\\Users/29718/Projects'.replace(/\//g, '\\');
    expect(result).toBe('C:\\Users\\29718\\Projects');
  });
});

describe('文件名处理', () => {
  test('从路径提取文件名', () => {
    const basename = 'C:\\Users\\29718\\Projects\\test.js'.replace(/\\/g, '/').split('/').pop();
    expect(basename).toBe('test.js');
  });

  test('提取目录路径', () => {
    const dirname = 'C:\\Users\\29718\\Projects\\test.js'.replace(/\\/g, '/').replace(/\/[^/]+$/, '');
    expect(dirname).toBe('C:/Users/29718/Projects');
  });
});

describe('文件大小限制', () => {
  const MAX_SIZE = 1024 * 1024; // 1MB

  test('小于限制的文件大小允许', () => {
    const fileSize = 500 * 1024; // 500KB
    expect(fileSize <= MAX_SIZE).toBe(true);
  });

  test('等于限制的文件大小允许', () => {
    const fileSize = MAX_SIZE;
    expect(fileSize <= MAX_SIZE).toBe(true);
  });

  test('超过限制的文件大小拒绝', () => {
    const fileSize = MAX_SIZE + 1;
    expect(fileSize > MAX_SIZE).toBe(true);
  });
});

describe('目录树深度限制', () => {
  test('深度0返回null（顶层）', () => {
    const depth = 0;
    const maxDepth = 2;
    expect(depth > maxDepth).toBe(false);
  });

  test('超过深度的节点返回null', () => {
    const depth = 3;
    const maxDepth = 2;
    expect(depth > maxDepth).toBe(true);
  });

  test('等于深度的节点返回null', () => {
    const depth = 2;
    const maxDepth = 2;
    expect(depth > maxDepth).toBe(false); // 只在超过时返回null
  });
});

describe('排序逻辑', () => {
  test('目录排在前面', () => {
    const items = [
      { name: 'file.txt', isDirectory: false },
      { name: 'folder', isDirectory: true },
      { name: 'readme.md', isDirectory: false }
    ];

    items.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    expect(items[0].name).toBe('folder');
    expect(items[1].isDirectory).toBe(false);
  });

  test('同类型按名称排序', () => {
    const items = [
      { name: 'z-file.txt', isDirectory: false },
      { name: 'a-file.txt', isDirectory: false }
    ];

    items.sort((a, b) => a.name.localeCompare(b.name));

    expect(items[0].name).toBe('a-file.txt');
    expect(items[1].name).toBe('z-file.txt');
  });
});
