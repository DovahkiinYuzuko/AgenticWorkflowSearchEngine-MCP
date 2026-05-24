const config = require('../config');
const { broadcast } = require('../utils/streaming-server');

/**
 * 全ページの抽出結果を統合して、ユーザーの検索意図に対する最終的な回答を生成するよ！
 * 
 * @param {Array} results パイプラインで処理された各ページの結果（aiSummaryを含む）
 * @param {string} intent ユーザーの元の検索意図
 * @returns {Promise<string|null>} 生成された最終サマリー、失敗した場合はnull
 */
async function generateFinalSummary(results, intent) {
    if (!config.ollama || !config.ollama.enabled || !intent) {
        return null;
    }

    // 有効なサマリーだけを抽出
    const validSummaries = results
        .filter(res => res.aiSummary)
        .map((res, index) => `【Source ${index + 1}: ${res.title}】\n${res.aiSummary}`)
        .join('\n\n');

    if (validSummaries.length === 0) {
        return null;
    }

    try {
        const locale = Intl.DateTimeFormat().resolvedOptions().locale;
        
        // 最終まとめ用のプロンプトを構築
        const prompt = `You are a professional research assistant. Based on the following "Search Intent" and the "Summaries" extracted from multiple sources, please provide a comprehensive and definitive answer.

【Search Intent】
${intent}

【Summaries from Sources】
${validSummaries}

【Instructions】
1. Synthesize all information to provide a clear, structured, and comprehensive answer that directly addresses the Search Intent.
2. If there are conflicting informations between sources, mention them clearly.
3. You MUST output the result ONLY in the language of system locale "${locale}".
4. Maintain the source citations (e.g., [Source: [Heading Name](URL#Anchor)]) where possible to ensure traceability.
5. Do not include any introductory phrases like "Here is the summary" or "Based on the provided information". Start directly with the answer.`;

        // Ollama Viewerにフェーズの切り替えを通知
        broadcast(`\n\n--- Generating Final Comprehensive Answer / 最終回答を生成中... ---\n\n`);

        const requestBody = {
            model: config.ollama.model,
            prompt: prompt,
            stream: true,
            keep_alive: -1
        };

        if (config.ollama.system) {
            requestBody.system = config.ollama.system;
        }

        if (config.ollama.options) {
            requestBody.options = { ...config.ollama.options };
        }

        const timeoutSec = config.ollama.timeout || 300;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutSec * 1000);

        const response = await fetch(`${config.ollama.host}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`Ollama API error: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let finalSummary = '';
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const data = JSON.parse(line);
                    if (data.response) {
                        finalSummary += data.response;
                        // リアルタイムでViewerにブロードキャスト
                        broadcast(data.response);
                    }
                    if (data.done) break;
                } catch (e) {
                    // Ignore malformed JSON
                }
            }
        }

        return finalSummary;

    } catch (error) {
        console.error(`[WARNING] Failed to generate final summary via Ollama: ${error.message}`);
        return null;
    }
}

module.exports = generateFinalSummary;
