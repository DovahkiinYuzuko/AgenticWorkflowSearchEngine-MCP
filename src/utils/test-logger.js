const logger = require('./cli-logger');

// テスト用のダミーエラー
const dummyError = new Error('Something went wrong!');

console.log('--- Testing Professional Logger ---');

// 各メソッドの呼び出し
logger.init(false); // サイレントモード無効

logger.info('This is an info message [i]');
logger.success('Operation completed successfully [✔]');
logger.warn('This is a warning message [!]');
logger.error('An error occurred [x]', dummyError);

console.log('\n--- Testing Spinner with Header ---');
logger.startSpinner('Processing Data');
setTimeout(() => {
    logger.updateSpinner('Extracting content...');
    setTimeout(() => {
        logger.stopSpinner(true, 'Data processing finished!');
        
        console.log('\n--- Testing Progress Bar ---');
        const total = 100;
        let current = 0;
        const interval = setInterval(() => {
            current += 10;
            logger.progressBar(current, total, 'Downloading');
            if (current >= total) {
                clearInterval(interval);
                console.log('\n--- Logger Test Done ---');
            }
        }, 100);
    }, 1500);
}, 1500);
