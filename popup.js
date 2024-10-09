document.addEventListener('DOMContentLoaded', function () {
    const searchInput = document.getElementById('searchInput');
    const searchTermsContainer = document.getElementById('searchTermsContainer');
    const clearButton = document.getElementById('clearButton');
    const regexToggle = document.getElementById('regexToggle');
    let termColorMap = {};  // 検索語と色をマッピングするためのオブジェクト
    let currentColorIndex = 0;  // 次に割り当てる色のインデックス
    let scrollIndexes = {};  // 各検索語のスクロールインデックスを保持

    const highlightColors = [
        '#FFD700', '#32CD32', '#00CED1', '#FF69B4', '#FFA500',
        '#BA55D3', '#1E90FF', '#ADFF2F', '#FFB6C1', '#D3D3D3'
    ];

    // 検索語と設定を保存する関数
    function saveSearchTerms(terms) {
        browser.storage.local.set({
            originalOrder: terms,
            termColorMap: termColorMap
        }).catch((error) => {
            console.error('Error saving search terms:', error);
        });
    }

    // ハイライトを更新する関数
    async function updateHighlights() {
        let terms = searchInput.value.split('\n').filter((line) => line.trim() !== '');
        let originalOrder = [...terms];  // 元の順番を保存
        searchTermsContainer.innerHTML = '';  // ボタンをクリア

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
            browser.storage.local.remove(['originalOrder', 'termColorMap']);
            return;
        }

        terms.sort((a, b) => b.length - a.length);  // 検索語を長さ順にソート

        const colors = terms.map(term => {
            if (!termColorMap[term]) {
                termColorMap[term] = highlightColors[currentColorIndex % highlightColors.length];
                currentColorIndex++;
            }
            return termColorMap[term];
        });

        browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
            if (tabs[0]) {
                // コンテンツスクリプトにメッセージを送信し、ハイライトを実施
                browser.tabs.sendMessage(tabs[0].id, {
                    action: 'highlight',
                    terms: terms,
                    isRegexMode: regexToggle.checked,
                    colors: colors
                }).then((response) => {
                    displaySearchButtons(originalOrder, response.matchedTerms);
                    saveSearchTerms(originalOrder);  // 検索語を保存
                }).catch((error) => {
                    console.error('Error sending highlight message to content script:', error);
                });
            }
        }).catch((error) => {
            console.error('Error querying active tab:', error);
        });
    }

    // 検索語ボタンを表示する関数
    function displaySearchButtons(terms, matchedTerms = []) {
        searchTermsContainer.innerHTML = '';  // 既存のボタンをクリア

        terms.forEach((term) => {
            const button = document.createElement('button');
            button.textContent = term;
            button.classList.add('term-button');

            // マッチした検索語かどうかを確認してボタンの外観を設定
            if (matchedTerms.includes(term)) {
                button.style.backgroundColor = termColorMap[term];  // 割り当てられた色を適用
                button.style.color = '#000000';  // 文字色を黒に設定
            } else {
                button.style.backgroundColor = '#D3D3D3';  // 灰色の背景に設定
                button.classList.add('disabled');  // 無効化
                button.disabled = true;  // ボタンを無効化
            }

            // ボタンがクリックされたときに、その検索語にスクロール
            button.addEventListener('click', () => {
                browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
                    if (tabs[0]) {
                        scrollIndexes[term] = scrollIndexes[term] || 0;  // インデックスを初期化
                        browser.tabs.sendMessage(tabs[0].id, {
                            action: 'scrollToTerm',
                            term: term,
                            scrollIndex: scrollIndexes[term]  // 次のマッチ箇所にスクロールするためにインデックスを渡す
                        }).catch((error) => {
                            console.error('Error sending scroll message to content script:', error);
                        });
                        scrollIndexes[term]++;  // スクロールインデックスを進める
                    }
                });
            });

            searchTermsContainer.appendChild(button);
        });
    }

    // 拡張機能の起動時に保存されたデータを復元
    browser.storage.local.get(['originalOrder', 'termColorMap']).then((result) => {
        if (result.originalOrder) {
            searchInput.value = result.originalOrder.join('\n');
            termColorMap = result.termColorMap || {};
            updateHighlights();  // 検索語を復元してハイライトを適用
        }
    });

    searchInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();  // デフォルトの動作を防止
            updateHighlights();
        }
    });

    clearButton.addEventListener('click', () => {
        searchInput.value = '';
        termColorMap = {};
        currentColorIndex = 0;
        scrollIndexes = {};  // スクロールインデックスもリセット
        browser.storage.local.remove(['originalOrder', 'termColorMap']);  // 元の順番とマッピングもクリア
        updateHighlights();
    });

    regexToggle.addEventListener('change', () => {
        updateHighlights();
    });
});
