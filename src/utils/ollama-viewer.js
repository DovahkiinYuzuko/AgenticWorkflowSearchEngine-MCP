const WebSocket = require('ws');
const chalk = require('chalk');
const boxen = require('boxen');
const http = require('http');

/**
 * Ollama Real-time Viewer
 * 
 * [ENG] This script connects to the streaming relay server and displays
 * incoming text chunks with real-time statistics. It also monitors
 * the parent process and exits if the parent is no longer running.
 * 
 * [JPN] このスクリプトはストリーミング・リレー・サーバーに接続し、
 * リアルタイムでテキストを表示します。また、親プロセスを監視し、
 * 親が終了した場合には自身も終了します（幽霊プロセス防止）。
 */

const WS_URL = 'ws://localhost:9999';
const RECONNECT_DELAY = 2000;
const MAX_RECONNECT_ATTEMPTS = 5; // 5回失敗したら諦めるよ！

// コマンドライン引数から親プロセスのPIDを取得
const parentPid = process.argv[2] ? parseInt(process.argv[2], 10) : null;

let reconnectAttempts = 0;
let totalTokens = 0;
let startTime = null;
let isConnected = false;
let loadedModelInfo = 'Checking...';

// 起動して10秒経っても接続できなかったら強制終了するタイマーをセット
const startupTimer = setTimeout(() => {
  if (!isConnected) {
    console.log(chalk.red('\n[!] Failed to connect within 10s. Exiting...'));
    process.exit(1);
  }
}, 10000);

// 親プロセスの生存を確認するウォッチドッグ（2秒おき）
if (parentPid) {
    setInterval(() => {
        try {
            // signal 0 を送ることで、実際に殺さずに生存確認だけできるよ！
            process.kill(parentPid, 0);
        } catch (e) {
            // 親が見つからなければ終了
            console.log(chalk.gray(`\n\n[Watchdog] Parent process (${parentPid}) is gone. Exiting...`));
            process.exit(0);
        }
    }, 2000);
}

// Fetch loaded model info periodically
function fetchModelInfo() {
  http.get('http://localhost:11434/api/ps', (res) => {
    if (res.statusCode !== 200) {
      loadedModelInfo = 'Error';
      res.resume();
      return;
    }

    let data = '';
    res.on('data', (chunk) => { data += chunk; });
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
      } catch (e) {}
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
  const title = `[Loaded: ${loadedModelInfo}] | Tokens: ${totalTokens} | ${elapsed.toFixed(1)}s | ${tps} t/s`;
  process.stdout.write(`\x1b]0;${title}\x07`);
}

function connect() {
  const statusPrefix = chalk.yellow('[!]');
  
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.log(chalk.red(`\n\n${statusPrefix} Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Exiting...`));
    process.exit(1);
  }

  process.stdout.write(`\r${statusPrefix} Connecting to relay server... (${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})`);
  
  const ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    isConnected = true;
    clearTimeout(startupTimer);
    reconnectAttempts = 0;
    clearScreen();
    console.log(header);
    console.log(chalk.green('Connected to stream.\n'));
    startTime = Date.now();
  });

  ws.on('message', (data) => {
    const message = data.toString();
    if (message === 'ping') return;
    
    totalTokens++;
    
    // JSON形式で送られてくる場合はパースして表示、そうでない場合はそのまま表示
    try {
        const parsed = JSON.parse(message);
        if (parsed.response) {
            process.stdout.write(parsed.response);
        } else {
            process.stdout.write(message);
        }
    } catch (e) {
        // JSONでなければそのまま書き出す
        process.stdout.write(message);
    }
  });

  ws.on('close', () => {
    if (isConnected) {
      console.log(chalk.gray('\n\nStream closed. Task finished.'));
      process.exit(0);
    }
    reconnectAttempts++;
    setTimeout(connect, RECONNECT_DELAY);
  });

  ws.on('error', () => {
    // 接続エラー時は close イベントも飛んでくるので、リトライはそっちに任せるよ
    if (isConnected) {
      process.exit(1);
    }
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
