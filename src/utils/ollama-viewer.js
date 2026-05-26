const WebSocket = require('ws');
const chalk = require('chalk');
const boxen = require('boxen');
const http = require('http');
const readline = require('readline');

// 代替スクリーンバッファに切り替えて、画面のリセットを防ぎます
process.stdout.write('\x1b[?1049h');

// 元の通常スクリーンバッファに復元するクリーンアップ処理
function restoreScreen() {
  process.stdout.write('\x1b[?1049l');
}

// プロセスの各種終了イベント・例外時にも確実に元のスクリーンを復元します
process.on('exit', restoreScreen);
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
process.on('uncaughtException', (err) => {
  restoreScreen();
  console.error('\n[Viewer Error]', err);
  process.exit(1);
});

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

const PORT = process.argv[3] ? parseInt(process.argv[3], 10) : 9999;
const WS_URL = `ws://localhost:${PORT}`;
const RECONNECT_DELAY = 2000;
const MAX_RECONNECT_ATTEMPTS = 5;

// 親プロセスのPIDを取得
const parentPid = process.argv[2] ? parseInt(process.argv[2], 10) : null;

let reconnectAttempts = 0;
let totalTokens = 0;
let startTime = null;
let isConnected = false;
let loadedModelInfo = 'Checking...';
let streamBuffer = '';

// 起動後10秒以内に接続できない場合は終了
const startupTimer = setTimeout(() => {
  if (!isConnected) {
    console.log(chalk.red('\n[!] Failed to connect within 10s. Exiting...'));
    process.exit(1);
  }
}, 10000);

// ウォッチドッグ（親プロセスの生存確認）
if (parentPid) {
    setInterval(() => {
        try {
            process.kill(parentPid, 0);
        } catch (e) {
            console.log(chalk.gray(`\n\n[Watchdog] Parent process (${parentPid}) is gone. Exiting...`));
            process.exit(0);
        }
    }, 2000);
}

function clearScreen() {
  readline.cursorTo(process.stdout, 0, 0);
  readline.clearScreenDown(process.stdout);
}

/**
 * Renders the rich UI with a header and the stream buffer content.
 */
function renderUI() {
  if (!isConnected) return;

  const elapsed = startTime ? (Date.now() - startTime) / 1000 : 0;
  const tps = elapsed > 0 ? (totalTokens / elapsed).toFixed(1) : '0.0';

  const statsLine = `Model: ${chalk.green(loadedModelInfo)} | Tokens: ${chalk.yellow(totalTokens)} | Time: ${chalk.cyan(elapsed.toFixed(1) + 's')} | Speed: ${chalk.magenta(tps + ' t/s')}`;

  const headerBox = boxen(statsLine, {
    title: 'Ollama Real-time Insight',
    titleAlignment: 'center',
    padding: 0,
    margin: { bottom: 1 },
    borderStyle: 'round',
    borderColor: 'cyan'
  });

  clearScreen();
  process.stdout.write(headerBox + '\n');
  process.stdout.write(streamBuffer);
}

// モデル情報の取得
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
    startTime = null;
  });

  ws.on('message', (data) => {
    const message = data.toString();
    if (message === 'ping') return;

    try {
        const parsed = JSON.parse(message);

        if (parsed && typeof parsed === 'object') {
            // 制御コマンドの処理
            if (parsed.type === 'control' && parsed.value === 'clear') {
                if (streamBuffer.length > 0) {
                    streamBuffer += '\n\n' + chalk.blue('-'.repeat(process.stdout.columns || 40)) + '\n\n';
                }
                totalTokens = 0;
                startTime = null;
                return;
            }

            // 旧形式のクリアコマンドの互換性サポート
            if (parsed.control === 'clear') {
                if (streamBuffer.length > 0) {
                    streamBuffer += '\n\n' + chalk.blue('-'.repeat(process.stdout.columns || 40)) + '\n\n';
                }
                totalTokens = 0;
                startTime = null;
                return;
            }

            // トークンまたは情報メッセージの処理
            if (parsed.type === 'token') {
                if (totalTokens === 0 && !startTime) startTime = Date.now();
                totalTokens++;
                streamBuffer += parsed.value;
                return;
            }

            if (parsed.type === 'info') {
                streamBuffer += parsed.value;
                return;
            }

            // その他、想定外のJSONオブジェクト（Ollamaの生レスポンスなどのフォールバック）
            const token = parsed.response || parsed.value || message;
            if (totalTokens === 0 && !startTime) startTime = Date.now();
            totalTokens++;
            streamBuffer += token;
        }
    } catch (e) {
        // 例外発生時は純粋な文字列としてフォールバック処理
        if (totalTokens === 0 && !startTime) startTime = Date.now();
        totalTokens++;
        streamBuffer += message;
    }
  });

  ws.on('close', () => {
    if (isConnected) {
      console.log(chalk.gray('\n\nStream closed. Task finished. Closing in 3 seconds...'));   
      setTimeout(() => {
        process.exit(0);
      }, 3000);
      return;
    }
    reconnectAttempts++;
    setTimeout(connect, RECONNECT_DELAY);
  });

  ws.on('error', () => {
    if (isConnected) {
      process.exit(1);
    }
  });
}

// UIの定期更新
setInterval(() => {
  if (isConnected) {
    renderUI();
  }
}, 500);

// 開始
clearScreen();
console.log(chalk.cyan('Initializing Ollama Viewer...'));
connect();
