const decodeBingUrl = (bingUrl) => {
    try {
        const urlObj = new URL(bingUrl);
        const uParam = urlObj.searchParams.get('u');
        if (uParam) {
            // 先頭の 'a1' や 'a0' などの2文字のプレフィックスを除去します
            const base64Str = uParam.substring(2);
            // パディング不足を補正します（4の倍数になるように '=' を追加）
            const paddedBase64 = base64Str.padEnd(base64Str.length + (4 - (base64Str.length % 4)) % 4, '=');
            // Base64デコードを実行します
            const decodedUrl = Buffer.from(paddedBase64, 'base64').toString('utf-8');
            if (decodedUrl.startsWith('http')) {
                return decodedUrl;
            }
        }
    } catch (e) {
        console.error("Bing URLのデコードに失敗しました:", e);
    }
    return bingUrl;
};

module.exports = decodeBingUrl;
