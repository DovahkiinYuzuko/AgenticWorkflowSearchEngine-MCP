const fs = require('fs');
const config = require('../config');

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

            // ロケール（言語環境）と元URLを渡して、リンク付きのソース引用を強制する英語のプロンプトを構成します
            const prompt = `Based on the specified [Search Intent], please extract only the necessary information from the following text and summarize it concisely in the language corresponding to the system locale "${locale}".
You MUST output the result ONLY in the language of system locale "${locale}". Do not generate any extra remarks or meta-comments.
For each extracted fact, claim, or summary point, you MUST explicitly cite the corresponding heading or section from the source text and format it as a clickable Markdown link pointing to the original URL (e.g., "[Source: [Heading Name](${url}#HeadingName)]" or "According to '[Heading Name](${url}#HeadingName)', ...") to verify the source of information.

【Search Intent】
${intent}

【Original Page URL】
${url}

【Text】
${mdContent}`;

            // 設定ファイルからタイムアウト秒数（秒単位）を取得し、ミリ秒に変換して適用します（デフォルト300秒＝5分）
            const timeoutSec = (config.ollama && config.ollama.timeout) || 300;
            const timeoutMs = timeoutSec * 1000;

            // APIの呼び出しを動的な設定時間でタイムアウトさせます
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`Ollama refinement request timed out after ${timeoutSec} seconds.`)), timeoutMs)
            );

            // リクエストボディを組み立て、設定ファイルからsystemプロンプトとoptionsをマージして動的に紐付けます
            const requestBody = {
                model: config.ollama.model,
                prompt: prompt,
                stream: false,
                keep_alive: 0 // 推論処理の終了直後に、メモリ（VRAM/RAM）からモデルを完全にアンロード（解放）させます
            };

            if (config.ollama.system) {
                requestBody.system = config.ollama.system;
            }

            if (config.ollama.options) {
                requestBody.options = { ...config.ollama.options };
            }

            const fetchPromise = fetch(`${config.ollama.host}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            // タイムアウトとfetchのレースを実行します
            const response = await Promise.race([fetchPromise, timeoutPromise]);

            if (response.ok) {
                const data = await response.json();
                aiSummary = data.response;
            } else {
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
