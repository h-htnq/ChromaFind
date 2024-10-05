let currentMatches = {};  // 各検索語の全マッチ箇所を保持

// ハイライトを適用する関数
function highlightText(terms, isRegexMode, colors) {
    removeHighlights();  // 既存のハイライトを削除
    currentMatches = {};  // マッチ箇所をリセット

    if (!terms || terms.length === 0) {
        return;
    }

    const regexFlags = 'gi';  // グローバルかつ大文字小文字を区別しないフラグ
    let regexList = terms
        .map(term => {
            if (isRegexMode) {
                try {
                    return new RegExp(term, regexFlags);
                } catch (e) {
                    console.error('正規表現が無効です:', e);
                    return null;
                }
            } else {
                return new RegExp(escapeRegExp(term), regexFlags);
            }
        })
        .filter(Boolean);  // 無効な正規表現を除去

    // 検索語の長さ順にソートして、重複を防ぐ（長い単語を優先的にハイライト）
    regexList.sort((a, b) => b.source.length - a.source.length);

    walkTextNodes(document.body, node => {
        let parent = node.parentNode;
        let text = node.nodeValue;
        let newNodeContents = [];
        let lastIndex = 0;
        let matchedIndexes = new Set();

        regexList.forEach((regex, index) => {
            let matches;

            while ((matches = regex.exec(text)) !== null) {
                // 重複を防ぐため、既にマッチした箇所はスキップ
                if (matchedIndexes.has(matches.index)) {
                    continue;
                }

                // テキストエリアやインプット要素内のテキストをハイライトしない
                if (
                    parent.nodeName === 'TEXTAREA' ||
                    parent.nodeName === 'INPUT' ||
                    parent.nodeName === 'SCRIPT' ||
                    parent.nodeName === 'STYLE'
                ) {
                    return;
                }

                if (matches.index > lastIndex) {
                    newNodeContents.push(document.createTextNode(text.substring(lastIndex, matches.index)));
                }

                let span = document.createElement('span');
                span.className = `chroma-highlight chroma-highlight-${index}`;
                span.style.backgroundColor = colors[index];  // ボタンと同じ色を適用
                span.textContent = matches[0];

                newNodeContents.push(span);
                lastIndex = matches.index + matches[0].length;
                regex.lastIndex = lastIndex;

                // マッチした範囲のインデックスを記録
                for (let i = matches.index; i < lastIndex; i++) {
                    matchedIndexes.add(i);
                }

                // マッチ箇所を記録
                const term = terms[index];
                if (!currentMatches[term]) {
                    currentMatches[term] = [];
                }
                currentMatches[term].push(span);
            }
        });

        if (lastIndex < text.length) {
            newNodeContents.push(document.createTextNode(text.substring(lastIndex)));
        }

        if (newNodeContents.length > 0) {
            if (parent.contains(node)) {
                newNodeContents.forEach(nodeContent => parent.insertBefore(nodeContent, node));
                parent.removeChild(node);
            }
        }
    });

    injectStyles(colors);
}

// ハイライトを削除する関数
function removeHighlights() {
    const highlights = document.querySelectorAll('.chroma-highlight');
    highlights.forEach(span => {
        const parent = span.parentNode;
        parent.replaceChild(document.createTextNode(span.textContent), span);
        parent.normalize();
    });
}

// テキストノードを探索する関数
function walkTextNodes(node, callback) {
    if (node.nodeType === Node.TEXT_NODE) {
        callback(node);
    } else if (
        node.nodeType === Node.ELEMENT_NODE &&
        node.nodeName !== 'SCRIPT' &&
        node.nodeName !== 'STYLE' &&
        node.nodeName !== 'TEXTAREA' &&  // TEXTAREAを除外
        node.nodeName !== 'INPUT' &&     // INPUTを除外
        node.contentEditable !== 'true' &&
        !node.classList.contains('no-highlight') &&
        node.closest('.no-highlight') === null
    ) {
        let childNodes = Array.from(node.childNodes);  // 子ノードのリストを事前に取得
        for (let child of childNodes) {
            walkTextNodes(child, callback);
        }
    }
}

// 正規表現をエスケープする関数
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// スタイルを注入する関数
function injectStyles(colors) {
    const existingStyle = document.getElementById('chroma-find-styles');
    if (existingStyle) {
        existingStyle.remove();
    }

    const style = document.createElement('style');
    style.id = 'chroma-find-styles';
    style.textContent = `
        .chroma-highlight {
            background-color: transparent;
            display: inline;
            color: inherit;
        }

        .chroma-highlight-active {
            outline: 2px solid #FF0000 !important;
        }

        ${colors.map((color, index) => `
        .chroma-highlight-${index} {
            background-color: ${color};
            display: inline !important;
        }
        `).join('\n')}
    `;
    document.head.appendChild(style);
}

// スクロールする関数
function scrollToTerm(term, scrollIndex) {
    if (currentMatches[term] && currentMatches[term].length > 0) {
        const matchCount = currentMatches[term].length;
        const targetMatch = currentMatches[term][scrollIndex % matchCount];  // インデックスの範囲内にスクロール
        targetMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // ハイライトを明示的にするためにクラスを付与
        document.querySelectorAll('.chroma-highlight-active').forEach(el => {
            el.classList.remove('chroma-highlight-active');
        });
        targetMatch.classList.add('chroma-highlight-active');
    }
}

// メッセージを受信してハイライトを適用またはスクロール
browser.runtime.onMessage.addListener((message) => {
    if (message.action === 'highlight') {
        highlightText(message.terms, message.isRegexMode, message.colors);
    } else if (message.action === 'scrollToTerm') {
        scrollToTerm(message.term, message.scrollIndex);
    } else if (message.action === 'clearHighlights') {
        removeHighlights();
    }
});
