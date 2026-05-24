const fs = require('fs');
const path = require('path');
const os = require('os');

const configFileName = 'models_config.json';
// 1. カレントディレクトリ (実行場所)
const cwdConfigPath = path.resolve(process.cwd(), configFileName);
// 2. ユーザーホームディレクトリ
const homeConfigPath = path.resolve(os.homedir(), '.aw-se.json');
// 3. プログラムの実体フォルダ (フォールバック)
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
        model: "gemma4-e4b-custom-uncensored:latest",
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

// 簡易的なDeep Merge関数 (optionsなどのネストされたプロパティを維持するため)
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
    }
} catch (error) {
    console.error("設定ファイルの読み込みに失敗しました。デフォルト設定を使用します: / Failed to load config file. Using default settings:", error);
}

module.exports = config;
