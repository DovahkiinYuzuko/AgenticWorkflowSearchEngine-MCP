let isSilent = false;
let spinnerInterval = null;
let spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
let spinnerIndex = 0;
let currentSpinnerText = "";

const colors = {
    cyan: (text) => `\x1b[36m${text}\x1b[0m`,
    green: (text) => `\x1b[32m${text}\x1b[0m`,
    red: (text) => `\x1b[31m${text}\x1b[0m`,
    yellow: (text) => `\x1b[33m${text}\x1b[0m`,
    gray: (text) => `\x1b[90m${text}\x1b[0m`,
    bold: (text) => `\x1b[1m${text}\x1b[22m`
};

const cliLogger = {
    // 起動時の初期化（MCPモードかCLIモードかで出力を切り替えます）
    init(isMcp) {
        isSilent = isMcp;
    },
    
    info(text) {
        if (isSilent) return;
        console.error(colors.cyan(`ℹ [INFO] ${text}`));
    },
    
    success(text) {
        if (isSilent) return;
        console.error(colors.green(`✔ [SUCCESS] ${text}`));
    },
    
    warn(text) {
        if (isSilent) return;
        console.error(colors.yellow(`⚠ [WARNING] ${text}`));
    },
    
    error(text, err) {
        if (isSilent) return;
        console.error(colors.red(`✖ [ERROR] ${text}`));
        if (err) console.error(colors.gray(err.stack || err.message || err));
    },
    
    // スピナーアニメーションを開始します
    startSpinner(text) {
        if (isSilent) return;
        if (spinnerInterval) clearInterval(spinnerInterval);
        
        currentSpinnerText = text;
        spinnerIndex = 0;
        
        // 最初のフレームを出力
        process.stderr.write(`\r${colors.cyan(spinnerFrames[0])} ${text}`);
        
        spinnerInterval = setInterval(() => {
            spinnerIndex = (spinnerIndex + 1) % spinnerFrames.length;
            process.stderr.write(`\r${colors.cyan(spinnerFrames[spinnerIndex])} ${currentSpinnerText}`);
        }, 80);
    },
    
    // スピナーの文言を更新します
    updateSpinner(text) {
        if (isSilent) return;
        currentSpinnerText = text;
    },
    
    // スピナーを停止し、最終結果を書き出します
    stopSpinner(isSuccess, text = "") {
        if (isSilent) return;
        if (spinnerInterval) {
            clearInterval(spinnerInterval);
            spinnerInterval = null;
        }
        
        // 行全体をクリア
        process.stderr.write('\r\x1b[K');
        
        const finalMsg = text || currentSpinnerText;
        if (isSuccess) {
            console.error(`${colors.green('✔ [SUCCESS]')} ${finalMsg}`);
        } else {
            console.error(`${colors.red('✖ [ERROR]')} ${finalMsg}`);
        }
    },
    
    // スタイリッシュな進捗バー（プログレスバー）を出力します
    progressBar(current, total, label = "") {
        if (isSilent) return;
        const width = 20;
        const percent = Math.min(Math.max(current / total, 0), 1);
        const filledWidth = Math.round(width * percent);
        const emptyWidth = width - filledWidth;
        
        const filledStr = '█'.repeat(filledWidth);
        const emptyStr = '░'.repeat(emptyWidth);
        
        const percentStr = Math.round(percent * 100).toString().padStart(3);
        
        const bar = colors.cyan(`[${filledStr}${emptyStr}]`);
        const stats = colors.gray(`(${current}/${total})`);
        
        process.stderr.write(`\r${bar} ${percentStr}% | ${label} ${stats}\x1b[K`);
        if (current === total) {
            process.stderr.write('\n'); // 完了時は自動改行
        }
    }
};

module.exports = cliLogger;
