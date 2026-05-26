const { WebSocketServer, WebSocket } = require('ws');
const cliLogger = require('./cli-logger');

let wss = null;

/**
 * 全接続クライアントにデータを送信
 * @param {any} data 送信するデータ（文字列またはJSONオブジェクト）
 */
const broadcast = (data) => {
  if (!wss) return;
  
  let payload;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    payload = data;
  } else {
    // レガシーなプレーンテキスト呼び出しに対する自動JSON構造化ラッピング
    payload = {
      type: 'token',
      value: String(data)
    };
  }
  
  const message = JSON.stringify(payload);
  
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
};

/**
 * ストリーミング・リレー・サーバー（WebSocket）を起動
 * ユズコ、これでリアルタイムにトークンを飛ばせるようになるよ！
 * @param {number} port 
 * @returns {object} { wss, broadcast }
 */
function startRelayServer(port = 9999) {
  // すでにサーバーが起動している場合は二重起動を防ぐ
  if (wss) {
    cliLogger.warn('Streaming relay server is already running.');
    return { wss, broadcast };
  }

  try {
    wss = new WebSocketServer({ port });
    
    cliLogger.info(`Streaming relay server started on ws://localhost:${port}`);

    wss.on('connection', (ws) => {
      cliLogger.info('New client connected to streaming relay');

      ws.on('error', (err) => {
        cliLogger.error('WebSocket client error:', err);
      });

      ws.on('close', () => {
        cliLogger.info('Client disconnected from streaming relay');
      });
    });

    // サーバー自体のエラー（EADDRINUSEなど）をハンドリング
    wss.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        cliLogger.error(`Port ${port} is already in use. Failed to start streaming server.`);
      } else {
        cliLogger.error('WebSocket server error:', err);
      }
    });

    return {
      wss,
      broadcast
    };
  } catch (err) {
    cliLogger.error('Failed to start streaming relay server:', err);
    throw err;
  }
}

/**
 * ストリーミング・リレー・サーバーを安全に停止
 */
function stopRelayServer() {
  if (wss) {
    cliLogger.info('Stopping streaming relay server...');
    wss.close((err) => {
      if (err) {
        cliLogger.error('Error while stopping streaming server:', err);
      } else {
        cliLogger.info('Streaming relay server stopped.');
      }
    });
    wss = null;
  }
}

module.exports = {
  startRelayServer,
  stopRelayServer,
  broadcast
};
