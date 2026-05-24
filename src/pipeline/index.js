const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
chromium.use(stealth());

const path = require('path');

const config = require('../config');
const cliLogger = require('../utils/cli-logger');
const { checkCache, saveCache } = require('../utils/cache');

const webSearch = require('./1-search');
const captureUrls = require('./2-capture');
const htmlToMarkdown = require('./3-extract');
const markdownToJson = require('./4-structure');

// Ollamaのモデル存在チェックヘルパー
async function checkOllamaModel(host, model) {
    try {
        const response = await fetch(`${host}/api/tags`);
        if (!response.ok) return false;
        const data = await response.json();
        if (!data.models) return false;
        // 完全一致またはタグなし一致を確認します
        return data.models.some(m => m.name === model || m.name === `${model}:latest`);
    } catch {
        return false;
    }
}

// Ollamaのモデルプリロード（ウォームアップ）ヘルパー
async function preloadOllamaModel(host, model) {
    try {
        // バックグラウンドで空のプロンプトを投げてモデルをVRAMにロード（ウォームアップ）させます
        fetch(`${host}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: model,
                prompt: "",
                stream: false
            })
        }).catch(() => {}); // エラーは無視して並列バックグラウンドで処理
    } catch {
        // 例外を無視
    }
}

// パイプラインを統合して一括実行する関数
async function runPipeline(keywords, intent, limitInput) {
    const limit = limitInput || config.search.defaultLimit;

    // 案D: キャッシュチェック (有効期限内のキャッシュが存在すればブラウザを起動せずに即座に返します)
    if (config.cache && config.cache.enabled) {
        cliLogger.startSpinner(`Checking cache for "${keywords}"... / 「${keywords}」のキャッシュを確認しています...`);
        const cached = await checkCache(keywords, config.cache);
        if (cached.hit) {
            cliLogger.stopSpinner(true, `Cache hit! Returning cached results. / キャッシュが見つかりました。キャッシュから結果を返します。`);
            return cached.summary;
        }
        const reason = cached.reason || 'No cache found.';
        cliLogger.stopSpinner(false, `${reason} Starting fresh search. / 新規検索を開始します。`);
    }

    let ollamaActive = config.ollama && config.ollama.enabled;

    // 1. Ollamaモデルのロード確認＆並列プリロード開始
    if (ollamaActive) {
        cliLogger.startSpinner(`Checking local model "${config.ollama.model}" status... / ローカルモデル "${config.ollama.model}" のロード状況を確認しています...`);
        const isModelLoaded = await checkOllamaModel(config.ollama.host, config.ollama.model);

        if (isModelLoaded) {
            cliLogger.stopSpinner(true, `Model "${config.ollama.model}" is ready. Starting parallel preloading... / モデル "${config.ollama.model}" が検出されました。並列プリロードを開始します...`);
            // awaitせず非同期（バックグラウンド）でプリロードを即座に開始します
            preloadOllamaModel(config.ollama.host, config.ollama.model);
        } else {
            cliLogger.stopSpinner(false, `Model "${config.ollama.model}" not found or Ollama is offline. Refinement will be skipped. / モデル "${config.ollama.model}" が未検出、またはOllamaがオフラインです。要約はスキップされます。`);
            ollamaActive = false; // 動的に無効化して要約をスキップします
        }
    }

    cliLogger.startSpinner("Launching browser environment... / ブラウザ環境を起動しています...");

    // 案A: headedブラウザ1台のみ起動 (headlessブラウザは廃止)
    const headedBrowser = await chromium.launch({
        headless: false,
        slowMo: config.search.slowMo
    });

    const headedContext = await headedBrowser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const headedPage = await headedContext.newPage();

    let results = [];
    let hasRefinementError = !ollamaActive && config.ollama.enabled; // Ollamaが計画されていたがロードできなかった場合

    try {
        cliLogger.updateSpinner(`Searching Bing for "${keywords}"... / Bingで「${keywords}」を検索中...`);
        const searchResults = await webSearch(headedPage, keywords, limit);
        cliLogger.stopSpinner(true, `Search results retrieved successfully (${searchResults.length} pages). / 検索結果のURLを取得しました（${searchResults.length}件）。`);

        if (searchResults.length > 0) {
            const concurrency = config.search.concurrency || 1;
            cliLogger.info(`Starting page capture (concurrency: ${concurrency}) and HTML→Markdown conversion... / ページのキャプチャ（同時処理数: ${concurrency}）とHTML→Markdown変換を開始します...`);

            // 4. Capture (案A+B: page.content()でHTML取得 + 並列処理)
            const captureReport = await captureUrls(
                headedContext,
                searchResults,
                keywords,
                (current, total, label) => {
                    const enLabel = label.replace("を処理中...", "processing...");
                    cliLogger.progressBar(current, total, `${enLabel} / ${label}`);
                }
            );

            cliLogger.info("Structuring Markdown to JSON... / MarkdownからJSONへの構造化を開始します...");

            // 5. Extract & 6. Structure
            for (let i = 0; i < captureReport.length; i++) {
                const item = captureReport[i];
                if (item.error || item.skipped) {
                    results.push(item);
                    continue;
                }

                cliLogger.progressBar(i, captureReport.length, `Converting: ${item.mdFilename} / 変換中: ${item.mdFilename}`);

                const mdPath = path.join(item.artifactDir, item.mdFilename);
                const jsonPath = path.join(item.artifactDir, item.jsonFilename);

                // 案A: HTMLからMarkdownに変換 (PDFを経由しない)
                const mdContent = await htmlToMarkdown(item.htmlContent, mdPath, item.title);

                // 動的意図を渡してMarkdownからJSONへ構造化（AI要約を含む）
                const originalOllamaEnabled = config.ollama.enabled;
                config.ollama.enabled = ollamaActive;

                const jsonData = await markdownToJson(
                    mdContent,
                    mdPath,
                    item.url,
                    item.title,
                    jsonPath,
                    intent
                );

                config.ollama.enabled = originalOllamaEnabled; // configの復元

                if (!jsonData.aiSummary && originalOllamaEnabled) {
                    hasRefinementError = true;
                }

                results.push({
                    no: item.no,
                    url: item.url,
                    title: item.title,
                    markdownPath: mdPath,
                    jsonPath,
                    aiSummary: jsonData.aiSummary,
                    sections: jsonData.sections
                });
            }

            cliLogger.progressBar(captureReport.length, captureReport.length, "All conversion processes completed. / すべての変換・抽出処理が完了しました。");
        } else {
            cliLogger.warn("No search results found. Please check for robot verification (CAPTCHA) on screen. / 検索結果が見つかりませんでした。ロボット検証（CAPTCHA）が画面に表示されている場合は解除してください。");
        }
    } catch (err) {
        cliLogger.error("An error occurred during pipeline execution. / パイプラインの実行中にエラーが発生しました:", err);
        throw err;
    } finally {
        // 案A: headedBrowserのみクローズ (headlessBrowserは廃止)
        await headedBrowser.close();
    }

    // 7. 親AIに返却する「美しい統合Markdown」を組み立てます
    let markdownOutput = `# 🔍 Search Result Summary / 検索結果サマリー\n`;
    markdownOutput += `- **Keywords / 検索ワード**: \`${keywords}\`\n`;
    markdownOutput += `- **Search Intent / 検索意図**: *"${intent}"*\n\n`;

    if (hasRefinementError) {
        markdownOutput += `> [!WARNING]\n`;
        markdownOutput += `> Ollama refinement was offline or timed out. Raw files are saved below. / \n`;
        markdownOutput += `> 整理役 (Ollama) がオフラインであるか、タイムアウトしました。生データは以下に保存されています。\n\n`;
    }

    markdownOutput += `---\n\n`;

    for (const res of results) {
        if (res.error) {
            markdownOutput += `### ❌ Page ${res.no}: Error / エラー\n`;
            markdownOutput += `- **URL**: ${res.url}\n`;
            markdownOutput += `- **Error Message / エラー内容**: \`${res.error}\`\n\n`;
            markdownOutput += `---\n\n`;
            continue;
        }
        if (res.skipped) {
            markdownOutput += `### ⏭ Page ${res.no}: Skipped / スキップ\n`;
            markdownOutput += `- **URL**: ${res.url}\n`;
            markdownOutput += `- **Reason / 理由**: ${res.reason}\n\n`;
            markdownOutput += `---\n\n`;
            continue;
        }

        markdownOutput += `### 📄 Page ${res.no}: ${res.title}\n`;
        markdownOutput += `- **Source URL / 取得元URL**: [${res.url}](${res.url})\n`;
        markdownOutput += `- **Local Markdown / MD保存先**: \`${res.markdownPath}\`\n`;
        markdownOutput += `- **Local JSON / JSON保存先**: \`${res.jsonPath}\`\n\n`;

        if (res.aiSummary) {
            markdownOutput += `#### 🎯 Refinement Summary (Ollama) / 整理役による抽出結果:\n`;
            markdownOutput += `${res.aiSummary}\n\n`;
        } else {
            markdownOutput += `#### 📁 Headings Structure / 見出し構造:\n`;
            res.sections.forEach(sec => {
                if (sec.heading !== 'Introduction' && sec.content) {
                    markdownOutput += `- **${sec.heading}**\n`;
                }
            });
            markdownOutput += `\n*(Ollama refinement was skipped. Please refer to the raw Markdown for full text.)*\n\n`;
        }

        markdownOutput += `---\n\n`;
    }

    // 案D: 生成したサマリーをキャッシュとして保存します
    saveCache(keywords, markdownOutput, config.cache);

    return markdownOutput;
}

module.exports = { runPipeline };
