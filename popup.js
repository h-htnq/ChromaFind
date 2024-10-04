document.addEventListener('DOMContentLoaded', function () {
    const searchInput = document.getElementById('searchInput');
    const searchTermsContainer = document.getElementById('searchTermsContainer');
    const clearButton = document.getElementById('clearButton');
    const regexToggle = document.getElementById('regexToggle');
    let encryptionKey = null;  // 暗号化キーの変数を定義
  
    // 拡張機能の起動時にキーを生成または復元
    initKey();
  
    // 正規表現モードの状態を保持
    let isRegexMode = false;
  
    // 正規表現トグルスイッチの状態を保存・復元
    browser.storage.local.get('isRegexMode').then((result) => {
        isRegexMode = result.isRegexMode || false;
        regexToggle.checked = isRegexMode;
    });
  
    regexToggle.addEventListener('change', () => {
        isRegexMode = regexToggle.checked;
        browser.storage.local.set({ isRegexMode });
        // ハイライトを更新（新しい設定を適用）
        sendHighlightMessage();
    });
  
    // ウィンドウが開かれたときに、ローカルストレージから検索文字列を復号化して復元
    browser.storage.local.get(['searchTerms', 'iv']).then(async (result) => {
        const savedTermsEncrypted = result.searchTerms;
        const iv = result.iv;
        
        if (savedTermsEncrypted && iv && encryptionKey) {
            const decryptedTerms = await decryptData(encryptionKey, savedTermsEncrypted, iv);
            const terms = JSON.parse(decryptedTerms);
            searchInput.value = terms.join('\n');
            displaySearchButtons(terms);
        }
    });
  
    // テキストエリアのキーイベントを処理
    searchInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault(); // デフォルトの動作を防止
            updateHighlights();
        }
    });
  
    // クリアボタンのクリックイベントを処理
    clearButton.addEventListener('click', () => {
        searchInput.value = '';
        updateHighlights();
    });
  
    // ハイライトを更新する関数
    async function updateHighlights() {
        let terms = searchInput.value.split('\n').filter((line) => line.trim() !== '');
        searchTermsContainer.innerHTML = '';
  
        if (terms.length === 0) {
            // 検索語がない場合はハイライトを削除
            browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
                if (tabs[0]) {
                    browser.tabs.sendMessage(tabs[0].id, {
                        action: 'clearHighlights',
                    }).catch((error) => {
                        console.error('Error sending message to content script:', error);
                    });
                }
            });
            // ストレージから検索語を削除
            browser.storage.local.remove(['searchTerms', 'iv']);
            return;
        }
  
        // 検索語を表示
        displaySearchButtons(terms);
  
        // コンテンツスクリプトにメッセージを送信してハイライトを更新
        browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
            if (tabs[0]) {
                browser.tabs.sendMessage(tabs[0].id, {
                    action: 'highlight',
                    terms: terms,
                    isRegexMode: isRegexMode,
                    colors: generateColors(terms.length),
                }).catch((error) => {
                    console.error('Error sending message to content script:', error);
                });
            }
        });
  
        // 検索語を暗号化して保存
        if (encryptionKey) {
            const { iv, encrypted } = await encryptData(encryptionKey, JSON.stringify(terms));
  
            browser.storage.local.set({
                searchTerms: encrypted,
                iv: iv
            }).catch((error) => {
                console.error('Error saving search terms:', error);
            });
        }
    }
  
    // 検索ボタンを表示する関数
    function displaySearchButtons(terms) {
        searchTermsContainer.innerHTML = '';  // 既存のボタンをクリア
  
        terms.forEach((term, index) => {
            const button = document.createElement('button');
            button.textContent = term;
            button.classList.add('term-button');
            button.style.backgroundColor = generateColors(terms.length)[index];
            button.style.color = '#000000';  // 文字色を黒に設定
  
            // ボタンがクリックされたときに、その検索語にスクロール
            button.addEventListener('click', () => {
                browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
                    if (tabs[0]) {
                        browser.tabs.sendMessage(tabs[0].id, {
                            action: 'scrollToTerm',
                            term: term,
                            isRegexMode: isRegexMode,
                        }).catch((error) => {
                            console.error('Error sending message to content script:', error);
                        });
                    }
                });
            });
  
            searchTermsContainer.appendChild(button);
        });
    }
  
    // ユーザー提供のカラーパレットから色を生成する関数
    function generateColors(count) {
        const highlightColors = [
            '#FFD700', '#32CD32', '#00CED1', '#FF69B4', '#FFA500',
            '#BA55D3', '#1E90FF', '#ADFF2F', '#FFB6C1', '#D3D3D3'
        ];
        const colors = [];
        for (let i = 0; i < count; i++) {
            colors.push(highlightColors[i % highlightColors.length]);
        }
        return colors;
    }
  
    // キーの初期化関数
    async function initKey() {
        // 既存のキーが保存されていないか確認
        const keyData = await browser.storage.local.get('encryptionKey');
        if (keyData.encryptionKey) {
            // キーが存在する場合は復元
            encryptionKey = await importKey(keyData.encryptionKey);
        } else {
            // 新しくキーを生成
            encryptionKey = await generateKey();
            const exportedKey = await exportKey(encryptionKey);
            // キーを保存
            browser.storage.local.set({ encryptionKey: exportedKey });
        }
    }
  
    // 暗号化のためのキー生成
    async function generateKey() {
        return await crypto.subtle.generateKey(
            {
                name: "AES-GCM",
                length: 256
            },
            true,
            ["encrypt", "decrypt"]
        );
    }
  
    // 暗号化のキーをエクスポート
    async function exportKey(key) {
        const exported = await crypto.subtle.exportKey('jwk', key);
        return exported;
    }
  
    // 暗号化のキーをインポート
    async function importKey(jwk) {
        return await crypto.subtle.importKey(
            'jwk',
            jwk,
            {
                name: "AES-GCM",
                length: 256
            },
            true,
            ["encrypt", "decrypt"]
        );
    }
  
    // 暗号化関数
    async function encryptData(key, data) {
        const encoder = new TextEncoder();
        const iv = crypto.getRandomValues(new Uint8Array(12)); // 12バイトのIV
        const encrypted = await crypto.subtle.encrypt(
            {
                name: "AES-GCM",
                iv: iv
            },
            key,
            encoder.encode(data)
        );
        return { iv, encrypted };
    }
  
    // 復号化関数
    async function decryptData(key, encrypted, iv) {
        const decrypted = await crypto.subtle.decrypt(
            {
                name: "AES-GCM",
                iv: iv
            },
            key,
            encrypted
        );
        const decoder = new TextDecoder();
        return decoder.decode(decrypted);
    }
  });
