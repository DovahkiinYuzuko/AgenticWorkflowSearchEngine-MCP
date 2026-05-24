const fs = require('fs');
const path = require('path');
const sanitizeFolderName = require('./sanitize');

const ARTIFACTS_DIR = path.resolve(__dirname, '../../artifacts');

// キーワードに対応するキャッシュサマリーファイルのパスを返します
function getCacheSummaryPath(keywords) {
    const cacheDir = path.join(ARTIFACTS_DIR, sanitizeFolderName(keywords));
    return path.join(cacheDir, '_summary.md');
}

/**
 * キャッシュの有効性を確認し、有効であればサマリーを返します
 * @param {string} keywords 検索キーワード
 * @param {object} cacheConfig models_config.json の cache 設定オブジェクト
 * @returns {{ hit: boolean, summary?: string, reason?: string }}
 */
async function checkCache(keywords, cacheConfig) {
    if (!cacheConfig || !cacheConfig.enabled) {
        return { hit: false };
    }

    const summaryPath = getCacheSummaryPath(keywords);

    if (!fs.existsSync(summaryPath)) {
        return { hit: false };
    }

    const stat = fs.statSync(summaryPath);
    const maxAgeMs = (cacheConfig.maxAgeHours || 24) * 60 * 60 * 1000;
    const ageMs = Date.now() - stat.mtimeMs;

    if (ageMs > maxAgeMs) {
        const ageHours = Math.floor(ageMs / 3600000);
        return { hit: false, reason: `Cache expired (age: ${ageHours}h / 有効期限切れ: ${ageHours}時間経過)` };
    }

    const summary = fs.readFileSync(summaryPath, 'utf-8');
    return { hit: true, summary };
}

/**
 * 生成されたサマリーMarkdownをキャッシュとして保存します
 * @param {string} keywords 検索キーワード
 * @param {string} summary 保存するMarkdown文字列
 * @param {object} cacheConfig models_config.json の cache 設定オブジェクト
 */
function saveCache(keywords, summary, cacheConfig) {
    if (!cacheConfig || !cacheConfig.enabled) return;

    const summaryPath = getCacheSummaryPath(keywords);
    const cacheDir = path.dirname(summaryPath);

    if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
    }

    fs.writeFileSync(summaryPath, summary, 'utf-8');
}

module.exports = { checkCache, saveCache };
