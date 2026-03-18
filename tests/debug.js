// 调试解码 v4 - 正确的算法
function decodeProjectPath(folderName) {
  let result = folderName;

  console.log('原始:', folderName);

  // 1. C-- -> C:\
  result = result.replace(/^([a-zA-Z])--/, '$1:\\');
  console.log('步骤1:', result);

  // 2. 驱动器后：把连续 - 变成 \
  const driveMatch = result.match(/^([A-Za-z]:\\)(.+)/);
  if (driveMatch) {
    let pathPart = driveMatch[2];

    // 先把连续 - 变成 \（临时）
    let withSlash = pathPart.replace(/-{2,}/g, '|||SPLIT|||');
    console.log('withSlash (temp):', withSlash);

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

  console.log('最终:', result);
  return result;
}

// 测试
decodeProjectPath('C--Users-29718-remote-vscode');
console.log('---');
decodeProjectPath('D--Resource-200----220-----220-006-learn-claude-code');
console.log('---');
decodeProjectPath('D--Resource-001----');
console.log('---');
decodeProjectPath('C--Users-29718');
