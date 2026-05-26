const decodeBingUrl = require('../utils/bing-decoder');
const sleep = require('../utils/sleep');
const config = require('../config');
const cliLogger = require('../utils/cli-logger');

// 検索エンジンごとのDOMセレクター＆URL定義マップ（アダプターパターン）
const ENGINE_CONFIGS = {
    "bing": {
        url: "https://www.bing.com",
        searchBox: 'textarea[name="q"]',
        links: 'li.b_algo h2 a',
        nextButton: 'a.sb_pagN'
    },
    "google": {
        url: "https://www.google.com",
        searchBox: 'textarea[name="q"]',
        links: 'div#search a h3', // h3 を含む a タグを抽出
        nextButton: 'a#pnnext'
    },
    "duckduckgo": {
        url: "https://html.duckduckgo.com/html/", // CAPTCHAの無い静的HTML版
        searchBox: 'input[name="q"]',
        links: 'a.result__url',
        nextButton: 'input[value="Next"]'
    }
};

// Web検索を行い、複数ページ（ページネーション）を自動巡回して指定件数まで取得する関数
async function webSearch(page, keywords, limit) {
    let results = [];
    const seenUrls = new Set();
    const searchLimit = limit || config.search.defaultLimit;
    let count = 0;

    // 後方互換性の解決 (URLが設定されていても自動的にキーにマッピング)
    let engineKey = (config.search.engine || "bing").toLowerCase();
    if (engineKey.includes("bing")) engineKey = "bing";
    else if (engineKey.includes("duckduckgo")) engineKey = "duckduckgo";
    else if (engineKey.includes("google")) engineKey = "google";
    
    // 設定されたエンジンを選択、無効ならデフォルトでBingを適用
    const engine = ENGINE_CONFIGS[engineKey] || ENGINE_CONFIGS.bing;

    // 検索サイトへ遷移
    await page.goto(engine.url); 
    
    const searchBox = page.locator(engine.searchBox);
    await searchBox.fill(keywords);
    await searchBox.press('Enter');

    // 最初の結果リンクが表示されるのを待機
    const linksSelector = engine.links;
    const firstLink = page.locator(linksSelector).first();
    
    try {
        await firstLink.waitFor({ state: 'attached', timeout: 8000 });
        await sleep(config.search.waitAfterSearch || 2000);
    } catch (err) {
        // 検索結果が1件も出ないか、ロボット検証が表示されている場合はここで早期リターン
        return results;
    }

    // 目標件数に達するまで、または次のページが無くなるまで自動ループ
    while (count < searchLimit) {
        const linkElements = page.locator(linksSelector);
        const totalLinks = await linkElements.count();
        
        if (totalLinks === 0) {
            break;
        }

        let addedInThisPage = 0;
        for (let i = 0; i < totalLinks && count < searchLimit; i++) {
            const element = linkElements.nth(i);
            let rawUrl = null;

            if (engineKey === "google") {
                // h3 から親の a タグを辿って href を取得
                const parent = element.locator('xpath=..'); // 1段階上の親
                rawUrl = await parent.getAttribute('href');
                if (!rawUrl) {
                    const grandParent = parent.locator('xpath=..'); // もう1段階上
                    rawUrl = await grandParent.getAttribute('href');
                }
            } else {
                rawUrl = await element.getAttribute('href');
            }

            if (rawUrl) {
                // BingのリダイレクトURLをデコードして本物の遷移先URLを取得します
                let url = rawUrl;
                if (engineKey === "bing" && rawUrl.includes('bing.com/ck/a')) {
                    url = decodeBingUrl(rawUrl);
                } else if (rawUrl.startsWith('/url?q=')) {
                    // Googleの検索結果の特殊な内部リダイレクトURLをクレンジング
                    const urlMatch = rawUrl.match(/\/url\?q=([^&]+)/);
                    if (urlMatch) {
                        url = decodeURIComponent(urlMatch[1]);
                    }
                } else if (rawUrl.startsWith('/html/')) {
                    // DuckDuckGo HTML版の相対パスURLを絶対パスに解決
                    url = "https://html.duckduckgo.com" + rawUrl;
                }

                if (url.startsWith('https') && !seenUrls.has(url)) {
                    results.push([count + 1, url]);
                    seenUrls.add(url);
                    count++;
                    addedInThisPage++;
                }
            }
        }

        // 目標件数に達していれば巡回終了
        if (count >= searchLimit) {
            break;
        }

        // 「次のページ」ボタンを探して自動遷移
        const nextButton = page.locator(engine.nextButton);
        const hasNext = await nextButton.count();

        if (hasNext > 0 && await nextButton.isVisible()) {
            await nextButton.click();
            
            // 遷移後の新しい検索結果が表示されるのを待機
            const nextFirstLink = page.locator(linksSelector).first();
            try {
                await nextFirstLink.waitFor({ state: 'attached', timeout: 5000 });
                await sleep(config.search.slowMo || 500); 
            } catch (err) {
                // 遷移に失敗したか、次のページロードが間に合わなければ終了
                break;
            }
        } else {
            // 次のページボタンが無い、または非表示なら終了
            break;
        }
    }

    if (results.length === 0) {
        cliLogger.warn("No search results found. A robot verification (CAPTCHA) might have occurred, or search selectors may have changed. / 検索結果が0件でした。ロボット検証（CAPTCHA）が発生したか、セレクターが変更された可能性があります。");
        cliLogger.warn("Tip: Try switching to DuckDuckGo (less CAPTCHA in HTML mode) or Academic mode. / 対処法: DuckDuckGo（HTML版）へ切り替えるか、論文検索（Academic）モードをお試しください。");
    }

    return results;
}

module.exports = webSearch;
