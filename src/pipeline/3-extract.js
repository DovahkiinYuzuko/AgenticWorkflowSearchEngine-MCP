const fs = require('fs');
const TurndownService = require('turndown');

// TurndownService の初期化と変換ルールの設定
const turndownService = new TurndownService({
    headingStyle: 'atx',       // # 形式の見出しを使用
    codeBlockStyle: 'fenced',  // ``` 形式のコードブロックを使用
    bulletListMarker: '-',     // リストは - 記号を使用
    hr: '---'
});

// テキストコンテンツを持たない要素、およびどのサイトでも共通して使われるサイト構造部品を除外します
// ※ header はページのみならず記事タイトルも含む場合があるため、意図的に除外しません
turndownService.remove([
    // 非テキスト系 (スクリプト・スタイル・埋め込み)
    'script', 'style', 'noscript', 'iframe', 'svg',
    // サイト共通構造部品 (どのサイトでも本文とは無関係)
    'nav',    // ナビゲーションバー
    'footer', // フッター (著作権表示・リンク集等)
    'aside',  // サイドバー
    'form',   // お問い合わせフォーム・検索ボックス等
    'button', // UIボタン
]);

// HTMLからMarkdownへの変換関数 (案A: PDF変換を廃止し、ページのHTMLを直接変換します)
async function htmlToMarkdown(htmlContent, mdPath, title) {
    // turndown による HTML→Markdown 変換 (追加リクエストなし、メモリ上のデータのみ使用)
    const markdownBody = turndownService.turndown(htmlContent);

    // 連続する改行を最大2行に圧縮してクリーンアップします
    const cleanedMarkdown = markdownBody.replace(/\n{3,}/g, '\n\n');

    const markdownContent = `# ${title}\n\n${cleanedMarkdown}`;
    fs.writeFileSync(mdPath, markdownContent, 'utf-8');

    return markdownContent;
}

module.exports = htmlToMarkdown;
