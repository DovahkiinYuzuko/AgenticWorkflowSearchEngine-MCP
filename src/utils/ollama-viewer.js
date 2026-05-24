const WebSocket = require('ws');
const chalk = require('chalk');
const boxen = require('boxen');
const readline = require('readline');

/**
 * Ollama Real-time Viewer
 * 
 * This script connects to the streaming relay server and displays
 * incoming text chunks with real-time statistics.
 */

const WS_URL = 'ws://localhost:9999';
const RECONNECT_DELAY = 2000;

let totalTokens = 0;
let startTime = null;
let isConnected = false;

// UI Configuration
const header = boxen(chalk.cyan.bold('Ollama Real-time Insight'), {
  padding: 1,
  margin: 1,
  borderStyle: 'double',
  borderColor: 'cyan'
});

function clearScreen() {
  process.stdout.write('\x1Bc');
}

function updateStats() {
  if (!startTime || totalTokens === 0) return;

  const elapsed = (Date.now() - startTime) / 1000;
  const tps = (totalTokens / elapsed).toFixed(1);

  // ウィンドウのタイトルバーに統計情報を表示 (OS/Terminalによるけどシブい手法)
  const title = `Ollama: ${totalTokens} tokens | ${elapsed.toFixed(1)}s | ${tps} t/s`;
  process.stdout.write(`\x1b]0;${title}\x07`);
  
  // 画面下部に一行だけ表示 (成功すれば上書き、失敗しても邪魔になりにくい)
  if (process.stdout.isTTY) {
    readline.cursorTo(process.stdout, 0, process.stdout.rows - 1);
    process.stdout.write(chalk.bgCyan.black(` ${title} `));
    readline.cursorTo(process.stdout, 0, 0); // カーソルを戻す (気休め)
  }
}

function connect() {
  const statusPrefix = chalk.yellow('[!]');
  process.stdout.write(`\r${statusPrefix} Connecting to relay server...`);
  
  const ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    isConnected = true;
    clearScreen();
    console.log(header);
    console.log(chalk.green('[✔] Connected to stream.\n'));
    startTime = Date.now();
  });

  ws.on('message', (data) => {
    const message = data.toString();
    if (message === 'ping') return;

    totalTokens++;
    process.stdout.write(message);
    updateStats();
  });

  ws.on('close', () => {
    if (isConnected) {
      console.log(chalk.red('\n[!] Connection lost. Retrying...'));
    }
    isConnected = false;
    setTimeout(connect, RECONNECT_DELAY);
  });

  ws.on('error', () => {
    // 接続エラー時は1行で表示し続ける
    process.stdout.write(`\r${statusPrefix} Waiting for server at ${WS_URL}...`);
    isConnected = false;
    setTimeout(connect, RECONNECT_DELAY);
  });
}

// Global UI maintenance
setInterval(() => {
  if (isConnected) {
    updateStats();
  }
}, 500);

// Start
clearScreen();
console.log(chalk.cyan('Initializing Ollama Viewer...'));
connect();
