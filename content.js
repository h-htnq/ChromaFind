// ハイライトを適用する関数
function highlightText(terms, isRegexMode, colors) {
  removeHighlights();  // 既存のハイライトを削除

  if (!terms || terms.length === 0) {
      return;
  }

  const regexFlags = 'gi';  // グローバルかつ大文字小文字を区別しないフラグ
  let regexList = [];

  if (isRegexMode) {
      try {
          regexList = terms.map(term => new RegExp(term, regexFlags));
      } catch (e) {
          console.error('正規表現が無効です:', e);
          return;
      }
  } else {
      regexList = terms.map(term => new RegExp(escapeRegExp(term), regexFlags));
  }

  // テキストノードを再帰的に処理してハイライトを適用
  walkTextNodes(document.body, node => {
      let parent = node.parentNode;
      let text = node.nodeValue;

      regexList.forEach((regex, index) => {
          let matches;
          let lastIndex = 0;  // ハイライト済みのテキストを追跡するインデックス

          while ((matches = regex.exec(text)) !== null) {
              if (parent.nodeName === 'SCRIPT' || parent.nodeName === 'STYLE') return; // スクリプトやスタイルタグは無視

              // マッチしたテキストをハイライト
              let span = document.createElement('span');
              span.className = `chroma-highlight chroma-highlight-${index}`;
              span.style.backgroundColor = colors[index];
              span.textContent = matches[0];

              // マッチした部分の前のテキストを保持
              const beforeMatch = document.createTextNode(text.substring(lastIndex, matches.index));
              const afterMatch = document.createTextNode(text.substring(matches.index + matches[0].length));

              // ハイライトを挿入
              parent.insertBefore(beforeMatch, node);
              parent.insertBefore(span, beforeMatch.nextSibling);
              parent.insertBefore(afterMatch, span.nextSibling);

              parent.removeChild(node); // 元のテキストノードを削除
              node = afterMatch;  // 残りのテキストノードを処理
              lastIndex = matches.index + matches[0].length;
              regex.lastIndex = lastIndex; // 次のマッチを探すためにインデックスを更新
          }
      });
  });

  // スタイルの注入
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

  // 既存のスタイルも削除
  const existingStyle = document.getElementById('chroma-find-styles');
  if (existingStyle) {
      existingStyle.remove();
  }
}

// テキストノードを探索する関数
function walkTextNodes(node, callback) {
  if (node.nodeType === Node.TEXT_NODE) {
      callback(node);
  } else if (
      node.nodeType === Node.ELEMENT_NODE &&
      node.nodeName !== 'SCRIPT' &&
      node.nodeName !== 'STYLE' &&
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
      }
      `).join('\n')}
  `;
  document.head.appendChild(style);
}

// 特定の用語にスクロールする関数
function scrollToTerm(term, isRegexMode) {
  let regex;
  const regexFlags = 'gi';

  if (isRegexMode) {
      try {
          regex = new RegExp(term, regexFlags);
      } catch (e) {
          console.error('正規表現が無効です:', e);
          return;
      }
  } else {
      regex = new RegExp(escapeRegExp(term), regexFlags);
  }

  const highlights = document.querySelectorAll('.chroma-highlight');
  for (let highlight of highlights) {
      if (regex.test(highlight.textContent)) {
          highlight.scrollIntoView({ behavior: 'smooth', block: 'center' });
          highlight.classList.add('chroma-highlight-active');
          setTimeout(() => {
              highlight.classList.remove('chroma-highlight-active');
          }, 2000);
          break;
      }
  }
}

// ページロード時に保存された検索語を取得してハイライトを適用
window.addEventListener('load', () => {
  browser.storage.local.get(['searchTerms', 'isRegexMode', 'highlightColors']).then((result) => {
      const terms = result.searchTerms || [];
      const isRegexMode = result.isRegexMode || false;
      const colors = result.highlightColors || [
          '#FFD700', '#32CD32', '#00CED1', '#FF69B4', '#FFA500',
          '#BA55D3', '#1E90FF', '#ADFF2F', '#FFB6C1', '#D3D3D3'
      ];

      if (terms.length > 0) {
          highlightText(terms, isRegexMode, colors);
      }
  }).catch((error) => {
      console.error('Error retrieving search terms from storage:', error);
  });
});

// メッセージを受信してハイライトを適用またはスクロール
browser.runtime.onMessage.addListener((message) => {
  if (message.action === 'highlight') {
      const terms = message.terms;
      const isRegexMode = message.isRegexMode;
      const colors = message.colors;
      highlightText(terms, isRegexMode, colors);
  } else if (message.action === 'scrollToTerm') {
      scrollToTerm(message.term, message.isRegexMode);
  } else if (message.action === 'clearHighlights') {
      removeHighlights();
  }
});
