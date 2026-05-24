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

  const statsLine = chalk.dim(`[ Tokens: ${totalTokens} | Elapsed: ${elapsed.toFixed(1)}s | Speed: ${tps} t/s ]`);
  
  // Move cursor to bottom, clear line, and print stats
  readline.cursorTo(process.stdout, 0, process.stdout.rows - 1);
  readline.clearLine(process.stdout, 0);
  process.stdout.write(statsLine);
}

function connect() {
  console.log(chalk.yellow(`Connecting to ${WS_URL}...`));
  
  const ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    isConnected = true;
    clearScreen();
    console.log(header);
    console.log(chalk.green('Connected to stream.\n'));
    startTime = Date.now();
  });

  ws.on('message', (data) => {
    const message = data.toString();
    
    // Check if it's a heartbeat or actual content
    if (message === 'ping') return;

    totalTokens++;
    process.stdout.write(message);
    
    // Update stats at the bottom
    updateStats();
  });

  ws.on('close', () => {
    isConnected = false;
    console.log(chalk.red('\nConnection lost. Retrying...'));
    setTimeout(connect, RECONNECT_DELAY);
  });

  ws.on('error', (err) => {
    if (!isConnected) {
      // Silently retry if initial connection fails
      setTimeout(connect, RECONNECT_DELAY);
    } else {
      console.error(chalk.red(`\nWebSocket Error: ${err.message}`));
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
