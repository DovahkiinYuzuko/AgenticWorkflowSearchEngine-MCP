#!/usr/bin/env node
const { runPipeline } = require("./pipeline");
const cliLogger = require("./utils/cli-logger");

async function main() {
    const args = process.argv.slice(2);
    
    if (args.length < 1) {
        console.log(`
================================================================================
🤖 Agentic Workflow Search Engine [CLI MODE]
================================================================================

[ENG] Usage:
  node src/cli.js <keywords> [intent] [limit] [final_summary]

  - keywords : Search query keywords (Required)
  - intent   : Search intent or extraction criteria (Optional)
               (Default: Extract main facts and conclusions, excluding ads/navigation.)
  - limit    : Max number of pages to capture (Optional, Default: 5)
  - final_summary : Generate a final summary (Optional, Default: false, set to 'true' to enable)

[JPN] 使い方:
  node src/cli.js <検索キーワード> [検索意図] [最大件数] [最終要約生成]

  - 検索キーワード : 検索したいキーワード（必須）
  - 検索意図       : 抽出したい情報や取捨選択の基準（任意）
                     （省略時: 広告や共通メニューを除外した主要な事実と結論の抽出）
  - 最大件数       : 処理する最大ページ数（任意、デフォルト5件）
  - 最終要約生成   : 全ページを統合した最終要約を生成するか（任意、デフォルト: false、'true'で有効）

[ENG] Example:
  node src/cli.js "Banksy" "Extract exhibition schedule and ticket prices" 3 true
[JPN] 実行例:
  node src/cli.js "バンクシー" "展示会のスケジュールとチケット価格の抽出" 3 true

================================================================================
        `);
        process.exit(0);
    }

    const keywords = args[0];
    // 第2引数のintentが省略された場合は、汎用的な抽出基準を自動でバインドします
    const intent = args[1] || "Extract main facts, key metrics, and conclusions related to the query keywords, excluding any ads, site-wide navigation links, footers, or promotion banners. / 検索キーワードに関連する主要な事実、重要な数値、結論を網羅的に抽出し、無関係な広告、共通メニュー、フッター、プロモーション情報は徹底的に除外してください。";
    const limit = args[2] ? parseInt(args[2], 10) : undefined;
    const finalSummary = args[3] === 'true';

    // CLI用の日英併記カラーログ・プログレスを有効化します
    cliLogger.init(false);

    cliLogger.info(`Starting workflow... / ワークフローを開始しています...`);
    cliLogger.info(`Keywords / キーワード: "${keywords}"`);
    cliLogger.info(`Intent / 検索意図: "${intent}"`);
    cliLogger.info(`Final Summary / 最終要約: ${finalSummary}`);

    try {
        const resultMarkdown = await runPipeline(keywords, intent, limit, finalSummary);

        console.log("\n");
        console.log("================================================================================");        
        console.log("📊 WORKFLOW RESULT SUMMARY / ワークフロー実行結果サマリー");
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
