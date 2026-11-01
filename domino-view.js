/* Account Domino Mapper - MIT (c) 2026 ipusiron. */
// 見せ方の部品（DOM に依存しない）。計算は DominoCore を使い、文は messages.js の辞書を引数で受け取る。
// M＝DominoMessages（ja と en の両方）、lang＝'ja' か 'en'。p はデータの人物、q は1手のあとの人物（applyMove の結果）。
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./domino-core.js'));
  else root.DominoView = factory(root.DominoCore);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (Core) {
  'use strict';

  const CARD_KEYS = { leak: 'cardLeak', simswap: 'cardSimswap', mail: 'cardMail', desk: 'cardDesk' };
  const PERSON_KEYS = { worker: 'personWorker', parent: 'personParent', student: 'personStudent' };
  const TAG_KEYS = { device: 'tagDevice', phone: 'tagPhone', info: 'tagInfo', idcheck: 'tagIdcheck', paper: 'tagPaper' };
  const REQ_KEYS = { device: 'reqDevice', phone: 'reqPhone', info: 'reqInfo', idcheck: 'reqIdcheck', paper: 'reqPaper' };
  const LOSS_COLUMN_KEYS = { device: 'lockColPhone', number: 'lockColNumber', paper: 'lockColPaper' };
  const PARTNER_KEYS = { device: 'partnerPhone', number: 'partnerNumber', paper: 'partnerPaper' };
  const LOSS_SENTENCE_KEYS = { device: 'Phone', number: 'Number', mail: 'Mail' };
  // 人物の名前だけ（ハルト・シズエ・ミオ）。人物の設定の頭と、何も倒れないときの文と、候補の上の1行（storyMoveNote）に使う
  const NAME_KEYS = { worker: 'nameWorker', parent: 'nameParent', student: 'nameStudent' };

  // ===== 文の部品 =====
  function fill(template, values = {}) {
    return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (whole, name) => (name in values ? String(values[name]) : whole));
  }
  // 辞書。ない鍵を引いたら例外にする（書き間違いを見逃さないため）
  function dictionary(M, lang) {
    const D = M[lang];
    if (!D) throw new Error('unknown language ' + lang);
    return new Proxy(D, { get(target, key) {
      if (typeof key === 'string' && typeof target[key] !== 'string') throw new Error('missing message ' + key);
      return target[key];
    } });
  }
  const stripSuffix = (label) => label.replace(/\s*[（(][^（）()]*[）)]$/, '');
  // 英の文の途中に置くメールの名前：先頭に the を付け、先頭の1文字が大文字で次の文字が大文字でないときだけ小文字にする
  function midName(shortName, lang) {
    if (lang !== 'en') return shortName;
    return 'the ' + (/^[A-Z](?![A-Z])/.test(shortName) ? shortName[0].toLowerCase() + shortName.slice(1) : shortName);
  }
  const ownerOf = (id) => (id.startsWith('paper:') ? id.slice(6) : id.startsWith('pw:own-') ? id.slice(7) : null);
  function joinAny(D, items) {
    if (items.length < 2) return items.join('');
    return items.slice(0, -1).join(D.sepList) + D.sepListLast + items[items.length - 1];
  }
  // すべてを並べる（日：A・B・C、英：A, B and C）
  function joinAll(D, items) {
    if (items.length < 2) return items.join('');
    return items.slice(0, -1).join(D.sepList) + D.sepListAnd + items[items.length - 1];
  }

  // 変更で増える「このアカウントだけのパスワード」の記号：その人のパスワードの記号（A・B・C…）の次の英字
  // （会社員はD、親はB、学生はC。1つの変更で増えるのは1つだけ）
  function nextSymbol(p) {
    const codes = p.credentials.filter((c) => c.type === 'pw' && c.symbol).map((c) => c.symbol.charCodeAt(0));
    return String.fromCharCode(Math.max(64, ...codes) + 1);
  }
  // 全名・短い名前・英の文の途中の名前・札（短い記号）・変更の文の名前・失うものの列名と相方の名前
  function names(p, M, lang) {
    const D = dictionary(M, lang);
    const full = {}, short = {}, mid = {}, tag = {}, req = {}, box = {};
    for (const s of p.services) {
      full[s.id] = s.label[lang];
      short[s.id] = stripSuffix(full[s.id]);
      mid[s.id] = s.mail ? midName(short[s.id], lang) : short[s.id];
      if (s.mail) { tag[s.id] = short[s.id]; req[s.id] = mid[s.id]; }
    }
    for (const c of p.credentials) {
      const owner = ownerOf(c.id);
      const account = owner && short[owner];
      // 変更で増えた資格情報は、計算部が付けたラベルを出さない。図の箱には札（パスワードD・回復コード（紙））を書き、
      // 全名（箱に重ねると出る文）には、どのアカウントのものかを書く（パスワードD（ポイントアプリだけ））
      let long = null;
      if (c.type === 'pw' && c.family === 'own') {
        const symbol = nextSymbol(p);
        tag[c.id] = fill(D.tagFamily, { symbol });
        req[c.id] = fill(D.reqOwn, { symbol });
        long = fill(D.boxOwn, { symbol, account });
      } else if (c.type === 'pw') {
        tag[c.id] = fill(D.tagFamily, { symbol: c.symbol });
        req[c.id] = c.label[lang];
      } else if (c.type === 'paper') {
        tag[c.id] = D.tagPaper;
        req[c.id] = D.reqPaper;
        long = fill(D.boxPaper, { account });
      } else {
        tag[c.id] = D[TAG_KEYS[c.type]];
        req[c.id] = D[REQ_KEYS[c.type]];
      }
      box[c.id] = tag[c.id];
      full[c.id] = owner ? long : c.label[lang];
    }
    const card = {}, cardLabel = {};
    for (const c of p.cards) {
      card[c.id] = D[CARD_KEYS[c.id]];
      cardLabel[c.id] = c.label[lang];
    }
    const mailLoss = p.losses.find((l) => l.id === 'mail');
    const mailId = mailLoss && mailLoss.lost ? mailLoss.lost[0] : null;
    const lossColumn = {}, partner = {}, lossLabel = {};
    for (const l of p.losses) {
      lossLabel[l.id] = l.label[lang];
      lossColumn[l.id] = l.id === 'mail' ? short[mailId] : LOSS_COLUMN_KEYS[l.id] ? D[LOSS_COLUMN_KEYS[l.id]] : l.label[lang];
      partner[l.id] = l.id === 'mail' ? mid[mailId] : PARTNER_KEYS[l.id] ? D[PARTNER_KEYS[l.id]] : l.label[lang];
    }
    return { full, short, mid, tag, req, box, card, cardLabel, lossColumn, partner, lossLabel, mailId,
      person: PERSON_KEYS[p.id] ? D[PERSON_KEYS[p.id]] : p.id };
  }

  // ===== 人物の帯 =====
  // アカウントの数と、パスワードの数とその記号（A・B・C）
  function counts(p) {
    const passwords = p.credentials.filter((c) => c.type === 'pw');
    return { accounts: p.services.length, families: passwords.length, symbols: passwords.map((c) => c.symbol) };
  }

  // ===== タブ1：カードと段 =====
  // カードの最後の段（倒れるものがなければ0）。pv＝Core.personaVectors(p)
  function lastStep(pv, cardId) {
    return Math.max(0, ...Object.values(pv.cards[cardId].rank));
  }
  // result＝pv.cards[card] か afterMap の値（rank・via・backdoor を持つもの）
  const maxRank = (result) => Math.max(0, ...Object.values(result.rank));

  // 攻撃者の手元に加わったものの名前（資格情報はデータのラベル、個人情報は短い札、変更で増えたものは変更の文の名前、アカウントは短い名前）
  function heldName(p, nm, id, D, lang) {
    const c = p.credentials.find((x) => x.id === id);
    if (!c) return nm.short[id];
    if (c.type === 'info') return D.tagInfo;
    return ownerOf(id) ? nm.req[id] : c.label[lang];
  }
  // 攻撃者が最初に手にするもの（漏えい＝パスワードのデータのラベル、SIMスワップ＝電話番号のデータのラベル、
  // メールの乗っ取り＝「…のアカウント」（メールアドレスでなくアカウントごと）、ソーシャルエンジニアリング＝「個人情報」）
  function givesShort(p, cardId, M, lang) {
    const D = dictionary(M, lang), nm = names(p, M, lang);
    const gives = Core.cardGives(p, p.cards.find((c) => c.id === cardId));
    return gives.map((id) => (p.services.some((s) => s.id === id) ? fill(D.givesAccount, { account: nm.mid[id] })
      : heldName(p, nm, id, D, lang))).join(D.sepList);
  }
  // カードの説明の1行：データのカードのラベル＋攻撃者が最初に手にするもの（漏えいは計算したパスワードと、漏れたサービスの短い名前）
  function cardLine(p, cardId, M, lang) {
    const D = dictionary(M, lang), nm = names(p, M, lang);
    const card = p.cards.find((c) => c.id === cardId);
    const gives = card.leaks
      ? fill(D.givesLeak, { family: givesShort(p, cardId, M, lang), service: nm.short[card.leaks] })
      : fill(D.gives, { gives: givesShort(p, cardId, M, lang) });
    return fill(D.cardLine, { label: card.label[lang], gives });
  }
  // カードごとの注記。カードの説明の行のすぐ下に出す（メールの乗っ取りにはない）。SMS とソーシャルエンジニアリングは、
  // 規則表の注記（noteSms・noteDesk）より短い、このタブ用の文
  function cardNote(cardId, M, lang) {
    const key = { leak: 'noteLeak', simswap: 'noteSmsCard', desk: 'noteDeskCard' }[cardId];
    return key ? dictionary(M, lang)[key] : null;
  }
  // 段の要約（段の操作に関係なく、最後の段の結果。文は「最後の段までに」と言う）。メールの乗っ取りは、最初に乗っ取られた
  // メール（段0）も数に入るので、そのことを頭で言う。全部倒れるとき・1つのとき・★がないときは型を替える。
  // 何も倒れないとき、カードが渡す個人情報をどの入口も使っていなければ、そのわけを言う（学生のソーシャルエンジニアリング）
  function stepSummary(p, result, M, lang, cardId = null) {
    const D = dictionary(M, lang), nm = names(p, M, lang);
    const fallen = p.services.filter((s) => result.rank[s.id] !== undefined);
    if (!fallen.length) {
      const gives = cardId ? Core.cardGives(p, p.cards.find((c) => c.id === cardId)) : [];
      const info = gives.some((id) => p.credentials.some((c) => c.id === id && c.type === 'info'));
      const used = p.services.some((s) => s.methods.some((m) => m.requires.some((r) => gives.includes(r))));
      return info && !used ? fill(D.stepSummaryNoneInfo, { name: D[NAME_KEYS[p.id]] }) : D.stepSummaryNone;
    }
    const imp = fallen.filter((s) => s.important).length;
    const first = p.services.find((s) => result.rank[s.id] === 0);
    const countKey = fallen.length === p.services.length ? 'summaryCountAll' : fallen.length === 1 ? 'summaryCountOne' : 'summaryCount';
    return fill(D.stepSummary, {
      first: first ? fill(D.summaryFirst, { mail: nm.mid[first.id] }) : '',
      count: fill(D[countKey], { n: fallen.length, total: p.services.length }),
      imp: imp ? fill(D.summaryImp, { imp }) : '',
    });
  }
  // 段の文（段のボタンのすぐ下にいつも出す1行）。段0は攻撃者が最初に手にしたもの、段 r はその段で新たに倒れたアカウントの短い名前。
  // 最後の段は「ここが最後の段」と言う。英語は倒れたアカウントが1つなら falls
  function stepLine(p, result, cardId, step, M, lang) {
    const D = dictionary(M, lang), nm = names(p, M, lang);
    if (step === 0) return fill(D.stepStatusZero, { gives: givesShort(p, cardId, M, lang) });
    const max = maxRank(result);
    const fallen = p.services.filter((s) => result.rank[s.id] === step).map((s) => nm.short[s.id]);
    const key = (step >= max ? 'stepStatusLast' : 'stepStatus') + (fallen.length === 1 ? 'One' : '');
    return fill(D[key], { step, max, accounts: joinAll(D, fallen) });
  }
  // 読み上げの段の文。最後の段では段の文に要約を続ける
  function stepStatus(p, result, cardId, step, M, lang) {
    const status = stepLine(p, result, cardId, step, M, lang);
    return step >= maxRank(result)
      ? fill(dictionary(M, lang).stepStatusWithSummary, { status, summary: stepSummary(p, result, M, lang, cardId) }) : status;
  }
  function mapCaption(p, cardId, step, M, lang) {
    const nm = names(p, M, lang);
    return fill(dictionary(M, lang).mapCaption, { person: nm.person, card: nm.card[cardId], step });
  }
  // タブ1の地図の表の題（「…の地図の表」。狭い画面では図がなく表だけなので、表であることを題で言う）
  function mapTableCaption(p, cardId, step, M, lang) {
    const nm = names(p, M, lang);
    return fill(dictionary(M, lang).mapTableCaption, { person: nm.person, card: nm.card[cardId], step });
  }

  // 入口の札（かつは＋でつなぐ）と、表の入口の欄の文
  const requirementTags = (nm, m, D) => m.requires.map((r) => nm.tag[r]).join(D.sepPlus);
  function entranceText(nm, m, D) {
    return fill(D[m.role === 'login' ? 'entranceLogin' : 'entranceRecovery'], { req: requirementTags(nm, m, D) });
  }
  // 攻撃者が使った入口の名前。変更で変えた入口は、データのラベルでなく条件の札から作る
  function viaName(X, nm, key, changedMethod, D, lang) {
    const [sid, mid] = key.split('.');
    const m = X.services.find((s) => s.id === sid).methods.find((x) => x.id === mid);
    return key === changedMethod ? entranceText(nm, m, D) : m.label[lang];
  }
  // 地図の表のセルと詳細欄で、攻撃者が使った入口を言う形。セルは入口の欄と同じ札（「復旧：メインのメール」）で書き、どの行の
  // 入口かを入口の欄と見比べられるようにする。詳細欄と読み上げは「復旧の「登録メールで再設定」」（変えた入口は札の形）
  function usedEntrance(X, nm, key, D) {
    const [sid, mid] = key.split('.');
    return entranceText(nm, X.services.find((s) => s.id === sid).methods.find((x) => x.id === mid), D);
  }
  function usedLabel(X, nm, key, changedMethod, D, lang) {
    const [sid, mid] = key.split('.');
    const m = X.services.find((s) => s.id === sid).methods.find((x) => x.id === mid);
    return key === changedMethod ? entranceText(nm, m, D)
      : fill(D.viaLabel, { role: D[m.role === 'login' ? 'roleLogin' : 'roleRecovery'], label: m.label[lang] });
  }

  // 地図の表の行。X＝描く人物（タブ1は p、手のあとは q）。段 step より先の段は「－」にする
  function mapRows(X, result, step, M, lang, changedMethod = null) {
    const D = dictionary(M, lang), nm = names(X, M, lang);
    const last = maxRank(result);
    return X.services.map((s) => {
      const rank = result.rank[s.id];
      let cell;
      if (rank !== undefined && rank <= step) {
        const via = rank === 0 ? null : usedEntrance(X, nm, result.via[s.id], D);
        const said = rank === 0 ? null : usedLabel(X, nm, result.via[s.id], changedMethod, D, lang);
        cell = { fallen: true, rank, thisStep: rank === step, backdoor: result.backdoor.includes(s.id),
          text: rank === 0 ? D.cellGiven : fill(D.cellFallen, { rank, via }),
          sr: rank === 0 ? D.srGiven : fill(D.srFallen, { rank, via: said }) };
      } else {
        cell = { fallen: false, rank: null, thisStep: false, backdoor: false, text: D.cellNone,
          sr: step < last ? D.srNotYet : D.srNone };
      }
      return { id: s.id, important: !!s.important, name: nm.full[s.id], short: nm.short[s.id],
        entrances: s.methods.map((m) => entranceText(nm, m, D)), methods: s.methods.map((m) => m.id), cell };
    });
  }

  // 倒すのに要るカード（vectors の cardBase）。いつも名詞句で書き、2枚そろって倒れる組は画面の記号と同じ＋でつなぐ。
  // 1枚・2枚のどちらか・3枚以上のどれか・4枚のどれでも・組・組のどれか・1枚と組の両方・4枚を合わせても倒れない
  function needText(p, pv, accountId, M, lang) {
    const D = dictionary(M, lang), nm = names(p, M, lang);
    const bases = pv.cardBase[accountId];
    if (!bases.length) return D.needNever;
    const singles = bases.filter((b) => b.length === 1).map((b) => nm.card[b[0]]);
    const combos = bases.filter((b) => b.length > 1).map((b) => b.map((c) => nm.card[c]).join(D.sepPlus));
    if (!combos.length) {
      if (singles.length === p.cards.length) return D.needAllFour;
      if (singles.length === 1) return fill(D.needOne, { card: singles[0] });
      return singles.length === 2 ? fill(D.needEither, { a: singles[0], b: singles[1] }) : fill(D.needAnyOf, { cards: joinAny(D, singles) });
    }
    if (!singles.length) {
      return combos.length === 1 ? fill(D.needCombo, { combo: combos[0], n: bases[0].length })
        : fill(D.needCombos, { combos: combos.join(D.sepCombos) });
    }
    const either = combos.join(D.sepCombos);
    return singles.length === 1 ? fill(D.needMixedOne, { card: singles[0], combos: either })
      : fill(D.needMixed, { cards: joinAny(D, singles), combos: either });
  }

  // 詳細欄。倒れ方はいまの段に合わせて書く（段 step で、もう倒れた／まだ倒れていない）。step を渡さなければ最後の段。
  // 2枚以上の組で倒れるアカウントには、画面で選べるカードは1枚ずつだという注を添える
  function detail(p, pv, cardId, accountId, M, lang, step = Infinity) {
    const D = dictionary(M, lang), nm = names(p, M, lang);
    const s = p.services.find((x) => x.id === accountId);
    const result = pv.cards[cardId];
    const rank = result.rank[accountId];
    const fallen = rank !== undefined && rank <= step;
    const falls = rank === undefined ? D.detailSafe : rank === 0 ? D.detailGiven
      : fallen ? fill(D.detailFalls, { rank, via: usedLabel(p, nm, result.via[accountId], null, D, lang) })
        : fill(D.detailFallsLater, { rank, step });
    const notes = [];
    if (pv.cardBase[accountId].some((b) => b.length > 1)) notes.push(D.needComboNote);
    if (accountId === 'sec') notes.push(D.noteBrokerage);
    if (accountId === 'sec' && p.id === 'student') notes.push(D.noteBrokerageStudent);
    return {
      heading: fill(D.detailHeading, { account: nm.full[accountId] }),
      // 入口ごとに「{ログイン｜復旧}（{入口の名前}）に必要なもの：{札}」（パスワードA と入口の名前の「パスワード」を重ねない）
      entrances: s.methods.map((m) => fill(D.detailEntrance, { role: D[m.role === 'login' ? 'symbolLog' : 'symbolRec'],
        label: m.label[lang], req: requirementTags(nm, m, D) })),
      falls,
      backdoor: fallen && result.backdoor.includes(accountId) ? D.srBackdoor : null,
      need: needText(p, pv, accountId, M, lang),
      notes,
    };
  }

  // 4枚のカードをまとめた格子（セル＝●段か－。裏口の印は付けない）
  function fourCards(p, pv, M, lang) {
    const D = dictionary(M, lang), nm = names(p, M, lang);
    const head = { leak: 'fourCardsColLeak', simswap: 'fourCardsColSimswap', mail: 'fourCardsColMail', desk: 'fourCardsColDesk' };
    return {
      caption: fill(D.fourCardsCaption, { person: nm.person }),
      columns: p.cards.map((c) => ({ id: c.id, short: D[head[c.id]], full: nm.card[c.id] })),
      rows: p.services.map((s) => ({ id: s.id, name: nm.short[s.id], important: !!s.important, cells: p.cards.map((c) => {
        const rank = pv.cards[c.id].rank[s.id];
        if (rank === undefined) return { card: c.id, text: D.cellNone, sr: D.srNone };
        return { card: c.id, text: '●' + rank, sr: rank === 0 ? D.srGiven : fill(D.srFallsAt, { rank }) };
      }) })),
    };
  }

  // ===== タブ2：閉め出しの表 =====
  // セル＝○・△（…も失うと×）・×・消えた。相方が紙の回復コードなら英の動詞を go にする（キーを分ける）。
  // △には、×になるあと1つ（cond＝「番号も失うと×」）も返す（画面の表は△の下にこれを書く。印刷と座学は text の1行）
  function lockCell(cell, nm, D) {
    if (cell.mark === 'gone') return { mark: 'gone', text: D.cellGone, sr: D.srGone };
    if (cell.mark === 'locked') return { mark: 'locked', text: D.cellLocked, sr: D.srLocked };
    if (!cell.plus.length) return { mark: 'ok', text: D.cellOk, sr: D.srOk };
    const partners = cell.plus.map((x) => nm.partner[x]);
    const plural = cell.plus[cell.plus.length - 1] === 'paper' ? 'Plural' : '';
    const values = partners.length === 1 ? { p: partners[0] }
      : { p1: partners.slice(0, -1).join(D.sepList), p2: partners[partners.length - 1] };
    const n = partners.length === 1 ? '1' : '2';
    return { mark: 'plus', text: fill(D['cellPlus' + n + plural], values), cond: fill(D['cellCond' + n + plural], values),
      sr: fill(D.srPlus, { p: partners.join(D.sepOr) }) };
  }
  // table＝vectors の lossTable（ふだん）か moves[i].lossTable（手のあと）
  function lockTable(p, table, M, lang) {
    const D = dictionary(M, lang), nm = names(p, M, lang);
    const mailHead = nm.short[nm.mailId];
    return {
      caption: fill(D.lockCaption, { mailHead }),
      legendMail: fill(D.lockLegendMail, { mailHead, mailLoss: nm.lossLabel.mail }),
      columns: table.columns.map((l) => ({ id: l, head: nm.lossColumn[l] })),
      rows: p.services.map((s) => ({ id: s.id, important: !!s.important, name: nm.full[s.id],
        cells: table.columns.map((l) => ({ loss: l, ...lockCell(table.cells[l][s.id], nm, D) })) })),
    };
  }
  // 選んだアカウントの入口（地図の表の入口の欄と同じ書き方）。×の理由を、このタブで読めるようにする。
  // lockDetail＝閉め出しの表で、選んだ行のすぐ下に出す見出しと入口（1行に1つ）。lockEntrances＝同じものを1行にした文
  function lockDetail(p, accountId, M, lang) {
    const D = dictionary(M, lang), nm = names(p, M, lang);
    const s = p.services.find((x) => x.id === accountId);
    return { heading: fill(D.lockDetailHead, { account: nm.full[accountId] }), entrances: s.methods.map((m) => entranceText(nm, m, D)) };
  }
  function lockEntrances(p, accountId, M, lang) {
    const D = dictionary(M, lang), nm = names(p, M, lang);
    return fill(D.lockEntrances, { account: nm.full[accountId], entrances: lockDetail(p, accountId, M, lang).entrances.join(D.sepLines) });
  }
  // 閉め出しの表の前後：セル（mark・plus）が前後で変わったアカウントだけ。列＝喪失カード3枚×前・後
  function lockChanges(p, pv, moveId, M, lang) {
    const D = dictionary(M, lang);
    const mv = moveOf(pv, moveId);
    const before = lockTable(p, pv.lossTable, M, lang), after = lockTable(p, mv.lossTable, M, lang);
    const same = (a, b) => a.mark === b.mark && a.plus.join('+') === b.plus.join('+');
    const changed = p.services.filter((s) => pv.lossTable.columns.some((l) => !same(pv.lossTable.cells[l][s.id], mv.lossTable.cells[l][s.id])));
    const phases = [['before', D.phaseBefore], ['after', D.phaseAfter]];
    return {
      caption: before.caption,
      legendMail: before.legendMail,
      columns: before.columns.flatMap((c) => phases.map(([phase, word]) => ({ loss: c.id, phase,
        head: fill(D.lockColPhase, { loss: c.head, phase: word }) }))),
      rows: changed.map((s) => {
        const b = before.rows.find((r) => r.id === s.id), a = after.rows.find((r) => r.id === s.id);
        return { id: s.id, important: b.important, name: b.name,
          cells: b.cells.flatMap((cell, i) => [{ ...cell, phase: 'before' }, { ...a.cells[i], phase: 'after' }]) };
      }),
    };
  }

  // ===== 1手：候補・効果・同じ入口・手のあとの地図 =====
  function moveOf(pv, moveId) {
    const mv = pv.moves.find((x) => x.id === moveId);
    if (!mv) throw new Error('unknown move ' + moveId);
    return mv;
  }
  const cardIdsFor = (p, mode) => (mode === 'all' || mode === 'lockout' ? p.cards.map((c) => c.id) : [mode]);
  // 「閉め出し」のタブの列（失うもの）に入っているメール：プロバイダーの解約や卒業で消えることがわかっているメール（会社員の古いメール・
  // 親のプロバイダーのメール・学生の大学のメール）
  function lostMails(p) {
    const mails = new Set(p.services.filter((s) => s.mail).map((s) => s.id));
    return p.losses.filter((l) => !l.optional).flatMap((l) => l.lost || []).filter((id) => mails.has(id));
  }
  // 候補（このシミュレーションでの上位の変更）：並べた順に、条件（ok）を満たす手だけを取り、同じ入口（アカウントと入口の組）の手は飛ばして3つまで。
  // 失うものに入っているメールへ切り替える変更は出さない（消える予定のメールに頼り直すことを上位に並べない。「変更を自分で選ぶ」では選べる）。
  // 外した変更は同じ入口の枠を使わないので、同じ入口のほかの変更（紙の回復コードへ切り替えるなど）が繰り上がる。
  // そのあと、カードのモード（＝「閉め出し」以外）では、★のアカウントを守れる変更が先、守れない変更が後になるように並べ直し、
  // 各段の中は守れる数の多い順にする（同じなら元の順＝安定ソート）。候補が3つの中に★ありと★なしが混ざるときに、順位の数と
  // 守れる数の多少が合わない見え方（例：1・2・3位の守れる数が12・6・7）を解く
  function candidates(p, pv, mode) {
    const ok = (mv) => {
      let net = 0, delta = 0, newly = 0;
      for (const c of cardIdsFor(p, mode)) net += mv.cards[c].saved.length - mv.cards[c].exposed.length;
      for (const l of Object.values(mv.losses)) {
        newly += l.newlyLocked.length;
        delta += l.newlyLocked.length - l.unlocked.length;
      }
      return mode === 'lockout' ? delta < 0 : net > 0 && newly === 0;
    };
    const lost = new Set(lostMails(p));
    const toLostMail = (mv) => mv.kind === 'replace' && lost.has(mv.to);
    const picked = [], entrances = new Set();
    for (const id of pv.ranking[mode]) {
      const mv = moveOf(pv, id);
      const entrance = mv.service + '.' + mv.method;
      if (!ok(mv) || toLostMail(mv) || entrances.has(entrance)) continue;
      entrances.add(entrance);
      picked.push(id);
      if (picked.length === 3) break;
    }
    // カードのモードは2段に分けて並べ直す（閉め出しのモードは★の数が守れる数と対応しないので、そのまま）
    let ids = picked;
    let groups = null;
    if (mode !== 'lockout' && picked.length) {
      const face = Object.fromEntries(picked.map((id) => [id, effect(p, pv, id, mode)]));
      const stable = picked.map((id, i) => ({ id, i, imp: face[id].imp, saved: face[id].saved }));
      const impIds = stable.filter((x) => x.imp > 0).sort((a, b) => b.saved - a.saved || a.i - b.i).map((x) => x.id);
      const otherIds = stable.filter((x) => !(x.imp > 0)).sort((a, b) => b.saved - a.saved || a.i - b.i).map((x) => x.id);
      ids = [...impIds, ...otherIds];
      groups = { impIds, otherIds };
    }
    let reason = null;
    if (!ids.length) {
      if (mode === 'lockout') reason = p.losses.every((l) => !pv.losses[l.id].locked.length) ? 'noLockout' : 'noSafeMove';
      else reason = cardIdsFor(p, mode).every((c) => !pv.cards[c].services.length) ? 'noFall' : 'noSafeMove';
    }
    return { ids, groups, reason };
  }
  // 効果の文の数。saved＝守れた数（カードのモードはそのカード、4枚の合計は4枚のカードごとに数えて足した数）、imp＝そのうち★。
  // exposedCard はいま並べ替えに使っているカード（4枚の合計・閉め出しのモードでは4枚の合計）、exposedAll は常に4枚の合計
  function effect(p, pv, moveId, mode) {
    const mv = moveOf(pv, moveId);
    const imp = new Set(p.services.filter((s) => s.important).map((s) => s.id));
    let saved = 0, impSaved = 0, exposedCard = 0, exposedAll = 0, unlocked = 0, newly = 0, pairNew = 0;
    for (const c of cardIdsFor(p, mode)) {
      saved += mv.cards[c].saved.length;
      impSaved += mv.cards[c].saved.filter((s) => imp.has(s)).length;
      exposedCard += mv.cards[c].exposed.length;
    }
    for (const c of p.cards) exposedAll += mv.cards[c.id].exposed.length;
    for (const l of Object.values(mv.losses)) {
      unlocked += l.unlocked.length;
      newly += l.newlyLocked.length;
    }
    for (const x of Object.values(mv.pairLosses)) pairNew += x.newlyLocked.length;
    return { saved, imp: impSaved, unlocked, newly, exposedCard, exposedAll, pairNew };
  }
  // Card modes (not 'all', not 'lockout') name a single attack card: newly fallen is counted for that one card alone,
  // so the parenthetical says "to this card" instead of "sum over 4 cards" (and the number matches what the user sees)
  const isCardMode = (mode) => mode !== 'all' && mode !== 'lockout';
  function exposedPart(D, e, mode) {
    if (isCardMode(mode)) return e.exposedCard ? fill(D.effectExposedCard, { n: e.exposedCard }) : null;
    return e.exposedAll ? fill(D.effectExposed, { n: e.exposedAll }) : null;
  }
  // 効果の文：守れる数（閉め出しを減らすモードは解ける数）のあとに、0でないものだけを区切りでつなぐ
  function effectText(p, pv, moveId, mode, M, lang) {
    const D = dictionary(M, lang);
    const e = effect(p, pv, moveId, mode);
    const parts = [];
    if (mode === 'lockout') parts.push(fill(D.effectUnlocked, { n: e.unlocked }));
    else if (mode === 'all') parts.push(fill(D[e.imp ? 'effectSavedAllImp' : 'effectSavedAll'], { n: e.saved, imp: e.imp }));
    else parts.push(fill(D[e.imp ? 'effectSavedImp' : 'effectSaved'], { n: e.saved, imp: e.imp }));
    if (mode === 'lockout' && e.newly) parts.push(fill(D.effectNewly, { n: e.newly }));
    const exposed = exposedPart(D, e, mode);
    if (exposed) parts.push(exposed);
    if (e.pairNew) parts.push(fill(D.effectPairNew, { n: e.pairNew }));
    return parts.join(D.effectSep);
  }
  // 候補のボタンの数の欄（何の数か・大きな数・うち★）と、題の下に添える文（閉め出しが増える・新たに倒れる・2つ同時の閉め出し）。
  // 文と数は effectText と同じ（effectText は1行の文、こちらはボタンの欄ごと）
  function effectFace(p, pv, moveId, mode, M, lang) {
    const D = dictionary(M, lang);
    const e = effect(p, pv, moveId, mode);
    const extras = [];
    if (mode === 'lockout' && e.newly) extras.push(fill(D.effectNewly, { n: e.newly }));
    const exposed = exposedPart(D, e, mode);
    if (exposed) extras.push(exposed);
    if (e.pairNew) extras.push(fill(D.effectPairNew, { n: e.pairNew }));
    if (mode === 'lockout') return { label: D.faceUnlocked, n: e.unlocked, imp: null, extras };
    return { label: D[mode === 'all' ? 'faceSavedAll' : 'faceSaved'], n: e.saved, imp: e.imp ? fill(D.faceImp, { imp: e.imp }) : null, extras };
  }
  // 並べ方（モードで替える）：上位に出さない変更の箇条、比べる順の箇条（番号付き）、そのあとの注記
  function rankingNote(mode, M, lang) {
    const D = dictionary(M, lang);
    const lockout = mode === 'lockout';
    const order = lockout ? ['rankingLockout1', 'rankingLockout2', 'rankingLockout3', 'rankingLockout4']
      : ['rankingCards1', 'rankingCards2', 'rankingCards3', 'rankingCards4'];
    return { excludeLead: D.rankingExcludeLead, exclude: [D[lockout ? 'rankingExcludeNoDecrease' : 'rankingExcludeLock'], D.rankingExcludeMail],
      orderLead: D.rankingOrderLead, order: [...order.map((key) => D[key]), D.rankingTie], note: D[lockout ? 'rankingLockoutNote' : 'rankingCardsNote'] };
  }
  // 高齢の親の上位に、人物の説明にある銀行の変更（見どころP3と同じ変更）が2位か3位で入るときの1行（候補の上に出す）。
  // それ以外（1位のとき・上位にないとき・ほかの人物）は null
  function storyMoveNote(p, ids, M, lang) {
    const D = dictionary(M, lang);
    const own = HIGHLIGHTS.filter((h) => h.person === p.id);
    const h = own.find((x) => x.id === 'P3');
    const rank = h ? ids.indexOf(h.state.move) + 1 : 0;
    if (rank < 2) return null;
    return fill(D.storyMoveNote, { name: D[NAME_KEYS[p.id]], rank, n: own.indexOf(h) + 1, tab: D.tabChain });
  }

  // 同じ入口（アカウントと入口の組）の手。列挙の順
  function sameEntrance(pv, moveId) {
    const mv = moveOf(pv, moveId);
    return pv.moves.filter((x) => x.service === mv.service && x.method === mv.method).map((x) => x.id);
  }
  function methodText(p, mv, M, lang) {
    const D = dictionary(M, lang);
    const m = p.services.find((s) => s.id === mv.service).methods.find((x) => x.id === mv.method);
    return fill(D[m.role === 'login' ? 'methodLogin' : 'methodRecovery'], { label: m.label[lang] });
  }
  // 札（同じ入口の表の {from}{to}）。変更で増える紙の回復コードと、このアカウントだけのパスワード（次の記号）も札で書く
  function tagOf(p, id, M, lang) {
    const D = dictionary(M, lang);
    if (id.startsWith('paper:')) return D.tagPaper;
    if (id.startsWith('pw:own-')) return fill(D.tagFamily, { symbol: nextSymbol(p) });
    return names(p, M, lang).tag[id];
  }
  // 変更の文の {from}{to}
  function reqName(p, id, M, lang) {
    const D = dictionary(M, lang);
    if (id.startsWith('paper:')) return D.reqPaper;
    if (id.startsWith('pw:own-')) return fill(D.reqOwn, { symbol: nextSymbol(p) });
    return names(p, M, lang).req[id];
  }
  const pairText = (key, label, D) => {
    const [a, b] = key.split('+');
    return fill(D.pairName, { a: label[a], b: label[b] });
  };
  // 2つ同時の差をアカウントごとにまとめる（nw＝新たに閉め出される組、un＝解けた組）。データの順
  function pairGroups(p, mv) {
    const groups = [];
    for (const s of p.services) {
      const nw = Object.keys(mv.pairLosses).filter((k) => mv.pairLosses[k].newlyLocked.includes(s.id));
      const un = Object.keys(mv.pairLosses).filter((k) => mv.pairLosses[k].unlocked.includes(s.id));
      if (nw.length || un.length) groups.push({ account: s.id, nw, un });
    }
    return groups;
  }
  // 同じ入口のほかの変え方と比べる表。変え方の名前は変更の文と同じ言い方（「古いメールを、紙の回復コードに切り替える」）。
  // 閉め出しの列は、変わったことを1つずつの文で書く（何を失うと、どのアカウントに入れないか・入れるか）。変わらなければ「変わらない」
  function sameRows(p, pv, moveId, M, lang) {
    const D = dictionary(M, lang), nm = names(p, M, lang);
    const ids = sameEntrance(pv, moveId);
    const first = moveOf(pv, moveId);
    const lost = nm.partner;
    const rows = ids.map((id) => {
      const mv = moveOf(pv, id);
      const move = mv.kind === 'add' ? D.sameRowAdd : mv.kind === 'remove' ? D.sameRowRemove
        : fill(D.sameRowReplace, { from: reqName(p, mv.from, M, lang), to: reqName(p, mv.to, M, lang) });
      let saved = 0, newly = 0;
      for (const c of p.cards) {
        saved += mv.cards[c.id].saved.length;
        newly += mv.cards[c.id].exposed.length;
      }
      const lock = [];
      for (const [field, key] of [['newlyLocked', 'sameLockNew'], ['unlocked', 'sameLockUnlocked']]) {
        for (const l of p.losses) {
          for (const s of mv.losses[l.id][field]) lock.push(fill(D[key], { account: nm.full[s], loss: lost[l.id] }));
        }
      }
      const pair = [];
      for (const g of pairGroups(p, mv)) {
        const account = nm.full[g.account];
        if (g.nw.length === 1 && g.un.length === 1) {
          const [a, b] = g.un[0].split('+'), [c, d] = g.nw[0].split('+');
          pair.push(fill(D.samePairMove, { A: lost[a], B: lost[b], C: lost[c], D: lost[d], account }));
          continue;
        }
        for (const k of g.nw) {
          const [a, b] = k.split('+');
          pair.push(fill(D.samePairNew, { A: lost[a], B: lost[b], account }));
        }
        for (const k of g.un) {
          const [a, b] = k.split('+');
          pair.push(fill(D.samePairUnlocked, { A: lost[a], B: lost[b], account }));
        }
      }
      return { id, move, saved, newly, lock: lock.length ? lock : [D.sumNoChange], pair: pair.length ? pair : [D.sumNoChange] };
    });
    // 外す手の注記を表の下に：表に「外す」の行があり、選んだ手が外す手でないとき（外す手を選んでいれば、上の注記に同じ文が出る）。
    // 「外す」の行の閉め出しが「変わらない」でも、パスワードを忘れたときの戻り道はなくなるため
    const removeNote = first.kind !== 'remove' && ids.some((id) => moveOf(pv, id).kind === 'remove') ? D.noteRemove : null;
    const m = p.services.find((s) => s.id === first.service).methods.find((x) => x.id === first.method);
    return { heading: fill(D.sameEntrance, { account: nm.full[first.service], role: D[m.role === 'login' ? 'roleLogin' : 'roleRecovery'],
      label: m.label[lang], n: ids.length }), rows, removeNote };
  }

  // 手のあとの地図：手のあとの人物 q で cardGives(q, card) と段・開けた入口・裏口をその場で計算する（personaVectors は使わない）
  function afterMap(p, moveId, cardId) {
    const mv = Core.enumerateMoves(p).find((x) => x.id === moveId);
    if (!mv) throw new Error('unknown move ' + moveId);
    const q = Core.applyMove(p, mv);
    const g = Core.personaGraph(q);
    const gives = Core.cardGives(q, q.cards.find((c) => c.id === cardId));
    const { rank, via } = Core.stepReach(g, gives);
    const spec = Core.personaSpec(q);
    const noRecovery = Core.graphFrom({ nodes: spec.nodes, clauses: spec.clauses.filter((c) => c.role !== 'recovery') });
    const withoutRecovery = Core.reach(noRecovery, gives);
    const ordered = [...rank.keys()].sort((a, b) => rank.get(a) - rank.get(b) || g.order.get(a) - g.order.get(b));
    const services = q.services.map((s) => s.id).filter((s) => rank.has(s));
    return {
      rank: Object.fromEntries(ordered.map((v) => [v, rank.get(v)])),
      via: Object.fromEntries(ordered.filter((v) => rank.get(v) > 0).map((v) => [v, via.get(v)])),
      backdoor: services.filter((s) => !withoutRecovery.has(s)),
      services,
      changedMethod: mv.service + '.' + mv.method,
      gives,
      person: q,
      move: mv,
    };
  }
  // 手のあとの地図の段の結果と図の座標を覚える入れ物：最後に使った limit 件だけを覚える（小さな LRU）。make() は覚えていない鍵の
  // ときだけ呼ぶ。使った鍵はいちばん新しい位置へ移し、limit を超えたら、いちばん長く使っていない1件を捨てる（3人の全手を選んでも、
  // 覚える数が増え続けない）
  function recentCache(limit) {
    const entries = new Map();
    return (key, make) => {
      if (entries.has(key)) {
        const value = entries.get(key);
        entries.delete(key);
        entries.set(key, value);
        return value;
      }
      const value = make();
      entries.set(key, value);
      if (entries.size > limit) entries.delete(entries.keys().next().value);
      return value;
    };
  }

  // ===== 変更後の地図（タブ3の「変更後の地図を見る」） =====
  // 地図のカードは「連鎖を追う」のカードと別に持つ。変更前と変更後は、どちらもそのカードで最後の段まで進めた結果
  // 最初に選んでおくカード：その変更で守れるアカウントがいちばん多いカード（同じ数なら、並べ替えの基準のカードがその中にあればそれ、
  // なければカードの順で先のもの）。どのカードでも守れないときは、新たに倒れるアカウントがいちばん多いカード（違いが地図に出るもの）。
  // どのカードでも変わらないときは、基準のカード（基準がカードのとき）か、最初のカード
  function afterCardFor(p, pv, moveId, mode) {
    const mv = moveOf(pv, moveId), ids = p.cards.map((c) => c.id);
    const pick = (count) => {
      const most = Math.max(...ids.map(count));
      if (most <= 0) return null;
      const tops = ids.filter((c) => count(c) === most);
      return tops.includes(mode) ? mode : tops[0];
    };
    return pick((c) => mv.cards[c].saved.length) || pick((c) => mv.cards[c].exposed.length) || (ids.includes(mode) ? mode : ids[0]);
  }
  // 地図のカードについての文。kind＝'diff'（このカードで倒れるアカウントが変わる：text＝数の変わり方、line＝変わるカードの一覧）、
  // 'other'（このカードでは変わらず、ほかのカードで変わる：cards＝違いが出るカード。画面はそのカードへ替えるボタンを添える）、
  // 'none'（どのカードでも変わらない）
  function afterCardNotice(p, pv, moveId, cardId, M, lang) {
    const D = dictionary(M, lang), nm = names(p, M, lang), mv = moveOf(pv, moveId);
    const differs = (c) => mv.cards[c].saved.length + mv.cards[c].exposed.length > 0;
    const cards = p.cards.map((c) => c.id).filter(differs);
    if (!cards.length) return { kind: 'none', text: D.afterNoneAny, line: null, cards };
    if (!differs(cardId)) return { kind: 'other', text: D.afterNoneHere, line: null, cards };
    const before = pv.cards[cardId].services.length;
    const after = before - mv.cards[cardId].saved.length + mv.cards[cardId].exposed.length;
    const key = after < before ? (after ? 'afterCountDown' : 'afterCountDownNone')
      : after > before ? (before ? 'afterCountUp' : 'afterCountUpNone') : 'afterCountSwap';
    return { kind: 'diff', text: fill(D[key], { card: nm.card[cardId], before, after }),
      line: fill(D.afterCardsLine, { cards: cards.map((c) => nm.card[c]).join(D.sepList) }), cards };
  }
  // 図の箱の印（変更前と変更後の両方の図に付ける）：守れた（変更前は倒れ、変更後は倒れない）と新たに倒れる（その逆）
  function afterBadges(p, pv, moveId, cardId, M, lang) {
    const D = dictionary(M, lang), mv = moveOf(pv, moveId);
    return [...mv.cards[cardId].saved.map((node) => ({ node, kind: 'saved', text: D.mapBadgeSaved })),
      ...mv.cards[cardId].exposed.map((node) => ({ node, kind: 'newly', text: D.mapBadgeNewly }))];
  }
  // 図と表の題（段の数は書かない。タブ3の地図はいつも最後の段）
  function afterCaption(p, cardId, phase, table, M, lang) {
    const D = dictionary(M, lang), nm = names(p, M, lang);
    return fill(D[table ? 'afterTableCaption' : 'afterMapCaption'], { person: nm.person, card: nm.card[cardId],
      phase: D[phase === 'before' ? 'phaseBefore' : 'phaseAfter'] });
  }
  // 変更後の地図の表の行（変更前か変更後）。after＝afterMap(p, 変更, カード)、phase＝'before'（変更前の人物と pv の段）
  // か 'after'（変更後の人物と after の段）。段はいつも最後の段なので、「この段で倒れた」の帯は付けない。mapRows の行に次を足す。
  //   mark：このカードで守れた（'saved'）・新たに倒れる（'newly'）・変わらない（null）。変更前と変更後のどちらの表にも付ける
  //   items：入口の欄の行。変更前の人物の入口の順に1つずつ { text, changed, removed }。変えた入口は changed。変更後の表で外した入口は
  //     removed で、変更前の札のまま残す（表から消さず、外したことを見せる）
  // tag＝変えた入口に添える札（変更前は「ここを変える」「ここを外す」、変更後は「変えた」「外した」）
  function afterRows(p, pv, after, cardId, phase, M, lang) {
    const D = dictionary(M, lang);
    const before = phase === 'before';
    const X = before ? p : after.person, result = before ? pv.cards[cardId] : after;
    const nmP = names(p, M, lang), nmX = before ? nmP : names(X, M, lang);
    const mv = moveOf(pv, after.move.id), saved = mv.cards[cardId].saved, newly = mv.cards[cardId].exposed;
    const removed = !after.person.services.find((s) => s.id === mv.service).methods.some((m) => m.id === mv.method);
    const rows = mapRows(X, result, maxRank(result), M, lang, before ? null : after.changedMethod).map((row) => {
      const methods = p.services.find((s) => s.id === row.id).methods, now = X.services.find((s) => s.id === row.id).methods;
      const items = methods.map((m) => {
        const n = now.find((x) => x.id === m.id);
        return { text: n ? entranceText(nmX, n, D) : entranceText(nmP, m, D), changed: row.id + '.' + m.id === after.changedMethod, removed: !n };
      });
      return { ...row, cell: { ...row.cell, thisStep: false }, items,
        mark: saved.includes(row.id) ? 'saved' : newly.includes(row.id) ? 'newly' : null };
    });
    const tag = D[(removed ? 'removedTag' : 'changedTag') + (before ? 'Before' : 'After')];
    return { rows, tag, removed };
  }
  // 表で選んだアカウントの、変更前と変更後（その行のすぐ下に出す）。heading＝名前とカード、mark＝守れた・新たに倒れる・null、
  // rows＝見出しと文の組：変えたアカウントなら先に「変えた入口」（外す変更は「外した入口」）、続いて変更前と変更後の倒れ方。
  // 攻撃者が使った入口は入口の名前で言う（「復旧の「予備のメールで再設定」」）。変更後の変えた入口だけは、データの名前が元の条件を指したまま
  // のことがある（「大学のメールに届くコード」）ので、条件の札で言う（「ログイン（フリーメール）」）
  function afterDetail(p, pv, after, cardId, accountId, M, lang) {
    const D = dictionary(M, lang), q = after.person, nmP = names(p, M, lang), nmQ = names(q, M, lang);
    const mv = moveOf(pv, after.move.id);
    const method = (X, key) => X.services.find((s) => s.id === key.split('.')[0]).methods.find((x) => x.id === key.split('.')[1]);
    const via = (X, nm, key) => {
      const m = method(X, key);
      if (X === q && key === after.changedMethod) return fill(D[m.role === 'login' ? 'methodLogin' : 'methodRecovery'], { label: requirementTags(nm, m, D) });
      return fill(D.viaLabel, { role: D[m.role === 'login' ? 'roleLogin' : 'roleRecovery'], label: m.label[lang] });
    };
    const falls = (X, nm, result) => {
      const rank = result.rank[accountId];
      if (rank === undefined) return D.afterFallsNone;
      if (rank === 0) return D.afterFallsGiven;
      return fill(D.afterFalls, { rank, via: via(X, nm, result.via[accountId]) });
    };
    const rows = [];
    if (mv.service === accountId) {
      const m = method(p, after.changedMethod), n = q.services.find((s) => s.id === accountId).methods.find((x) => x.id === mv.method);
      const entrance = fill(D.viaLabel, { role: D[m.role === 'login' ? 'symbolLog' : 'symbolRec'], label: m.label[lang] });
      const from = requirementTags(nmP, m, D);
      rows.push(n ? { label: D.afterDetailChanged, text: fill(D.afterDetailChange, { entrance, from, to: requirementTags(nmQ, n, D) }) }
        : { label: D.afterDetailRemoved, text: fill(D.afterDetailRemove, { entrance, from }) });
    }
    rows.push({ label: D.mapBefore, text: falls(p, nmP, pv.cards[cardId]) }, { label: D.mapAfter, text: falls(q, nmQ, after) });
    const mark = mv.cards[cardId].saved.includes(accountId) ? 'saved' : mv.cards[cardId].exposed.includes(accountId) ? 'newly' : null;
    return { heading: fill(D.afterDetailHeading, { account: nmP.full[accountId], card: nmP.card[cardId] }), mark, rows };
  }
  // 表の上の凡例（変更後の地図。タブ1と同じ2つのまとまり）。入口の欄：タブ1の項目に、変えた入口の札と、変更で増えたもの（このアカウント
  // だけのパスワード・紙の回復コード）を足す。「このカードで倒れる段」の欄：タブ1の項目から「この段で倒れた」を外し、－の意味を最後の段の
  // ものにし、守れた・新たに倒れるの札を足す。mark＝札の形で見せる語（＝の前）の種類（'changed'・'saved'・'newly'）
  function afterLegend(p, pv, after, phase, M, lang) {
    const D = dictionary(M, lang), nm = names(after.person, M, lang), mv = moveOf(pv, after.move.id);
    const removed = !after.person.services.find((s) => s.id === mv.service).methods.some((m) => m.id === mv.method);
    const before = phase === 'before';
    const item = (text, mark = null) => ({ text, mark });
    const added = [];
    if (!before && String(mv.to).startsWith('pw:own-')) added.push(item(fill(D.afterLegendOwn, { symbol: nextSymbol(p), account: nm.short[mv.service] })));
    const meaning = lang === 'ja' ? D.symPaperMeaning : D.symPaperMeaning[0].toLowerCase() + D.symPaperMeaning.slice(1);
    if (!before && String(mv.to).startsWith('paper:')) added.push(item(D.symPaperName + (lang === 'ja' ? '＝' : ' = ') + meaning));
    const changeKey = (removed ? 'afterLegendRemoved' : 'afterLegendChanged') + (before ? 'Before' : 'After');
    return [
      { head: D.legendEntrancesHead, items: [...['legendPw', 'legendPhone', 'legendSms', 'legendInfo', 'legendDoc', 'legendMail', 'legendPlus']
        .map((key) => item(D[key])), ...added, item(D[changeKey], 'changed')] },
      { head: D.legendCellHead, items: [item(D.legendRank), item(D.legendVia), item(D.afterLegendNone), item(D.legendBackdoor),
        item(D.attackLegendSaved, 'saved'), item(D.attackLegendNewly, 'newly'), item(D.legendStar)] },
    ];
  }

  // ===== 変更の文 =====
  // 切り替える変更は「{アカウント}：{ログイン｜復旧}で使う{元}を、{新}に切り替える」（入口の名前と条件を2度言わない）
  function moveTitle(p, mv, M, lang) {
    const D = dictionary(M, lang), nm = names(p, M, lang);
    const values = { account: nm.full[mv.service], method: methodText(p, mv, M, lang) };
    if (mv.kind === 'add') return fill(D.moveAdd, values);
    if (mv.kind === 'remove') return fill(D.moveRemove, values);
    const m = p.services.find((s) => s.id === mv.service).methods.find((x) => x.id === mv.method);
    return fill(D.moveReplace, { ...values, role: D[m.role === 'login' ? 'roleLogin' : 'roleRecovery'],
      from: reqName(p, mv.from, M, lang), to: reqName(p, mv.to, M, lang) });
  }
  // 「変更を自分で選ぶ」の選択肢の文：見出し（moveTitle）の頭からアカウント名を除いた形。選んだあとに出る見出し（アカウント＋：＋
  // この文）と、文の中身がそろう。欄の中には optgroup でアカウント名を別に出すので、ここに頭を繰り返さない
  function moveChoice(p, mv, M, lang) {
    const title = moveTitle(p, mv, M, lang), head = names(p, M, lang).full[mv.service];
    return (title.startsWith(head) ? title.slice(head.length) : title).replace(/^(?:：|:\s*)/, '');
  }
  // 選択肢の組：アカウントごと（データの順、label＝全名）に、その人の全手（列挙の順）
  function moveOptions(p, pv, M, lang) {
    const nm = names(p, M, lang);
    return p.services.map((s) => ({ account: s.id, label: nm.full[s.id],
      moves: pv.moves.filter((mv) => mv.service === s.id).map((mv) => ({ id: mv.id, text: moveChoice(p, mv, M, lang) })) }))
      .filter((g) => g.moves.length);
  }
  // 2つまでは区切りでつなぎ、最後だけ sumSepLast（英は and）でつなぐ（タブ3の要約の文。段の行の joinAll は sepListAnd を使う別の関数）
  function joinSum(D, items) {
    return items.length < 2 ? items.join('') : items.slice(0, -1).join(D.sepList) + D.sumSepLast + items[items.length - 1];
  }
  function accountsText(nm, ids, D) {
    return ids.length >= 4 ? fill(D.accountsMany, { first: nm.short[ids[0]], n: ids.length }) : joinSum(D, ids.map((s) => nm.short[s]));
  }
  // カードの句。要約（守れた＝「SIMスワップでは」、新たに＝「SIMスワップで」）となぜ守れたかの文（「SIMスワップのカードで」）で、
  // 2枚は「AでもBでも」、3枚は「A・B・Cのどれでも」、4枚は「4枚のどのカードでも」（「と」でつなぐと「両方そろうと」に読めるため）
  // keys＝1枚・2枚・3枚・4枚の型の鍵（要約は sumCards…、なぜ守れたかの文は whyCards…）
  function cardsPhrase(nm, cards, keys, D) {
    const n = cards.map((c) => nm.card[c]);
    if (cards.length === 1) return fill(D[keys[0]], { a: n[0] });
    if (cards.length === 2) return fill(D[keys[1]], { a: n[0], b: n[1] });
    if (cards.length === 3) return fill(D[keys[2]], { a: n[0], b: n[1], c: n[2] });
    return D[keys[3]];
  }
  const SUM_CARDS = { saved: ['sumCardsOneSaved', 'sumCardsTwo', 'sumCardsThree', 'sumCardsAll'],
    exposed: ['sumCardsOneExposed', 'sumCardsTwo', 'sumCardsThree', 'sumCardsAll'] };
  const WHY_CARDS = ['whyCardsOne', 'whyCardsTwo', 'whyCardsThree', 'whyCardsAll'];
  // 守れた（新たに倒れた）アカウントの集合が同じカードをまとめる
  function groupCards(p, mv, field) {
    const out = [];
    for (const c of p.cards) {
      const set = mv.cards[c.id][field];
      if (!set.length) continue;
      let g = out.find((x) => x.key === set.join(','));
      if (!g) out.push(g = { key: set.join(','), cards: [], accounts: set });
      g.cards.push(c.id);
    }
    return out;
  }
  // 要約の攻撃の文（頭の「攻撃：」なし）。アカウントを主語にする（「ネット証券は、SIMスワップでは倒れなくなる」）。mv＝vectors の moves の形の値
  function attackParts(p, mv, M, lang) {
    const D = dictionary(M, lang), nm = names(p, M, lang);
    const line = (g, saved) => fill(D[(saved ? 'sumSaved' : 'sumExposed') + (g.accounts.length > 1 ? 'Plural' : '')],
      { accounts: accountsText(nm, g.accounts, D), cards: cardsPhrase(nm, g.cards, SUM_CARDS[saved ? 'saved' : 'exposed'], D) });
    const parts = [...groupCards(p, mv, 'saved').map((g) => line(g, true)), ...groupCards(p, mv, 'exposed').map((g) => line(g, false))];
    return parts.length ? parts : [D.sumNoChangeAttack];
  }
  // 要約の攻撃の行（1行の形。座学8の表にも使う）
  function attackLine(p, mv, M, lang) {
    const D = dictionary(M, lang);
    return fill(D.sumAttack, { lines: attackParts(p, mv, M, lang).join(D.sepSentences) });
  }
  // 1つ失う文。1つ→2つ同時（解けたが、手のあとの pairOnly でその喪失を含む組に入る）は lossOneUnlocked の代わりに oneToPair。
  // その組のほうは、2つ同時の行に pairFromOne の文で出す（同じ文を2つの行に重ねない）
  function lossLines(p, mv, M, lang) {
    const D = dictionary(M, lang), nm = names(p, M, lang);
    const mail = nm.partner.mail;
    const one = [], oneToPair = [], pairFromOne = [];
    for (const l of mv.lossTable.columns) {
      const suffix = LOSS_SENTENCE_KEYS[l];
      const { newlyLocked, unlocked } = mv.losses[l];
      if (newlyLocked.length) {
        one.push(fill(D.lossOneNew, { lossIf: fill(D['lossIf' + suffix], { mail }),
          accounts: newlyLocked.map((s) => nm.full[s]).join(D.sepList) }));
      }
      const pairsOf = (s) => Object.keys(mv.lossTable.pairOnly)
        .filter((k) => k.split('+').includes(l) && mv.lossTable.pairOnly[k].includes(s));
      const plain = unlocked.filter((s) => !pairsOf(s).length);
      if (plain.length) {
        one.push(fill(D.lossOneUnlocked, { lossEven: fill(D['lossEven' + suffix], { mail }),
          accounts: plain.map((s) => nm.full[s]).join(D.sepList) }));
      }
      for (const s of unlocked.filter((x) => pairsOf(x).length)) {
        const pairs = pairsOf(s).map((k) => pairText(k, nm.partner, D)).join(D.sepPairs);
        const line = fill(D.oneToPair, { account: nm.full[s], loss: fill(D['lossGerund' + suffix], { mail }), pairs });
        one.push(line);
        oneToPair.push(line);
        pairFromOne.push(fill(D.pairFromOne, { account: nm.full[s], pairs, loss: fill(D['lossOnly' + suffix], { mail }) }));
      }
    }
    return { one, oneToPair, pairFromOne };
  }
  // 2つ同時の文（pairLosses をアカウントごとに。組が移る・新たに・解ける）
  function pairLines(p, mv, M, lang) {
    const D = dictionary(M, lang), nm = names(p, M, lang);
    const text = (keys, sep) => keys.map((k) => pairText(k, nm.partner, D)).join(sep);
    return pairGroups(p, mv).map((g) => {
      const account = nm.full[g.account];
      if (g.nw.length && g.un.length) return fill(D.pairMoved, { account, before: text(g.un, D.sepList), after: text(g.nw, D.sepList) });
      if (g.nw.length) return fill(D.pairNew, { account, pairs: text(g.nw, D.sepPairs) });
      return fill(D.pairUnlocked, { account, pairs: text(g.un, D.sepPairs) });
    });
  }
  // 何も変えない手：カード1枚ずつの守れた・新たに倒れる、喪失4枚の閉め出し、2つ同時の差がすべて空
  const changesNothing = (mv) => Object.values(mv.cards).every((x) => !x.saved.length && !x.exposed.length)
    && Object.values(mv.losses).every((x) => !x.newlyLocked.length && !x.unlocked.length)
    && Object.values(mv.pairLosses).every((x) => !x.newlyLocked.length && !x.unlocked.length);
  // 注記（当てはまるものを、この順で）：書類・紙・外す・このアカウントだけのパスワード（漏えいの出どころ）・スマホ・何も変わらない
  function moveNotes(p, mv, M, lang) {
    const D = dictionary(M, lang);
    const device = p.credentials.find((c) => c.type === 'device');
    const idcheck = p.credentials.find((c) => c.type === 'idcheck');
    const leak = p.cards.find((c) => c.leaks);
    const mentionsDevice = (mv.losses.device && (mv.losses.device.newlyLocked.length || mv.losses.device.unlocked.length))
      || Object.keys(mv.pairLosses).some((k) => k.split('+').includes('device')
        && (mv.pairLosses[k].newlyLocked.length || mv.pairLosses[k].unlocked.length));
    const notes = [];
    // 書類への切り替えの注記は、タブ3用の文（タブ1のカードの注記 noteDesk とは分ける）
    if (idcheck && mv.to === idcheck.id) notes.push(D.noteDeskChange);
    if (mv.to && mv.to.startsWith('paper:')) notes.push(D.notePaper);
    if (mv.kind === 'remove') notes.push(D.noteRemove);
    if (mv.to && mv.to.startsWith('pw:own-') && leak && leak.leaks === mv.service) notes.push(D.noteOwnFamily);
    if ((device && mv.to === device.id) || mentionsDevice) notes.push(D.lockNoteSync);
    if (changesNothing(mv)) notes.push(D.noteNoChange);
    return notes;
  }
  // 攻撃（カード4枚）の表の行と、4枚の合計の行。表の行の名前は全名（要約の行は短い名前）。
  // 選んだカード（selected）の印は、モードのカードの行にだけ付ける（4枚の合計と閉め出しを減らすのモードでは、どの行にも付けない）
  function attackRows(p, pv, mv, mode, M, lang) {
    const D = dictionary(M, lang), nm = names(p, M, lang);
    const rows = p.cards.map((c) => {
      const before = pv.cards[c.id].services.length;
      const { saved, exposed } = mv.cards[c.id];
      return { card: c.id, label: nm.card[c.id], selected: c.id === mode, before, after: before - saved.length + exposed.length,
        saved: saved.length, newly: exposed.length, savedNames: saved.map((s) => nm.full[s]),
        newlyNames: exposed.map((s) => nm.full[s]) };
    });
    const sum = (k) => rows.reduce((t, r) => t + r[k], 0);
    rows.push({ card: 'all', label: D.attackTotal, selected: false, before: sum('before'), after: sum('after'),
      saved: sum('saved'), newly: sum('newly'), savedNames: [], newlyNames: [] });
    return rows;
  }
  // なぜ守れたか：守れたアカウントがあるときだけ1文。カードのモードはそのカード（守れたものがなければ次と同じ）、4枚の合計と閉め出しは
  // 守れる数のいちばん多いカード（守れたアカウントが同じカードはまとめる）。型は3つ：
  //   変えた入口から倒れ、そこから広がっていた（whySpread）／広がっていなかった（whySingle）／漏れたサービスのパスワードを別にした（whyOwn）。
  // 守れたアカウントに変えたアカウントが入るとき、そのアカウントは変えた入口からしか倒れていない（ほかの入口が開くなら守れない）ので、
  // 「…から倒れ」は事実に合う（3人の全変更×4枚で、変えた入口と攻撃者が使った入口が一致する。view.test で確かめる）
  function whyLine(p, pv, mv, mode, M, lang) {
    const D = dictionary(M, lang), nm = names(p, M, lang);
    const savedOf = (c) => mv.cards[c].saved;
    let cards;
    if (p.cards.some((c) => c.id === mode) && savedOf(mode).length) cards = [mode];
    else {
      const most = Math.max(...p.cards.map((c) => savedOf(c.id).length));
      if (!most) return null;
      const key = savedOf(p.cards.find((c) => savedOf(c.id).length === most).id).join(',');
      cards = p.cards.map((c) => c.id).filter((c) => savedOf(c).join(',') === key);
    }
    const saved = savedOf(cards[0]);
    if (!saved.includes(mv.service)) {
      // 漏れたサービスのパスワードをほかと別にした：漏えいで攻撃者が手にするのが新しいパスワードだけになり、使い回し先が守れる
      const leak = p.cards.find((c) => c.leaks === mv.service);
      const from = p.credentials.find((c) => c.id === mv.from);
      if (!leak || !cards.includes(leak.id) || !from || !String(mv.to).startsWith('pw:own-')) return null;
      return fill(D[saved.length === 1 ? 'whyOwnOne' : 'whyOwn'], { symbol: from.symbol, service: nm.short[mv.service], n: saved.length,
        new: nextSymbol(p) });
    }
    const m = p.services.find((s) => s.id === mv.service).methods.find((x) => x.id === mv.method);
    const values = { cards: cardsPhrase(nm, cards, WHY_CARDS, D), account: nm.short[mv.service],
      role: D[m.role === 'login' ? 'roleLogin' : 'roleRecovery'], label: m.label[lang] };
    if (saved.length === 1) return fill(D[cards.length === 1 ? 'whySingle' : 'whySingleMany'], values);
    return fill(D.whySpread, { ...values, others: accountsText(nm, saved.filter((s) => s !== mv.service), D), n: saved.length });
  }
  // 1手の文：見出し・要約（攻撃・閉め出し・2つ同時の1行の形。座学8の表にも使う）・要約の欄（rows：見出しと文。タブ3の比べた結果）・
  // なぜ守れたか・攻撃の表・1つ失う文・2つ同時の文・注記。変わらない欄は「変わらない」と書く
  function sentences(p, pv, moveId, M, lang, mode = 'all') {
    const D = dictionary(M, lang);
    const mv = moveOf(pv, moveId);
    const { one, pairFromOne } = lossLines(p, mv, M, lang);
    const pairs = pairLines(p, mv, M, lang);
    const attack = attackParts(p, mv, M, lang);
    const summary = [fill(D.sumAttack, { lines: attack.join(D.sepSentences) }),
      fill(D.sumLock, { lines: one.length ? one.join(D.sepLines) : D.sumNoChange })];
    if (pairs.length) summary.push(fill(D.sumPair, { lines: pairs.join(D.sepLines) }));
    const two = [...pairs, ...pairFromOne];
    const lossOne = one.length ? one : [D.sumNoChange], lossTwo = two.length ? two : [D.sumNoChange];
    return {
      title: moveTitle(p, mv, M, lang),
      summary,
      rows: [{ id: 'attack', label: D.rowAttack, lines: attack }, { id: 'lockOne', label: D.lockOneHeading, lines: lossOne },
        { id: 'lockTwo', label: D.lockTwoHeading, lines: lossTwo }],
      why: whyLine(p, pv, mv, mode, M, lang),
      attack: attackRows(p, pv, mv, mode, M, lang),
      lossOne,
      lossTwo,
      notes: moveNotes(p, mv, M, lang),
    };
  }

  // ===== タブ4：記号の一覧と、印刷する3人の表 =====
  // 記号の一覧は2つの表にする（空欄を作らない）。1つ目＝入口に必要なものの記号（4列：記号・何を表すか・攻撃者がこれを手にするカード・
  // 本人がこれを失う場合）。2つ目＝表と図に出る印と線（2列：記号・何を表すか）。図の線は実線（ログイン）と破線（復旧）の2種だけ
  const SYMBOL_ROWS = Object.freeze(['Family', 'Phone', 'Sms', 'Info', 'Doc', 'Paper', 'Mail']);
  const SYMBOL_COLUMNS = ['Name', 'Meaning', 'Attack', 'Loss'];
  function symbolTable(M, lang) {
    const D = dictionary(M, lang);
    return {
      caption: D.symbolCaption,
      columns: ['symbolColSymbol', 'symbolColMeaning', 'symbolColAttack', 'symbolColLoss'].map((key) => D[key]),
      rows: SYMBOL_ROWS.map((row) => ({ id: row, cells: SYMBOL_COLUMNS.map((col) => D['sym' + row + col]) })),
    };
  }
  // 印と線：記号は画面に出る札と同じキーから取る（札の語が替わっても一覧がずれない）。並び＝入口の欄と図（＋・線）、
  // 地図の表（●・入られた・裏口・この段で倒れた・－・★）、変更後の地図（守れた・新たに倒れる・ここを変える／変えた）、
  // 閉め出しの表（○・△・×・消えた）
  const MARK_ROWS = Object.freeze([['Role', 'symRoleName', 'symRoleMeaning'], ['Lines', 'symLinesName', 'symLinesMeaning'],
    ['Step', 'markStepName', 'markStepMeaning'], ['Open', 'openTag', 'markOpenMeaning'], ['Backdoor', 'cellBackdoor', 'termBackdoorMeaning'],
    ['ThisStep', 'cellThisStep', 'markThisStepMeaning'], ['Earlier', 'markEarlierName', 'markEarlierMeaning'], ['None', 'cellNone', 'markNoneMeaning'],
    ['Star', null, 'markStarMeaning'], ['Saved', 'mapBadgeSaved', 'markSavedMeaning'], ['Newly', 'mapBadgeNewly', 'markNewlyMeaning'],
    ['Changed', 'markChangedName', 'markChangedMeaning'], ['Ok', 'cellOk', 'markOkMeaning'], ['Plus', 'cellPlusMark', 'markPlusMeaning'],
    ['Locked', 'cellLocked', 'markLockedMeaning'], ['Gone', 'cellGone', 'markGoneMeaning']].map(Object.freeze));
  function markTable(M, lang) {
    const D = dictionary(M, lang);
    return {
      caption: D.markCaption,
      columns: [D.symbolColSymbol, D.symbolColMeaning],
      rows: MARK_ROWS.map(([id, name, meaning]) => ({ id, cells: [name ? D[name] : '★', D[meaning]] })),
    };
  }
  const STORY_KEYS = { worker: 'storyWorker', parent: 'storyParent', student: 'storyStudent' };
  // 印刷する人物の表（1人1表）：列＝アカウント・入口・攻撃カード4枚・喪失カード3枚。入口は札（ログイン：パスワードA／復旧：SMS）、
  // 攻撃の列は最後の段の●段（裏口なら印を添える）か－、失うものの列は閉め出しの表と同じ○・○（…も失うと×）・×・消えた
  function printTable(p, pv, M, lang) {
    const D = dictionary(M, lang), nm = names(p, M, lang);
    const lt = lockTable(p, pv.lossTable, M, lang);
    const attackCell = (cardId, accountId) => {
      const result = pv.cards[cardId], rank = result.rank[accountId];
      if (rank === undefined) return D.cellNone;
      const cell = '●' + rank;
      return result.backdoor.includes(accountId) ? fill(D.printCellBackdoor, { cell, bd: D.printBackdoor }) : cell;
    };
    return {
      title: fill(D.printTitle, { person: nm.person }),
      story: D[STORY_KEYS[p.id]],
      columns: [D.printColAccount, D.printColEntrances, ...p.cards.map((c) => D[{ leak: 'printColLeak', simswap: 'printColSimswap',
        mail: 'printColMail', desk: 'printColDesk' }[c.id]]), ...lt.columns.map((c) => ({ device: D.printColPhone, number: D.printColNumber,
        mail: fill(D.printColMailLoss, { mailHead: c.head }) }[c.id]))],
      rows: p.services.map((s, i) => ({
        id: s.id, important: !!s.important, name: nm.full[s.id],
        entrances: s.methods.map((m) => fill(D.printEntrance, { role: D[m.role === 'login' ? 'symbolLog' : 'symbolRec'],
          req: requirementTags(nm, m, D) })).join(D.sepLines),
        attack: p.cards.map((c) => attackCell(c.id, s.id)),
        loss: lt.rows[i].cells.map((cell) => cell.text),
      })),
    };
  }

  // ===== 座学（ヘルプの中の10節）：段落・表・注記の並びと出典。表の数は計算部とデータから作る（手で書かない） =====
  // 出典のリンク先。書誌の文は messages.js の lessonRef…（実在の名前を書いてよいのはそこだけ）。論文は DOI を https://doi.org/ で書く
  const LESSON_REFS = Object.freeze({
    Hammann2019: 'https://doi.org/10.1145/3319535.3354193',
    Dowling1984: 'https://doi.org/10.1016/0743-1066(84)90014-1',
    Das2014: 'https://doi.org/10.14722/ndss.2014.23357',
    Jpcert: 'https://www.jpcert.or.jp/pr/stop-password.html',
    SoumuSite: 'https://www.soumu.go.jp/main_sosiki/cybersecurity/kokumin/security/end_user/general/01/',
    JapanPost: 'https://files.japanpost.jp/assets/34d9d11432734cfaa759e78fe395b688/8ca4b69b953146bda1823819d3c1f5a3/20261019_01.pdf',
    Nist: 'https://doi.org/10.6028/NIST.SP.800-63B-4',
    Li2018: 'https://doi.org/10.1109/INFOCOM.2018.8486017',
    Klivan2023: 'https://doi.org/10.1145/3576915.3623180',
    Honan2012: 'https://www.wired.com/2012/08/apple-amazon-mat-honan-hacking/',
    Lee2020: 'https://www.usenix.org/conference/soups2020/presentation/lee',
    NaraPolice: 'https://www.police.pref.nara.jp/cmsfiles/contents/0000006/6309/cybernews_R5_4.pdf',
    SoumuMobile: 'https://www.soumu.go.jp/tokushusagi/id-check/',
    Ncsc2025: 'https://www.ncsc.gov.uk/blog-post/incidents-impacting-retailers',
    Jsda2025: 'https://www.jsda.or.jp/about/hatten/inv_alerts/alearts04/files/20251015_internetgl.pdf',
    FsaGuidelines: 'https://www.fsa.go.jp/news/r7/shouken/20251015/20251015.html',
    FsaDialogue: 'https://www.fsa.go.jp/common/ronten/202507/07.pdf',
    Unit42: 'https://unit42.paloaltonetworks.com/passwordless-authentication-security-risks/',
    Chi2022: 'https://doi.org/10.1145/3491102.3502125',
    Buttner2024: 'https://doi.org/10.5220/0012319000003648',
  });
  // 関連ツール（座学10の表と、規則表の注記4・座学8のリンク）。名前は toolDay…、何を学ぶかは lesson10Day…
  const RELATED_TOOLS = Object.freeze([
    ['day083', 'https://ipusiron.github.io/intrusion-path-mapper/'],
    ['day001', 'https://ipusiron.github.io/password-checker/'],
    ['day019', 'https://ipusiron.github.io/passcloud/'],
    ['day060', 'https://ipusiron.github.io/reverse-bruteforce-demo/'],
    ['day064', 'https://ipusiron.github.io/patternlock-security-trainer/'],
    ['day088', 'https://ipusiron.github.io/pin-threat-simulator/'],
    ['day124', 'https://ipusiron.github.io/scatter-seeds/'],
    ['day125', 'https://ipusiron.github.io/overlay-qr-shares/'],
  ].map(([id, href]) => {
    const day = 'Day' + id.slice(3);
    return Object.freeze({ id, href, name: 'tool' + day, learn: 'lesson10' + day });
  }));
  // 座学10節：段落（p）・表（table）・注記（note）・凡例（legend）・関連ツールへのリンクを含む段落（links）の並びと、出典（LESSON_REFS の名前）
  const LESSONS = Object.freeze([
    { n: 1, blocks: [['p', 'lesson1Text1'], ['p', 'lesson1Text2'], ['p', 'lesson1Text3'], ['table', 'flow'], ['p', 'lesson1Text4'],
      ['table', 'andOr']], refs: ['Hammann2019', 'Dowling1984'] },
    { n: 2, blocks: [['p', 'lesson2Text1'], ['p', 'lesson2Text2'], ['p', 'lesson2Text3'], ['p', 'lesson2Text4'], ['table', 'families']],
      refs: ['Das2014', 'Jpcert', 'SoumuSite', 'JapanPost', 'Nist'] },
    { n: 3, blocks: [['p', 'lesson3Text1'], ['p', 'lesson3Text2'], ['p', 'lesson3Text3'], ['p', 'lesson3Text4'], ['table', 'backdoors']],
      refs: ['Li2018', 'Klivan2023', 'Honan2012', 'Hammann2019'] },
    { n: 4, blocks: [['p', 'lesson4Text1'], ['p', 'lesson4Text2'], ['p', 'lesson4Text3'], ['p', 'lesson4Text4'], ['table', 'simswap']],
      refs: ['Lee2020', 'Nist', 'NaraPolice', 'SoumuMobile'] },
    { n: 5, blocks: [['p', 'lesson5Text1'], ['p', 'lesson5Text2'], ['p', 'lesson5Text3'], ['table', 'desk']], refs: ['Ncsc2025', 'Nist'] },
    { n: 6, blocks: [['p', 'lesson6Text1'], ['p', 'lesson6Text2'], ['p', 'lesson6Text3'], ['table', 'brokerage'], ['note', 'noteBrokerage'],
      ['note', 'noteBrokerageStudent']], refs: ['Jsda2025', 'FsaGuidelines', 'FsaDialogue', 'Nist', 'Unit42'] },
    { n: 7, blocks: [['p', 'lesson7Text1'], ['p', 'lesson7Text2'], ['p', 'lesson7Text3'], ['p', 'lesson7Text4'], ['table', 'lockout']],
      refs: ['Hammann2019', 'Chi2022', 'Buttner2024'] },
    { n: 8, blocks: [['p', 'lesson8Text1'], ['table', 'removeReplace'], ['p', 'lesson8Text2'], ['links', 'lesson8Text3']],
      refs: ['Nist', 'Chi2022'] },
    { n: 9, blocks: [['p', 'lesson9Text1'], ['p', 'lesson9Text2'], ['table', 'cycle'], ['p', 'lesson9Text3'], ['p', 'lesson9Text4']],
      refs: ['Hammann2019', 'Chi2022'] },
    { n: 10, blocks: [['p', 'lesson10Text1'], ['p', 'lesson10Text2'], ['table', 'tools']], refs: [] },
  ].map((lesson) => Object.freeze({ ...lesson, blocks: Object.freeze(lesson.blocks), refs: Object.freeze(lesson.refs) })));
  // 座学1の2つの場面（人物・カード・アカウント）と、座学6の口座（3人とも同じ id）
  const LESSON_SCENES = Object.freeze({ flow: ['worker', 'leak', 'sns'], andOr: ['worker', 'simswap', 'bank'], brokerage: 'sec' });
  // 座学8の5行（同じ入口を外す変更と、紙の回復コードか書類に切り替える変更。切り替える先のない入口は null）
  const LESSON8_ROWS = Object.freeze([
    ['worker', 'remove:sec.recMailSms', 'replace:sec.recMailSms:phone>paper:sec'],
    ['worker', 'remove:mailMain.recSms', 'replace:mailMain.recSms:phone>paper:mailMain'],
    ['parent', 'remove:bank.recSms', 'replace:bank.recSms:phone>idcheck'],
    ['student', 'remove:sec.recMail', 'replace:sec.recMail:mailFree>paper:sec'],
    ['student', 'remove:mailUni.recDesk', null],
  ].map(Object.freeze));
  const CARD_SHORT_KEYS = { leak: 'fourCardsColLeak', simswap: 'fourCardsColSimswap', mail: 'fourCardsColMail', desk: 'fourCardsColDesk' };

  // 表の形：{ caption, heads, rows, grid }。grid＝数や短い記号だけの表（狭い画面でも縦積みにしない）。そのほかは狭い画面で縦積み。
  // セル＝文字列、{ text, sr }（記号と読み上げ）、{ lines }（複数の行）、{ href, text }（別タブのリンク）、{ name, important }、{ text, sr, mark }（閉め出しの印）
  // 座学1の表1：1つのアカウントが1枚のカードで倒れるまでの段ごとに、新しく加わったものと、そのアカウントの入口ごとの条件
  function lessonFlow(p, pv, cardId, accountId, M, lang) {
    const D = dictionary(M, lang), nm = names(p, M, lang);
    const result = pv.cards[cardId], s = p.services.find((x) => x.id === accountId);
    const fall = result.rank[accountId];
    if (fall === undefined) throw new Error('the account does not fall to the card: ' + accountId);
    const ids = Object.keys(result.rank);
    const rows = [];
    for (let step = 0; step <= fall; step++) {
      const held = new Set(ids.filter((id) => result.rank[id] <= step));
      // そろった入口は次の段で開く（その段の行では「そろった（次の段で開く）」、倒れた段の行では「そろった」）
      rows.push([fill(D.lessonStep, { step }),
        ids.filter((id) => result.rank[id] === step).map((id) => heldName(p, nm, id, D, lang)).join(D.sepList),
        ...s.methods.map((m) => {
          const missing = m.requires.filter((r) => !held.has(r));
          return missing.length ? fill(D.lessonMissing, { items: missing.map((r) => nm.tag[r]).join(D.sepList) })
            : step < fall ? D.lessonMetNext : D.lessonMet;
        }),
        step === fall ? fill(D.srFallen, { rank: fall, via: viaName(p, nm, result.via[accountId], null, D, lang) }) : D.srNotYet]);
    }
    return { caption: fill(D.lesson1FlowCaption, { person: nm.person, account: nm.short[accountId], card: nm.card[cardId] }),
      heads: [D.lesson1ColStep, D.lesson1ColAdded, ...s.methods.map((m) => entranceText(nm, m, D)), D.lessonColResult], rows, grid: false };
  }
  // 座学1の表2：カードが渡すものを条件に含む入口を、かつ・またはで数えたときと、「かつ」も「または」として数えたとき（素朴な BFS）
  function lessonAndOr(p, cardId, accountId, M, lang) {
    const D = dictionary(M, lang), nm = names(p, M, lang);
    const g = Core.personaGraph(p), gives = Core.cardGives(p, p.cards.find((c) => c.id === cardId));
    const R = Core.reach(g, gives), N = Core.naiveBfs(g, gives);
    const methods = p.services.find((x) => x.id === accountId).methods.filter((m) => m.requires.some((r) => gives.includes(r)));
    const tags = (ids) => ids.map((r) => nm.tag[r]).join(D.sepList);
    const strict = (m) => {
      const missing = m.requires.filter((r) => !R.has(r));
      return missing.length ? fill(D.lessonMissing, { items: tags(missing) }) : D.lessonMet;
    };
    const naive = (m) => {
      const held = m.requires.filter((r) => N.has(r));
      return held.length ? fill(D.lesson1OpensWith, { items: tags(held) }) : fill(D.lessonMissing, { items: tags(m.requires) });
    };
    return { caption: fill(D.lesson1AndOrCaption, { person: nm.person, account: nm.full[accountId], card: nm.card[cardId] }),
      heads: [D.lesson1ColCounting, ...methods.map((m) => entranceText(nm, m, D)), D.lessonColResult],
      rows: [[D.lesson1CountAndOr, ...methods.map(strict), R.has(accountId) ? D.lessonFalls : D.srNone],
        [D.lesson1CountAllOr, ...methods.map(naive), N.has(accountId) ? D.lessonFalls : D.srNone]], grid: false };
  }
  // 座学2：3人のパスワードごとに、そのパスワードを条件に持つアカウント（データの順）
  function lessonFamilies(people, M, lang) {
    const D = dictionary(M, lang);
    const rows = [];
    for (const { p } of people) {
      const nm = names(p, M, lang);
      for (const c of p.credentials.filter((x) => x.type === 'pw')) {
        const users = p.services.filter((s) => s.methods.some((m) => m.requires.includes(c.id)));
        rows.push([nm.person, nm.tag[c.id], String(users.length), users.map((s) => nm.short[s.id]).join(D.sepList)]);
      }
    }
    return { caption: D.lesson2Caption, heads: [D.lessonColPerson, D.lesson2ColFamily, D.lesson2ColCount, D.lesson2ColAccounts], rows, grid: false };
  }
  // 座学3：座学4・5と同じ「倒れる｜うち裏口」の形。カードごとに3人の行（vectors の cards.<card>.services と backdoor）。
  // カードの名前は3行にまたがる見出し（span＝3。下の2行の先頭は null＝上の見出しが覆う）。rowHeads＝行の見出しの列の数（カードと人物）
  function lessonBackdoors(people, M, lang) {
    const D = dictionary(M, lang);
    return { caption: D.lesson3Caption, heads: [D.attackColCard, D.lessonColPerson, D.lessonColFallen, D.lessonColBackdoor],
      rows: people[0].p.cards.flatMap((c) => people.map(({ p, pv }, i) => [
        i ? null : { text: D[CARD_SHORT_KEYS[c.id]], sr: D[CARD_KEYS[c.id]], span: people.length },
        names(p, M, lang).person, String(pv.cards[c.id].services.length), String(pv.cards[c.id].backdoor.length)])),
      grid: true, rowHeads: 2 };
  }
  // 座学4・5：1枚のカードで、3人それぞれ倒れるアカウントの数と、そのうちの裏口の数
  function lessonCardResult(people, cardId, captionKey, M, lang) {
    const D = dictionary(M, lang);
    return { caption: D[captionKey], heads: [D.lessonColPerson, D.lessonColFallen, D.lessonColBackdoor],
      rows: people.map(({ p, pv }) => [names(p, M, lang).person, String(pv.cards[cardId].services.length),
        String(pv.cards[cardId].backdoor.length)]), grid: true };
  }
  // 座学6：3人の証券の入口と、倒すのに要るカード（vectors の cardBase。1枚で倒れるカードと、そろうと倒れる組）
  function lessonBrokerage(people, accountId, M, lang) {
    const D = dictionary(M, lang);
    return { caption: D.lesson6Caption, heads: [D.lessonColPerson, D.colEntrances, D.lesson6ColOne, D.lesson6ColCombo],
      rows: people.map(({ p, pv }) => {
        const nm = names(p, M, lang), bases = pv.cardBase[accountId];
        const one = bases.filter((b) => b.length === 1).map((b) => nm.card[b[0]]);
        const combos = bases.filter((b) => b.length > 1).map((b) => b.map((c) => nm.card[c]).join(D.sepAnd));
        return [nm.person, p.services.find((x) => x.id === accountId).methods.map((m) => entranceText(nm, m, D)).join(D.sepLines),
          one.length ? one.join(D.sepList) : D.lessonNone, combos.length ? combos.join(D.sepCombos) : D.lessonNone];
      }), grid: false };
  }
  // 座学7：3人の閉め出しの表のうち、×か「あと1つ失うと×」のセルを持つアカウントの行（セルはタブ2と同じ）
  function lessonLockout(people, M, lang) {
    const D = dictionary(M, lang);
    const rows = [];
    for (const { p, pv } of people) {
      const nm = names(p, M, lang);
      for (const row of lockTable(p, pv.lossTable, M, lang).rows) {
        if (!row.cells.some((c) => c.mark === 'locked' || c.mark === 'plus')) continue;
        rows.push([nm.person, { name: row.name, important: row.important }, ...row.cells.map((c) => ({ text: c.text, sr: c.sr, mark: c.mark }))]);
      }
    }
    return { caption: D.lesson7Caption, heads: [D.lessonColPerson, D.colAccount, D.lockColPhone, D.lockColNumber, D.lesson7ColMail], rows,
      grid: false };
  }
  // 座学8：同じ入口を外す変更と切り替える変更の要約（タブ3の要約の文と同じ。切り替える変更には札で前後を添える）
  function lessonRemoveReplace(people, M, lang) {
    const D = dictionary(M, lang);
    return { caption: D.lesson8Caption, heads: [D.lesson8ColEntrance, D.lesson8ColRemove, D.lesson8ColReplace],
      rows: LESSON8_ROWS.map(([pid, removeId, replaceId]) => {
        const { p, pv } = people.find((x) => x.p.id === pid), nm = names(p, M, lang);
        const remove = moveOf(pv, removeId);
        const summary = (id) => sentences(p, pv, id, M, lang).summary;
        const replace = replaceId ? moveOf(pv, replaceId) : null;
        return [fill(D.lesson8Entrance, { person: nm.person, account: nm.full[remove.service], method: methodText(p, remove, M, lang) }),
          { lines: summary(removeId) },
          replace ? { lines: [fill(D.sameReplace, { from: tagOf(p, replace.from, M, lang), to: tagOf(p, replace.to, M, lang) }),
            ...summary(replaceId)] } : D.lesson8NoReplace];
      }), grid: false };
  }
  // 座学9：輪の例（論文の形式。2つのメールが互いを回復先にする）。失ったものごとに、到達の補集合と定義18の最小不動点で入れないメール
  function lessonCycle(M, lang) {
    const D = dictionary(M, lang);
    const g = Core.graphFrom(Core.PAPER.cycle);
    const name = { pwA: D.lesson9PwA, pwB: D.lesson9PwB, mailA: D.lesson9MailA, mailB: D.lesson9MailB };
    const holdings = g.nodes.filter((v) => !g.byHead.has(v)), accounts = g.nodes.filter((v) => g.byHead.has(v));
    const list = (ids) => (ids.length ? ids.map((id) => name[id]).join(D.sepList) : D.lessonNone);
    return { caption: D.lesson9Caption, heads: [D.lesson9ColLost, D.lesson9ColComplement, D.lesson9ColDef18],
      rows: [holdings.slice(0, 1), holdings].map((lost) => {
        const R = Core.userReach(g, holdings, lost), L = Core.lockoutDef18(g, lost);
        return [list(lost), list(accounts.filter((v) => !R.has(v))), list(accounts.filter((v) => L.has(v)))];
      }), grid: true };
  }
  // 座学10：関連ツール（名前は別タブのリンク）
  function lessonTools(M, lang) {
    const D = dictionary(M, lang);
    return { caption: D.lesson10Caption, heads: [D.lesson10ColTool, D.lesson10ColLearn],
      rows: RELATED_TOOLS.map((tool) => [{ href: tool.href, text: D[tool.name] }, D[tool.learn]]), grid: false };
  }
  // 座学の表の番号（表の種類→番号）。座学の番号に合わせ、表が2つある座学1だけ「1-1」「1-2」（ほかは「2」〜「10」）。
  // 画面は表の題の頭に「表{番号}」を付け、本文は同じ番号で表を指す
  function lessonTableNumbers() {
    const numbers = {};
    for (const lesson of LESSONS) {
      const tables = lesson.blocks.filter(([kind]) => kind === 'table').map(([, value]) => value);
      tables.forEach((value, i) => { numbers[value] = tables.length > 1 ? lesson.n + '-' + (i + 1) : String(lesson.n); });
    }
    return numbers;
  }
  // 座学の表。people＝3人の [{ p, pv }]（データの順。pv＝Core.personaVectors(p)）
  function lessonTable(kind, people, M, lang) {
    const scene = (key) => {
      const [pid, cardId, accountId] = LESSON_SCENES[key];
      return { ...people.find((x) => x.p.id === pid), cardId, accountId };
    };
    if (kind === 'flow') {
      const { p, pv, cardId, accountId } = scene('flow');
      return lessonFlow(p, pv, cardId, accountId, M, lang);
    }
    if (kind === 'andOr') {
      const { p, cardId, accountId } = scene('andOr');
      return lessonAndOr(p, cardId, accountId, M, lang);
    }
    if (kind === 'families') return lessonFamilies(people, M, lang);
    if (kind === 'backdoors') return lessonBackdoors(people, M, lang);
    if (kind === 'simswap') return lessonCardResult(people, 'simswap', 'lesson4Caption', M, lang);
    if (kind === 'desk') return lessonCardResult(people, 'desk', 'lesson5Caption', M, lang);
    if (kind === 'brokerage') return lessonBrokerage(people, LESSON_SCENES.brokerage, M, lang);
    if (kind === 'lockout') return lessonLockout(people, M, lang);
    if (kind === 'removeReplace') return lessonRemoveReplace(people, M, lang);
    if (kind === 'cycle') return lessonCycle(M, lang);
    if (kind === 'tools') return lessonTools(M, lang);
    throw new Error('unknown lesson table ' + kind);
  }

  // ===== 見どころ9つ（画面にはいまの人物の3つを出す。押すと状態を変え、移る先へフォーカスを移す） =====
  const HIGHLIGHTS = Object.freeze([
    { id: 'W1', person: 'worker', key: 'highlightW1', count: 'leak',
      state: { tab: 'chain', card: 'leak', step: 0, account: 'mailMain' }, target: 'step:next' },
    { id: 'W2', person: 'worker', key: 'highlightW2',
      state: { tab: 'compare', mode: 'all', move: 'replace:mailMain.recMail:mailOld>paper:mailMain' }, target: 'compare-heading' },
    { id: 'W3', person: 'worker', key: 'highlightW3',
      state: { tab: 'compare', mode: 'simswap', move: 'remove:sec.recMailSms' }, target: 'compare-heading' },
    { id: 'P1', person: 'parent', key: 'highlightP1',
      state: { tab: 'chain', card: 'simswap', step: 'last', account: 'bank' }, target: 'detail-heading' },
    { id: 'P2', person: 'parent', key: 'highlightP2', state: { tab: 'lockout', account: 'bank' }, target: 'lock-acct:bank' },
    { id: 'P3', person: 'parent', key: 'highlightP3',
      state: { tab: 'compare', mode: 'simswap', move: 'replace:bank.recSms:phone>idcheck' }, target: 'compare-heading' },
    { id: 'S1', person: 'student', key: 'highlightS1',
      state: { tab: 'chain', card: 'leak', step: 0, account: 'sec' }, target: 'step:next' },
    { id: 'S2', person: 'student', key: 'highlightS2', count: 'mail',
      state: { tab: 'chain', card: 'mail', step: 'last', account: 'mailUni' }, target: 'detail-heading' },
    { id: 'S3', person: 'student', key: 'highlightS3', state: { tab: 'lockout', account: 'sub' }, target: 'lock-acct:sub' },
  ].map((h) => Object.freeze({ ...h, state: Object.freeze(h.state) })));
  // 題の {n} は計算で入れる（W1＝漏えいで倒れる数、S2＝メールの乗っ取りで倒れる数）
  function highlightTitle(h, pv, M, lang) {
    return fill(dictionary(M, lang)[h.key], h.count ? { n: pv.cards[h.count].services.length } : {});
  }
  // 移った先で「見るところ」の文。ほかのタブの見出しや列の名前は、その画面の語を差し込む（画面の語が変わっても食い違わない）。
  // 攻撃の表の変更後の数の列は、前後を1つの列にまとめた名前（attackColBeforeAfter）があればそれを使う
  function highlightLook(h, M, lang) {
    const D = dictionary(M, lang), raw = M[lang];
    return fill(D['hlLook' + h.id], { after: raw.attackColBeforeAfter || D.attackColAfter, lockOne: D.lockOneHeading, number: D.lockColNumber });
  }

  // ===== 地図の SVG の座標（文字は 14px。図の幅は列の数で決め、図の枠が狭い画面では図ごと枠の幅まで縮めて出す） =====
  // 列：0＝本人が持っているもの（パスワード・スマホ・電話番号など）、1…＝メール（メールどうしの依存の深さの順）、最後＝ほかのアカウント。
  // 図の幅は列の数で決める（4列＝960、3列＝800。日英で同じ）。列の幅は中身から決め、図の幅に収まらなければ、余裕のある列から縮めて
  // 条件の札を2行に折る（札そのものは割らない）。余った幅は列の間に配り（maxGap まで）、それでも余れば図を中央に寄せる。
  // 入口の行は、「ログイン」「復旧」の語の欄と、条件の札の欄に分ける。右には、攻撃者が使った入口の印（入られた）の場所を空けておく。
  // 線：隣の列へは3次ベジエ。2つ以上の列をまたぐ線は、元の列の右のすき間の縦の道を通り、入口の行の高さを横にまっすぐ進む。
  // その高さに途中の列のカードがあるときだけ、カードの上か下（近いほう）を回る。並んで走る横の線は sep 以上離す。
  // メールの列のカードは、ほかのアカウントの列の1枚目のカードの下から始める（1枚目の入口への線が、メールのカードの上をまっすぐ通る）。
  // top＝箱の上端（その上は列の見出し）、clear＝線と箱の間、step＝縦の道の間隔、edge＝箱の縁から
  // いちばん外の縦の道まで、minGap＝列の間の下限（隣の列へのベジエが曲がれる幅）、laneSep＝同じ縦の道を2本の線が使うときに空ける縦の間
  const G = Object.freeze({ margin: 12, top: 30, headY: 16, headLine: 16, boxMin: 104, boxMax: 140, box: 30, line: 18, sub: 15,
    rowGap: 10, head: 28, row: 24, pad: 6, roleGap: 8, markGap: 6, cardMin: 196, clear: 8, sep: 6, step: 6, edge: 6, minGap: 36,
    maxGap: 132, laneSep: 8, radius: 6, widths: Object.freeze({ 3: 800, 4: 960 }) });
  // 文字幅の見積もり（14px の文字）：全角14、英字の大文字9・小文字7・数字8・空白4・そのほかの半角5。
  // 列の見出しは 13px、「ログイン」「復旧」の語と小さな注は 12px で、この値を縮めて使う
  function charWidth(ch) {
    const c = ch.codePointAt(0);
    if (c >= 0x2E80 || (c >= 0x2190 && c <= 0x2BFF) || c === 0x2026) return 14;
    if (c >= 0x80) return 8;
    return /[A-Z]/.test(ch) ? 9 : /[a-z]/.test(ch) ? 7 : /[0-9]/.test(ch) ? 8 : ch === ' ' ? 4 : 5;
  }
  const textWidth = (s) => [...s].reduce((w, ch) => w + charWidth(ch), 0);
  const NO_START = '）)」』、。・ーぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ…';
  const NO_END = '（(「『';
  function charClass(ch) {
    const c = ch.codePointAt(0);
    if (c < 0x80) return /[A-Za-z0-9]/.test(ch) ? 'latin' : 'mark';
    if (c >= 0x3040 && c <= 0x309F) return 'hira';
    if (c >= 0x30A0 && c <= 0x30FF) return 'kata';
    if ((c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3400 && c <= 0x4DBF)) return 'kanji';
    return 'other';
  }
  function truncate(text, width) {
    if (textWidth(text) <= width) return text;
    const chars = [...text];
    while (chars.length && textWidth(chars.join('')) + 14 > width) chars.pop();
    return chars.join('').trimEnd() + '…';
  }
  // 2行までに折り返す。日本語は「の」の後ろや字の種類が変わる所を先に選び、英語は語の途中で切らない。
  // 2行に収まらなければ2行目の末尾を「…」で切る（全文は title に入れる）
  function wrapText(text, widths) {
    const [w0, w1] = widths;
    if (textWidth(text) <= w0) return { lines: [text], cut: false };
    const chars = [...text];
    let k = 0;
    for (let w = 0; k < chars.length && w + charWidth(chars[k]) <= w0; k++) w += charWidth(chars[k]);
    const good = [], plain = [];
    for (let i = k; i >= 1; i--) {
      const a = chars[i - 1], b = chars[i];
      if (b === undefined || NO_START.includes(b) || NO_END.includes(a)) continue;
      if (a === ' ' || b === ' ' || a === '-') { good.push(i); continue; }
      if (a.codePointAt(0) < 0x80 && b.codePointAt(0) < 0x80) continue;
      if ('の・＋、'.includes(a) || '＋（'.includes(b) || charClass(a) !== charClass(b)) good.push(i); else plain.push(i);
    }
    const options = [...good, ...plain];
    const split = (i) => [chars.slice(0, i).join('').trimEnd(), chars.slice(i).join('').trimStart()];
    for (const i of options) {
      const [first, rest] = split(i);
      if (textWidth(first) <= w0 && textWidth(rest) <= w1) return { lines: [first, rest], cut: false };
    }
    const [first, rest] = split(options.length ? options[0] : Math.max(1, k));
    return { lines: [truncate(first, w0), truncate(rest, w1)], cut: true };
  }
  // 入口の条件の札を、入る幅（room）で折り返す。札の途中では折らず、「＋」の前で折る（メインのメールや回復コード（紙）などの名前を
  // 割らない）。1つの札だけで入らないときは「…」で切り、全文を title に入れる
  function wrapTags(tags, plus, room) {
    const text = tags.join(plus);
    if (textWidth(text) <= room) return { lines: [text], cut: false, text };
    const lines = [];
    let current = null;
    for (const tag of tags) {
      if (current === null) current = tag;
      else if (textWidth(current + plus + tag) <= room) current += plus + tag;
      else {
        lines.push(current);
        current = plus.trimStart() + tag;
      }
    }
    lines.push(current);
    return { lines: lines.map((line) => truncate(line, room)), cut: lines.some((line) => textWidth(line) > room), text };
  }
  // メールの深さ＝1＋（入口の条件に出てくるメールの深さの最大。メールの条件がなければ0）
  function mailDepths(p) {
    const mails = new Map(p.services.filter((s) => s.mail).map((s) => [s.id, s]));
    const depth = {}, visiting = new Set();
    const visit = (id) => {
      if (depth[id] !== undefined) return depth[id];
      if (visiting.has(id)) throw new Error('mail cycle at ' + id);
      visiting.add(id);
      let d = 0;
      for (const m of mails.get(id).methods) for (const r of m.requires) if (mails.has(r)) d = Math.max(d, visit(r));
      visiting.delete(id);
      return (depth[id] = d + 1);
    };
    for (const id of mails.keys()) visit(id);
    return depth;
  }
  const round = (n) => Math.round(n * 100) / 100;
  function sampleSegment(a, b, out) {
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.5));
    for (let i = 1; i <= n; i++) out.push([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]);
  }
  // 直角に折れる線の角を円弧にした経路。sample のときだけ、経路を 1px 以下の間隔で分けた点（points）も返す
  function roundedPath(points, radius, sample) {
    const P = [];
    for (const pt of points) {
      const last = P[P.length - 1];
      if (!last || last[0] !== pt[0] || last[1] !== pt[1]) P.push(pt);
    }
    for (let i = 1; i < P.length - 1;) {
      const [a, b, c] = [P[i - 1], P[i], P[i + 1]];
      if ((a[0] === b[0] && b[0] === c[0]) || (a[1] === b[1] && b[1] === c[1])) P.splice(i, 1); else i++;
    }
    let d = 'M ' + round(P[0][0]) + ' ' + round(P[0][1]);
    const samples = sample ? [P[0]] : null;
    let current = P[0];
    for (let i = 1; i < P.length; i++) {
      const pt = P[i];
      if (i === P.length - 1) {
        d += ' L ' + round(pt[0]) + ' ' + round(pt[1]);
        if (sample) sampleSegment(current, pt, samples);
        break;
      }
      const prev = P[i - 1], next = P[i + 1];
      const l1 = Math.hypot(pt[0] - prev[0], pt[1] - prev[1]), l2 = Math.hypot(next[0] - pt[0], next[1] - pt[1]);
      const d1 = [(pt[0] - prev[0]) / l1, (pt[1] - prev[1]) / l1], d2 = [(next[0] - pt[0]) / l2, (next[1] - pt[1]) / l2];
      const r = Math.min(radius, l1 / 2, l2 / 2);
      const start = [pt[0] - d1[0] * r, pt[1] - d1[1] * r], end = [pt[0] + d2[0] * r, pt[1] + d2[1] * r];
      const sweep = d1[0] * d2[1] - d1[1] * d2[0] > 0 ? 1 : 0;
      d += ' L ' + round(start[0]) + ' ' + round(start[1]) + ' A ' + round(r) + ' ' + round(r) + ' 0 0 ' + sweep + ' '
        + round(end[0]) + ' ' + round(end[1]);
      if (sample) {
        sampleSegment(current, start, samples);
        const center = [start[0] + d2[0] * r, start[1] + d2[1] * r];
        const a0 = Math.atan2(start[1] - center[1], start[0] - center[0]);
        const turn = (sweep ? 1 : -1) * Math.PI / 2;
        const n = Math.max(2, Math.ceil(r * Math.PI / 2 / 0.5));
        for (let j = 1; j <= n; j++) {
          const t = a0 + turn * j / n;
          samples.push([center[0] + Math.cos(t) * r, center[1] + Math.sin(t) * r]);
        }
      }
      current = end;
    }
    return sample ? { d, points: samples } : { d };
  }
  // 隣の列へは3次ベジエ（M x1 y1 C x1+pull y1, x2−pull y2, x2 y2。pull＝列の間の半分ほど）。点（points）は sample のときだけ
  function bezierPath(x1, y1, x2, y2, sample, pull = 20) {
    const k = round(pull);
    const d = 'M ' + round(x1) + ' ' + round(y1) + ' C ' + round(x1 + k) + ' ' + round(y1) + ', ' + round(x2 - k) + ' '
      + round(y2) + ', ' + round(x2) + ' ' + round(y2);
    if (!sample) return { d };
    const c = [[x1, y1], [x1 + k, y1], [x2 - k, y2], [x2, y2]];
    const at = (t) => {
      const u = 1 - t, w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
      return [w.reduce((s, q, i) => s + q * c[i][0], 0), w.reduce((s, q, i) => s + q * c[i][1], 0)];
    };
    let n = Math.max(8, Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 3));
    let points;
    for (;;) {
      points = Array.from({ length: n + 1 }, (_, i) => at(i / n));
      let gap = 0;
      for (let i = 1; i < points.length; i++) {
        gap = Math.max(gap, Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
      }
      if (gap <= 1) break;
      n *= 2;
    }
    return { d, points };
  }
  // 区間 [lo, hi] の並びを、重なるものどうしまとめて小さい順に返す
  function mergeIntervals(list) {
    const out = [];
    for (const [lo, hi] of [...list].sort((a, b) => a[0] - b[0])) {
      const last = out[out.length - 1];
      if (last && lo <= last[1]) last[1] = Math.max(last[1], hi); else out.push([lo, hi]);
    }
    return out;
  }
  const sum = (list) => list.reduce((a, b) => a + b, 0);
  // 地図の座標。列と順は手の前の人物 p で決める。q を渡したときは、行と箱の高さを前後の文字の長いほうにそろえ、
  // 前後で座標を変えない（外した入口の行も場所を残す）。q の図は、箱ごとの印（守れた・新たに倒れる）をカードの上の縁に重ねて
  // 描けるように、箱の上と箱どうしの間を広げておく（box[id].badge＝印の右端と、上の縁の高さ）。
  // 返す値：columns・colOf、box（資格情報の箱とアカウントのカード）、rows（入口の行。before／after に「ログイン」「復旧」の語と札の行）、
  // heads（列の見出し）、lines＝描く人物（q か p）の条件の線（end＝入口の行に着く点）、linesBefore＝q があるときの p の線、
  // width・height、changed（変えた入口）、gaps（列の間の幅）、left（列の左端）。
  // 線の点（points＝経路を 1px 以下の間隔で分けた点）は、画面では使わないので、options.samplePoints のとき（テスト）だけ作る
  function layout(p, q, M, lang, options = {}) {
    const sample = options.samplePoints === true;
    const D = dictionary(M, lang);
    const after = q || p;
    const nmAfter = names(after, M, lang), nmBefore = names(p, M, lang);
    const depth = mailDepths(p);
    const lastCol = Math.max(0, ...Object.values(depth)) + 1;
    const colOf = {};
    for (const c of after.credentials) colOf[c.id] = 0;
    for (const s of p.services) colOf[s.id] = s.mail ? depth[s.id] : lastCol;
    const extra = after.credentials.filter((c) => !p.credentials.some((x) => x.id === c.id)).map((c) => c.id);
    const columns = Array.from({ length: lastCol + 1 }, () => []);
    columns[0] = [...p.credentials.map((c) => c.id), ...extra];
    for (const s of p.services) columns[colOf[s.id]].push(s.id);
    // 変えた入口（q がないときはなし）
    let changed = null;
    if (q) {
      for (const s of p.services) {
        for (const m of s.methods) {
          const n = q.services.find((x) => x.id === s.id).methods.find((x) => x.id === m.id);
          if (!changed && (!n || n.requires.join('\u0000') !== m.requires.join('\u0000'))) changed = s.id + '.' + m.id;
        }
      }
    }
    // 攻撃カードが渡しうる資格情報には「●0」の場所を空けておく
    const givable = new Set();
    for (const X of q ? [p, q] : [p]) for (const c of X.cards) for (const id of Core.cardGives(X, c)) givable.add(id);
    // ふだんの図で、どの入口にも使われていない資格情報には、線がないわけを小さく添える（書類は変更で使う）
    const unused = (id) => !q && !p.services.some((s) => s.methods.some((m) => m.requires.includes(id)));
    const unusedNote = (id) => (p.credentials.find((c) => c.id === id).type === 'idcheck' ? D.boxUnusedDoc : D.boxUnused);
    // 変更で増えた箱（このアカウントだけのパスワード・紙の回復コード）には、どのアカウントのものかを小さく添える（箱の名前は札の
    // 「パスワードD」「回復コード（紙）」のままで、切れない）
    const addedNote = (id) => {
      const owner = ownerOf(id);
      return after.credentials.find((c) => c.id === id).type === 'paper' ? fill(D.boxPaperSub, { account: nmAfter.mid[owner] })
        : fill(D.boxOwnSub, { account: nmAfter.short[owner] });
    };
    const markReserve = textWidth('●0') + G.markGap;
    const rankReserve = textWidth('●9') + G.markGap;
    // 「入られた」の印と「ログイン」「復旧」の語は 12px で書く（14px の幅を縮めて見積もる）
    const small = (text) => Math.ceil(textWidth(text) * 12 / 14);
    const openReserve = small(D.openTag) + G.markGap;
    const roleW = Math.max(small(D.symbolLog), small(D.symbolRec));
    const reqX = G.pad + roleW + G.roleGap;
    const reqRoom = (w) => w - reqX - openReserve - G.pad;
    const headName = (id) => (p.services.find((s) => s.id === id).important ? '★' : '') + nmBefore.short[id];
    const tagsOf = (X, nm, sid, mid) => {
      const m = X.services.find((s) => s.id === sid).methods.find((x) => x.id === mid);
      return m ? m.requires.map((r) => nm.tag[r]) : null;
    };
    // 列の幅：資格情報の列は札の長さ（boxMin〜boxMax）。メールとほかのアカウントの列は、見出しと入口の行が1行に入る幅（cardMin 以上）。
    // 縮めてよいのは、いちばん長い札が1行に入り、見出しが2行に入る幅（minimum）まで
    // 変更で増えた箱は、名前の下のアカウントの行（12px）が1行に入る幅もとる（boxMax まで）
    const credNeed = (id) => Math.max(2 * G.pad + textWidth(nmAfter.box[id]) + (givable.has(id) ? markReserve : 0),
      extra.includes(id) ? 2 * G.pad + small(addedNote(id)) : 0);
    const rowTags = (id) => p.services.find((x) => x.id === id).methods
      .flatMap((m) => (q ? [[p, nmBefore], [q, nmAfter]] : [[p, nmBefore]]).map(([X, nm]) => tagsOf(X, nm, id, m.id)).filter(Boolean));
    const cardNeed = (id, minimum) => {
      const rows = rowTags(id).map((tags) => reqX + (minimum ? Math.max(...tags.map(textWidth)) : textWidth(tags.join(D.sepPlus)))
        + openReserve + G.pad);
      const head = minimum ? Math.ceil(textWidth(headName(id)) / 2) + 14 : textWidth(headName(id));
      return Math.ceil(Math.max(G.cardMin, 2 * G.pad + head + rankReserve, ...rows));
    };
    const widths = columns.map((ids, k) => (k === 0 ? Math.min(G.boxMax, Math.max(G.boxMin, ...ids.map(credNeed)))
      : Math.max(...ids.map((id) => cardNeed(id, false)))));
    const minimum = columns.map((ids, k) => (k === 0 ? widths[0] : Math.max(...ids.map((id) => cardNeed(id, true)))));
    // 箱とカードと行の縦の位置（列の横の位置には依らない）。ほかのアカウントの列を先に置き、メールの列はその1枚目の下から
    const top = q ? G.top + 12 : G.top, rowGap = q ? G.rowGap + 6 : G.rowGap;
    function build() {
      const box = {}, rows = {}, bottoms = [];
      let mailTop = top;
      [lastCol, ...columns.keys()].filter((k, i, all) => all.indexOf(k) === i).forEach((k) => {
        const ids = columns[k];
        let y = k > 0 && k < lastCol ? mailTop : top;
        for (const id of ids) {
          const inner = widths[k] - 2 * G.pad;
          if (k === 0) {
            const label = wrapText(nmAfter.box[id], [inner - (givable.has(id) ? markReserve : 0), inner]);
            const note = unused(id) ? unusedNote(id) : extra.includes(id) ? addedNote(id) : null;
            const sub = note ? wrapText(note, [inner * 14 / 12, inner * 14 / 12]).lines : [];
            const labelH = G.box + G.line * (label.lines.length - 1);
            const h = labelH + (sub.length ? G.sub * sub.length + 4 : 0);
            box[id] = { kind: 'credential', y, h, labelH, label: label.lines, sub, title: nmAfter.full[id], added: extra.includes(id) };
            y += h + rowGap;
            continue;
          }
          const s = p.services.find((x) => x.id === id);
          const head = wrapText(headName(id), [inner - rankReserve, inner]);
          const headH = G.head + G.line * (head.lines.length - 1);
          const card = { kind: 'account', y, h: 0, headH, head: head.lines, important: !!s.important, title: nmBefore.full[id], rows: [] };
          let ry = y + headH;
          for (const m of s.methods) {
            const key = id + '.' + m.id;
            const textFor = (X, nm) => {
              const tags = tagsOf(X, nm, id, m.id);
              return tags && wrapTags(tags, D.sepPlus, reqRoom(widths[k]));
            };
            const before = textFor(p, nmBefore), afterText = q ? textFor(q, nmAfter) : null;
            const lineCount = Math.max(before.lines.length, afterText ? afterText.lines.length : 0);
            const textH = G.row + G.line * (lineCount - 1);
            rows[key] = { y: ry, h: textH + (key === changed ? G.line : 0), textH, lineCount, role: m.role, service: id, method: m.id,
              changed: key === changed, before, after: afterText };
            card.rows.push(key);
            ry += rows[key].h;
          }
          card.h = ry - y;
          box[id] = card;
          y = ry + rowGap;
          if (k === lastCol && id === ids[0]) mailTop = y;
        }
        bottoms[k] = y - rowGap;
      });
      return { box, rows, bottoms };
    }
    // 線の道筋のうち y だけで決まるもの（出口と入口の高さ・横に進む高さ・縦の道の番号）と、すき間ごとの縦の道の数
    function routesFor(X, geo) {
      const { box, rows } = geo;
      const list = [];
      for (const s of X.services) {
        for (const m of s.methods) {
          for (const r of m.requires) {
            const key = s.id + '.' + m.id;
            if (!(r in colOf) || colOf[r] >= colOf[s.id]) throw new Error('line not drawn from left to right: ' + r + ' -> ' + key);
            list.push({ from: r, to: key, role: m.role, kind: Core.lineKind(X, r), c1: colOf[r], c2: colOf[s.id] });
          }
        }
      }
      const span = (id) => (box[id].kind === 'credential' ? box[id].labelH : box[id].headH);
      const targetMid = (l) => rows[l.to].y + rows[l.to].textH / 2;
      // 1つの出口・入口に線が集まるときは、線ごとに高さを 5px までずらして束にしない（出口は行き先の高い順に上から）
      const spread = (n, height) => {
        const st = n > 1 ? Math.min(5, (height - 10) / (n - 1)) : 0;
        return Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * st);
      };
      const group = (field) => {
        const map = new Map();
        for (const l of list) {
          if (!map.has(l[field])) map.set(l[field], []);
          map.get(l[field]).push(l);
        }
        return map;
      };
      for (const [from, ls] of group('from')) {
        ls.sort((a, b) => targetMid(a) - targetMid(b) || a.c2 - b.c2);
        spread(ls.length, span(from)).forEach((off, i) => { ls[i].y1 = box[from].y + span(from) / 2 + off; });
      }
      for (const [to, ls] of group('to')) {
        ls.sort((a, b) => a.y1 - b.y1);
        spread(ls.length, rows[to].textH).forEach((off, i) => { ls[i].y2 = targetMid(ls[i]) + off; });
      }
      // 横に進む高さ：入口の行の高さに途中の列のカードがなければ、その高さをまっすぐ。あれば、カードの上か下を回る
      const blocked = columns.map((ids, k) => (k ? ids.map((id) => [box[id].y - G.clear, box[id].y + box[id].h + G.clear]) : []));
      const topLimit = G.headY + 8;
      const far = list.filter((l) => l.c2 - l.c1 > 1);
      for (const l of far) {
        l.blocked = mergeIntervals(blocked.slice(l.c1 + 1, l.c2).flat());
        const iv = l.blocked.find(([a, b]) => l.y2 > a && l.y2 < b);
        l.direct = !iv;
        if (l.direct) {
          l.channel = l.y2;
          continue;
        }
        const cost = (c) => Math.abs(l.y1 - c) + Math.abs(c - l.y2);
        l.sides = iv[0] >= topLimit && cost(iv[0]) < cost(iv[1]) ? [[iv[0], -1], [iv[1], 1]] : [[iv[1], 1], [iv[0], -1]];
      }
      // 並んで走る横の線を sep 以上離す。まっすぐ進む線の高さは動かさず、回る線を、カードから離れる向きにずらす。
      // 同じ列から出るほかの線の出口（元の列の右のすき間を横に進む）の高さも避ける
      const overlaps = (a, b) => Math.max(a.c1, b.c1) < Math.min(a.c2, b.c2);
      const placed = far.filter((l) => l.direct);
      const detours = far.filter((l) => !l.direct)
        .sort((a, b) => Math.abs(a.y2 - a.sides[0][0]) - Math.abs(b.y2 - b.sides[0][0]) || a.y2 - b.y2);
      for (const l of detours) {
        const busy = (y) => placed.some((o) => overlaps(o, l) && Math.abs(o.channel - y) < G.sep)
          || far.some((o) => o !== l && o.c1 === l.c1 && Math.abs(o.y1 - y) < G.sep)
          || l.blocked.some(([a, b]) => y > a && y < b);
        for (const [start, dir] of l.sides) {
          let c = start;
          while (busy(c)) c += dir * G.sep / 2;
          if (dir < 0 && c < topLimit) continue;
          l.channel = c;
          break;
        }
        placed.push(l);
      }
      // 縦の道：元の列の右のすき間（出口→横に進む高さ）と、回る線の、先の列の左のすき間（横に進む高さ→入口）。
      // 縦の範囲が重なる（laneSep より近い）区間どうしに別の道を割り当てる。道の番号は、元の側はすき間の左から、先の側は右から数え、
      // 縦に長く進む線ほど列の近くの道を使う（線どうしを入れ子にして交差を減らす）
      const needs = [];
      const assign = (pieces, field) => {
        pieces.sort((a, b) => (b.hi - b.lo) - (a.hi - a.lo) || a.lo - b.lo);
        const lanes = [];
        for (const pc of pieces) {
          let k = 0;
          while (lanes[k] && lanes[k].some(([lo, hi]) => pc.lo < hi + G.laneSep && lo < pc.hi + G.laneSep)) k++;
          (lanes[k] ||= []).push([pc.lo, pc.hi]);
          pc.line[field] = k;
        }
        return lanes.length;
      };
      for (let g = 0; g < lastCol; g++) {
        const out = far.filter((l) => l.c1 === g).map((l) => ({ line: l, lo: Math.min(l.y1, l.channel), hi: Math.max(l.y1, l.channel) }));
        const into = far.filter((l) => !l.direct && l.c2 - 1 === g)
          .map((l) => ({ line: l, lo: Math.min(l.channel, l.y2), hi: Math.max(l.channel, l.y2) }));
        needs[g] = { out: assign(out, 'laneOut'), in: assign(into, 'laneIn') };
      }
      return { list, needs, far };
    }
    // 列の間の幅：縦の道が step の間隔で入る幅（両端に edge、元の側と先の側の道の間に step。隣の列へのベジエのために minGap 以上）
    const gapNeed = (routes) => Array.from({ length: lastCol }, (_, g) => Math.max(G.minGap, ...routes.map((r) => {
      const { out, in: into } = r.needs[g];
      return 2 * G.edge + Math.max(0, out + into - 1) * G.step + (out && into ? G.step : 0);
    })));
    // 図の幅に収まらなければ、縮める余裕（minimum までの幅）のいちばん大きい列から縮めて（札を2行に折って）やり直す
    const W = G.widths[columns.length] || G.widths[4];
    let geo, routes, need;
    for (let pass = 0; ; pass++) {
      geo = build();
      routes = (q ? [q, p] : [p]).map((X) => routesFor(X, geo));
      need = gapNeed(routes);
      const over = 2 * G.margin + sum(widths) + sum(need) - W;
      const slack = widths.map((w, k) => w - minimum[k]);
      const k = slack.indexOf(Math.max(...slack));
      if (over <= 0 || pass === 8 || slack[k] <= 0) break;
      widths[k] -= Math.min(slack[k], Math.ceil(over));
    }
    // 余った幅は列の間に等しく配る（maxGap まで）。足りなければ列の間を縮める（縦の道の間隔が詰まる）。残りは左右に半分ずつ
    const gaps = need.slice();
    let rest = W - (2 * G.margin + sum(widths) + sum(need));
    if (rest < 0) {
      const room = gaps.map((w) => w - G.minGap), total = sum(room);
      gaps.forEach((w, g) => { gaps[g] = w + (total > 0 ? rest * room[g] / total : 0); });
      rest = 0;
    }
    for (let open = gaps.map((_, g) => g); rest > 0.5 && open.length; open = open.filter((g) => gaps[g] < G.maxGap)) {
      const share = rest / open.length;
      for (const g of open) {
        const add = Math.min(share, G.maxGap - gaps[g]);
        gaps[g] += add;
        rest -= add;
      }
    }
    gaps.forEach((w, g) => { rest += w - Math.floor(w); gaps[g] = Math.floor(w); });
    const left = [G.margin + Math.floor(Math.max(0, rest) / 2)];
    for (let k = 1; k <= lastCol; k++) left[k] = left[k - 1] + widths[k - 1] + gaps[k - 1];
    const right = (k) => left[k] + widths[k];
    // 座標を入れる
    const box = {}, rows = {};
    for (const [id, b] of Object.entries(geo.box)) {
      const k = colOf[id], x = left[k], w = widths[k];
      box[id] = b.kind === 'credential'
        ? { kind: b.kind, x, y: b.y, w, h: b.h, title: b.title, added: b.added,
          lines: b.label.map((value, i) => ({ value, x: x + 8, y: b.y + 20 + G.line * i })),
          sub: b.sub.map((value, i) => ({ value, x: x + 8, y: b.y + b.labelH + 8 + G.sub * i })),
          mark: { x: x + w - G.pad, y: b.y + 20 } }
        : { kind: b.kind, x, y: b.y, w, h: b.h, headH: b.headH, important: b.important, title: b.title, rows: b.rows,
          lines: b.head.map((value, i) => ({ value, x: x + G.pad, y: b.y + 19 + G.line * i })),
          mark: { x: x + w - G.pad, y: b.y + 19 }, badge: { x: x + w - 8, y: b.y } };
    }
    for (const [key, r] of Object.entries(geo.rows)) {
      const k = colOf[r.service], x = left[k], w = widths[k];
      const place = (t) => t && { role: { value: D[r.role === 'login' ? 'symbolLog' : 'symbolRec'], x: x + G.pad, y: r.y + 17 },
        lines: t.lines.map((value, i) => ({ value, x: x + reqX, y: r.y + 17 + G.line * i })), title: t.cut ? t.text : null };
      rows[key] = { x, y: r.y, w, h: r.h, role: r.role, service: r.service, method: r.method, changed: r.changed,
        before: place(r.before), after: q ? place(r.after) : null, mark: { x: x + w - G.pad, y: r.y + 17 },
        tag: r.changed ? { x: x + w - G.pad, y: r.y + 17 + G.line * r.lineCount } : null };
    }
    // 列の見出し（13px）：本人が持っているもの・メール（メールの列すべての上）・ほかのアカウント
    const headSpec = [[D.mapColHolds, 0, 0], ...(lastCol > 1 ? [[D.mapColMail, 1, lastCol - 1]] : []), [D.mapColAccounts, lastCol, lastCol]];
    const heads = headSpec.map(([text, k1, k2]) => {
      const room = (right(k2) - left[k1] + (k2 < lastCol ? gaps[k2] - 8 : 0)) * 14 / 13;
      return { lines: wrapText(text, [room, room]).lines.map((value, i) => ({ value, x: left[k1], y: G.headY + G.headLine * i })) };
    });
    // 線を描く。隣の列へは3次ベジエ、2つ以上またぐ線は、縦の道→横（→回るときは縦の道）→入口（角は半径6の円弧）
    function linesFor(route) {
      const spacing = route.needs.map(({ out, in: into }, g) => {
        const n = out + into + (out && into ? 1 : 0);
        return n > 1 ? Math.min(G.step, (gaps[g] - 2 * G.edge) / (n - 1)) : 0;
      });
      return route.list.map((l) => {
        const x1 = right(l.c1), x2 = left[l.c2];
        let path, channel = null;
        if (l.c2 - l.c1 === 1) path = bezierPath(x1, l.y1, x2, l.y2, sample, Math.min(48, (x2 - x1) * 0.45));
        else {
          channel = l.channel;
          const xs = x1 + G.edge + l.laneOut * spacing[l.c1];
          const xt = x2 - G.edge - (l.laneIn || 0) * spacing[l.c2 - 1];
          path = roundedPath(l.direct ? [[x1, l.y1], [xs, l.y1], [xs, l.y2], [x2, l.y2]]
            : [[x1, l.y1], [xs, l.y1], [xs, l.channel], [xt, l.channel], [xt, l.y2], [x2, l.y2]], G.radius, sample);
        }
        const line = { from: l.from, to: l.to, kind: l.kind, role: l.role, d: path.d, columns: [l.c1, l.c2], channel, end: [x2, round(l.y2)] };
        if (sample) line.points = path.points;
        return line;
      });
    }
    const lines = linesFor(routes[0]);
    const linesBefore = q ? linesFor(routes[1]) : null;
    const channels = routes.flatMap((r) => r.far.map((l) => l.channel));
    const height = Math.ceil(Math.max(...geo.bottoms, ...channels.map((c) => c + 6)) + G.margin);
    return { columns, colOf, box, rows, heads, lines, linesBefore, width: W, height, changed, gaps, left, widths };
  }

  return Object.freeze({
    fill, names, counts, lastStep, maxRank, givesShort, cardLine, cardNote, stepSummary, stepLine, stepStatus, mapCaption, mapTableCaption,
    mapRows, needText,
    detail, fourCards, lockCell, lockTable, lockEntrances, lockChanges, candidates, effect, effectText, rankingNote, sameEntrance, sameRows, afterMap,
    recentCache, moveTitle, moveChoice, moveOptions, attackLine, lossLines, pairLines, moveNotes, sentences, highlights: HIGHLIGHTS, highlightTitle,
    highlightLook, layout, textWidth, wrapText, wrapTags, mailDepths, symbolTable, printTable,
    lessons: LESSONS, lessonRefs: LESSON_REFS, relatedTools: RELATED_TOOLS, lessonScenes: LESSON_SCENES, lesson8Rows: LESSON8_ROWS, lessonTable,
    // タブ3：失うメール・候補のボタンの欄・候補の上の1行・要約の攻撃の文・なぜ守れたか
    lostMails, effectFace, storyMoveNote, attackParts, whyLine,
    // タブ2・タブ4・ヘルプ・印刷
    lockDetail, markTable, lessonTableNumbers,
    // 変更後の地図：地図のカードの選び方・カードについての文・箱の印・題・表の行・選んだアカウントの前後・表の凡例
    afterCardFor, afterCardNotice, afterBadges, afterCaption, afterRows, afterDetail, afterLegend,
  });
}));
