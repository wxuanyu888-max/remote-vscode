// 终端模块
import { $ } from './state.js';
import { apiRequest } from './api.js';

export function initTerminal() {
  const cmdInput = $('cmd-input');
  const execBtn = $('btn-exec');
  const clearBtn = $('btn-clear-terminal');

  if (execBtn && cmdInput) {
    execBtn.addEventListener('click', () => executeCommand());

    cmdInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        executeCommand();
      }
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', clearTerminal);
  }
}

async function executeCommand() {
  const cmdInput = $('cmd-input');
  const output = $('terminal-output');

  if (!cmdInput || !output) return;

  const cmd = cmdInput.value.trim();
  if (!cmd) return;

  // 显示输入的命令
  addOutput(`$ ${cmd}`, 'input');
  cmdInput.value = '';

  try {
    const data = await apiRequest('/api/terminal/exec', {
      method: 'POST',
      body: JSON.stringify({ command: cmd })
    });

    if (data.output) {
      addOutput(data.output, 'stdout');
    }
    if (data.error) {
      addOutput(data.error, 'error');
    }
  } catch (error) {
    addOutput(`执行失败: ${error.message}`, 'error');
  }
}

function addOutput(text, type = 'stdout') {
  const output = $('terminal-output');
  if (!output) return;

  const line = document.createElement('div');
  line.className = `output-line ${type}`;
  line.textContent = text;
  output.appendChild(line);
  output.scrollTop = output.scrollHeight;
}

function clearTerminal() {
  const output = $('terminal-output');
  if (output) {
    output.innerHTML = '<div class="output-line system">终端已清空</div>';
  }
}
