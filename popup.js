// popup.js

document.addEventListener('DOMContentLoaded', () => {
    const highlightButton = document.getElementById('highlightButton');
    const clearButton = document.getElementById('clearButton');
    const prevButton = document.getElementById('prevButton');
    const nextButton = document.getElementById('nextButton');
    const searchInput = document.getElementById('searchInput');
    const closeButton = document.getElementById('closeButton'); // 閉じるボタンの取得

    // 使用するハイライト色の配列
    const highlightColors = [
      '#FFD700', // ゴールド
      '#32CD32', // ライムグリーン
      '#00CED1', // ダークターコイズ
      '#FF69B4', // ホットピンク
      '#FFA500', // オレンジ
      '#BA55D3', // ミディアムオーキッド
      '#1E90FF', // ドジャーブルー
      '#ADFF2F', // グリーンイエロー
      '#FFB6C1', // ライトピンク
      '#D3D3D3'  // ライトグレー
    ];

    // 閉じるボタンのクリックイベント
    closeButton.addEventListener('click', () => {
      window.close();
    });

    // 検索語をストレージから復元
    browser.storage.local.get('searchTerms').then((result) => {
      const searchTerms = result.searchTerms;
      if (searchTerms && searchTerms.length > 0) {
        const query = searchTerms.map(item => item.term).join('\n');
        searchInput.value = query;
      }
    }).catch(error => {
      console.error("ストレージからの取得エラー:", error);
    });

    // ハイライトボタンのクリックイベント
    highlightButton.addEventListener('click', () => {
      const query = searchInput.value;
      if (!query.trim()) {
        // アラートを削除またはコメントアウト
        // alert('検索文字列を入力してください。');
        return; // 何も入力されていない場合は無反応
      }

      // 各行の検索語を取得
      const searchTerms = query.split(/\r?\n/).map(term => term.trim()).filter(term => term.length > 0);

      if (searchTerms.length === 0) {
        // アラートを削除またはコメントアウト
        // alert('有効な検索文字列がありません。');
        return; // 有効な検索語がない場合は無反応
      }

      // 各検索語に色を割り当てる
      const termsWithColors = searchTerms.map((term, index) => ({
        term: term,
        color: highlightColors[index % highlightColors.length]
      }));

      // 検索語をストレージに保存
      browser.storage.local.set({ searchTerms: termsWithColors }).then(() => {
        console.log("検索語をストレージに保存しました。");
      }).catch(error => {
        console.error("ストレージへの保存エラー:", error);
      });

      // 現在のタブを取得してメッセージを送信
      browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
        if (tabs.length === 0) return;

        browser.tabs.sendMessage(tabs[0].id, { action: "highlight", searchTerms: termsWithColors }).then(response => {
          console.log(response.status);
        }).catch(error => {
          console.error("メッセージ送信エラー:", error);
        });
      });
    });

    // クリアボタンのクリックイベント
    clearButton.addEventListener('click', () => {
      // 検索語をストレージから削除
      browser.storage.local.remove('searchTerms').then(() => {
        console.log("ストレージから検索語を削除しました。");
      }).catch(error => {
        console.error("ストレージからの削除エラー:", error);
      });

      // 現在のタブを取得してメッセージを送信（空の検索Termsでハイライトをクリア）
      browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
        if (tabs.length === 0) return;

        browser.tabs.sendMessage(tabs[0].id, { action: "highlight", searchTerms: [] }).then(response => {
          console.log(response.status);
        }).catch(error => {
          console.error("メッセージ送信エラー:", error);
        });
      });
    });

    // 前へボタンのクリックイベント
    prevButton.addEventListener('click', () => {
      browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
        if (tabs.length === 0) return;

        browser.tabs.sendMessage(tabs[0].id, { action: "scrollPrev" }).then(response => {
          console.log(response.status);
        }).catch(error => {
          console.error("メッセージ送信エラー:", error);
        });
      });
    });

    // 次へボタンのクリックイベント
    nextButton.addEventListener('click', () => {
      browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
        if (tabs.length === 0) return;

        browser.tabs.sendMessage(tabs[0].id, { action: "scrollNext" }).then(response => {
          console.log(response.status);
        }).catch(error => {
          console.error("メッセージ送信エラー:", error);
        });
      });
    });
});
