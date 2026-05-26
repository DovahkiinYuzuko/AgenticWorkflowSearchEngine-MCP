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

// 2つのURLが「同一記事の分割ページ」である可能性が高いか判定するヘルパー (改修版)
function isSameArticleUrl(urlA, urlB) {
    try {
        const uA = new URL(urlA);
        const uB = new URL(urlB);

        if (uA.hostname !== uB.hostname) return false;

        const paramsA = uA.searchParams;
        const paramsB = uB.searchParams;

        // 代表的な記事IDキーの検証 (値が異なれば別記事とする)
        const articleKeys = ['p', 'id', 'post', 'article_id', 'entry_id'];
        for (const key of articleKeys) {
            if (paramsA.has(key) && paramsB.has(key)) {
                if (paramsA.get(key) !== paramsB.get(key)) {
                    return false;
                }
            }
        }

        // パスの類似性検証
        const pathA = uA.pathname;
        const pathB = uB.pathname;
        if (pathA === pathB) return true;

        const segsA = pathA.split('/').filter(Boolean);
        const segsB = pathB.split('/').filter(Boolean);

        if (segsA.length === 0 || segsB.length === 0) return true;

        const minLen = Math.min(segsA.length, segsB.length);
        let matchCount = 0;
        for (let i = 0; i < minLen; i++) {
            if (segsA[i] === segsB[i]) {
                matchCount++;
            } else {
                break;
            }
        }

        // 1. パスの長さが同じで、最後の1つのセグメント（ファイル名やID）だけが異なる場合
        if (segsA.length === segsB.length && matchCount === segsA.length - 1) {
            const lastA = segsA[segsA.length - 1];
            const lastB = segsB[segsB.length - 1];

            // 単にID自体が異なる数値（例: "12345" と "67890"）の場合は、別記事とみなす
            const isNumericA = /^\d+$/.test(lastA);
            const isNumericB = /^\d+$/.test(lastB);
            if (isNumericA && isNumericB) {
                return lastA === lastB;
            }

            // 最後のセグメントの違いが「ページ番号の増加・パターン」であるか確認する
            const pagePattern = /[-_]?(\d+)$/;
            const matchA = lastA.match(pagePattern);
            const matchB = lastB.match(pagePattern);

            if (matchA && matchB) {
                const prefixA = lastA.replace(pagePattern, '');
                const prefixB = lastB.replace(pagePattern, '');
                if (prefixA === prefixB && prefixA !== '') {
                    return true;
                }
            } else if (matchB) {
                // 例: "article" -> "article-2"
                const prefixB = lastB.replace(pagePattern, '');
                if (lastA === prefixB && prefixB !== '') {
                    return true;
                }
            }

            // 特殊パターンに当てはまらない単なる別名の場合は、別記事とみなして排除
            return false;
        }

        // 2. パスの長さが異なる場合 (例: /news/12345 -> /news/12345/2 や /news/12345/page/2)
        // 共通部分が、短い方のパス（元のパスである segsA）全体と完全に一致している必要がある
        if (segsA.length < segsB.length) {
            return matchCount === segsA.length;
        }

        return matchCount > 0 && matchCount >= (minLen - 1);
    } catch (e) {
        return false;
    }
}

// ページ分割された「次のページ」へのリンクを自律検出するヘルパー
async function detectNextPageLink(page, originalUrl) {
    try {
        // 1. link[rel="next"] を確認
        const linkHref = await page.locator('link[rel="next"]').getAttribute('href', { timeout: 1000 }).catch(() => null);
        if (linkHref) {
            const targetUrl = new URL(linkHref, page.url()).toString();
            if (isSameArticleUrl(originalUrl, targetUrl)) return targetUrl;
        }

        // 2. a[rel="next"] を確認
        const aHref = await page.locator('a[rel="next"]').first().getAttribute('href', { timeout: 1000 }).catch(() => null);
        if (aHref) {
            const targetUrl = new URL(aHref, page.url()).toString();
            if (isSameArticleUrl(originalUrl, targetUrl)) return targetUrl;
        }

        // 3. 一般的なパジネーションのテキストマッチによるヒューリスティック判定
        const nextTexts = ["次のページ", "次へ", "next", "»", ">"];
        const ignoreTexts = ["次の記事", "次のエントリ", "次の投稿", "next post", "next article", "前の記事", "前のエントリ", "前の投稿"];
        const anchors = page.locator('a');
        const count = await anchors.count();
        
        for (let i = 0; i < count; i++) {
            const a = anchors.nth(i);
            const text = (await a.innerText().catch(() => '')).trim().toLowerCase();
            const href = await a.getAttribute('href').catch(() => null);
            
            if (href) {
                // 回避すべきクロノロジカルワードが含まれている場合はスキップ
                if (ignoreTexts.some(it => text.includes(it))) {
                    continue;
                }

                if (nextTexts.some(nt => text === nt || text.includes(nt))) {
                    const targetUrl = new URL(href, page.url()).toString();
                    
                    if (isSameArticleUrl(originalUrl, targetUrl) && targetUrl !== page.url()) {
                        // 親要素のクラス名による時系列ナビゲーションコンテナの除外
                        const isChronological = await a.evaluate(el => {
                            let parent = el.parentElement;
                            while (parent) {
                                const className = (parent.className || '').toLowerCase();
                                if (className.includes('post-navigation') || 
                                    className.includes('prev-next') || 
                                    className.includes('nav-links') || 
                                    className.includes('adjacent')) {
                                    return true;
                                }
                                parent = parent.parentElement;
                            }
                            return false;
                        }).catch(() => false);

                        if (!isChronological) {
                            return targetUrl;
                        }
                    }
                }
            }
        }
    } catch (e) {
        // 検出中の軽微なエラーは無視します
    }
    return null;
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
        
        // WindowsのMAX_PATH (260文字) を考慮し、タイトルを最大50文字に切り詰めて安全装置とします
        const maxTitleLength = 50;
        const truncatedTitle = normalizedTitle.length > maxTitleLength 
            ? normalizedTitle.substring(0, maxTitleLength) + "..." 
            : normalizedTitle;

        const baseFilename = `page${no}_${truncatedTitle}`;

        // 除外パターンの確認
        const ignorePatterns = ['/video', '/images', '/search', '/shop', '/news', '/maps', '/translate', '/weather', '/sports', '/finance', '/entertainment'];
        if (ignorePatterns.some(pattern => url.includes(pattern))) {
            await headedPage.close();
            return { no, url, skipped: true, reason: "除外対象のURLパターンです" };
        }

        // HTMLコンテンツをメモリ上から直接取得します (追加のサーバーリクエストは発生しません)
        let htmlContent = await headedPage.content();

        // --- 複数ページ巡回 (Pagination Loop) ---
        const maxPaginationDepth = config.search.maxPaginationDepth || 5;
        let currentPageIndex = 1;
        const visitedUrls = new Set([url]);

        while (currentPageIndex < maxPaginationDepth) {
            const nextUrl = await detectNextPageLink(headedPage, url);
            if (!nextUrl || visitedUrls.has(nextUrl)) {
                break;
            }

            visitedUrls.add(nextUrl);
            console.log(`\n[Pagination] URL ${no}: Navigating to page ${currentPageIndex + 1} -> ${nextUrl}`);

            try {
                // 次のページへ遷移します
                await headedPage.goto(nextUrl, { timeout: 30000, waitUntil: 'domcontentloaded' });
                await sleep(config.search.viewTime);
                const nextPageHtml = await headedPage.content();

                // 次のページのHTMLを区切り線付きでマージします
                htmlContent += `\n\n<hr class="page-divider" />\n\n${nextPageHtml}`;
                currentPageIndex++;
            } catch (err) {
                console.warn(`[Warning] Failed to capture pagination page ${currentPageIndex + 1}: ${err.message}`);
                break;
            }
        }

        // 全ページのキャプチャが完了した後にタブを閉じます
        await headedPage.close();

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
