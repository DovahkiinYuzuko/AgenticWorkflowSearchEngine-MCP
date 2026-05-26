const fs = require('fs');
const path = require('path');
const os = require('os');

const configFileName = 'config.json';
// 1. カレントディレクトリの設定 (実行時の優先設定)
const cwdConfigPath = path.resolve(process.cwd(), configFileName);
// 2. ホームディレクトリの設定
const homeConfigPath = path.resolve(os.homedir(), '.aw-se.json');
// 3. アプリケーションディレクトリのデフォルト設定 (フォールバック)
const realAppDir = fs.realpathSync(path.resolve(__dirname, '..'));
const appConfigPath = path.resolve(realAppDir, configFileName);

// デフォルト設定
let config = {
    search: {
        engine: "https://www.bing.com",
        defaultLimit: 5,
        slowMo: 500,
        waitAfterSearch: 3000,
        viewTime: 4000,
        concurrency: 2
    },
    ollama: {
        enabled: false,
        model: "gemma4:e4b-it-q4_K_M",
        host: "http://127.0.0.1:11434",
        timeout: 300,
        maxInputChars: -1,
        system: "You MUST strictly remain neutral and objective. Never include your own opinions, interpretations, or evaluations. Adopt a highly nuanced, objective tone: avoid making absolute or definitive assertions unless they are universally accepted facts (e.g., 1+1=2), and instead use objective phrasing such as 'According to the text, ...', 'It is reported that...', or 'The source states that...'. When extracting claims or facts, always cite or reference the corresponding section, heading, or context from the source text to verify the source of information. Strictly DO NOT generate any conversational fillers, introductory remarks, greetings, follow-up suggestions, or recommendations. Output ONLY the refined, objective core facts directly, without providing any extra advice or next steps.",
        options: {
            temperature: 0.0,
            top_p: 0.9,
            top_k: 40,
            repeat_penalty: 1.1,
            num_ctx: 4096
        }
    },
    cache: {
        enabled: true,
        maxAgeHours: 24
    },
    loadedFrom: 'Defaults'
};

/**
 * 簡易的なディープマージ関数
 * @param {Object} target マージ先
 * @param {Object} source マージ元
 */
function mergeConfig(target, source) {
    for (const key in source) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
            if (!target[key]) target[key] = {};
            mergeConfig(target[key], source[key]);
        } else {
            target[key] = source[key];
        }
    }
}

// 優先順位: cwd > home > appDir
let targetConfigPath = null;
if (fs.existsSync(cwdConfigPath)) {
    targetConfigPath = cwdConfigPath;
} else if (fs.existsSync(homeConfigPath)) {
    targetConfigPath = homeConfigPath;
} else if (fs.existsSync(appConfigPath)) {
    targetConfigPath = appConfigPath;
}

try {
    if (targetConfigPath) {
        const fileContent = fs.readFileSync(targetConfigPath, 'utf-8');
        const parsed = JSON.parse(fileContent);
        mergeConfig(config, parsed);
        config.loadedFrom = targetConfigPath;
    } else {
        // どこにも設定ファイルが存在しない場合、自動生成する
        // デフォルトではアプリディレクトリに作成を試み、失敗したらホームディレクトリに作成する
        const configToSave = { ...config };
        delete configToSave.loadedFrom; // 保存用データからloadedFromを削除

        let savePath = appConfigPath;
        try {
            fs.writeFileSync(savePath, JSON.stringify(configToSave, null, 4), 'utf-8');
        } catch (e) {
            // 権限エラー等でアプリディレクトリに書けない場合はホームディレクトリにフォールバック
            savePath = homeConfigPath;
            fs.writeFileSync(savePath, JSON.stringify(configToSave, null, 4), 'utf-8');
        }
        console.log(`[AW-SE-MCP] 設定ファイルが見つからなかったため、デフォルト設定を自動生成しました: ${savePath}`);
        config.loadedFrom = savePath;
    }
} catch (error) {
    console.error("設定ファイルの読み込みまたは作成中にエラーが発生しました。デフォルト設定を使用します。 / Failed to load or create config file. Using default settings:", error);
}

module.exports = config;
