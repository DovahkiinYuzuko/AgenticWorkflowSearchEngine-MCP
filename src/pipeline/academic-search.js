const fs = require('fs');
const path = require('path');
const sanitizeFolderName = require('../utils/sanitize');

/**
 * Clean up text (remove excessive whitespaces, XML tags, etc.)
 */
function cleanText(text) {
    if (!text) return '';
    return text
        .replace(/<[^>]+>/g, '') // HTML/XMLタグ除去
        .replace(/\s+/g, ' ')   // 連続スペースの圧縮
        .trim();
}

/**
 * Fetch results from arXiv API
 */
async function fetchArxiv(keywords, limit) {
    const papers = [];
    try {
        const url = `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(keywords)}&max_results=${limit}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`arXiv API error: ${response.status}`);
        
        const xmlText = await response.text();
        
        // 正規表現による簡易XMLパース
        const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
        let match;
        let count = 0;
        
        while ((match = entryRegex.exec(xmlText)) !== null && count < limit) {
            const entryContent = match[1];
            
            const idMatch = entryContent.match(/<id>([\s\S]*?)<\/id>/i);
            const titleMatch = entryContent.match(/<title>([\s\S]*?)<\/title>/i);
            const summaryMatch = entryContent.match(/<summary>([\s\S]*?)<\/summary>/i);
            
            if (idMatch && titleMatch) {
                const absUrl = cleanText(idMatch[1]);
                const pdfUrl = absUrl.replace('/abs/', '/pdf/') + '.pdf';
                const title = cleanText(titleMatch[1]);
                const summary = cleanText(summaryMatch[1]);
                
                // 著者の抽出
                const authors = [];
                const authorRegex = /<author>([\s\S]*?)<\/author>/g;
                let authorMatch;
                while ((authorMatch = authorRegex.exec(entryContent)) !== null) {
                    const nameMatch = authorMatch[1].match(/<name>([\s\S]*?)<\/name>/i);
                    if (nameMatch) {
                        authors.push(cleanText(nameMatch[1]));
                    }
                }
                
                papers.push({
                    title,
                    authors: authors.join(', ') || 'Unknown',
                    abstract: summary,
                    url: absUrl,
                    pdfUrl,
                    source: 'arXiv'
                });
                count++;
            }
        }
    } catch (err) {
        console.error('[Warning] Failed to fetch from arXiv:', err.message);
    }
    return papers;
}

/**
 * Fetch results from PubMed API
 */
async function fetchPubMed(keywords, limit) {
    const papers = [];
    try {
        // Step 1: Search for IDs
        const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(keywords)}&retmode=json&retmax=${limit}`;
        const searchRes = await fetch(searchUrl);
        if (!searchRes.ok) throw new Error(`PubMed Search API error: ${searchRes.status}`);
        
        const searchData = await searchRes.json();
        const idList = searchData.esearchresult?.idlist || [];
        
        if (idList.length === 0) return papers;
        
        // Step 2: Fetch article details in XML (to get abstracts)
        const fetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${idList.join(',')}&retmode=xml`;
        const fetchRes = await fetch(fetchUrl);
        if (!fetchRes.ok) throw new Error(`PubMed Fetch API error: ${fetchRes.status}`);
        
        const xmlText = await fetchRes.text();
        
        // PubMedArticleごとに切り分け
        const articleRegex = /<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/g;
        let match;
        let count = 0;
        
        while ((match = articleRegex.exec(xmlText)) !== null && count < limit) {
            const articleContent = match[1];
            
            const pmidMatch = articleContent.match(/<PMID[^>]*>(\d+)<\/PMID>/i);
            const titleMatch = articleContent.match(/<ArticleTitle>([\s\S]*?)<\/ArticleTitle>/i);
            
            if (pmidMatch && titleMatch) {
                const pmid = pmidMatch[1];
                const title = cleanText(titleMatch[1]);
                const url = `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;
                
                // 抄録（アブストラクト）の抽出。複数ある場合は結合。
                const abstractTexts = [];
                const abstractRegex = /<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g;
                let absMatch;
                while ((absMatch = abstractRegex.exec(articleContent)) !== null) {
                    abstractTexts.push(cleanText(absMatch[1]));
                }
                const abstract = abstractTexts.join('\n\n') || 'No abstract available.';
                
                // 著者の抽出
                const authors = [];
                const authorRegex = /<Author[^>]*>([\s\S]*?)<\/Author>/g;
                let authorMatch;
                while ((authorMatch = authorRegex.exec(articleContent)) !== null) {
                    const lastNameMatch = authorMatch[1].match(/<LastName>([\s\S]*?)<\/LastName>/i);
                    const foreNameMatch = authorMatch[1].match(/<ForeName>([\s\S]*?)<\/ForeName>/i);
                    if (lastNameMatch && foreNameMatch) {
                        authors.push(`${cleanText(foreNameMatch[1])} ${cleanText(lastNameMatch[1])}`);
                    }
                }
                
                papers.push({
                    title,
                    authors: authors.join(', ') || 'Unknown',
                    abstract,
                    url,
                    source: 'PubMed'
                });
                count++;
            }
        }
    } catch (err) {
        console.error('[Warning] Failed to fetch from PubMed:', err.message);
    }
    return papers;
}

/**
 * Academic Search pipeline entrypoint
 */
async function academicSearch(keywords, limitInput) {
    const limit = limitInput || 5;
    
    // arXivとPubMedから半分ずつ取得する設計
    const halfLimit = Math.ceil(limit / 2);
    
    console.log(`[Academic Search] Querying arXiv and PubMed for: "${keywords}"`);
    
    const [arxivPapers, pubmedPapers] = await Promise.all([
        fetchArxiv(keywords, halfLimit),
        fetchPubMed(keywords, halfLimit)
    ]);
    
    // 交互にマージして最終リストを作成する
    const mergedPapers = [];
    const maxLen = Math.max(arxivPapers.length, pubmedPapers.length);
    for (let i = 0; i < maxLen; i++) {
        if (arxivPapers[i] && mergedPapers.length < limit) mergedPapers.push(arxivPapers[i]);
        if (pubmedPapers[i] && mergedPapers.length < limit) mergedPapers.push(pubmedPapers[i]);
    }
    
    // キャプチャされたドキュメントのアーティファクト保存先を準備
    const subFolderName = sanitizeFolderName(keywords);
    const artifactDir = path.resolve(__dirname, '../../artifacts', subFolderName);
    if (!fs.existsSync(artifactDir)) {
        fs.mkdirSync(artifactDir, { recursive: true });
    }
    
    const phase1Results = [];
    
    for (let i = 0; i < mergedPapers.length; i++) {
        const paper = mergedPapers[i];
        const no = i + 1;
        
        // タイトルの安全なクレンジング
        const normalizedTitle = paper.title.replace(/[\\/:*?"<>|]/g, "").substring(0, 100);
        const mdFilename = `page${no}_academic_${normalizedTitle}.md`;
        const mdPath = path.join(artifactDir, mdFilename);
        
        // Markdownコンテンツの作成
        const markdownContent = `# ${paper.title}

- **Source**: ${paper.source}
- **Authors**: ${paper.authors}
- **URL**: [${paper.url}](${paper.url})
${paper.pdfUrl ? `- **PDF Link**: [Download PDF](${paper.pdfUrl})\n` : ''}
## Abstract

${paper.abstract}
`;
        
        // ディスクへの書き込み
        fs.writeFileSync(mdPath, markdownContent, 'utf-8');
        
        // 既存のパイプラインに適合する結果オブジェクトの構成
        phase1Results.push({
            item: {
                no,
                url: paper.url,
                artifactDir
            },
            extractResult: {
                markdownContent,
                title: paper.title,
                mdFilename,
                mdPath
            }
        });
    }
    
    return phase1Results;
}

module.exports = academicSearch;
