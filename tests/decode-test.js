// 测试路径解码 - 最终版
function decodeProjectPath(folderName) {
  let result = folderName;

  console.log('原始:', folderName);

  // 1. C-- -> C:\
  result = result.replace(/^([a-zA-Z])--/, '$1:\\');
  console.log('步骤1:', result);

  // 2. 驱动器后：
  // 找到最后一个目录分隔符（连续的 -）
  // 之前的部分，每个 - 变成 \（除了被保护的连字符）

  const driveMatch = result.match(/^([A-Za-z]:\\)(.+)/);
  if (driveMatch) {
    let pathPart = driveMatch[2];

    // 找到最后连续的 - （至少2个）- 这是目录分隔符
    // 其余部分（最后一个目录分隔符之后）是最终目录名/项目名
    const lastMultiDash = pathPart.match(/-{2,}/);
    let dirPart = pathPart;
    let lastPart = '';

    if (lastMultiDash) {
      const splitIdx = lastMultiDash.index;
      dirPart = pathPart.substring(0, splitIdx);
      lastPart = pathPart.substring(splitIdx);
    }

    // dirPart: 目录部分，保护真正的连字符
    // 保护字母-字母（如 remote-vscode）
    dirPart = dirPart.replace(/([a-zA-Z]+)-([a-zA-Z]+)/g, '$1~C~$2');
    // 保护数字-数字（如 220-005）
    dirPart = dirPart.replace(/(\d+)-(\d+)/g, '$1~N~$2');
    // 剩余的单个 - 变成 \
    dirPart = dirPart.replace(/-([a-zA-Z])/g, '\\$1');
    dirPart = dirPart.replace(/-(\d)/g, '\\$1');
    // 恢复保护
    dirPart = dirPart.replace(/~C~/g, '-');
    dirPart = dirPart.replace(/~N~/g, '-');

    result = driveMatch[1] + dirPart + lastPart;
  }
  console.log('步骤2:', result);

  return result;
}

// 测试用例
const tests = [
  'C--Users-29718-remote-vscode',
  'C--Users-29718',
  'D--Resource-200----220-----220-005-mul-agent',
  'd--Resource-200----220-----220-003-KnowledgeSync',
  'D--Resource-001--'
];

tests.forEach(t => {
  console.log('===>', decodeProjectPath(t));
  console.log('');
});
