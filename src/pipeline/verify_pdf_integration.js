const fs = require('fs');
const path = require('path');

// pdf-parseをモックする
const pdfParseMock = async () => ({
    text: 'This is mocked PDF text content.',
    info: { Title: 'Mocked PDF Title', Author: 'Mocked Author' }
});

// require.cacheを操作してモックを注入する
// 3-extract.jsが読み込まれる前に設定する必要がある
const extractPath = path.resolve(__dirname, './3-extract.js');
const pdfParsePath = require.resolve('pdf-parse');

require.cache[pdfParsePath] = {
    id: pdfParsePath,
    filename: pdfParsePath,
    loaded: true,
    exports: pdfParseMock
};

const extractToMarkdown = require('./3-extract');
const markdownToJson = require('./4-structure');

async function verify() {
    console.log('--- PDF Integration Verification (with Mocks) Start ---');

    const artifactDir = path.join(__dirname, '../../artifacts/test_pdf_integration');
    if (!fs.existsSync(artifactDir)) {
        fs.mkdirSync(artifactDir, { recursive: true });
    }

    // 1. Mock PDF item (Task 2 style)
    const mockPdfBuffer = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Title (Test PDF) >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF');
    const pdfItem = {
        no: 99,
        url: 'https://example.com/test.pdf',
        contentType: 'pdf',
        content: mockPdfBuffer,
        pdfPath: path.join(artifactDir, 'page99_download.pdf'),
        artifactDir: artifactDir
    };

    fs.writeFileSync(pdfItem.pdfPath, pdfItem.content);
    console.log('Mock PDF created at:', pdfItem.pdfPath);

    // 2. Run extractToMarkdown (Task 2 logic)
    console.log('Running extractToMarkdown...');
    const extractResult = await extractToMarkdown(pdfItem);
    console.log('Extract Result:', JSON.stringify(extractResult, (key, value) => key === 'markdownContent' ? '(content)' : value, 2));

    if (extractResult.mdFilename !== 'page99_pdf_extracted.md') {
        throw new Error('Unexpected mdFilename for PDF');
    }

    // 3. Run markdownToJson (Task 3 integration point)
    console.log('Running markdownToJson...');
    const jsonPath = path.join(pdfItem.artifactDir, extractResult.mdFilename.replace('.md', '.json'));
    const jsonData = await markdownToJson(
        extractResult.markdownContent,
        extractResult.mdPath,
        pdfItem.url,
        extractResult.title,
        jsonPath,
        'Testing PDF integration'
    );

    console.log('JSON Result created at:', jsonPath);
    console.log('JSON Data Title:', jsonData.title);
    
    if (jsonData.rawMarkdown !== extractResult.markdownContent) {
        throw new Error('Markdown content mismatch in JSON');
    }

    console.log('--- Verification Success! ---');
    
    // Cleanup
    // fs.rmSync(artifactDir, { recursive: true, force: true });
}

verify().catch(err => {
    console.error('Verification Failed:', err);
    process.exit(1);
});
