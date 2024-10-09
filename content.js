let currentMatches = {};  // 各検索語の全マッチ箇所を保持

// ハイライトを適用する関数
function highlightText(terms, isRegexMode, colors) {
    removeHighlights();  // 既存のハイライトを削除
    currentMatches = {};  // マッチ箇所をリセット

    if (!terms || terms.length === 0) {
        return;
    }

    let matchedTerms = [];  // マッチした検索語を追跡

    const regexFlags = 'gi';  // グローバルかつ大文字小文字を区別しないフラグ
    let regexList = terms.map(term => {
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
    }).filter(Boolean);  // 無効な正規表現を除去

    // 検索語の長さ順にソートして、重複を防ぐ（長い単語を優先的にハイライト）
    regexList.sort((a, b) => b.source.length - a.source.length);

    // ノードの処理
    walkTextNodes(document.body, node => {
        let text = node.nodeValue;
        let newText = text;  
        regexList.forEach((regex, index) => {
            const color = colors[index];
            newText = newText.replace(regex, (match) => {
                if (!matchedTerms.includes(terms[index])) {
                    matchedTerms.push(terms[index]);  // マッチした検索語を追加
                }
                const spanID = `highlight-${index}-${currentMatches[match] ? currentMatches[match].length : 0}`;
                currentMatches[match] = currentMatches[match] || [];
                currentMatches[match].push(spanID);
                return `<span id="${spanID}" class="chroma-highlight" style="background-color:${color}">${match}</span>`;
            });
        });

        // 元のテキストを置き換え
        if (newText !== text) {
            replaceNodeWithInnerHTML(node, newText);
        }
    });

    injectStyles(colors);

    // マッチした検索語を返す
    return { matchedTerms };
}

// ノードを innerHTML を使って置き換える関数
function replaceNodeWithInnerHTML(node, newText) {
    const parent = node.parentNode;
    if (parent) {
        const span = document.createElement('span');
        span.innerHTML = newText;
        parent.replaceChild(span, node);
    }
}

// ハイライトを削除する関数
function removeHighlights() {
    const highlights = document.querySelectorAll('.chroma-highlight');
    highlights.forEach(span => {
        const parent = span.parentNode;
        parent.replaceChild(document.createTextNode(span.textContent), span);
        parent.normalize();  // テキストノードを適切に結合
    });
}

// テキストノードを再帰的に探索し、ハイライトを適用する関数
function walkTextNodes(node, callback) {
    if (node.nodeType === Node.TEXT_NODE && node.nodeValue.trim().length > 0) {
        callback(node);
    } else if (
        node.nodeType === Node.ELEMENT_NODE &&
        node.nodeName !== 'SCRIPT' &&
        node.nodeName !== 'STYLE' &&
        node.nodeName !== 'TEXTAREA' &&
        node.nodeName !== 'INPUT' &&
        node.contentEditable !== 'true' &&
        !node.classList.contains('no-highlight') &&
        node.closest('.no-highlight') === null
    ) {
        let childNodes = Array.from(node.childNodes);
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
        const targetID = currentMatches[term][scrollIndex % matchCount];  // インデックスの範囲内にスクロール
        const targetElement = document.getElementById(targetID);
        if (targetElement) {
            targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

            // ハイライトを明示的にするためにクラスを付与
            document.querySelectorAll('.chroma-highlight-active').forEach(el => {
                el.classList.remove('chroma-highlight-active');
            });
            targetElement.classList.add('chroma-highlight-active');
        }
    }
}

// メッセージを受信してハイライトを適用またはスクロール
browser.runtime.onMessage.addListener((message) => {
    if (message.action === 'highlight') {
        const matchedTerms = highlightText(message.terms, message.isRegexMode, message.colors);
        return Promise.resolve(matchedTerms);  // マッチした検索語を返す
    } else if (message.action === 'scrollToTerm') {
        scrollToTerm(message.term, message.scrollIndex);
    } else if (message.action === 'clearHighlights') {
        removeHighlights();
    }
});
