const pty = require('node-pty');
const path = require('path');

// 프로젝트 루트의 package.json에서 gemini 실행 경로 유추 (실제 환경에서는 tool-manager가 처리)
// 여기서는 간단히 gemini 명령어가 PATH에 있다고 가정하거나, 
// 현재 설치된 managed-tools 경로를 추측하여 실행합니다.

const shell = process.env.SHELL || 'bash';
const ptyProcess = pty.spawn(shell, [], {
  name: 'xterm-256color',
  cols: 80,
  rows: 24,
  cwd: process.cwd(),
  env: process.env
});

let output = '';
ptyProcess.onData((data) => {
  output += data;
  process.stdout.write(data);
});

// 일정 시간 후 명령 주입 및 종료
setTimeout(() => {
  ptyProcess.write('gemini -p "/stats session"\r');
  setTimeout(() => {
    ptyProcess.write('exit\r');
  }, 5000);
}, 1000);

ptyProcess.onExit(() => {
  console.log('\n--- PTY Output Capture End ---');
  process.exit(0);
});
