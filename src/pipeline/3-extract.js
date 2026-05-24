const fs = require('fs');
const TurndownService = require('turndown');

// TurndownService の初期化と変換ルールの設定
const turndownService = new TurndownService({
    headingStyle: 'atx',       // # 形式の見出しを使用
    codeBlockStyle: 'fenced',  // ``` 形式のコードブロックを使用
    bulletListMarker: '-',     // リストは - 記号を使用
    hr: '---'
});

// テキストコンテンツを持たない要素を変換対象から除外します
// ※ nav/footer/header 等のサイト構造要素は除外せず、Ollamaの要約処理に委ねます
turndownService.remove(['script', 'style', 'noscript', 'iframe', 'svg']);

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
