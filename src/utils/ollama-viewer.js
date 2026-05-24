const WebSocket = require('ws');
const chalk = require('chalk');
const boxen = require('boxen');
const readline = require('readline');
const http = require('http');

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
let loadedModelInfo = 'Checking...';

// Fetch loaded model info periodically
function fetchModelInfo() {
  http.get('http://localhost:11434/api/ps', (res) => {
    if (res.statusCode !== 200) {
      loadedModelInfo = 'Error';
      res.resume(); // Consume response data to free up memory
      return;
    }

    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    res.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        if (parsed.models && parsed.models.length > 0) {
          const model = parsed.models[0];
          const size = model.size_vram || model.size || 0;
          const sizeGB = (size / (1024 ** 3)).toFixed(1);
          loadedModelInfo = `${model.name} (${sizeGB} GB)`;
        } else {
          loadedModelInfo = 'No model loaded';
        }
      } catch (e) {
        // ignore parsing errors
      }
    });
  }).on('error', () => {
    loadedModelInfo = 'Offline';
  });
}

setInterval(fetchModelInfo, 2000);
fetchModelInfo();

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
  const title = `[Loaded: ${loadedModelInfo}] | Tokens: ${totalTokens} | ${elapsed.toFixed(1)}s | ${tps} t/s`;
  process.stdout.write(`\x1b]0;${title}\x07`);
  
  // 画面下部に一行だけ表示 (成功すれば上書き、失敗しても邪魔になりにくい)
  if (process.stdout.isTTY) {
    process.stdout.write('\u001b[s'); // カーソル位置を保存
    readline.cursorTo(process.stdout, 0, process.stdout.rows - 1);
    readline.clearLine(process.stdout, 0); // 行をクリアして綺麗に描画
    process.stdout.write(chalk.bgCyan.black(` ${title} `));
    process.stdout.write('\u001b[u'); // カーソル位置を復元
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
