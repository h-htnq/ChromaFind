// popup.js --- 最終修正版 (ライブ検索 + 正規表現の挙動改善)
document.addEventListener('DOMContentLoaded', function () {
    const searchInput = document.getElementById('searchInput'); // <textarea>である必要があります
    const searchTermsContainer = document.getElementById('searchTermsContainer');
    const clearButton = document.getElementById('clearButton');
    const regexToggle = document.getElementById('regexToggle');

    let termColorMap = {}; // 永続的な色のマッピング
    let scrollIndexes = {}; // スクロール状態
    let debounceTimer;      // ライブ検索のためのタイマー

    // はっきりしたランダム色を生成（近い色を避ける）
    function getUniqueRandomColor() {
        const existingColors = Object.values(termColorMap);
        let attempts = 0;
        let newColor;

        do {
            // はっきりした色の候補を生成
            const colorCandidates = [
                'rgb(255, 220, 100)',  // 明るい黄色
                'rgb(255, 120, 180)',  // 明るいピンク
                'rgb(120, 255, 120)',  // 明るい緑
                'rgb(120, 180, 255)',  // 明るい青
                'rgb(255, 120, 120)',  // 明るい赤
                'rgb(180, 120, 255)',  // 明るい紫
                'rgb(255, 180, 120)',  // 明るいオレンジ
                'rgb(120, 220, 255)',  // 明るいターコイズ
                'rgb(180, 255, 120)',  // 明るい黄緑
                'rgb(255, 120, 255)',  // 明るいマゼンタ
                'rgb(220, 180, 120)',  // 明るいブラウン
                'rgb(255, 150, 200)',  // 明るいローズ
            ];

            // 使用されていない色から選択
            const availableColors = colorCandidates.filter(color => !existingColors.includes(color));

            if (availableColors.length > 0) {
                // 使用されていない色からランダム選択
                newColor = availableColors[Math.floor(Math.random() * availableColors.length)];
            } else {
                // 全色使用済みの場合は完全ランダム生成
                const r = Math.floor(Math.random() * 200) + 55; // 55-255の範囲
                const g = Math.floor(Math.random() * 200) + 55;
                const b = Math.floor(Math.random() * 200) + 55;
                newColor = `rgb(${r}, ${g}, ${b})`;
            }

            attempts++;
        } while (existingColors.includes(newColor) && attempts < 50);

        return newColor;
    }

    // 背景色の明度に基づいて適切な文字色を決定する関数
    function getContrastTextColor(backgroundColor) {
        // RGB値を抽出
        let r, g, b;
        if (backgroundColor.startsWith('rgb(')) {
            const match = backgroundColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
            if (match) {
                r = parseInt(match[1]);
                g = parseInt(match[2]);
                b = parseInt(match[3]);
            }
        } else if (backgroundColor.startsWith('#')) {
            const hex = backgroundColor.slice(1);
            r = parseInt(hex.substr(0, 2), 16);
            g = parseInt(hex.substr(2, 2), 16);
            b = parseInt(hex.substr(4, 2), 16);
        } else {
            return '#ffffff'; // デフォルトは白
        }

        // 相対輝度を計算（WCAG基準）
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

        // 明度が0.5以上なら黒文字、未満なら白文字
        return luminance > 0.5 ? '#000000' : '#ffffff';
    }

    // 状態を保存
    function saveState() {
        browser.storage.local.set({
            savedText: searchInput.value,
            savedRegexMode: regexToggle.checked,
            termColorMap: termColorMap
        }).catch(e => console.error("Error saving state:", e));
    }

    // 検索を実行するメイン関数
    function performSearch() {
        const rawText = searchInput.value;
        const isRegex = regexToggle.checked;

        // ★★★ 挙動変更の核心部分 ★★★
        // どのモードであっても、改行で分割して個別の検索語として扱う
        const termsToProcess = rawText.split('\n').filter(t => t.trim() !== '');

        // 1. 検索語がなければ、ハイライトを消して終了
        if (termsToProcess.length === 0) {
            clearHighlightsOnPage();
            displaySearchButtons([]); // ボタンも消す
            saveState();
            return;
        }

        // 2. 既存の色マッピングをクリアして新しい順序で再割り当て
        const existingTerms = Object.keys(termColorMap);
        // 2. 新しい単語にユニークな色を割り当て
        termsToProcess.forEach(term => {
            if (!termColorMap[term]) {
                termColorMap[term] = getUniqueRandomColor();
            }
        });

        // 3. content_scriptに渡すためのデータを作成
        //    通常モードでは、重なりを避けるため長い単語から処理するようソート
        const sortedTerms = isRegex ? termsToProcess : [...termsToProcess].sort((a, b) => b.length - a.length);
        const sortedColors = sortedTerms.map(term => termColorMap[term]);

        // 4. content_scriptにハイライト指示を送信
        browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
            if (tabs[0] && tabs[0].id) {
                browser.tabs.sendMessage(tabs[0].id, {
                    action: 'highlight',
                    terms: sortedTerms,
                    isRegexMode: isRegex,
                    colors: sortedColors
                }).then(response => {
                    if (response) {
                        // ボタンの表示順は、ユーザーの入力順（ソート前）を維持
                        displaySearchButtons(termsToProcess, response.termCounts);
                    }
                    saveState();
                }).catch(e => console.error("Error from content script:", e.getMessage()));
            }
        }).catch(e => console.error("Error querying tabs:", e));
    }

    // ポップアップにボタンを表示
    function displaySearchButtons(terms, termCounts = {}) {
        searchTermsContainer.innerHTML = '';

        // 重複する単語を除去し、最初に出現した順序を保持
        const uniqueTerms = [];
        const seenTerms = new Set();
        terms.forEach(term => {
            if (!seenTerms.has(term)) {
                uniqueTerms.push(term);
                seenTerms.add(term);
            }
        });

        uniqueTerms.forEach(term => {
            const count = termCounts[term] || 0;
            // ページ上で1つ以上見つかった単語のボタンのみ表示
            if (count > 0) {
                const button = document.createElement('button');
                button.textContent = `${term} (${count})`;
                button.classList.add('term-button');
                button.style.backgroundColor = termColorMap[term];
                button.style.color = getContrastTextColor(termColorMap[term]); // 背景色に応じて文字色を決定

                button.addEventListener('click', () => {
                    scrollIndexes[term] = scrollIndexes[term] || 0;
                    browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
                        if (tabs[0] && tabs[0].id) {
                            browser.tabs.sendMessage(tabs[0].id, {
                                action: 'scrollToTerm',
                                term: term,
                                scrollIndex: scrollIndexes[term]
                            }).catch(e => console.error("Error sending scroll message:", e));
                        }
                    });
                    scrollIndexes[term]++;
                });
                searchTermsContainer.appendChild(button);
            }
        });
    }

    // ページ上のハイライトを消す指示を出す
    function clearHighlightsOnPage() {
        browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
            if (tabs[0] && tabs[0].id) {
                browser.tabs.sendMessage(tabs[0].id, { action: 'clearHighlights' })
                    .catch(e => console.error("Error clearing highlights:", e));
            }
        });
    }

    // === イベントリスナー ===

    // ★★★ ライブ検索の実装 ★★★
    // 入力があるたびに、少し遅れて検索を実行する
    searchInput.addEventListener('input', () => {
        clearTimeout(debounceTimer); // 前のタイマーをキャンセル
        debounceTimer = setTimeout(performSearch, 500); // 500ミリ秒後に関数を実行
    });

    // Shift+Enterのリスナーは不要になったため削除

    clearButton.addEventListener('click', () => {
        searchInput.value = '';
        termColorMap = {};
        scrollIndexes = {};
        performSearch(); // clear flow
    });

    regexToggle.addEventListener('change', performSearch);

    // ポップアップを開いたときに状態を復元
    browser.storage.local.get(['savedText', 'savedRegexMode', 'termColorMap']).then(result => {
        if (result.savedText) {
            searchInput.value = result.savedText;
        }
        if (result.savedRegexMode) {
            regexToggle.checked = result.savedRegexMode;
        }
        termColorMap = result.termColorMap || {};
        // 起動時にも検索を実行して、前回の状態を復元する
        performSearch();
    });
});
