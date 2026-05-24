const fs = require('fs');
const config = require('../config');
const { broadcast } = require('../utils/streaming-server');

// MarkdownからJSONへの構造化関数（システムロケールに基づく多言語動的要約、およびメモリ自動解放に対応しました）
// 案A対応: pdfPath引数を削除 (PDFファイルの生成を廃止したため)
async function markdownToJson(mdContent, mdPath, url, title, jsonPath, intent) {
    const lines = mdContent.split('\n');
    const sections = [];
    let currentHeading = 'Introduction';
    let currentContent = [];
    
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('#')) {
            if (currentContent.length > 0 || currentHeading !== 'Introduction') {
                sections.push({
                    heading: currentHeading,
                    content: currentContent.join('\n').trim()
                });
            }
            currentHeading = trimmed.replace(/^#+\s*/, '');
            currentContent = [];
        } else {
            currentContent.push(line);
        }
    }
    
    if (currentContent.length > 0 || currentHeading !== 'Introduction') {
        sections.push({
            heading: currentHeading,
            content: currentContent.join('\n').trim()
        });
    }
    
    let aiSummary = null;
    
    // Ollamaが有効化されており、かつ検索意図（intent）が指定されている場合、動的に取捨選択抽出を実行します
    if (config.ollama && config.ollama.enabled && intent) {
        try {
            // プロセスのシステムロケール（"ja-JP", "en-US", "zh-CN"など）を自動検知します
            const locale = Intl.DateTimeFormat().resolvedOptions().locale;

            // maxInputChars が正の値の場合のみ入力テキストを切り詰めます (-1 は無制限)
            const maxChars = (config.ollama.maxInputChars && config.ollama.maxInputChars > 0)
                ? config.ollama.maxInputChars
                : -1;
            const inputText = maxChars > 0 ? mdContent.slice(0, maxChars) : mdContent;

            // ロケール（言語環境）と元URLを渡して、リンク付きのソース引用を強制する英語のプロンプトを構成します
            const prompt = `Based on the specified [Search Intent], please extract only the necessary information from the following text and summarize it concisely in the language corresponding to the system locale "${locale}".
You MUST output the result ONLY in the language of system locale "${locale}". Do not generate any extra remarks or meta-comments.
For each extracted fact, claim, or summary point, you MUST explicitly cite the corresponding heading or section from the source text and format it as a clickable Markdown link pointing to the original URL (e.g., "[Source: [Heading Name](${url}#HeadingName)]" or "According to '[Heading Name](${url}#HeadingName)', ...") to verify the source of information.

【Search Intent】
${intent}

【Original Page URL】
${url}

【Text】
${inputText}`;

            // 設定ファイルからタイムアウト秒数（秒単位）を取得し、ミリ秒に変換して適用します（デフォルト300秒＝5分）
            const timeoutSec = (config.ollama && config.ollama.timeout) || 300;
            const timeoutMs = timeoutSec * 1000;

            // AbortController でタイムアウトをストリーミング全体にかけます
            // (Promise.race と異なり、接続確立後のストリーミング読み取り中も有効です)
            const controller = new AbortController();
            const timeoutId = setTimeout(
                () => controller.abort(new Error(`Ollama refinement request timed out after ${timeoutSec} seconds.`)),
                timeoutMs
            );

            // リクエストボディを組み立て、設定ファイルからsystemプロンプトとoptionsをマージして動的に紐付けます
            const requestBody = {
                model: config.ollama.model,
                prompt: prompt,
                stream: true, // ストリーミングを有効化します
                keep_alive: -1 // パイプライン実行中はモデルをメモリ（VRAM/RAM）に保持し続けます（-1: 無期限）
            };

            if (config.ollama.system) {
                requestBody.system = config.ollama.system;
            }

            if (config.ollama.options) {
                requestBody.options = { ...config.ollama.options };
            }

            const response = await fetch(`${config.ollama.host}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
                signal: controller.signal // AbortController のシグナルを渡してストリーム全体を管理します
            });

            if (response.ok) {
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                aiSummary = '';
                let buffer = '';
                
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) {
                        if (buffer.trim()) {
                            try {
                                const data = JSON.parse(buffer);
                                if (data.response) {
                                    aiSummary += data.response;
                                    broadcast(data.response);
                                }
                            } catch (e) {
                                // 最後の不完全なバッファは無視
                            }
                        }
                        break;
                    }
                    
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    
                    buffer = lines.pop(); // 最後の要素（不完全かもしれない行）をバッファに残す
                    
                    for (const line of lines) {
                        if (!line.trim()) continue;
                        try {
                            const data = JSON.parse(line);
                            if (data.response) {
                                aiSummary += data.response;
                                // 各チャンクの内容をブロードキャストしてリアルタイムにリレーします
                                broadcast(data.response);
                            }
                            if (data.done) break;
                        } catch (e) {
                            // 不完全なJSON行の場合はスキップ
                        }
                    }
                }
                // ストリーミングが正常完了した場合、タイムアウトタイマーをクリアします
                clearTimeout(timeoutId);
            } else {
                clearTimeout(timeoutId);
                console.error(`Ollama API error occurred. Status code: ${response.status} / Ollama API エラーが発生しました。ステータスコード: ${response.status}`);
            }
        } catch (error) {
            console.error(`[WARNING] Failed to refine content via Ollama: ${error.message} / Ollamaによる情報抽出の実行中にエラーが発生またはタイムアウトしました: ${error.message}`);
        }
    }
    
    const resultJson = {
        title: title,
        url: url,
        markdownPath: mdPath,
        sections: sections,
        aiSummary: aiSummary,
        rawMarkdown: mdContent
    };
    
    fs.writeFileSync(jsonPath, JSON.stringify(resultJson, null, 2), 'utf-8');
    return resultJson;
}

module.exports = markdownToJson;
