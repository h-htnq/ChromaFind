// content_script.js --- 最終版
let currentMatches = {};  // 各検索語の全マッチ箇所を保持
let currentSearchContext = {
    terms: [],
    isRegexMode: false,
    colors: []
}; // Global context for search terms, mode, and colors

/**
 * ページ上のすべての <textarea> を contenteditable な <div> に置き換える関数
 */
function replaceTextareasWithEditableDivs() {
    // 拡張機能のポップアップ内では実行しない
    if (window.location.href.includes('extension://') || 
        window.location.protocol === 'moz-extension:' ||
        document.documentElement.getAttribute('data-extension-popup') === 'true') {
        return;
    }

    // data-is-replaced属性を持たないtextareaだけを対象にする
    // ポップアップ内のtextareaは除外
    const textareas = document.querySelectorAll('textarea:not([data-is-replaced="true"])');

    textareas.forEach(textarea => {
        // ポップアップ関連の親要素内にある場合はスキップ
        const excludedSelectors = [
            '.modal', '.popup', '.tooltip', '.dropdown', '.overlay', '.dialog',
            '[role="dialog"]', '[role="alertdialog"]', '[role="tooltip"]', '[aria-modal="true"]'
        ];

        if (excludedSelectors.some(selector => textarea.closest(selector))) {
            return; // この textarea はスキップ
        }

        // 拡張機能のポップアップ内の要素をスキップ
        if (textarea.closest('body').classList.contains('extension-popup') || 
            document.body.classList.contains('extension-popup') ||
            window.location.href.includes('extension://') ||
            window.location.protocol === 'moz-extension:') {
            return; // 拡張機能内の textarea はスキップ
        }

        // position: fixed/absolute の親要素内にある場合もスキップ
        let parent = textarea.parentElement;
        while (parent && parent !== document.body) {
            const computedStyle = window.getComputedStyle(parent);
            if (computedStyle.position === 'fixed' || computedStyle.position === 'absolute') {
                return; // この textarea はスキップ
            }
            parent = parent.parentElement;
        }

        textarea.dataset.isReplaced = 'true'; // 処理済みのマークを付ける

        const editableDiv = document.createElement('div');
        editableDiv.contentEditable = 'true';
        editableDiv.textContent = textarea.value;

        const styles = window.getComputedStyle(textarea);
        const styleProperties = [
            'font', 'border', 'padding', 'margin', 'width', 'height',
            'resize', 'backgroundColor', 'color', 'lineHeight', 'boxSizing',
            'borderRadius', 'outline'
        ];
        styleProperties.forEach(prop => {
            editableDiv.style[prop] = styles[prop];
        });

        editableDiv.style.overflowY = 'auto';
        editableDiv.style.whiteSpace = 'pre-wrap';
        // wordWrap は非推奨なので wordBreak に変更
        editableDiv.style.wordBreak = 'break-word';

        textarea.style.display = 'none';
        textarea.parentNode.insertBefore(editableDiv, textarea.nextSibling);

        editableDiv.addEventListener('input', () => {
            textarea.value = editableDiv.textContent;
            
            // 入力が止まったら再検索（遅延を短くして応答性向上）
            clearTimeout(editableDiv.searchTimer);
            editableDiv.searchTimer = setTimeout(() => {
                performReSearch();
                notifyPopupOfTextChange();
            }, 300); // 300ms後に再検索
        });

        // フォーカス時の処理
        editableDiv.addEventListener('focus', () => {
            // フォーカス時は特別な処理なし
        });

        // ブラー時の処理
        editableDiv.addEventListener('blur', () => {
            // タイマーをクリアして即座に再検索
            clearTimeout(editableDiv.searchTimer);
            performReSearch();
            notifyPopupOfTextChange();
        });

        // キーボード入力の処理を改善
        editableDiv.addEventListener('keydown', (e) => {
            // Enterキーで改行を許可
            if (e.key === 'Enter') {
                e.preventDefault();
                const selection = window.getSelection();
                const range = selection.getRangeAt(0);
                const br = document.createElement('br');
                range.deleteContents();
                range.insertNode(br);
                range.setStartAfter(br);
                range.setEndAfter(br);
                selection.removeAllRanges();
                selection.addRange(range);

                // textareaの値を更新
                textarea.value = editableDiv.textContent;
                
                // Enterキー押下時に即座に再検索
                performReSearch();
            }
        });

        // ペースト処理の改善
        editableDiv.addEventListener('paste', (e) => {
            e.preventDefault();
            const text = (e.clipboardData || window.clipboardData).getData('text');
            const selection = window.getSelection();
            if (selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                range.deleteContents();
                range.insertNode(document.createTextNode(text));
                range.collapse(false);
                selection.removeAllRanges();
                selection.addRange(range);
            }

            // textareaの値を更新
            textarea.value = editableDiv.textContent;
            
            // ペースト後に再検索
            setTimeout(() => {
                performReSearch();
            }, 100); // 少し遅延させてDOM更新を待つ
        });

        // MutationObserverでtextareaの値変更を監視
        const observer = new MutationObserver(() => {
            if (editableDiv.textContent !== textarea.value) {
                editableDiv.textContent = textarea.value;
            }
        });
        observer.observe(textarea, { attributes: true, childList: true, subtree: true, characterData: true });

        // プロパティ変更も監視（JavaScriptでの.val()設定をキャッチ）
        let lastValue = textarea.value;
        const checkValueChange = () => {
            if (textarea.value !== lastValue) {
                lastValue = textarea.value;
                editableDiv.textContent = textarea.value;
                // ハイライトを再適用
                if (currentSearchContext.terms.length > 0) {
                    highlightText(currentSearchContext.terms, currentSearchContext.isRegexMode, currentSearchContext.colors);
                }
            }
        };

        // 定期的にチェック（JavaScriptでの値変更をキャッチするため）
        setInterval(checkValueChange, 100);

        // inputイベントも監視
        textarea.addEventListener('input', checkValueChange);

        // jQueryのval()メソッドをフック
        if (window.jQuery) {
            const originalVal = window.jQuery.fn.val;
            window.jQuery.fn.val = function (value) {
                const result = originalVal.apply(this, arguments);
                if (arguments.length > 0 && this[0] === textarea) {
                    setTimeout(checkValueChange, 0);
                }
                return result;
            };
        }
    });
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
            const escapedTerm = escapeRegExp(term);
            try { return { regex: new RegExp(escapedTerm, regexFlags), termIndex: index, term: term, color: colors[index] }; }
            catch (e) { console.error('Error creating RegExp from escaped term:', escapedTerm, e); return null; }
        }
    }).filter(Boolean);

    // 長い順のソートはpopup.jsに任せる

    const allPotentialMatches = [];
    walkTextNodes(document.body, node => {
        const text = node.nodeValue;
        regexList.forEach(item => {
            if (item.regex) {
                item.regex.lastIndex = 0;
                let match;
                while ((match = item.regex.exec(text)) !== null) {
                    allPotentialMatches.push({
                        start: match.index, end: match.index + match[0].length,
                        termIndex: item.termIndex, term: item.term, color: item.color,
                        matchText: match[0], node: node
                    });
                }
            }
        });
    });

    const termCounts = {};
    const finalMatchedTermsSet = new Set();
    allPotentialMatches.forEach(match => {
        finalMatchedTermsSet.add(match.term);
        termCounts[match.term] = (termCounts[match.term] || 0) + 1;
    });
    terms.forEach(term => {
        if (termCounts[term] === undefined) termCounts[term] = 0;
    });

    const matchesByNode = new Map();
    allPotentialMatches.forEach(match => {
        if (!matchesByNode.has(match.node)) {
            matchesByNode.set(match.node, []);
        }
        matchesByNode.get(match.node).push(match);
    });

    matchesByNode.forEach((nodeMatches, originalNode) => {
        if (!originalNode.parentNode) return;

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
            const spanID = `highlight-${match.termIndex}-${allPotentialMatches.indexOf(match)}`;

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

    return { matchedTerms: Array.from(finalMatchedTermsSet), termCounts };
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
}

function walkTextNodes(node, callback) {
    if (node.nodeType === Node.TEXT_NODE && node.nodeValue.trim().length > 0) {
        if (!node.parentNode || ['SCRIPT', 'STYLE'].includes(node.parentNode.nodeName) || node.parentNode.closest('.no-highlight')) return;
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
            node.style.position === 'fixed' ||
            node.style.position === 'absolute') return;

        Array.from(node.childNodes).forEach(child => walkTextNodes(child, callback));
    }
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

        replaceTextareasWithEditableDivs();
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

    // jQueryのval()メソッドをグローバルにフック
    if (window.jQuery) {
        const originalVal = window.jQuery.fn.val;
        window.jQuery.fn.val = function (value) {
            const result = originalVal.apply(this, arguments);
            if (arguments.length > 0) {
                // 値が設定された場合、対応するeditableDivを更新
                this.each(function () {
                    if (this.tagName === 'TEXTAREA' && this.dataset.isReplaced === 'true') {
                        const editableDiv = this.nextElementSibling;
                        if (editableDiv && editableDiv.contentEditable === 'true') {
                            editableDiv.textContent = this.value;
                            // ハイライトを即座に再適用
                            if (currentSearchContext.terms.length > 0) {
                                performReSearch();
                            }
                        }
                    }
                });
            }
            return result;
        };
    }

    replaceTextareasWithEditableDivs();

    // DOM変更を監視して新しいtextareaを処理
    const observer = new MutationObserver((mutations) => {
        let needsCheck = false;
        
        for (let mutation of mutations) {
            // 新しいtextareaが追加された場合のみ処理
            if (mutation.addedNodes.length > 0) {
                for (let addedNode of mutation.addedNodes) {
                    if (addedNode.nodeType === Node.ELEMENT_NODE && (addedNode.querySelector('textarea:not([data-is-replaced="true"])') || addedNode.matches('textarea:not([data-is-replaced="true"])'))) {
                        // ポップアップ関連の要素内の変更は無視
                        const excludedSelectors = [
                            '.modal', '.popup', '.tooltip', '.dropdown', '.overlay', '.dialog',
                            '[role="dialog"]', '[role="alertdialog"]', '[role="tooltip"]', '[aria-modal="true"]'
                        ];

                        if (!excludedSelectors.some(selector => addedNode.closest(selector))) {
                            needsCheck = true;
                        }
                    }
                }
            }
        }

        if (needsCheck) {
            replaceTextareasWithEditableDivs();
        }
    });

    observer.observe(document.body, { 
        childList: true, 
        subtree: true
    });
}

initializeContentScript();
