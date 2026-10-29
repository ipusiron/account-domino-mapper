/* Account Domino Mapper - MIT (c) 2026 ipusiron. */
// 見せ方の部品（DOM に依存しない）。計算は DominoCore を使い、文は messages.js の辞書を引数で受け取る。
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./domino-core.js'));
  else root.DominoView = factory(root.DominoCore);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (Core) {
  'use strict';

  // 人物の帯の数：アカウントの数と、パスワードの系統の数
  function counts(p) {
    return { accounts: p.services.length, families: p.credentials.filter((c) => c.type === 'pw').length };
  }

  // カードの最後の段（倒れるものがなければ0）。pv＝Core.personaVectors(p)
  function lastStep(pv, cardId) {
    return Math.max(0, ...Object.values(pv.cards[cardId].rank));
  }

  return Object.freeze({ counts, lastStep });
}));
