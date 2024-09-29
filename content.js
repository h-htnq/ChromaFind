// content.js

// 既存のハイライトをクリアする関数
function clearHighlights() {
    const highlightedElements = document.querySelectorAll('span.custom-highlight');
    highlightedElements.forEach(span => {
      const parent = span.parentNode;
      parent.replaceChild(document.createTextNode(span.textContent), span);
      parent.normalize(); // テキストノードを統合
    });
  }
  
  // テキストノードを検索してハイライトする関数
  function highlightText(searchTerms) {
    if (!searchTerms || searchTerms.length === 0) return;
  
    searchTerms.forEach(({ term, color }) => {
      if (!term.trim()) return; // 空の検索語はスキップ
  
      const regex = new RegExp(`(${escapeRegExp(term)})`, 'gi');
  
      traverseAndHighlight(document.body, regex, color);
    });
  
    // ハイライトされた要素を更新
    updateHighlightedElements();
  }
  
  // テキストを安全に扱うためのエスケープ関数
  function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  
  // DOMを再帰的にトラバースし、テキストノードをハイライトする関数
  function traverseAndHighlight(node, regex, color) {
    if (node.nodeType === Node.TEXT_NODE) {
      const matches = node.nodeValue.match(regex);
      if (matches) {
        const parent = node.parentNode;
        const frag = document.createDocumentFragment();
        let lastIndex = 0;
  
        node.nodeValue.replace(regex, (match, p1, offset) => {
          // テキストの前半部分
          const textBefore = node.nodeValue.substring(lastIndex, offset);
          if (textBefore) {
            frag.appendChild(document.createTextNode(textBefore));
          }
  
          // ハイライト部分
          const span = document.createElement('span');
          span.textContent = match;
          span.style.backgroundColor = color;
          span.classList.add('custom-highlight');
          frag.appendChild(span);
  
          lastIndex = offset + match.length;
        });
  
        // 残りのテキスト
        const textAfter = node.nodeValue.substring(lastIndex);
        if (textAfter) {
          frag.appendChild(document.createTextNode(textAfter));
        }
  
        parent.replaceChild(frag, node);
      }
    } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName !== 'SCRIPT' && node.tagName !== 'STYLE') {
      // スクリプトやスタイルタグ内はスキップ
      Array.from(node.childNodes).forEach(child => traverseAndHighlight(child, regex, color));
    }
  }
  
  // ハイライトされた要素のリストと現在のインデックス
  let highlightedElements = [];
  let currentIndex = -1;
  
  // ハイライトされた要素を更新する関数
  function updateHighlightedElements() {
    highlightedElements = Array.from(document.querySelectorAll('span.custom-highlight'));
    if (highlightedElements.length > 0) {
      currentIndex = 0;
      scrollToElement(highlightedElements[currentIndex]);
    } else {
      currentIndex = -1;
    }
  }
  
  // 要素にスクロールする関数
  function scrollToElement(element) {
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // フォーカスを当該要素に移す（視認性向上のため）
    element.style.outline = '2px solid red';
    setTimeout(() => {
      element.style.outline = '';
    }, 1000);
  }
  
  // 次の要素にスクロールする関数
  function scrollNext() {
    if (highlightedElements.length === 0) return;
    currentIndex = (currentIndex + 1) % highlightedElements.length;
    scrollToElement(highlightedElements[currentIndex]);
  }
  
  // 前の要素にスクロールする関数
  function scrollPrev() {
    if (highlightedElements.length === 0) return;
    currentIndex = (currentIndex - 1 + highlightedElements.length) % highlightedElements.length;
    scrollToElement(highlightedElements[currentIndex]);
  }
  
  // メッセージを受信してハイライトやスクロールを実行
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "highlight") {
      clearHighlights();
      const searchTerms = message.searchTerms;
  
      if (!searchTerms || searchTerms.length === 0) {
        sendResponse({ status: "ハイライトをクリアしました" });
        return;
      }
  
      highlightText(searchTerms);
      sendResponse({ status: "ハイライトしました" });
    } else if (message.action === "scrollNext") {
      scrollNext();
      sendResponse({ status: "次のハイライトへスクロールしました" });
    } else if (message.action === "scrollPrev") {
      scrollPrev();
      sendResponse({ status: "前のハイライトへスクロールしました" });
    }
  });
