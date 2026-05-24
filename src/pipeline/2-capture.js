const path = require('path');
const fs = require('fs');
const sleep = require('../utils/sleep');
const config = require('../config');
const sanitizeFolderName = require('../utils/sanitize');

// ページのタイトルを安全に取得するヘルパー
async function newPageTitle(page) {
    try {
        return await page.title();
    } catch {
        return "Untitled Page";
    }
}

// 1件のURLを処理する内部ヘルパー (並列実行の単位)
async function processUrl(headedContext, no, url, artifactDir) {
    const headedPage = await headedContext.newPage();

    try {
        const response = await headedPage.goto(url, { timeout: 60000, waitUntil: 'domcontentloaded' });

        // PDFの判定
        let contentType = '';
        try {
            contentType = response?.headers?.()?.['content-type'] || '';
        } catch (e) {
            // response.headers() is not always available in mocks or some scenarios
        }

        if (contentType && contentType.includes('application/pdf')) {
            const pdfBuffer = await response.body();

            // PDFのマジックナンバー確認 (%PDF-)
            const isActuallyPdf = pdfBuffer.length > 4 && 
                                pdfBuffer[0] === 0x25 && // %
                                pdfBuffer[1] === 0x50 && // P
                                pdfBuffer[2] === 0x44 && // D
                                pdfBuffer[3] === 0x46 && // F
                                pdfBuffer[4] === 0x2d;   // -

            if (isActuallyPdf) {
                const filename = `page${no}_download.pdf`;
                const pdfPath = path.join(artifactDir, filename);
                
                fs.writeFileSync(pdfPath, pdfBuffer);

                await headedPage.close();
                return {
                    no,
                    url,
                    contentType: 'pdf',
                    content: pdfBuffer,
                    pdfPath,
                    artifactDir
                };
            } else {
                // PDFとして宣言されているが中身がPDFでない場合（エラーページなど）
                // HTMLとして処理を続行するためにフラグを立てるか、そのままHTML取得へ流す
                console.warn(`[Warning] URL ${no} is declared as PDF but does not have a valid PDF signature. Falling back to HTML parsing.`);
            }
        }

        const rawTitle = await newPageTitle(headedPage);
        const normalizedTitle = rawTitle.replace(/[\\/:*?"<>|]/g, "");

        // 除外パターンの確認
        const ignorePatterns = ['/video', '/images', '/search', '/shop', '/news', '/maps', '/translate', '/weather', '/sports', '/finance', '/entertainment'];
        if (ignorePatterns.some(pattern => url.includes(pattern))) {
            await headedPage.close();
            return { no, url, skipped: true, reason: "除外対象のURLパターンです" };
        }

        // HTMLコンテンツをメモリ上から直接取得します (追加のサーバーリクエストは発生しません)
        const htmlContent = await headedPage.content();

        // ユーザーに閲覧時間を設けた後にタブを閉じます
        await sleep(config.search.viewTime);
        await headedPage.close();

        const baseFilename = `page${no}_${normalizedTitle}`;

        return {
            no,
            url,
            title: rawTitle,
            contentType: 'html',
            htmlContent,
            artifactDir,
            mdFilename: `${baseFilename}.md`,
            jsonFilename: `${baseFilename}.json`
        };
    } catch (error) {
        // エラー発生時も確実にページを閉じます
        try { await headedPage.close(); } catch {}
        return { no, url, error: error.message };
    }
}

// URL一覧をキャプチャし、HTMLコンテンツを返す関数 (コンカレンシー制限付き並列処理)
async function captureUrls(headedContext, searchResults, keywords, onProgress) {
    const subFolderName = sanitizeFolderName(keywords);
    const artifactDir = path.resolve(__dirname, '../../artifacts', subFolderName);

    if (!fs.existsSync(artifactDir)) {
        fs.mkdirSync(artifactDir, { recursive: true });
    }

    // 同時処理数を設定ファイルから取得 (デフォルト: 1 = 直列)
    const CONCURRENCY = config.search.concurrency || 1;

    // 結果を入力順(URLの番号順)に保持するため、インデックスで管理します
    const report = new Array(searchResults.length);
    let completed = 0;

    // CONCURRENCY件ずつ並列でチャンク処理します
    for (let i = 0; i < searchResults.length; i += CONCURRENCY) {
        const chunk = searchResults.slice(i, i + CONCURRENCY);

        const chunkPromises = chunk.map(async (item) => {
            const no = item[0];
            const url = item[1];
            const resultIndex = no - 1; // 1始まりのnoを0始まりのインデックスに変換

            if (onProgress) onProgress(completed, searchResults.length, `URL ${no} を処理中...`);

            const result = await processUrl(headedContext, no, url, artifactDir);
            report[resultIndex] = result;
            completed++;

            if (onProgress) onProgress(completed, searchResults.length, `URL ${no} を処理中...`);
        });

        // このチャンクの全処理が完了するまで待機してから次のチャンクへ進みます
        await Promise.allSettled(chunkPromises);
    }

    if (onProgress) onProgress(searchResults.length, searchResults.length, `すべてのURLのキャプチャが完了しました。`);

    return report;
}

module.exports = captureUrls;
