const fs = require('fs');
const config = require('../config');
const { broadcast } = require('../utils/streaming-server');

/**
 * Ollama APIを呼び出し、ストリーミングで応答を取得する共通ヘルパー
 */
async function callOllamaStreaming(prompt, url, intent, onChunk) {
    const timeoutSec = (config.ollama && config.ollama.timeout) || 300;
    const timeoutMs = timeoutSec * 1000;

    const controller = new AbortController();
    const timeoutId = setTimeout(
        () => controller.abort(new Error(`Ollama request timed out after ${timeoutSec} seconds.`)),
        timeoutMs
    );

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

    let resultText = '';
    const response = await fetch(`${config.ollama.host}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal
    });

    if (!response.ok) {
        clearTimeout(timeoutId);
        throw new Error(`Ollama API error: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            if (buffer.trim()) {
                try {
                    const data = JSON.parse(buffer);
                    if (data.response) {
                        resultText += data.response;
                        if (onChunk) onChunk(data.response);
                    }
                } catch (e) {}
            }
            break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
            if (!line.trim()) continue;
            try {
                const data = JSON.parse(line);
                if (data.response) {
                    resultText += data.response;
                    if (onChunk) onChunk(data.response);
                }
                if (data.done) break;
            } catch (e) {}
        }
    }

    clearTimeout(timeoutId);
    return resultText;
}

// MarkdownからJSONへの構造化関数（システムロケールに基づく多言語動的要約、およびメモリ自動解放に対応しました）
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
    
    if (config.ollama && config.ollama.enabled && intent) {
        try {
            const locale = Intl.DateTimeFormat().resolvedOptions().locale;

            // 1. 動的な見出し境界でのチャンク分割 (Max 8000 characters)
            const maxChunkSize = 8000;
            const chunks = [];
            let currentChunkText = '';

            for (const section of sections) {
                const sectionText = `\n# ${section.heading}\n${section.content}\n`;
                if (currentChunkText.length + sectionText.length > maxChunkSize && currentChunkText.length > 0) {
                    chunks.push(currentChunkText);
                    currentChunkText = sectionText;
                } else {
                    currentChunkText += sectionText;
                }
            }
            if (currentChunkText.length > 0) {
                chunks.push(currentChunkText);
            }

            // maxInputChars が正の値の場合のみ入力テキストを切り詰めます（あえて制限する場合のみ）
            const maxChars = (config.ollama.maxInputChars && config.ollama.maxInputChars > 0)
                ? config.ollama.maxInputChars
                : -1;
            
            if (maxChars > 0) {
                chunks.length = 0;
                chunks.push(mdContent.slice(0, maxChars));
            }

            if (chunks.length === 1) {
                // チャンクが1つの場合は通常どおり実行
                const prompt = `Based on the specified [Search Intent], please extract only the necessary information from the following text and summarize it concisely in the language corresponding to the system locale "${locale}".
You MUST output the result ONLY in the language of system locale "${locale}". Do not generate any extra remarks or meta-comments.
For each extracted fact, claim, or summary point, you MUST explicitly cite the corresponding heading or section from the source text and format it as a clickable Markdown link pointing to the original URL (e.g., "[Source: [Heading Name](${url}#HeadingName)]" or "According to '[Heading Name](${url}#HeadingName)', ...") to verify the source of information.

【Search Intent】
${intent}

【Original Page URL】
${url}

【Text】
${chunks[0]}`;

                aiSummary = await callOllamaStreaming(prompt, url, intent, (text) => {
                    broadcast(text);
                });
            } else if (chunks.length > 1) {
                // 複数チャンクがある場合は MapReduce 方式で要約
                console.log(`\n[MapReduce] Splitting long document into ${chunks.length} chunks...`);
                const partialSummaries = [];

                for (let i = 0; i < chunks.length; i++) {
                    broadcast(`\n\n--- Refining Chunk ${i + 1}/${chunks.length} / 部分要約を生成中 (${i + 1}/${chunks.length}) ---\n\n`);
                    
                    const mapPrompt = `Based on the specified [Search Intent], please extract only the necessary information from the following portion of the text and summarize it concisely in the language corresponding to the system locale "${locale}".
You MUST output the result ONLY in the language of system locale "${locale}". Do not generate any extra remarks or meta-comments.
For each extracted fact, claim, or summary point, you MUST explicitly cite the corresponding heading or section from the source text and format it as a clickable Markdown link pointing to the original URL (e.g., "[Source: [Heading Name](${url}#HeadingName)]" or "According to '[Heading Name](${url}#HeadingName)', ...") to verify the source of information.

【Search Intent】
${intent}

【Original Page URL】
${url}

【Text Portion】
${chunks[i]}`;

                    const partialSummary = await callOllamaStreaming(mapPrompt, url, intent, (text) => {
                        broadcast(text);
                    });
                    
                    if (partialSummary.trim()) {
                        partialSummaries.push(partialSummary);
                    }
                }

                // Reduceフェーズ: 部分要約の統合・再要約
                broadcast(`\n\n--- Synthesizing Chunk Summaries / 部分要約を統合・再要約中... ---\n\n`);
                
                const combinedPartials = partialSummaries.map((ps, idx) => `【Chunk ${idx + 1} Summary】\n${ps}`).join('\n\n');
                
                const reducePrompt = `You are a professional research assistant. Based on the specified [Search Intent], please synthesize the following partial summaries extracted from different parts of a long document into a single cohesive, structured, and comprehensive final summary.
You MUST output the result ONLY in the language of system locale "${locale}". Do not generate any extra remarks or meta-comments.
You MUST preserve all source citations and clickable Markdown links (e.g., [Source: [Heading Name](${url}#HeadingName)]) from the partial summaries. Remove duplicate points and reorganize the structure to be perfectly readable.

【Search Intent】
${intent}

【Original Page URL】
${url}

【Partial Summaries】
${combinedPartials}`;

                aiSummary = await callOllamaStreaming(reducePrompt, url, intent, (text) => {
                    broadcast(text);
                });
            }
        } catch (error) {
            console.error(`[WARNING] Failed to refine content via Ollama: ${error.message}`);
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
