const fs = require('fs');
const path = require('path');
const TurndownService = require('turndown');
const pdfParse = require('pdf-parse');

// TurndownService の初期化と変換ルールの設定
const turndownService = new TurndownService({
    headingStyle: 'atx',       // # 形式の見出しを使用
    codeBlockStyle: 'fenced',  // ``` 形式のコードブロックを使用
    bulletListMarker: '-',     // リストは - 記号を使用
    hr: '---'
});

// テキストコンテンツを持たない要素、およびどのサイトでも共通して使われるサイト構造部品を除外します
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

/**
 * PDFまたはHTMLからMarkdownへ変換する関数
 * @param {Object} item キャプチャ結果のオブジェクト
 * @returns {Promise<Object>} 変換されたコンテンツとパスの情報を含むオブジェクト
 */
async function extractToMarkdown(item) {
    let mdFilename = item.mdFilename || `page${item.no}_extracted.md`;
    let mdPath = path.join(item.artifactDir, mdFilename);
    let markdownContent = '';
    let title = item.title || `Page ${item.no}`;

    if (item.contentType === 'pdf') {
        let pdfData;
        let pdfParsingError = null;
        try {
            pdfData = await pdfParse(item.content);
        } catch (err) {
            pdfParsingError = err.message;
        }

        if (pdfParsingError) {
            title = `Failed to parse PDF ${item.no}`;
            markdownContent = `# ${title}\n\n**Error:** PDF parsing failed for URL: ${item.url}\n\n**Details:** ${pdfParsingError}\n\n*(This file was processed as a stub because PDF parsing failed.)*`;
            mdFilename = `page${item.no}_pdf_error.md`;
            mdPath = path.join(item.artifactDir, mdFilename);
        } else {
            const info = pdfData.info || {};
            title = info.Title && info.Title.trim() ? info.Title : `PDF Document ${item.no}`;
            const author = info.Author && info.Author.trim() ? info.Author : 'Unknown';
            
            // 連続する改行を最大2行に圧縮してクリーンアップします
            const cleanedText = pdfData.text.replace(/\n{3,}/g, '\n\n').trim();

            markdownContent = `# ${title}\n\n**Author:** ${author}\n\n${cleanedText}`;
            mdFilename = `page${item.no}_pdf_extracted.md`;
            mdPath = path.join(item.artifactDir, mdFilename);
        }
    } else {
        // turndown による HTML→Markdown 変換
        const markdownBody = turndownService.turndown(item.htmlContent);
        // 連続する改行を最大2行に圧縮してクリーンアップします
        const cleanedMarkdown = markdownBody.replace(/\n{3,}/g, '\n\n');
        markdownContent = `# ${title}\n\n${cleanedMarkdown}`;
    }

    fs.writeFileSync(mdPath, markdownContent, 'utf-8');

    return {
        markdownContent,
        title,
        mdFilename,
        mdPath
    };
}

module.exports = extractToMarkdown;
