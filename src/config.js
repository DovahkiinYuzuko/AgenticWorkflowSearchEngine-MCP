const fs = require('fs');
const path = require('path');

// fs.realpathSync を使用して、npm link 等のシンボリックリンク環境下でも
// プログラムの実体フォルダにある models_config.json を確実に指すように解決します。
const realAppDir = fs.realpathSync(path.resolve(__dirname, '..'));
const configPath = path.resolve(realAppDir, 'models_config.json');

// デフォルト設定
let config = {
    search: {
        engine: "https://www.bing.com",
        defaultLimit: 5,
        slowMo: 500,
        waitAfterSearch: 3000,
        viewTime: 4000
    },
    ollama: {
        enabled: false,
        model: "gemma4-e4b-custom-uncensored:latest",
        host: "http://127.0.0.1:11434",
        timeout: 300,
        system: "You MUST strictly remain neutral and objective. Never include your own opinions, interpretations, or evaluations. Adopt a highly nuanced, objective tone: avoid making absolute or definitive assertions unless they are universally accepted facts (e.g., 1+1=2), and instead use objective phrasing such as 'According to the text, ...', 'It is reported that...', or 'The source states that...'. When extracting claims or facts, always cite or reference the corresponding section, heading, or context from the source text to verify the source of information. Do not generate conversational fillers or introductory remarks. Output ONLY the refined, objective core facts directly.",
        options: {
            temperature: 0.0,
            top_p: 0.9,
            top_k: 40,
            repeat_penalty: 1.1,
            num_ctx: 4096
        }
    }
};

try {
    if (fs.existsSync(configPath)) {
        const fileContent = fs.readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(fileContent);
        config = {
            search: { ...config.search, ...parsed.search },
            ollama: { ...config.ollama, ...parsed.ollama }
        };
    }
} catch (error) {
    console.error("設定ファイルの読み込みに失敗しました。デフォルト設定を使用します: / Failed to load config file. Using default settings:", error);
}

module.exports = config;
