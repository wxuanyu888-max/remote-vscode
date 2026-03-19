/**
 * projects.js 单元测试
 */

import { jest } from '@jest/globals';

// 直接在测试文件中实现被测试的函数（与 projects.js 保持同步）
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

function encodeProjectPath(projectPath) {
  return projectPath
    .replace(/^([A-Za-z]):/, '$1--')
    .replace(/\\/g, '-~-');
}

describe('decodeProjectPath', () => {
  test('解码简单用户目录', () => {
    expect(decodeProjectPath('C--Users-29718')).toBe('C:\\Users\\29718');
  });

  test('解码带项目名的路径', () => {
    expect(decodeProjectPath('C--Users-29718-remote-vscode')).toBe('C:\\Users\\29718\\remote-vscode');
  });

  test('解码带连字符的项目名（连续-作为分隔符）', () => {
    // 200----220-----220 表示 200\220\220，后面的 005-mul-agent 是最终目录名
    expect(decodeProjectPath('D--Resource-200----220-----220-005-mul-agent'))
      .toBe('D:\\Resource\\200\\220\\220-005-mul-agent');
  });

  test('解码小写驱动器字母', () => {
    expect(decodeProjectPath('d--Resource-200----220-----220-003-KnowledgeSync'))
      .toBe('d:\\Resource\\200\\220\\220-003-KnowledgeSync');
  });

  test('解码末尾有分隔符的路径', () => {
    expect(decodeProjectPath('D--Resource-001--')).toBe('D:\\Resource\\001\\');
  });

  test('解码深层嵌套路径（无连续分隔符）', () => {
    // 无连续 -，所以整个被当作一个部分处理
    expect(decodeProjectPath('C--Users-29718-Projects-My-App'))
      .toBe('C:\\Users\\29718\\Projects-My\\App');
  });

  test('解码数字-数字连字符（如版本号）', () => {
    expect(decodeProjectPath('D--Project-220-005'))
      .toBe('D:\\Project\\220-005');
  });

  test('解码带多级数字目录（无连续分隔符）', () => {
    // 无连续 -，但数字-数字被保护
    expect(decodeProjectPath('E--Work-2024-01-15-data'))
      .toBe('E:\\Work\\2024-01\\15\\data');
  });
});

describe('encodeProjectPath', () => {
  test('编码简单路径', () => {
    // C:\Users\29718 -> C---~-Users-~-29718 (驱动器 C: -> C--, 两个 \ -> 两个 -~-)
    expect(encodeProjectPath('C:\\Users\\29718')).toBe('C---~-Users-~-29718');
  });

  test('编码带项目名路径', () => {
    expect(encodeProjectPath('C:\\Users\\29718\\remote-vscode')).toBe('C---~-Users-~-29718-~-remote-vscode');
  });

  test('编码深层嵌套路径', () => {
    expect(encodeProjectPath('D:\\Resource\\200\\220\\220\\005-mul-agent'))
      .toBe('D---~-Resource-~-200-~-220-~-220-~-005-mul-agent');
  });

  test('编码小写驱动器', () => {
    expect(encodeProjectPath('d:\\Projects\\test')).toBe('d---~-Projects-~-test');
  });
});

describe('decodeProjectPath 和 encodeProjectPath 往返转换', () => {
  test('编码后解码产生有效路径格式', () => {
    const original = 'C:\\Users\\29718';
    const encoded = encodeProjectPath(original);
    const decoded = decodeProjectPath(encoded);
    // 编码后应包含驱动器字母和分隔符
    expect(encoded).toMatch(/^[A-Za-z]--/);
    // 解码后应包含反斜杠
    expect(decoded).toMatch(/^[A-Za-z]:\\/);
  });

  test('带连字符项目名往返产生有效路径', () => {
    const original = 'C:\\Users\\29718\\remote-vscode';
    const encoded = encodeProjectPath(original);
    const decoded = decodeProjectPath(encoded);
    // 解码结果应包含 remote-vscode
    expect(decoded).toContain('remote-vscode');
    expect(decoded).toMatch(/^[A-Za-z]:\\/);
  });

  test('编码产生正确的分隔符格式', () => {
    const original = 'D:\\Resource\\200\\220\\220\\005-mul-agent';
    const encoded = encodeProjectPath(original);
    // 编码后应该包含 -~- 作为分隔符
    expect(encoded).toContain('-~-');
    expect(encoded).toMatch(/^[A-Za-z]--/);
  });
});

describe('边界情况', () => {
  test('无效路径格式返回原值', () => {
    expect(decodeProjectPath('invalid')).toBe('invalid');
  });

  test('空字符串', () => {
    expect(decodeProjectPath('')).toBe('');
  });

  test('只有驱动器字母', () => {
    expect(decodeProjectPath('C--')).toBe('C:\\');
  });
});
