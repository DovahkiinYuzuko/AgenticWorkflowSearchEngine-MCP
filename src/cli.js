#!/usr/bin/env node
const { runPipeline } = require("./pipeline");
const cliLogger = require("./utils/cli-logger");
const config = require("./config");

async function main() {
    const args = process.argv.slice(2);
    
    // 起動時のタイトル表示
    console.log(`
================================================================================
 Agentic Workflow Search Engine [CLI MODE]
================================================================================`);
    
    // 設定ファイルの読み込み元を最初に表示して透明性を確保します
    // (cliLoggerが未初期化の可能性があるため、ここでは直接console.logを使います)
    const configSource = config.loadedFrom || 'Defaults';
    console.log(`[i] Config Source / 設定元: ${configSource}`);

    if (args.length < 1) {
        console.log(`
[ENG] Usage (Positional):
  node src/cli.js <keywords> [intent] [limit] [final_summary]

[ENG] Usage (Flags - Recommended):
  node src/cli.js --keywords "query" --intent "intent" --limit 5 --final-summary --mode academic --deep-dive auto --no-ollama

[JPN] 使い方（位置引数）:
  node src/cli.js <検索キーワード> [検索意図] [件数制限] [最終要約フラグ: true/false]

[JPN] 使い方（フラグ指定 - 推奨）:
  node src/cli.js --keywords "キーワード" --intent "意図" --limit 5 --final-summary --mode academic --deep-dive interactive --no-ollama
        `);
        process.exit(0);
    }

    let keywords = args[0];
    let intent = args[1] || "Extract main facts, key metrics, and conclusions related to the query keywords, excluding any ads, site-wide navigation links, footers, or promotion banners. / 検索キーワードに関連する主要な事実、重要な数値、結論を網羅的に抽出し、無関係な広告、共通メニュー、フッター、プロモーション情報は徹底的に除外してください。";
    let limit = args[2] ? parseInt(args[2], 10) : undefined;
    let finalSummary = args[3] === 'true';
    let mode = 'web';
    let deepDive = 'interactive';

    let useOllama = undefined; // デフォルトはconfig.jsonに従う

    // フラグ引数のパースを追加
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--keywords' && args[i+1]) {
            keywords = args[i+1];
        } else if (args[i] === '--intent' && args[i+1]) {
            intent = args[i+1];
        } else if (args[i] === '--limit' && args[i+1]) {
            limit = parseInt(args[i+1], 10);
        } else if (args[i] === '--final-summary') {
            finalSummary = true;
        } else if (args[i] === '--mode' && args[i+1]) {
            mode = args[i+1].toLowerCase();
        } else if (args[i] === '--deep-dive' && args[i+1]) {
            deepDive = args[i+1].toLowerCase();
        } else if (args[i] === '--no-ollama') {
            useOllama = false;
        } else if (args[i] === '--use-ollama') {
            useOllama = true;
        }
    }

    // CLI用の日英併記カラーログ・プログレスを有効化します
    cliLogger.init(false);

    cliLogger.info(`Config Source / 設定元: ${config.loadedFrom}`);
    cliLogger.info(`Starting workflow... / ワークフローを開始しています...`);
    cliLogger.info(`Keywords / キーワード: "${keywords}"`);
    cliLogger.info(`Intent / 検索意図: "${intent}"`);
    cliLogger.info(`Search Mode / 検索モード: "${mode}"`);
    cliLogger.info(`Deep Dive Mode / 深掘りモード: "${deepDive}"`);
    cliLogger.info(`Final Summary / 最終要約: ${finalSummary}`);

    try {
        const resultMarkdown = await runPipeline(keywords, intent, limit, finalSummary, mode, deepDive, useOllama);

        console.log("\n");
        console.log("================================================================================");        
        console.log("WORKFLOW RESULT SUMMARY / ワークフロー実行結果サマリー");
        console.log("================================================================================");        
        console.log(resultMarkdown);
        console.log("================================================================================");        
        cliLogger.success(`Workflow completed successfully! / ワークフローが正常に完了しました！`);
        process.exit(0);
    } catch (error) {
        cliLogger.error(`Workflow failed: ${error.message} / ワークフローの実行に失敗しました: ${error.message}`, error);
        process.exit(1);
    }
}

main();
