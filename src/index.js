const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const { runPipeline } = require("./pipeline");
const cliLogger = require("./utils/cli-logger");

// MCPサーバー起動時は StdOut や StdErr の雑多な出力を完全に停止して通信を守ります
cliLogger.init(true);

const server = new Server(
    {
        name: "agentic-workflow-search-engine-mcp",
        version: "1.2.0",
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

// ツール一覧の提供
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "search_and_extract",
                description: "[ENG] Web search by keywords, capture PDFs, convert to Markdown, and dynamically refine information based on search intent via local Ollama. / [JPN] キーワードでWeb検索し、PDF保存、Markdown変換したのち、ローカルOllamaを用いて検索意図（intent）に沿って情報を動的に取捨選択・要約します。",
                inputSchema: {
                    type: "object",
                    properties: {
                        keywords: {
                            type: "string",
                            description: "[ENG] Search query keywords. / [JPN] 検索キーワードを入力します。"
                        },
                        intent: {
                            type: "string",
                            description: "[ENG] Dynamic search intent or criteria to extract information. (e.g. 'extract ticket price and dates') / [JPN] この検索で『どういう情報を取捨選択して整理してほしいか』という具体的な意図や目的を入力します（例：『ツアー日程とチケット価格の抽出』）。"
                        },
                        limit: {
                            type: "number",
                            description: "[ENG] Maximum number of pages to process. (default: 5) / [JPN] 処理する最大件数（デフォルト5件）",
                            default: 5
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
        const keywords = args.keywords;
        const intent = args.intent;
        const limit = args.limit || 5;
        
        try {
            // パイプラインを実行し、返ってきた統合Markdownテキストをそのまま親AIに返します
            const resultMarkdown = await runPipeline(keywords, intent, limit);
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
