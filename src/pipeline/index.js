const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
chromium.use(stealth());

const path = require('path');
const { spawn, spawnSync } = require('child_process');

const config = require('../config');
const cliLogger = require('../utils/cli-logger');
const { checkCache, saveCache } = require('../utils/cache');
const { startRelayServer, stopRelayServer } = require('../utils/streaming-server');

const webSearch = require('./1-search');
const captureUrls = require('./2-capture');
const extractToMarkdown = require('./3-extract');
const markdownToJson = require('./4-structure');
const generateFinalSummary = require('./5-finalize');

/**
 * Ollama Viewerを別ウィンドウで起動する
 * 開発中の状況がリアルタイムで見えるようにするよ！
 * @param {number} parentPid 親プロセスのID（自爆監視用）
 */
async function launchOllamaViewer(parentPid) {
    const viewerPath = path.join(__dirname, '../utils/ollama-viewer.js');
    const platform = process.platform;

    cliLogger.info('Launching Ollama Viewer in a new window... / Ollama Viewerを別ウィンドウで起動しています...');

    try {
        let child;
        const viewerArgs = [viewerPath, parentPid.toString()];
        
        if (platform === 'win32') {
            // Windows: 'start' コマンドを使用して新しいウィンドウでプロセスを分離して起動
            const command = 'start';
            const args = ['"Ollama Viewer"', 'node', ...viewerArgs];
            child = spawn('cmd.exe', ['/c', command, ...args], { 
                detached: true, 
                stdio: 'ignore',
                shell: true 
            });
            child.unref();
        } else if (platform === 'darwin') {
            // macOS: Terminal.app で実行
            child = spawn('open', ['-a', 'Terminal', 'node', ...viewerArgs], { detached: true, stdio: 'ignore' });
            child.unref();
        } else {
            // Linux: gnome-terminalを優先し、一般的なxtermなどを試行
            const terminals = ['gnome-terminal', 'x-terminal-emulator', 'konsole', 'xterm'];
            let launched = false;
            for (const term of terminals) {
                try {
                    const which = spawnSync('which', [term]);
                    if (which.status === 0) {
                        if (term === 'gnome-terminal') {
                            child = spawn(term, ['--', 'node', ...viewerArgs], { detached: true, stdio: 'ignore' });
                        } else {
                            child = spawn(term, ['-e', `node ${viewerArgs.join(' ')}`], { detached: true, stdio: 'ignore' });
                        }
                        child.unref();
                        launched = true;
                        break;
                    }
                } catch (e) {
                    continue;
                }
            }
            if (!launched) {
                cliLogger.warn('Could not detect a terminal to launch Ollama Viewer. Please run "node src/utils/ollama-viewer.js" manually.');
            }
        }
    } catch (err) {
        cliLogger.error('Failed to launch Ollama Viewer:', err);
    }
}

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
        // 空のプロンプトを投げてモデルをVRAMにロード（ウォームアップ）させます。
        // リクエストが正常に送信されるまで待機しますが、生成完了まで待つ必要はありません。
        const response = await fetch(`${host}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: model,
                prompt: "",
                stream: false
            })
        });
        
        if (!response.ok) {
            cliLogger.warn(`Preload request for "${model}" returned status ${response.status}.`);
        }
    } catch (err) {
        cliLogger.warn(`Failed to preload Ollama model "${model}": ${err.message}`);
    }
}

// Ollamaのモデルアンロード（メモリ解放）ヘルパー
async function unloadOllamaModel(host, model) {
    try {
        cliLogger.info(`Unloading local model "${model}" to free memory... / メモリ解放のため、ローカルモデル "${model}" をアンロードしています...`);
        // 空のプロンプトと keep_alive: 0 を投げて即座にメモリから解放させます
        await fetch(`${host}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: model,
                prompt: "",
                stream: false,
                keep_alive: 0
            })
        });
    } catch {
        // 例外を無視
    }
}

// パイプラインを統合して一括実行する関数
async function runPipeline(keywords, intent, limitInput, enableFinalSummary) {
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

    // ストリーミングサーバーの起動とビューアーの自動起動
    if (ollamaActive) {
        // 1. Ollamaサーバー自体の生存確認 (APIの疎通が取れるか)
        cliLogger.startSpinner(`Checking local model "${config.ollama.model}" status... / ローカルモデル "${config.ollama.model}" のロード状況を確認しています...`);
        const isModelLoaded = await checkOllamaModel(config.ollama.host, config.ollama.model);

        if (isModelLoaded) {
            cliLogger.stopSpinner(true, `Model "${config.ollama.model}" is ready. Starting orchestration... / モデル "${config.ollama.model}" が検出されました。準備を開始します...`);
            
            try {
                startRelayServer(config.ollama.relayPort || 9999);
                // 自分のPIDを渡してビューアーを起動（自爆監視用）
                await launchOllamaViewer(process.pid);
                // NOTE: VRAM競合回避のため、ここではプリロードせず、ブラウザ終了後にロードします。
            } catch (err) {
                cliLogger.warn('Streaming orchestration failed, but pipeline will continue. / ストリーミングの準備に失敗しましたが、パイプラインは続行します。');
            }
        } else {
            cliLogger.stopSpinner(false, `Model "${config.ollama.model}" not found or Ollama is offline. Refinement will be skipped. / モデル "${config.ollama.model}" が未検出、またはOllamaがオフラインです。要約はスキップされます。`);
            ollamaActive = false; // 動的に無効化
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

            // Phase 1: Ingestion & Extraction (HTML/PDF -> Markdown)
            cliLogger.info("Phase 1: Extraction (HTML/PDF to Markdown)... / フェーズ 1: Markdownへの変換・抽出を開始します...");
            const phase1Results = [];
            for (let i = 0; i < captureReport.length; i++) {
                const item = captureReport[i];
                if (item.error || item.skipped) {
                    results.push(item);
                    continue;
                }

                const extractResult = await extractToMarkdown(item);
                const typeLabel = item.contentType === 'pdf' ? '[PDF]' : '[HTML]';
                const displayFilename = extractResult.mdFilename;
                cliLogger.progressBar(i, captureReport.length, `Extracting ${typeLabel}: ${displayFilename} / 抽出中 ${typeLabel}: ${displayFilename}`);

                phase1Results.push({
                    item,
                    extractResult
                });
            }
            cliLogger.progressBar(captureReport.length, captureReport.length, "Phase 1 completed. / フェーズ 1 が完了しました。");

            // Browser Close: Close the browser environment to free up memory before AI inference.
            if (headedBrowser) {
                cliLogger.info("Closing browser to free memory for AI inference... / AI推論のリソース確保のため、ブラウザを終了しています...");
                await headedBrowser.close();

                // OSのVRAM解放を待つための1秒のディレイ
                await new Promise(resolve => setTimeout(resolve, 1000));

                // ブラウザが完全に終了した後にモデルをロードします
                if (ollamaActive) {
                    cliLogger.info(`Loading local model "${config.ollama.model}" into VRAM... / ローカルモデル "${config.ollama.model}" をVRAMにロードしています...`);
                    await preloadOllamaModel(config.ollama.host, config.ollama.model);
                }
            }

            // Phase 2: AI Refinement (Markdown -> JSON structure)
            cliLogger.info("Phase 2: AI Refinement (Structuring Markdown to JSON)... / フェーズ 2: AIによる構造化と要約を開始します...");
            for (let i = 0; i < phase1Results.length; i++) {
                const { item, extractResult } = phase1Results[i];
                
                const mdContent = extractResult.markdownContent;
                const mdPath = extractResult.mdPath;
                const updatedTitle = extractResult.title;
                const jsonPath = path.join(item.artifactDir, extractResult.mdFilename.replace('.md', '.json'));

                const typeLabel = item.contentType === 'pdf' ? '[PDF]' : '[HTML]';
                cliLogger.progressBar(i, phase1Results.length, `Refining ${typeLabel}: ${extractResult.mdFilename} / AI分析中 ${typeLabel}: ${extractResult.mdFilename}`);

                // 動的意図を渡してMarkdownからJSONへ構造化（AI要約を含む）
                const originalOllamaEnabled = config.ollama.enabled;
                config.ollama.enabled = ollamaActive;

                const jsonData = await markdownToJson(
                    mdContent,
                    mdPath,
                    item.url,
                    updatedTitle,
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
                    title: updatedTitle,
                    markdownPath: mdPath,
                    jsonPath,
                    aiSummary: jsonData.aiSummary,
                    sections: jsonData.sections
                });
            }

            cliLogger.progressBar(phase1Results.length, phase1Results.length, "Phase 2 completed. / フェーズ 2 が完了しました。");
        } else {
            cliLogger.warn("No search results found. Please check for robot verification (CAPTCHA) on screen. / 検索結果が見つかりませんでした。ロボット検証（CAPTCHA）が画面に表示されている場合は解除してください。");
        }
    } catch (err) {
        cliLogger.error("An error occurred during pipeline execution. / パイプラインの実行中にエラーが発生しました:", err);
        throw err;
    } finally {
        // 案A: headedBrowserのみクローズ (もし例外で Phase 1 の途中で止まった場合の安全策)
        if (headedBrowser && headedBrowser.isConnected()) await headedBrowser.close();
    }

    // --- Task 2: Final Summarizer Step ---
    let finalAnswer = null;
    if (enableFinalSummary && ollamaActive && results.length > 0) {
        cliLogger.startSpinner("Generating final comprehensive answer... / 最終的な回答を生成しています...");   
        finalAnswer = await generateFinalSummary(results, intent);
        if (finalAnswer) {
            cliLogger.stopSpinner(true, "Final comprehensive answer generated successfully. / 最終回答の生成が完了しました。");
        } else {
            cliLogger.stopSpinner(false, "Failed to generate final answer. / 最終回答の生成に失敗しました。");
        }
    }

    // ストリーミングサーバーの停止
    stopRelayServer();

    // パイプライン終了時にOllamaモデルをアンロードしてメモリを解放します
    if (ollamaActive) {
        await unloadOllamaModel(config.ollama.host, config.ollama.model);
    }

    // 7. 親AIに返却する「美しい統合Markdown」を組み立てます
    let markdownOutput = `# 🔍 Search Result Summary / 検索結果サマリー\n`;
    markdownOutput += `- **Keywords / 検索ワード**: \`${keywords}\`\n`;
    markdownOutput += `- **Search Intent / 検索意図**: *"${intent}"*\n\n`;

    if (finalAnswer) {
        markdownOutput += `## 🏆 Final Comprehensive Answer / 最終的な回答\n`;
        markdownOutput += `${finalAnswer}\n\n`;
        markdownOutput += `---\n\n`;
    }

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
