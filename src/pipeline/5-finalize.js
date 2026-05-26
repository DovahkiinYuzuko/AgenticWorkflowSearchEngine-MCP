const fs = require('fs');
const path = require('path');
const config = require('../config');
const { broadcast } = require('../utils/streaming-server');

/**
 * Ollama APIを呼び出し、ストリーミングで応答を取得する共通ヘルパー
 */
async function callOllamaStreaming(prompt, onChunk) {
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
    let resultText = '';
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
                    resultText += data.response;
                    if (onChunk) onChunk(data.response);
                }
                if (data.done) break;
            } catch (e) {}
        }
    }

    return resultText;
}

/**
 * セッション1: ソース間のファクトチェック＆対立分析を生成する
 */
async function generateFactCheck(validSummaries, intent, locale) {
    const prompt = `You are a professional research evaluator. Based on the following "Search Intent" and the "Summaries" extracted from multiple sources, please perform an objective Fact-Checking and Contrast Analysis across these sources.
Identify:
1. Consensus Points: What claims do the sources agree on?
2. Contradictions & Conflicts: What claims are mismatched, in conflict, or contradictory?
3. Unverified or Biased Claims: What claims are highly subjective, isolating, commercially biased (advertising), or lack objective evidence?

You MUST output the result ONLY in the language corresponding to the system locale "${locale}".
Do not include any introductory remarks, greetings, or meta-comments. Start directly with the markdown.
Use the following exact Markdown structure:

## Fact-Checking & Contrast Analysis (論点対立・合意の分析)

### 🤝 Consensus Points (各ソースで一致している見解)
(List consensus points with clickable citations pointing to the source URL)

### ⚡ Contradictions & Conflicts (主張が対立している論点)
(List contradictions and conflicts between sources, explaining the differences)

### ⚠️ Unverified or Biased Claims (注意すべき主張・広告的な表現)
(List highly subjective or potentially biased/commercial claims from the text)

【Search Intent】
${intent}

【Summaries from Sources】
${validSummaries}`;

    broadcast({ type: 'info', value: `\n\n--- Session 1: Generating Fact-Checking & Contrast Analysis / ファクトチェックを生成中... ---\n\n` });
    return await callOllamaStreaming(prompt, (text) => broadcast({ type: 'token', value: text }));
}

/**
 * セッション2: 検索意図に対する包括的な総合要約を生成する
 */
async function generateComprehensiveSummary(validSummaries, intent, locale, csvIndexContent, keyword) {
    const prompt = `You are a professional research compiler. Based on the following "Search Intent", the "Summaries" extracted from multiple sources, and the provided "CSV Index", please synthesize a comprehensive, cohesive, and deeply structured objective answer.
Focus ONLY on answering the Search Intent in a highly logical and clear structure. Remove redundant details.

You MUST output the result ONLY in the language corresponding to the system locale "${locale}".
Do not include any introductory remarks, greetings, or meta-comments. Start directly with the markdown.
Use the following exact Markdown structure:

## Comprehensive Synthesis (総合的な検索意図への回答)
(Provide a clear, structured, and deep summary that directly addresses the overall Search Intent, integrating facts from the sources with clickable citations)

## Physical Reference Table (物理ピン打ち逆引き参照テーブル)
(At the end of your response, strictly based on the provided CSV Index, generate a markdown table mapping the key facts used in your answer to their exact File, Heading, Line Range, and an MCP Resource Link. This acts as a highly reliable Fact-Checking index.
Format example: 
| Fact / Topic | File | Heading | Line Range | Resource Link | Source URL |
|---|---|---|---|---|---|
| (Fact description) | pageX_extracted.md | ## (Heading) | (LineRange) | [Read](mcp://artifacts/${encodeURIComponent(keyword)}/pageX_extracted.md) | [(URL)] |
)

【Search Intent】
${intent}

【Summaries from Sources】
${validSummaries}

【CSV Index of Source Files】
${csvIndexContent || '(No CSV Index available)'}`;

    broadcast({ type: 'info', value: `\n\n--- Session 2: Generating Comprehensive Synthesis / 総合サマリーを生成中... ---\n\n` });
    return await callOllamaStreaming(prompt, (text) => broadcast({ type: 'token', value: text }));
}

/**
 * 最終成果物のオーケストレーション (セッション分離・最後は単純連結するハイブリッド設計)
 */
async function generateFinalSummary(results, intent) {
    if (!config.ollama || !config.ollama.enabled || !intent) {
        return null;
    }

    const validSummaries = results
        .filter(res => res.aiSummary)
        .map((res, index) => `【Source ${index + 1}: ${res.title}】(URL: ${res.url})\n${res.aiSummary}`)
        .join('\n\n');

    if (validSummaries.length === 0) {
        return null;
    }

    try {
        const locale = Intl.DateTimeFormat().resolvedOptions().locale;

        // index.csv の読み込みとキーワードの取得
        let csvIndexContent = '';
        let keyword = '';
        if (results.length > 0 && results[0].markdownPath) {
            const artifactsDir = path.dirname(results[0].markdownPath);
            keyword = path.basename(artifactsDir);
            const csvPath = path.join(artifactsDir, 'index.csv');
            if (fs.existsSync(csvPath)) {
                csvIndexContent = fs.readFileSync(csvPath, 'utf-8');
            }
        }

        // セッション1とセッション2を個別に実行し、シングルタスクで極限の思考精度を出す！
        const factCheckOutput = await generateFactCheck(validSummaries, intent, locale);
        const synthesisOutput = await generateComprehensiveSummary(validSummaries, intent, locale, csvIndexContent, keyword);

        // 最後に単純連結（Join）して1つの完璧なレポートに仕上げる
        const finalReport = `${factCheckOutput}\n\n---\n\n${synthesisOutput}`;
        return finalReport;

    } catch (error) {
        console.error(`[WARNING] Failed to generate final multi-session summary: ${error.message}`);
        return null;
    }
}

module.exports = generateFinalSummary;
