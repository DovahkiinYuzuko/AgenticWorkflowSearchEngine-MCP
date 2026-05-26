const chalk = require('chalk');
const boxen = require('boxen');
const cliProgress = require('cli-progress');

let isSilent = false;
let currentSpinnerText = "";
let progressBarInstance = null;

const icons = {
    info: chalk.blue('[i]'),
    success: chalk.green('[OK]'),
    plus: chalk.green('[+]'),
    warn: chalk.yellow('[!]'),
    error: chalk.red('[x]')
};

/**
 * ギャルでも納得！プロ仕様のCLIロガー
 */
const cliLogger = {
    /**
     * 初期化
     * @param {boolean} isMcp MCPモード（サイレント）かどうか
     */
    init(isMcp) {
        isSilent = !!isMcp;
    },

    isMcp() {
        return isSilent;
    },

    info(text) {
        if (isSilent) return;
        console.error(`${icons.info} ${chalk.cyan(text)}`);
    },

    success(text) {
        if (isSilent) return;
        console.error(`${icons.success} ${chalk.green(text)}`);
    },

    warn(text) {
        if (isSilent) return;
        console.error(`${icons.warn} ${chalk.yellow(text)}`);
    },

    error(text, err) {
        if (isSilent) return;
        console.error(`${icons.error} ${chalk.red(text)}`);
        if (err) {
            const errorMsg = err.stack || err.message || err;
            console.error(chalk.gray(errorMsg));
        }
    },

    /**
     * スピナー（というかヘッダー）を表示開始
     */
    startSpinner(text) {
        if (isSilent) return;
        currentSpinnerText = text;

        const header = boxen(chalk.bold.cyan(text), {
            padding: 0,
            margin: { top: 1, bottom: 0 },
            borderStyle: 'round',
            borderColor: 'cyan'
        });

        console.error(header);
    },

    
    /**
     * スピナーのテキストを更新
     */
    updateSpinner(text) {
        if (isSilent) return;
        this.info(text);
    },
    
    /**
     * スピナーを停止し、結果を表示
     */
    stopSpinner(isSuccess, text = "") {
        if (isSilent) return;
        const msg = text || currentSpinnerText;
        
        if (isSuccess) {
            this.success(msg);
        } else {
            this.error(msg);
        }
    },
    
    /**
     * 本物のプログレスバーを表示
     */
    progressBar(current, total, label = "") {
        if (isSilent) return;

        if (!progressBarInstance) {
            progressBarInstance = new cliProgress.SingleBar({
                format: `${chalk.cyan('{bar}')} ${chalk.yellow('{percentage}%')} | {value}/{total} | ${chalk.gray('{label}')}`,
                barCompleteChar: '=',
                barIncompleteChar: '-',
                hideCursor: true
            });
            
            progressBarInstance.start(total, current, { label });
        } else {
            progressBarInstance.update(current, { label });
        }

        if (current >= total) {
            progressBarInstance.stop();
            progressBarInstance = null;
        }
    }
};

module.exports = cliLogger;
