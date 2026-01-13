// content_script.js --- 最終版
let currentMatches = {};  // 各検索語の全マッチ箇所を保持
let currentSearchContext = {
    terms: [],
    isRegexMode: false,
    colors: []
}; // Global context for search terms, mode, and colors

/**
 * ページ上のすべての <textarea> を contenteditable な <div> に置き換える関数
 * 注意: この機能は無効化されています（体裁崩れとテキスト入力問題のため）
 */
function replaceTextareasWithEditableDivs() {
    // この機能は無効化されています
    // テキスト入力の問題と体裁崩れを防ぐため
    console.log('textarea replacement is disabled for stability');
    return;

}


/**
 * popup.jsにテキスト変更を通知する関数
 */
function notifyPopupOfTextChange() {
    try {
        // 現在のタブに対してメッセージを送信
        browser.runtime.sendMessage({
            action: 'textChanged',
            searchContext: currentSearchContext
        }).catch(error => {
            // popup.jsが開いていない場合はエラーが発生するが、これは正常
            console.log('Popup not open, skipping notification');
        });
    } catch (error) {
        console.log('Failed to notify popup:', error);
    }
}

/**
 * 手動で再検索を実行する関数
 */
function performReSearch() {
    console.log('Performing re-search...');
    console.log('Current search context:', currentSearchContext);

    if (currentSearchContext && currentSearchContext.terms && currentSearchContext.terms.length > 0) {
        try {
            const result = highlightText(currentSearchContext.terms, currentSearchContext.isRegexMode, currentSearchContext.colors);
            console.log('Re-search completed:', result);
            return result;
        } catch (error) {
            console.error('Error during re-search:', error);
        }
    } else {
        console.log('No search terms available for re-search');
    }
    return null;
}

/**
 * ビビッドカラーを生成する関数（はっきりした色を優先し、色相距離を最大化）
 */
function generateLightColors(count) {
    const colors = [];
    // はっきりした色から順番に配置し、色相距離も最大化
    const pasteColors = [
        'rgb(255, 220, 100)',  // 明るい黄色（最もはっきりした色）
        'rgb(255, 120, 180)',  // 明るいピンク（黄色から遠い色）
        'rgb(120, 255, 120)',  // 明るい緑（ピンクから遠い色）
        'rgb(120, 180, 255)',  // 明るい青（緑から遠い色）
        'rgb(255, 120, 120)',  // 明るい赤（青から遠い色）
        'rgb(180, 120, 255)',  // 明るい紫（赤から遠い色）
        'rgb(255, 180, 120)',  // 明るいオレンジ（紫から遠い色）
        'rgb(120, 220, 255)',  // 明るいターコイズ（オレンジから遠い色）
        'rgb(180, 255, 120)',  // 明るい黄緑（ターコイズから遠い色）
        'rgb(255, 120, 255)',  // 明るいマゼンタ（黄緑から遠い色）
        'rgb(220, 180, 120)',  // 明るいブラウン（マゼンタから遠い色）
        'rgb(255, 150, 200)',  // 明るいローズ（ブラウンから遠い色）
    ];

    for (let i = 0; i < count; i++) {
        colors.push(pasteColors[i % pasteColors.length]);
    }

    return colors;
}

/**
 * 背景色の明度に基づいて適切な文字色を決定する関数
 */
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

// ハイライトを適用する関数
function highlightText(terms, isRegexMode, colors) {
    // 現在フォーカスされている要素を保存
    const activeElement = document.activeElement;
    const isEditableDiv = activeElement && activeElement.contentEditable === 'true';
    let selection = null;
    let range = null;

    if (isEditableDiv) {
        selection = window.getSelection();
        if (selection.rangeCount > 0) {
            range = selection.getRangeAt(0).cloneRange();
        }
    }

    removeHighlights();
    currentMatches = {}; // スクロール機能のためにリセット

    if (!terms || terms.length === 0) {
        return { matchedTerms: [], termCounts: {} };
    }

    // 重複する単語を除去し、最初に出現した順序を保持
    const uniqueTerms = [];
    const seenTerms = new Set();
    terms.forEach(term => {
        if (!seenTerms.has(term)) {
            uniqueTerms.push(term);
            seenTerms.add(term);
        }
    });

    // 色が提供されていない場合は薄い色を生成
    if (!colors || colors.length === 0) {
        colors = generateLightColors(uniqueTerms.length);
    }

    const regexFlags = 'gi';
    let regexList = uniqueTerms.map((term, index) => {
        if (isRegexMode) {
            try { return { regex: new RegExp(term, regexFlags), termIndex: index, term: term, color: colors[index] }; }
            catch (e) { console.error('正規表現が無効です:', term, e); return null; }
        } else {
            // 検索語の前後の空白をトリムし、内部の空白文字を柔軟にマッチ
            const trimmedTerm = term.trim();
            if (trimmedTerm === '') return null;
            
            // まず正規表現の特殊文字をエスケープ
            const escapedTerm = escapeRegExp(trimmedTerm);
            // その後、エスケープされたスペースを \s+ に置換（空白文字を柔軟にマッチ）
            const flexibleTerm = escapedTerm.replace(/\\ /g, '\\s+').replace(/\s+/g, '\\s+');
            
            console.log('Original term:', JSON.stringify(term));
            console.log('Trimmed term:', JSON.stringify(trimmedTerm));
            console.log('Escaped term:', escapedTerm);
            console.log('Flexible term:', flexibleTerm);
            
            try { return { regex: new RegExp(flexibleTerm, regexFlags), termIndex: index, term: term, color: colors[index] }; }
            catch (e) { console.error('Error creating RegExp from flexible term:', flexibleTerm, e); return null; }
        }
    }).filter(Boolean);

    const allPotentialMatches = [];
    const processedNodes = new Set(); // 重複処理を防ぐ
    let matchCounter = 0; // 軽量なカウンター

    walkTextNodes(document.body, node => {
        // 既に処理済みのノードはスキップ
        if (processedNodes.has(node)) return;
        processedNodes.add(node);

        const text = node.nodeValue;
        if (text.includes('smtp1') || text.includes('CentOS5') || text.includes('rphsmta101')) {
            console.log('Found potential match in node:', JSON.stringify(text));
            console.log('Node text length:', text.length);
            // 文字コードも表示
            for (let i = 0; i < text.length; i++) {
                const char = text[i];
                if (char === ' ' || char === '　' || char === '-' || char === '>') {
                    console.log(`Character at ${i}: "${char}" (code: ${char.charCodeAt(0)})`);
                }
            }
        }
        regexList.forEach(item => {
            if (item.regex) {
                item.regex.lastIndex = 0;
                let match;
                while ((match = item.regex.exec(text)) !== null) {
                    console.log(`Match found for "${item.term}":`, match[0], 'at position', match.index);
                    allPotentialMatches.push({
                        start: match.index, end: match.index + match[0].length,
                        termIndex: item.termIndex, term: item.term, color: item.color,
                        matchText: match[0], node: node, matchId: ++matchCounter
                    });
                }
            }
        });
    });

    // 実際に表示されているマッチのみをカウント
    const termCounts = {};
    const finalMatchedTermsSet = new Set();

    // 各検索語のカウントを初期化
    uniqueTerms.forEach(term => {
        termCounts[term] = 0;
    });

    // ノードごとに重複を解決してから実際のマッチ数をカウント
    const matchesByNode = new Map();
    allPotentialMatches.forEach(match => {
        // 表示されている要素のマッチのみを処理
        if (isElementVisible(match.node.parentNode)) {
            if (!matchesByNode.has(match.node)) {
                matchesByNode.set(match.node, []);
            }
            matchesByNode.get(match.node).push(match);
        }
    });

    // 各ノードで重複を解決した後の実際のマッチ数をカウント
    matchesByNode.forEach((nodeMatches, originalNode) => {
        if (!originalNode.parentNode) return;

        // テキスト入力エリアの場合は特別な処理
        if (originalNode.isInputElement) {
            // テキスト入力エリアでも重複解決を行う
            nodeMatches.sort((a, b) => {
                if (a.start !== b.start) return a.start - b.start;
                return b.end - a.end;
            });

            let lastEnd = -1;
            for (const match of nodeMatches) {
                if (match.start >= lastEnd) {
                    finalMatchedTermsSet.add(match.term);
                    termCounts[match.term] = (termCounts[match.term] || 0) + 1;
                    lastEnd = match.end;
                }
            }
            return;
        }

        nodeMatches.sort((a, b) => {
            if (a.start !== b.start) return a.start - b.start;
            return b.end - a.end;
        });

        // 重複を解決して実際にハイライトされるマッチのみをカウント
        let lastEnd = -1;
        for (const match of nodeMatches) {
            if (match.start >= lastEnd) {
                finalMatchedTermsSet.add(match.term);
                termCounts[match.term] = (termCounts[match.term] || 0) + 1;
                lastEnd = match.end;
            }
        }
    });

    matchesByNode.forEach((nodeMatches, originalNode) => {
        if (!originalNode.parentNode) return;

        // テキスト入力エリアの場合は特別な処理
        if (originalNode.isInputElement) {
            handleInputElementMatches(nodeMatches, originalNode.inputElement);
            return;
        }

        nodeMatches.sort((a, b) => {
            if (a.start !== b.start) return a.start - b.start;
            return b.end - a.end;
        });

        const finalNodeMatches = [];
        let lastEnd = -1;
        for (const match of nodeMatches) {
            if (match.start >= lastEnd) {
                finalNodeMatches.push(match);
                lastEnd = match.end;
            }
        }

        let newNodeContent = '';
        let lastIndex = 0;
        for (const match of finalNodeMatches) {
            if (match.start > lastIndex) {
                newNodeContent += escapeHTML(originalNode.nodeValue.substring(lastIndex, match.start));
            }

            const term = match.term;
            const spanID = `highlight-${match.termIndex}-${match.matchId}`;

            if (!currentMatches[term]) {
                currentMatches[term] = [];
            }
            currentMatches[term].push(spanID);

            newNodeContent += `<span id="${spanID}" class="chroma-highlight" style="background-color:${match.color}; color:${getContrastTextColor(match.color)}">${escapeHTML(match.matchText)}</span>`;
            lastIndex = match.end;
        }
        if (lastIndex < originalNode.nodeValue.length) {
            newNodeContent += escapeHTML(originalNode.nodeValue.substring(lastIndex));
        }

        if (newNodeContent) {
            replaceNodeWithInnerHTML(originalNode, newNodeContent);
        }
    });

    injectStyles(colors);

    // フォーカスとカーソル位置を復元
    if (isEditableDiv && range) {
        activeElement.focus();
        try {
            selection.removeAllRanges();
            selection.addRange(range);
        } catch (e) {
            // カーソル位置の復元に失敗した場合は末尾にカーソルを置く
            const newRange = document.createRange();
            newRange.selectNodeContents(activeElement);
            newRange.collapse(false);
            selection.removeAllRanges();
            selection.addRange(newRange);
        }
    }

    console.log('Final term counts:', termCounts); // デバッグ用ログ
    return { matchedTerms: Array.from(finalMatchedTermsSet), termCounts };
}



/**
 * テキスト入力エリア（textarea、input）のマッチを処理する関数
 */
function handleInputElementMatches(nodeMatches, inputElement) {
    // テキスト入力エリア内でも通常のテキストハイライトを適用
    nodeMatches.sort((a, b) => {
        if (a.start !== b.start) return a.start - b.start;
        return b.end - a.end;
    });

    const finalNodeMatches = [];
    let lastEnd = -1;
    for (const match of nodeMatches) {
        if (match.start >= lastEnd) {
            finalNodeMatches.push(match);
            lastEnd = match.end;
        }
    }

    // テキスト入力エリアの値にハイライトHTMLを適用
    let newContent = '';
    let lastIndex = 0;
    const originalValue = inputElement.value;

    for (const match of finalNodeMatches) {
        if (match.start > lastIndex) {
            newContent += escapeHTML(originalValue.substring(lastIndex, match.start));
        }

        const term = match.term;
        const spanID = `highlight-${match.termIndex}-${match.matchId}`;

        if (!currentMatches[term]) {
            currentMatches[term] = [];
        }
        currentMatches[term].push(spanID);

        newContent += `<span id="${spanID}" class="chroma-highlight" style="background-color:${match.color}; color:${getContrastTextColor(match.color)}">${escapeHTML(match.matchText)}</span>`;
        lastIndex = match.end;
    }
    if (lastIndex < originalValue.length) {
        newContent += escapeHTML(originalValue.substring(lastIndex));
    }

    // テキスト入力エリアをcontenteditable divに一時的に変換してハイライト表示
    if (newContent && finalNodeMatches.length > 0) {
        const div = document.createElement('div');
        div.innerHTML = newContent;
        div.contentEditable = true;
        div.className = inputElement.className + ' chroma-input-converted';
        div.style.cssText = window.getComputedStyle(inputElement).cssText;
        div.style.border = window.getComputedStyle(inputElement).border;
        div.style.padding = window.getComputedStyle(inputElement).padding;
        div.style.margin = window.getComputedStyle(inputElement).margin;
        div.style.width = window.getComputedStyle(inputElement).width;
        div.style.height = window.getComputedStyle(inputElement).height;
        div.style.fontSize = window.getComputedStyle(inputElement).fontSize;
        div.style.fontFamily = window.getComputedStyle(inputElement).fontFamily;

        // 元の要素を隠してdivを表示
        inputElement.style.display = 'none';
        inputElement.setAttribute('data-chroma-original', 'true');
        inputElement.parentNode.insertBefore(div, inputElement.nextSibling);
    }
}

function escapeHTML(str) {
    const p = document.createElement("p");
    p.appendChild(document.createTextNode(str));
    return p.innerHTML;
}

function replaceNodeWithInnerHTML(node, newHTML) {
    if (!node || !node.parentNode) return;
    const fragment = document.createDocumentFragment();
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = newHTML;
    while (tempDiv.firstChild) {
        fragment.appendChild(tempDiv.firstChild);
    }
    node.parentNode.replaceChild(fragment, node);
}

function removeHighlights() {
    const highlights = document.querySelectorAll('.chroma-highlight');
    if (highlights.length === 0) return;

    const parentsToNormalize = new Set();
    highlights.forEach(span => {
        const parent = span.parentNode;
        if (parent) {
            parentsToNormalize.add(parent);
            parent.replaceChild(document.createTextNode(span.textContent), span);
        }
    });

    parentsToNormalize.forEach(parent => {
        parent.normalize();
    });

    // 変換されたテキスト入力エリアを元に戻す
    const convertedDivs = document.querySelectorAll('.chroma-input-converted');
    convertedDivs.forEach(div => {
        div.remove();
    });

    const hiddenInputs = document.querySelectorAll('[data-chroma-original="true"]');
    hiddenInputs.forEach(input => {
        input.style.display = '';
        input.removeAttribute('data-chroma-original');
    });
}

function walkTextNodes(node, callback) {
    if (node.nodeType === Node.TEXT_NODE && node.nodeValue.trim().length > 0) {
        // 親要素が表示されているかチェック
        if (!node.parentNode ||
            ['SCRIPT', 'STYLE'].includes(node.parentNode.nodeName) ||
            node.parentNode.closest('.no-highlight') ||
            !isElementVisible(node.parentNode)) return;
        callback(node);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
        // ポップアップ関連の要素を除外
        const excludedElements = ['SCRIPT', 'STYLE'];
        const excludedClasses = ['modal', 'popup', 'tooltip', 'dropdown', 'overlay', 'dialog'];
        const excludedRoles = ['dialog', 'alertdialog', 'tooltip'];

        if (excludedElements.includes(node.nodeName) ||
            node.classList.contains('no-highlight') ||
            node.closest('.no-highlight') ||
            excludedClasses.some(cls => node.classList.contains(cls)) ||
            excludedRoles.includes(node.getAttribute('role')) ||
            node.hasAttribute('aria-modal') ||
            !isElementVisible(node)) return;

        // テキスト入力エリア（textarea、input）の値もチェック
        if (node.nodeName === 'TEXTAREA' || (node.nodeName === 'INPUT' && node.type === 'text')) {
            if (node.value && node.value.trim()) {
                // 仮想的なテキストノードとして処理
                const virtualTextNode = {
                    nodeType: Node.TEXT_NODE,
                    nodeValue: node.value,
                    parentNode: node,
                    isInputElement: true,
                    inputElement: node
                };
                callback(virtualTextNode);
            }
        }

        Array.from(node.childNodes).forEach(child => walkTextNodes(child, callback));
    }
}

/**
 * 要素が実際に表示されているかどうかをチェックする関数
 */
function isElementVisible(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return true;

    // 計算されたスタイルを取得
    const style = window.getComputedStyle(element);

    // 非表示の条件をチェック
    if (style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.opacity === '0' ||
        element.hidden ||
        element.hasAttribute('hidden')) {
        return false;
    }

    // 親要素も再帰的にチェック（ただし、body要素まで）
    if (element.parentElement && element.parentElement !== document.body) {
        return isElementVisible(element.parentElement);
    }

    return true;
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function injectStyles(colors) {
    const existingStyle = document.getElementById('chroma-find-styles');
    if (existingStyle) existingStyle.remove();

    const style = document.createElement('style');
    style.id = 'chroma-find-styles';
    style.textContent = `
        .chroma-highlight { 
            background-color: transparent; 
            display: inline; 
        }
        .chroma-highlight-active { 
            outline: 2px solid #FF0000 !important; 
            box-shadow: 0 0 5px #FF0000; 
        }
        .chroma-input-converted {
            white-space: pre-wrap;
            word-wrap: break-word;
        }
    `;
    document.head.appendChild(style);
}

function scrollToTerm(term, scrollIndex) {
    if (currentMatches[term] && currentMatches[term].length > 0) {
        const matchCount = currentMatches[term].length;
        const targetID = currentMatches[term][scrollIndex % matchCount];
        const targetElement = document.getElementById(targetID);

        if (targetElement) {
            targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            document.querySelectorAll('.chroma-highlight-active').forEach(el => {
                el.classList.remove('chroma-highlight-active');
            });
            targetElement.classList.add('chroma-highlight-active');
        }
    }
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'highlight') {
        // 色が不足している場合は薄い色を生成
        let colors = message.colors || [];
        if (colors.length < (message.terms || []).length) {
            colors = generateLightColors((message.terms || []).length);
        }

        currentSearchContext = {
            terms: message.terms || [],
            isRegexMode: message.isRegexMode,
            colors: colors
        };

        console.log('Search context updated:', currentSearchContext);

        // textarea置換は行わず、通常のハイライトのみ
        const result = highlightText(currentSearchContext.terms, currentSearchContext.isRegexMode, currentSearchContext.colors);

        sendResponse(result);
        return true;

    } else if (message.action === 'scrollToTerm') {
        scrollToTerm(message.term, message.scrollIndex);
        sendResponse({});
        return true;
    } else if (message.action === 'clearHighlights') {
        removeHighlights();
        currentSearchContext = { terms: [], isRegexMode: false, colors: [] };
        sendResponse({});
        return true;
    }
});

function initializeContentScript() {
    console.log('Content script initialized.');

    // 拡張機能のポップアップ内では実行しない
    if (window.location.href.includes('extension://') ||
        window.location.protocol === 'moz-extension:' ||
        document.title.includes('popup') ||
        document.body.offsetWidth < 500 && document.body.offsetHeight < 600) {
        console.log('Skipping content script in extension popup');
        return;
    }

    // textarea置換は行わず、通常のハイライト機能のみ提供
    // replaceTextareasWithEditableDivs();

    // DOM変更を監視して新しい要素を処理
    const observer = new MutationObserver((mutations) => {
        // 新しい要素が追加された場合のみ軽微な処理
        for (let mutation of mutations) {
            if (mutation.addedNodes.length > 0) {
                // 特別な処理は行わない
            }
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
}

initializeContentScript();
