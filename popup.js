document.addEventListener('DOMContentLoaded', function () {
    const searchInput = document.getElementById('searchInput');
    const searchTermsContainer = document.getElementById('searchTermsContainer');
    const clearButton = document.getElementById('clearButton');
    const regexToggle = document.getElementById('regexToggle');
    let encryptionKey = null;  // 暗号化キーの変数を定義
    let termColorMap = {};  // 検索語と色をマッピングするためのオブジェクト
    let currentColorIndex = 0;  // 次に割り当てる色のインデックス
    let scrollIndexes = {};  // 各検索語のスクロールインデックスを保持

    const highlightColors = [
        '#FFD700', '#32CD32', '#00CED1', '#FF69B4', '#FFA500',
        '#BA55D3', '#1E90FF', '#ADFF2F', '#FFB6C1', '#D3D3D3'
    ];

    // 拡張機能の起動時にキーを生成または復元
    initKey();

    // 正規表現モードの状態を保持
    let isRegexMode = false;

    // 正規表現トグルスイッチの状態を保存・復元
    browser.storage.local.get(['isRegexMode', 'originalOrder', 'termColorMap']).then((result) => {
        isRegexMode = result.isRegexMode || false;
        regexToggle.checked = isRegexMode;

        // カラーマッピングを復元
        if (result.termColorMap) {
            termColorMap = result.termColorMap;
        }

        // 元の順番が存在する場合はそれを使って表示
        if (result.originalOrder) {
            searchInput.value = result.originalOrder.join('\n');
            displaySearchButtons(result.originalOrder);
        }
    });

    regexToggle.addEventListener('change', () => {
        isRegexMode = regexToggle.checked;
        browser.storage.local.set({ isRegexMode });
        // ハイライトを更新（新しい設定を適用）
        updateHighlights();
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
        termColorMap = {};  // 検索語と色のマッピングをクリア
        currentColorIndex = 0;  // カラーパレットのインデックスをリセット
        scrollIndexes = {};  // スクロールインデックスもリセット
        browser.storage.local.remove(['originalOrder', 'termColorMap']);  // 元の順番とマッピングもクリア
        updateHighlights();
    });

    // ハイライトを更新する関数
    async function updateHighlights() {
        // 検索語を取得して元の順番を保存
        let terms = searchInput.value.split('\n').filter((line) => line.trim() !== '');
        let originalOrder = [...terms];  // 元の順番を保存
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
            browser.storage.local.remove(['searchTerms', 'iv', 'originalOrder', 'termColorMap']);
            return;
        }

        // 検索語を長さ順にソートして検索処理を実施
        terms.sort((a, b) => b.length - a.length);

        // ソートされた検索語でハイライトを実施
        const colors = terms.map(term => {
            // 既に色が割り当てられているか確認
            if (!termColorMap[term]) {
                // 新しい色をマッピング
                termColorMap[term] = highlightColors[currentColorIndex % highlightColors.length];
                currentColorIndex++;
            }
            return termColorMap[term];
        });

        // コンテンツスクリプトにメッセージを送信してハイライトを更新
        browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
            if (tabs[0]) {
                browser.tabs.sendMessage(tabs[0].id, {
                    action: 'highlight',
                    terms: terms,
                    isRegexMode: isRegexMode,
                    colors: colors,  // ソートされた検索語に基づく色を適用
                }).catch((error) => {
                    console.error('Error sending highlight message to content script:', error);
                });
            } else {
                console.error('No active tab found.');
            }
        }).catch((error) => {
            console.error('Error querying active tab:', error);
        });

        // 元の順番に戻してボタンを表示
        displaySearchButtons(originalOrder);

        // 検索語を暗号化して保存し、元の順番と色マッピングも保存
        if (encryptionKey) {
            const { iv, encrypted } = await encryptData(encryptionKey, JSON.stringify(terms));

            browser.storage.local.set({
                searchTerms: encrypted,
                iv: iv,
                originalOrder: originalOrder,  // 元の順番を保存
                termColorMap: termColorMap  // 色のマッピングを保存
            }).catch((error) => {
                console.error('Error saving search terms and colors:', error);
            });
        }
    }

    // 検索ボタンを表示する関数
    function displaySearchButtons(terms) {
        searchTermsContainer.innerHTML = '';  // 既存のボタンをクリア

        terms.forEach((term) => {
            // 既に色が割り当てられているか確認
            if (!termColorMap[term]) {
                // 新しい色をマッピング
                termColorMap[term] = highlightColors[currentColorIndex % highlightColors.length];
                currentColorIndex++;
            }

            // スクロールインデックスを初期化
            if (!scrollIndexes[term]) {
                scrollIndexes[term] = 0;
            }

            const button = document.createElement('button');
            button.textContent = term;
            button.classList.add('term-button');
            button.style.backgroundColor = termColorMap[term];  // マッピングされた色を適用
            button.style.color = '#000000';  // 文字色を黒に設定

            // ボタンがクリックされたときに、その検索語にスクロール
            button.addEventListener('click', () => {
                browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
                    if (tabs[0]) {
                        browser.tabs.sendMessage(tabs[0].id, {
                            action: 'scrollToTerm',
                            term: term,
                            isRegexMode: isRegexMode,
                            scrollIndex: scrollIndexes[term]  // 次のマッチ箇所にスクロールするためにインデックスを渡す
                        }).catch((error) => {
                            console.error('Error sending scroll message to content script:', error);
                        });

                        // スクロールインデックスを次に進める
                        scrollIndexes[term]++;
                    }
                });
            });

            searchTermsContainer.appendChild(button);
        });
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
