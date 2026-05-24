const { WebSocketServer, WebSocket } = require('ws');
const cliLogger = require('./cli-logger');

let wss = null;

/**
 * ストリーミング・リレー・サーバー（WebSocket）を起動
 * ユズコ、これでリアルタイムにトークンを飛ばせるようになるよ！
 * @param {number} port 
 * @returns {object} { wss, broadcast }
 */
function startRelayServer(port = 9999) {
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

    wss.on('error', (err) => {
      cliLogger.error('WebSocket server error:', err);
    });

    /**
     * 全接続クライアントにデータを送信
     * @param {any} data 送信するデータ（文字列またはJSONオブジェクト）
     */
    const broadcast = (data) => {
      if (!wss) return;
      
      const message = typeof data === 'string' ? data : JSON.stringify(data);
      
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
        }
      });
    };

    return {
      wss,
      broadcast
    };
  } catch (err) {
    cliLogger.error('Failed to start streaming relay server:', err);
    throw err;
  }
}

module.exports = {
  startRelayServer
};
