#!/usr/bin/env node
const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const { runPipeline } = require("./pipeline");
const fs = require("fs/promises");
const path = require("path");
const cliLogger = require("./utils/cli-logger");

// MCPサーバー起動時は StdOut や StdErr の雑多な出力を完全に停止して通信を守ります
cliLogger.init(true);

const server = new Server(
    {
        name: "agentic-workflow-search-engine-mcp",
        version: "1.3.0",
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

// リソース一覧の提供
server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const artifactsDir = path.join(process.cwd(), 'artifacts');
    const resources = [];
    
    async function scanDir(dir) {
        try {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    await scanDir(fullPath);
                } else if (entry.isFile() && entry.name === 'index.csv') {
                    const relativePath = path.relative(process.cwd(), fullPath);
                    const parts = relativePath.split(path.sep);
                    const keyword = parts[1]; // artifactsの次のディレクトリ名をキーワードとして取得
                    const uri = `mcp://artifacts/${encodeURIComponent(keyword)}/index.csv`;
                    resources.push({
                        uri,
                        name: `CSV Index - ${keyword}`,
                        description: `CSV index table containing mapping and topics for search results of "${keyword}"`,
                        mimeType: 'text/csv'
                    });
                }
            }
        } catch (e) {
            // ディレクトリが存在しない等のエラーは無視して空配列を返す
        }
    }
    
    await scanDir(artifactsDir);
    return { resources };
});

// リソースの読み込みハンドラ
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;
    
    if (uri.startsWith('mcp://artifacts/')) {
        let relativePath = uri.replace('mcp://artifacts/', '');
        relativePath = decodeURIComponent(relativePath);
        
        const artifactsDir = path.join(process.cwd(), 'artifacts');
        
        // ディレクトリトラバーサル対策
        const safeRelativePath = path.normalize(relativePath).replace(/^(\.\.(\/|\\))+/, '');
        const filePath = path.join(artifactsDir, safeRelativePath);
        
        // セキュリティ検証: 絶対に artifactsDir の配下にあること
        if (!filePath.startsWith(artifactsDir)) {
            throw new Error(`Unauthorized resource access: ${uri}`);
        }
        
        // 許可する拡張子の制限
        if (!filePath.endsWith('.md') && !filePath.endsWith('.csv')) {
            throw new Error(`Unsupported resource type. Only .md and .csv are allowed: ${uri}`);
        }
        
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            return {
                contents: [
                    {
                        uri,
                        mimeType: filePath.endsWith('.csv') ? 'text/csv' : 'text/markdown',
                        text: content
                    }
                ]
            };
        } catch (e) {
            throw new Error(`Failed to read resource: ${uri}`);
        }
    }
    
    throw new Error(`Unknown resource URI: ${uri}`);
});

// ツール一覧の提供
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "search_and_extract",
                description: "[ENG] Highly autonomous research pipeline. Crawls web pages using Playwright, renders them to PDFs, extracts clean markdown, and uses a local Ollama model to dynamically refine, filter, and structure information based on your search intent. If blocked by CAPTCHAs, it automatically falls back to clean, scrape-free arXiv and PubMed APIs. After completion, a dynamic index mapping table is created under the custom resource URI `mcp://artifacts/{keyword}/index.csv` for physical pin-point raw text tracking. / [JPN] 高度に自律的な多段階検索・抽出パイプライン。PlaywrightでWebページを巡回しPDFレンダリングのうえノイズを除去した綺麗なMarkdownを生成し、ローカルOllamaを用いて『検索意図 (intent)』に合致する客観的事実のみを構造化・要約します。CAPTCHA（ロボット検証）等でクロールがブロックされた場合は、自動的にAPI経由の論文検索（arXiv / PubMed）へフォールバックします。完了後は、カスタムリソースURI `mcp://artifacts/{キーワード}/index.csv` 経由で、生成された各ページの生テキストファイルへの逆引き物理ピン留めアクセスが可能です。",
                inputSchema: {
                    type: "object",
                    properties: {
                        keywords: {
                            type: "string",
                            description: "[ENG] Target query keywords. Multiple terms should be space-separated. (e.g. 'quantum computing practical use 2026') / [JPN] 検索キーワードを入力します。複数ワードは半角スペースで区切ります（例：『量子コンピューター 実用化 2026』）。"    
                        },
                        intent: {
                            type: "string",
                            description: "[ENG] Specific extraction intent. Instruct precisely what details to extract, filter, and structure, and what to ignore. (e.g. 'Extract company roadmap milestones, expected release years, and discard any advertisements or promotions') / [JPN] 具体的な情報抽出の意図・目的を入力します。何に注目して情報を抽出し、何を無視すべきかをAIエージェントに向けて明確に指示してください（例：『企業別のロードマップのマイルストーンと実用化予定時期のみを抽出し、無関係な広告やプロモーションは徹底的に除外する』）。"
                        },
                        limit: {
                            type: "number",
                            description: "[ENG] Maximum number of search results to visit and process. (default: 5) / [JPN] 検索結果から実際に巡回・クローリングする最大件数（デフォルト5件）。",
                            default: 5
                        },
                        final_summary: {
                            type: "boolean",
                            description: "[ENG] Whether to generate a single comprehensive synthesized summary crossing all crawled pages. (default: false) / [JPN] 全ページの個別抽出が終わった後に、全体の情報を総合した最終回答まとめレポートを生成するかどうか（デフォルト: false）。",
                            default: false
                        },
                        mode: {
                            type: "string",
                            description: "[ENG] The search engine mode. 'web' (crawls using dynamic browser) or 'academic' (uses PubMed & arXiv APIs, bypasses scraping). (default: 'web') / [JPN] 検索の実行モード。『web』はPlaywrightを用いた通常のWebクローリング、『academic』は公式APIを叩く論文検索（スクレイピングが発生しないため安全かつ高速です）。",
                            default: "web",
                            enum: ["web", "academic"]
                        },
                        deep_dive: {
                            type: "string",
                            description: "[ENG] Autonomous multi-phase research depth. 'auto' (AI autonomously evaluates primary findings and executes a secondary search if needed) or 'none' (disables auto-search but recommends follow-up terms). (default: 'auto') / [JPN] 二段階検索（深掘り）の挙動。『auto』（一次結果をAI自身が評価し、未解決項目について自動で二次検索を実行）、『none』（自律検索を無効化し、推奨検索ワードの提示に留める）。",
                            default: "auto",
                            enum: ["auto", "none"]
                        }
                    },
                    required: ["keywords", "intent"]
                }
            }
        ]
    };
});

// ツールの実行ハンドラ
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === "search_and_extract") {
        if (!args || !args.keywords || !args.intent) {
            return {
                isError: true,
                content: [
                    {
                        type: "text",
                        text: "Error: Missing required arguments. Both 'keywords' and 'intent' must be provided. / エラー: 必須パラメーターが不足しています。 'keywords' と 'intent' の両方を指定してください。"
                    }
                ]
            };
        }

        const keywords = args.keywords;
        const intent = args.intent;
        const limit = args.limit || 5;
        const final_summary = args.final_summary || false;
        const mode = args.mode || "web";
        const deep_dive = args.deep_dive || "auto";

        try {
            // パイプラインを実行し、返ってきた統合Markdownテキストをそのまま親AIに返します
            const resultMarkdown = await runPipeline(keywords, intent, limit, final_summary, mode, deep_dive);
            return {
                content: [
                    {
                        type: "text",
                        text: resultMarkdown
                    }
                ]
            };
        } catch (error) {
            return {
                isError: true,
                content: [
                    {
                        type: "text",
                        text: `An error occurred during workflow execution: ${error.message} / ワークフローの実行中にエラーが発生しました: ${error.message}`
                    }
                ]
            };
        }
    }

    throw new Error(`Unknown tool: ${name} / 未知のツールです: ${name}`);
});

async function runServer() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Agentic Workflow Search Engine MCP Server has started successfully. / Agentic Workflow Search Engine MCP Server が正常に起動しました。");
}

runServer().catch((error) => {
    console.error("Failed to start the server: / サーバーの起動に失敗しました:", error);
    process.exit(1);
});
