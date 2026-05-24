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
 * Ollama Viewerを別ウィンドウで起動する。
 * @param {number} parentPid 親プロセスのID
 */
async function launchOllamaViewer(parentPid, port = 9999) {
    const viewerPath = path.join(__dirname, '../utils/ollama-viewer.js');
    const platform = process.platform;

    cliLogger.info('Launching Ollama Viewer in a new window... / Ollama Viewerを起動中...');

    try {
        let child;
        const viewerArgs = [viewerPath, parentPid.toString(), port.toString()];

        if (platform === 'win32') {
            const command = 'start';
            const args = ['"Ollama Viewer"', 'node', ...viewerArgs];
            child = spawn('cmd.exe', ['/c', command, ...args], {
                detached: true,
                stdio: 'ignore',
                shell: true
            });
            child.unref();
        } else if (platform === 'darwin') {
            child = spawn('open', ['-a', 'Terminal', 'node', ...viewerArgs], { detached: true, stdio: 'ignore' });
            child.unref();
        } else {
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
        }
    } catch (err) {
        cliLogger.error('Failed to launch Ollama Viewer:', err);
    }
}

async function checkOllamaModel(host, model) {
    try {
        const response = await fetch(`${host}/api/tags`);
        if (!response.ok) return false;
        const data = await response.json();
        if (!data.models) return false;
        return data.models.some(m => m.name === model || m.name === `${model}:latest`);       
    } catch {
        return false;
    }
}

async function preloadOllamaModel(host, model, options = {}) {
    try {
        const response = await fetch(`${host}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: model,
                prompt: "",
                stream: false,
                options: options
            })
        });
    } catch (err) {
        cliLogger.warn(`Failed to preload Ollama model "${model}": ${err.message}`);
    }
}

async function unloadOllamaModel(host, model) {
    try {
        cliLogger.info(`Unloading local model "${model}"...`);
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
    }
}

async function runPipeline(keywords, intent, limitInput, enableFinalSummary) {
    const limit = limitInput || config.search.defaultLimit;

    if (config.cache && config.cache.enabled) {
        cliLogger.startSpinner(`Checking cache for "${keywords}"...`);
        const cached = await checkCache(keywords, config.cache);
        if (cached.hit) {
            cliLogger.stopSpinner(true, `Cache hit!`);
            return cached.summary;
        }
        cliLogger.stopSpinner(true, `No cache found, running fresh search. / キャッシュなし。新規検索します。`);
    }

    let ollamaActive = config.ollama && config.ollama.enabled;

    if (ollamaActive) {
        cliLogger.startSpinner(`Checking local model status...`);
        const isModelLoaded = await checkOllamaModel(config.ollama.host, config.ollama.model);

        if (isModelLoaded) {
            cliLogger.stopSpinner(true, `Model ready.`);

            try {
                startRelayServer(config.ollama.relayPort || 9999);
                await launchOllamaViewer(process.pid, config.ollama.relayPort || 9999);
            } catch (err) {
                cliLogger.warn('Streaming preparation failed.');
            }
        } else {
            cliLogger.stopSpinner(false, `Model not found.`);
            ollamaActive = false;
        }
    }

    cliLogger.startSpinner("Launching browser...");

    const headedBrowser = await chromium.launch({
        headless: false,
        slowMo: config.search.slowMo
    });

    const headedContext = await headedBrowser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const headedPage = await headedContext.newPage();

    let results = [];
    let hasRefinementError = !ollamaActive && config.ollama.enabled;
    let finalAnswer = null; // tryブロック外で宣言することで、エラー時も変数のスコープを保証します

    try {
        cliLogger.updateSpinner(`Searching for "${keywords}"...`);
        const searchResults = await webSearch(headedPage, keywords, limit);
        cliLogger.stopSpinner(true, `Retrieved ${searchResults.length} pages.`);

        if (searchResults.length > 0) {
            const concurrency = config.search.concurrency || 1;
            cliLogger.info(`Starting page capture...`);

            // ブラウザがURLを巡回する間に、バックグラウンドでOllamaモデルをウォームアップします（並列プリロード）
            if (ollamaActive) {
                preloadOllamaModel(config.ollama.host, config.ollama.model, config.ollama.options); // await なし：fire-and-forget
            }

            const captureReport = await captureUrls(
                headedContext,
                searchResults,
                keywords,
                (current, total, label) => {
                    cliLogger.progressBar(current, total, `${label}`);
                }
            );

            cliLogger.info("Phase 1: Extraction...");
            const phase1Results = [];
            for (let i = 0; i < captureReport.length; i++) {
                const item = captureReport[i];
                if (item.error || item.skipped) {
                    results.push(item);
                    continue;
                }

                const extractResult = await extractToMarkdown(item);
                cliLogger.progressBar(i, captureReport.length, `Extracting: ${extractResult.mdFilename}`);

                phase1Results.push({
                    item,
                    extractResult
                });
            }
            cliLogger.progressBar(captureReport.length, captureReport.length, "Phase 1 completed.");

            // HTMLキャプチャ完了後にブラウザを閉じます（プリロードは既にバックグラウンドで実行中）
            if (headedBrowser && headedBrowser.isConnected()) {
                cliLogger.info("Closing browser... / ブラウザを閉じます...");
                await headedBrowser.close();
            }

            cliLogger.info("Phase 2: Refinement...");
            for (let i = 0; i < phase1Results.length; i++) {
                if (ollamaActive) {
                    const { broadcast } = require('../utils/streaming-server');
                    broadcast({ control: 'clear' });
                }

                const { item, extractResult } = phase1Results[i];
                const jsonPath = path.join(item.artifactDir, extractResult.mdFilename.replace('.md', '.json'));

                cliLogger.progressBar(i, phase1Results.length, `Refining: ${extractResult.mdFilename}`);

                const originalOllamaEnabled = config.ollama.enabled;
                config.ollama.enabled = ollamaActive;

                const jsonData = await markdownToJson(
                    extractResult.markdownContent,
                    extractResult.mdPath,
                    item.url,
                    extractResult.title,
                    jsonPath,
                    intent
                );

                config.ollama.enabled = originalOllamaEnabled;

                if (!jsonData.aiSummary && originalOllamaEnabled) {
                    hasRefinementError = true;
                }

                results.push({
                    no: item.no,
                    url: item.url,
                    title: extractResult.title,
                    markdownPath: extractResult.mdPath,
                    jsonPath,
                    aiSummary: jsonData.aiSummary,
                    sections: jsonData.sections
                });
            }

            cliLogger.progressBar(phase1Results.length, phase1Results.length, "Phase 2 completed.");

            // Phase 3: 全ページ横断の最終回答生成 (enableFinalSummary が有効な場合のみ)
            if (enableFinalSummary && ollamaActive && results.length > 0) {
                cliLogger.startSpinner("Generating final answer... / 最終回答を生成中...");
                finalAnswer = await generateFinalSummary(results, intent);
                cliLogger.stopSpinner(
                    !!finalAnswer,
                    finalAnswer ? "Final answer ready. / 最終回答の生成が完了しました。" : "Final answer failed. / 最終回答の生成に失敗しました。"
                );
            }
        }
    } catch (err) {
        cliLogger.error("Pipeline error:", err);
        throw err;
    } finally {
        // エラー・成功問わず、確実にリソースを解放します
        if (headedBrowser && headedBrowser.isConnected()) await headedBrowser.close();
        stopRelayServer();
        if (ollamaActive) {
            await unloadOllamaModel(config.ollama.host, config.ollama.model);
        }
    }

    let markdownOutput = `# Search Result Summary\n`;
    markdownOutput += `- **Keywords**: \`${keywords}\`\n`;
    markdownOutput += `- **Search Intent**: *"${intent}"*\n\n`;

    if (finalAnswer) {
        markdownOutput += `## Final Answer\n`;
        markdownOutput += `${finalAnswer}\n\n`;
        markdownOutput += `---\n\n`;
    }

    if (hasRefinementError) {
        markdownOutput += `> [!WARNING]\n`;
        markdownOutput += `> Refinement issue occurred.\n\n`;
    }

    markdownOutput += `---\n\n`;

    for (const res of results) {
        if (res.error) {
            markdownOutput += `### Page ${res.no}: Error\n`;
            markdownOutput += `- **URL**: ${res.url}\n\n`;
            continue;
        }
        if (res.skipped) {
            markdownOutput += `### Page ${res.no}: Skipped\n`;
            markdownOutput += `- **URL**: ${res.url}\n\n`;
            continue;
        }

        markdownOutput += `### Page ${res.no}: ${res.title}\n`;
        markdownOutput += `- **URL**: [${res.url}](${res.url})\n`;

        if (res.aiSummary) {
            markdownOutput += `#### AI Summary\n`;
            markdownOutput += `${res.aiSummary}\n\n`;
        } else {
            markdownOutput += `#### Headings\n`;
            res.sections.forEach(sec => {
                if (sec.heading !== 'Introduction' && sec.content) {
                    markdownOutput += `- **${sec.heading}**\n`;
                }
            });
        }
        markdownOutput += `---\n\n`;
    }

    saveCache(keywords, markdownOutput, config.cache);

    return markdownOutput;
}

module.exports = { runPipeline };
