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
  const COLOR_KEYS = { red: 'colorRed', blue: 'colorBlue', gray: 'colorGray', yellow: 'colorYellow', green: 'colorGreen',
    purple: 'colorPurple' };
  const TAG_KEYS = { device: 'tagDevice', phone: 'tagPhone', info: 'tagInfo', idcheck: 'tagIdcheck', paper: 'tagPaper' };
  const REQ_KEYS = { device: 'reqDevice', phone: 'reqPhone', info: 'reqInfo', idcheck: 'reqIdcheck', paper: 'reqPaper' };
  const LOSS_COLUMN_KEYS = { device: 'lockColPhone', number: 'lockColNumber', paper: 'lockColPaper' };
  const PARTNER_KEYS = { device: 'partnerPhone', number: 'partnerNumber', paper: 'partnerPaper' };
  const LOSS_SENTENCE_KEYS = { device: 'Phone', number: 'Number', mail: 'Mail' };

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

  // 全名・短い名前・英の文の途中の名前・札（短い記号）・1手の文の名前・喪失の列名と相方の名前
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
      if (c.type === 'pw' && c.family === 'own') {
        tag[c.id] = D.tagOwn;
        req[c.id] = D.reqOwn;
        box[c.id] = fill(D.boxOwn, { account });
      } else if (c.type === 'pw') {
        tag[c.id] = fill(D.tagFamily, { color: D[COLOR_KEYS[c.family]], symbol: c.symbol });
        req[c.id] = c.label[lang];
        box[c.id] = tag[c.id];
      } else if (c.type === 'paper') {
        tag[c.id] = D.tagPaper;
        req[c.id] = D.reqPaper;
        box[c.id] = fill(D.boxPaper, { account });
      } else {
        tag[c.id] = D[TAG_KEYS[c.type]];
        req[c.id] = D[REQ_KEYS[c.type]];
        box[c.id] = tag[c.id];
      }
      // 1手で増えた資格情報は、計算部が付けたラベルを出さず、箱の文を全名にする
      full[c.id] = owner ? box[c.id] : c.label[lang];
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
  // アカウントの数と、パスワードの系統の数
  function counts(p) {
    return { accounts: p.services.length, families: p.credentials.filter((c) => c.type === 'pw').length };
  }

  // ===== タブ1：カードと段 =====
  // カードの最後の段（倒れるものがなければ0）。pv＝Core.personaVectors(p)
  function lastStep(pv, cardId) {
    return Math.max(0, ...Object.values(pv.cards[cardId].rank));
  }
  // result＝pv.cards[card] か afterMap の値（rank・via・backdoor を持つもの）
  const maxRank = (result) => Math.max(0, ...Object.values(result.rank));

  // 攻撃者の手元に加わったものの名前（資格情報はデータのラベル、個人情報は短い札、1手で増えたものは1手の文の名前、アカウントは短い名前）
  function heldName(p, nm, id, D, lang) {
    const c = p.credentials.find((x) => x.id === id);
    if (!c) return nm.short[id];
    if (c.type === 'info') return D.tagInfo;
    return ownerOf(id) ? nm.req[id] : c.label[lang];
  }
  // 渡すものの札（漏えい＝系統のデータのラベル、SIMスワップ＝電話番号のデータのラベル、メールの乗っ取り＝メールの短い名前、窓口＝「個人情報」）
  function givesShort(p, cardId, M, lang) {
    const D = dictionary(M, lang), nm = names(p, M, lang);
    const gives = Core.cardGives(p, p.cards.find((c) => c.id === cardId));
    return gives.map((id) => heldName(p, nm, id, D, lang)).join(D.sepList);
  }
  // カードの説明の1行：データのカードのラベル＋渡すもの（漏えいは計算した系統と、漏れたサービスの短い名前）
  function cardLine(p, cardId, M, lang) {
    const D = dictionary(M, lang), nm = names(p, M, lang);
    const card = p.cards.find((c) => c.id === cardId);
    const gives = card.leaks
      ? fill(D.givesLeak, { family: givesShort(p, cardId, M, lang), service: nm.short[card.leaks] })
      : fill(D.gives, { gives: givesShort(p, cardId, M, lang) });
    return fill(D.cardLine, { label: card.label[lang], gives });
  }
  // カードごとの注記（メールの乗っ取りにはない）
  function cardNote(cardId, M, lang) {
    const key = { leak: 'noteLeak', simswap: 'noteSms', desk: 'noteDesk' }[cardId];
    return key ? dictionary(M, lang)[key] : null;
  }
  // 段の要約（段の操作に関係なく、最後の段の結果）。n＝1 と★0 は別の型
  function stepSummary(p, result, M, lang) {
    const D = dictionary(M, lang);
    const fallen = p.services.filter((s) => result.rank[s.id] !== undefined);
    if (!fallen.length) return D.stepSummaryNone;
    const imp = fallen.filter((s) => s.important).length;
    const key = (fallen.length === 1 ? 'stepSummaryOne' : 'stepSummary') + (imp ? '' : 'NoImp');
    return fill(D[key], { n: fallen.length, total: p.services.length, imp });
  }
  // 段の文（画面にいつも出す1行）。段0はカードが渡したもの、段 r はその段で新たに倒れたアカウントの短い名前
  function stepLine(p, result, cardId, step, M, lang) {
    const D = dictionary(M, lang), nm = names(p, M, lang);
    return step === 0
      ? fill(D.stepStatusZero, { gives: givesShort(p, cardId, M, lang) })
      : fill(D.stepStatus, { step, max: maxRank(result),
        accounts: p.services.filter((s) => result.rank[s.id] === step).map((s) => nm.short[s.id]).join(D.sepList) });
  }
  // 読み上げの段の文。最後の段では段の文に要約を続ける
  function stepStatus(p, result, cardId, step, M, lang) {
    const status = stepLine(p, result, cardId, step, M, lang);
    return step >= maxRank(result)
      ? fill(dictionary(M, lang).stepStatusWithSummary, { status, summary: stepSummary(p, result, M, lang) }) : status;
  }
  function mapCaption(p, cardId, step, M, lang) {
    const nm = names(p, M, lang);
    return fill(dictionary(M, lang).mapCaption, { person: nm.person, card: nm.card[cardId], step });
  }

  // 入口の札（かつは＋でつなぐ）と、表の入口の欄の文
  const requirementTags = (nm, m, D) => m.requires.map((r) => nm.tag[r]).join(D.sepPlus);
  function entranceText(nm, m, D) {
    return fill(D[m.role === 'login' ? 'entranceLogin' : 'entranceRecovery'], { req: requirementTags(nm, m, D) });
  }
  // 開けた入口の名前。手で変えた入口は、データのラベルでなく条件の札から作る
  function viaName(X, nm, key, changedMethod, D, lang) {
    const [sid, mid] = key.split('.');
    const m = X.services.find((s) => s.id === sid).methods.find((x) => x.id === mid);
    return key === changedMethod ? entranceText(nm, m, D) : m.label[lang];
  }

  // 地図の表の行。X＝描く人物（タブ1は p、手のあとは q）。段 step より先の段は「－」にする
  function mapRows(X, result, step, M, lang, changedMethod = null) {
    const D = dictionary(M, lang), nm = names(X, M, lang);
    const last = maxRank(result);
    return X.services.map((s) => {
      const rank = result.rank[s.id];
      let cell;
      if (rank !== undefined && rank <= step) {
        const via = rank === 0 ? null : viaName(X, nm, result.via[s.id], changedMethod, D, lang);
        cell = { fallen: true, rank, thisStep: rank === step, backdoor: result.backdoor.includes(s.id),
          text: rank === 0 ? D.cellGiven : fill(D.cellFallen, { rank, via }),
          sr: rank === 0 ? D.srGiven : fill(D.srFallen, { rank, via }) };
      } else {
        cell = { fallen: false, rank: null, thisStep: false, backdoor: false, text: D.cellNone,
          sr: step < last ? D.srNotYet : D.srNone };
      }
      return { id: s.id, important: !!s.important, name: nm.full[s.id], short: nm.short[s.id],
        entrances: s.methods.map((m) => entranceText(nm, m, D)), methods: s.methods.map((m) => m.id), cell };
    });
  }

  // 倒すのに要るカード（vectors の cardBase。1枚・どれか1枚・組・組のどれか・4枚を合わせても倒れない）
  function needText(p, pv, accountId, M, lang) {
    const D = dictionary(M, lang), nm = names(p, M, lang);
    const bases = pv.cardBase[accountId];
    if (!bases.length) return D.needNever;
    const singles = bases.filter((b) => b.length === 1).map((b) => nm.card[b[0]]);
    const combos = bases.filter((b) => b.length > 1).map((b) => b.map((c) => nm.card[c]).join(D.sepAnd));
    if (!combos.length) {
      if (singles.length === p.cards.length) return D.needAllFour;
      return singles.length === 1 ? fill(D.needOne, { card: singles[0] }) : fill(D.needAnyOf, { cards: joinAny(D, singles) });
    }
    if (!singles.length) {
      return combos.length === 1 ? fill(D.needCombo, { combo: combos[0] }) : fill(D.needCombos, { combos: combos.join(D.sepCombos) });
    }
    return fill(D.needMixed, { cards: joinAny(D, singles), combos: combos.join(D.sepCombos) });
  }

  // 詳細欄（段の操作に関係なく、最後の段の結果）。資格情報の組は出さない
  function detail(p, pv, cardId, accountId, M, lang) {
    const D = dictionary(M, lang), nm = names(p, M, lang);
    const s = p.services.find((x) => x.id === accountId);
    const result = pv.cards[cardId];
    const rank = result.rank[accountId];
    const falls = rank === undefined ? D.detailSafe : rank === 0 ? D.detailGiven
      : fill(D.detailFalls, { rank, via: viaName(p, nm, result.via[accountId], null, D, lang) });
    const notes = [];
    if (accountId === 'sec') notes.push(D.noteBrokerage);
    if (accountId === 'sec' && p.id === 'student') notes.push(D.noteBrokerageStudent);
    return {
      heading: fill(D.detailHeading, { account: nm.full[accountId] }),
      entrances: s.methods.map((m) => fill(D[m.role === 'login' ? 'entranceLogin' : 'entranceRecovery'],
        { req: fill(D.detailEntrance, { label: m.label[lang], req: requirementTags(nm, m, D) }) })),
      falls,
      backdoor: result.backdoor.includes(accountId) ? D.srBackdoor : null,
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
      rows: p.services.map((s) => ({ id: s.id, name: nm.short[s.id], cells: p.cards.map((c) => {
        const rank = pv.cards[c.id].rank[s.id];
        if (rank === undefined) return { card: c.id, text: D.cellNone, sr: D.srNone };
        return { card: c.id, text: '●' + rank, sr: rank === 0 ? D.srGiven : fill(D.srFallsAt, { rank }) };
      }) })),
    };
  }

  // ===== タブ2：閉め出しの表 =====
  // セル＝○・○（＋…で×）・×・消。相方が紙なら英の動詞を go にする（キーを分ける）
  function lockCell(cell, nm, D) {
    if (cell.mark === 'gone') return { mark: 'gone', text: D.cellGone, sr: D.srGone };
    if (cell.mark === 'locked') return { mark: 'locked', text: D.cellLocked, sr: D.srLocked };
    if (!cell.plus.length) return { mark: 'ok', text: D.cellOk, sr: D.srOk };
    const partners = cell.plus.map((x) => nm.partner[x]);
    const plural = cell.plus[cell.plus.length - 1] === 'paper' ? 'Plural' : '';
    const text = partners.length === 1
      ? fill(D['cellPlus1' + plural], { p: partners[0] })
      : fill(D['cellPlus2' + plural], { p1: partners.slice(0, -1).join(D.sepList), p2: partners[partners.length - 1] });
    return { mark: 'plus', text, sr: fill(D.srPlus, { p: partners.join(D.sepOr) }) };
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
  // 閉め出しの表の下の1行：選んだアカウントの入口（地図の表の入口の欄と同じ書き方）。×の理由を、このタブで読めるようにする
  function lockEntrances(p, accountId, M, lang) {
    const D = dictionary(M, lang), nm = names(p, M, lang);
    const s = p.services.find((x) => x.id === accountId);
    return fill(D.lockEntrances, { account: nm.full[accountId], entrances: s.methods.map((m) => entranceText(nm, m, D)).join(D.sepLines) });
  }
  // 閉め出しの表の前後：セル（mark・plus）が前後で変わったアカウントだけ。列＝喪失カード3枚×前・後
  function lockChanges(p, pv, moveId, M, lang) {
    const D = dictionary(M, lang);
    const mv = moveOf(pv, moveId);
    const before = lockTable(p, pv.lossTable, M, lang), after = lockTable(p, mv.lossTable, M, lang);
    const same = (a, b) => a.mark === b.mark && a.plus.join('+') === b.plus.join('+');
    const changed = p.services.filter((s) => pv.lossTable.columns.some((l) => !same(pv.lossTable.cells[l][s.id], mv.lossTable.cells[l][s.id])));
    const phases = [['before', D.attackColBefore], ['after', D.attackColAfter]];
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
  // 候補：並べた順に、オススメと同じ条件を満たす手だけを取り、同じ入口（アカウントと入口の組）の手は飛ばして3つまで。先頭＝best
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
    const ids = [], entrances = new Set();
    for (const id of pv.ranking[mode]) {
      const mv = moveOf(pv, id);
      const entrance = mv.service + '.' + mv.method;
      if (!ok(mv) || entrances.has(entrance)) continue;
      entrances.add(entrance);
      ids.push(id);
      if (ids.length === 3) break;
    }
    let reason = null;
    if (!ids.length) {
      if (mode === 'lockout') reason = p.losses.every((l) => !pv.losses[l.id].locked.length) ? 'noLockout' : 'noSafeMove';
      else reason = cardIdsFor(p, mode).every((c) => !pv.cards[c].services.length) ? 'noFall' : 'noSafeMove';
    }
    return { ids, reason };
  }
  // 効果の文の数。saved＝守れた数（カードのモードはそのカード、4枚の合計は4枚の延べ）、imp＝そのうち★
  function effect(p, pv, moveId, mode) {
    const mv = moveOf(pv, moveId);
    const imp = new Set(p.services.filter((s) => s.important).map((s) => s.id));
    let saved = 0, impSaved = 0, exposedAll = 0, unlocked = 0, newly = 0, pairNew = 0;
    for (const c of cardIdsFor(p, mode)) {
      saved += mv.cards[c].saved.length;
      impSaved += mv.cards[c].saved.filter((s) => imp.has(s)).length;
    }
    for (const c of p.cards) exposedAll += mv.cards[c.id].exposed.length;
    for (const l of Object.values(mv.losses)) {
      unlocked += l.unlocked.length;
      newly += l.newlyLocked.length;
    }
    for (const x of Object.values(mv.pairLosses)) pairNew += x.newlyLocked.length;
    return { saved, imp: impSaved, unlocked, newly, exposedAll, pairNew };
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
    if (e.exposedAll) parts.push(fill(D.effectExposed, { n: e.exposedAll }));
    if (e.pairNew) parts.push(fill(D.effectPairNew, { n: e.pairNew }));
    return parts.join(D.effectSep);
  }
  const rankingNote = (mode, M, lang) => dictionary(M, lang)[mode === 'lockout' ? 'rankingLockout' : 'rankingCards'];

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
  // 札（同じ入口の表の {from}{to}）。1手で増える紙と独自の系統も札で書く
  function tagOf(p, id, M, lang) {
    const D = dictionary(M, lang);
    if (id.startsWith('paper:')) return D.tagPaper;
    if (id.startsWith('pw:own-')) return D.tagOwn;
    return names(p, M, lang).tag[id];
  }
  // 1手の文の {from}{to}
  function reqName(p, id, M, lang) {
    const D = dictionary(M, lang);
    if (id.startsWith('paper:')) return D.reqPaper;
    if (id.startsWith('pw:own-')) return D.reqOwn;
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
  // 同じ入口のほかの手と比べる表。手の列は同じ入口との差だけを書く
  function sameRows(p, pv, moveId, M, lang) {
    const D = dictionary(M, lang), nm = names(p, M, lang);
    const ids = sameEntrance(pv, moveId);
    const first = moveOf(pv, moveId);
    const col = nm.lossColumn;
    const rows = ids.map((id) => {
      const mv = moveOf(pv, id);
      const move = mv.kind === 'add' ? D.sameAdd : mv.kind === 'remove' ? D.sameRemove
        : fill(D.sameReplace, { from: tagOf(p, mv.from, M, lang), to: tagOf(p, mv.to, M, lang) });
      let saved = 0, newly = 0;
      for (const c of p.cards) {
        saved += mv.cards[c.id].saved.length;
        newly += mv.cards[c.id].exposed.length;
      }
      const lock = [];
      for (const [field, key] of [['newlyLocked', 'sameLockNew'], ['unlocked', 'sameLockUnlocked']]) {
        for (const l of p.losses) {
          for (const s of mv.losses[l.id][field]) lock.push(fill(D[key], { account: nm.full[s], loss: col[l.id] }));
        }
      }
      const pair = [];
      for (const g of pairGroups(p, mv)) {
        if (g.nw.length === 1 && g.un.length === 1) {
          const [a, b] = g.un[0].split('+'), [c, d] = g.nw[0].split('+');
          pair.push(fill(D.samePairMove, { A: col[a], B: col[b], C: col[c], D: col[d] }));
          continue;
        }
        for (const k of g.nw) {
          const [a, b] = k.split('+');
          pair.push(fill(D.samePairNew, { A: col[a], B: col[b] }));
        }
        for (const k of g.un) {
          const [a, b] = k.split('+');
          pair.push(fill(D.samePairUnlocked, { A: col[a], B: col[b] }));
        }
      }
      return { id, move, saved, newly, lock: lock.length ? lock.join(D.sepList) : D.cellNone,
        pair: pair.length ? pair.join(D.sepList) : D.cellNone };
    });
    // 外す手の注記を表の下に：表に「外す」の行があり、選んだ手が外す手でないとき（外す手を選んでいれば、上の注記に同じ文が出る）。
    // 「外す」の行の閉め出しが「－」でも、パスワードを忘れたときの戻り道はなくなるため
    const removeNote = first.kind !== 'remove' && ids.some((id) => moveOf(pv, id).kind === 'remove') ? D.noteRemove : null;
    return { heading: fill(D.sameEntrance, { account: nm.full[first.service], method: methodText(p, first, M, lang), n: ids.length }),
      rows, removeNote };
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

  // ===== 1手の文 =====
  function moveTitle(p, mv, M, lang) {
    const D = dictionary(M, lang), nm = names(p, M, lang);
    const values = { account: nm.full[mv.service], method: methodText(p, mv, M, lang) };
    if (mv.kind === 'add') return fill(D.moveAdd, values);
    if (mv.kind === 'remove') return fill(D.moveRemove, values);
    return fill(D.moveReplace, { ...values, from: reqName(p, mv.from, M, lang), to: reqName(p, mv.to, M, lang) });
  }
  // 「1手を自分で選ぶ」の選択肢の文：1手の文から頭の「{account}：」を除いたもの
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
  function accountsText(nm, ids, D) {
    return ids.length >= 4 ? fill(D.accountsMany, { first: nm.short[ids[0]], n: ids.length })
      : ids.map((s) => nm.short[s]).join(D.sepList);
  }
  // 要約の攻撃の行。守れた（新たに倒れた）アカウントの集合が同じカードはまとめる。mv＝vectors の moves の形の値
  function attackLine(p, mv, M, lang) {
    const D = dictionary(M, lang), nm = names(p, M, lang);
    const groupBy = (field) => {
      const out = [];
      for (const c of p.cards) {
        const set = mv.cards[c.id][field];
        if (!set.length) continue;
        let g = out.find((x) => x.key === set.join(','));
        if (!g) out.push(g = { key: set.join(','), cards: [], accounts: set });
        g.cards.push(c.id);
      }
      return out;
    };
    const saved = groupBy('saved'), exposed = groupBy('exposed');
    const values = (g) => ({ cards: g.cards.map((c) => nm.card[c]).join(D.sepAnd), accounts: accountsText(nm, g.accounts, D) });
    const parts = saved.map((g, i) => fill(D[i ? 'sumAttackSavedMore' : 'sumAttackSaved'], values(g)));
    exposed.forEach((g, i) => parts.push(fill(D[!saved.length && !i ? 'sumAttackExposedFirst' : 'sumAttackExposed'], values(g))));
    return parts.length ? parts.join(D.sepSentences) : D.sumAttackNone;
  }
  // 1つ失う文。1つ→2つ同時（解けたが、手のあとの pairOnly でその喪失を含む組に入る）は lossOneUnlocked の代わりに oneToPair
  function lossLines(p, mv, M, lang) {
    const D = dictionary(M, lang), nm = names(p, M, lang);
    const mail = nm.partner.mail;
    const one = [], oneToPair = [];
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
        const line = fill(D.oneToPair, { account: nm.full[s], loss: fill(D['lossGerund' + suffix], { mail }),
          pairs: pairsOf(s).map((k) => pairText(k, nm.partner, D)).join(D.sepPairs) });
        one.push(line);
        oneToPair.push(line);
      }
    }
    return { one, oneToPair };
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
  // 注記（当てはまるものを、この順で）：書類・紙・外す・独自の系統（漏えいの出どころ）・スマホ・何も変わらない
  function moveNotes(p, mv, M, lang) {
    const D = dictionary(M, lang);
    const device = p.credentials.find((c) => c.type === 'device');
    const idcheck = p.credentials.find((c) => c.type === 'idcheck');
    const leak = p.cards.find((c) => c.leaks);
    const mentionsDevice = (mv.losses.device && (mv.losses.device.newlyLocked.length || mv.losses.device.unlocked.length))
      || Object.keys(mv.pairLosses).some((k) => k.split('+').includes('device')
        && (mv.pairLosses[k].newlyLocked.length || mv.pairLosses[k].unlocked.length));
    const notes = [];
    if (idcheck && mv.to === idcheck.id) notes.push(D.noteDesk);
    if (mv.to && mv.to.startsWith('paper:')) notes.push(D.notePaper);
    if (mv.kind === 'remove') notes.push(D.noteRemove);
    if (mv.to && mv.to.startsWith('pw:own-') && leak && leak.leaks === mv.service) notes.push(D.noteOwnFamily);
    if ((device && mv.to === device.id) || mentionsDevice) notes.push(D.lockNoteSync);
    if (changesNothing(mv)) notes.push(D.noteNoChange);
    return notes;
  }
  // 攻撃（カード4枚）の表の行と、合計（延べ）の行。表の行の名前は全名（要約の行は短い名前）。
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
  // 1手の文：見出し・要約（攻撃・閉め出し・2つ同時）・攻撃の表・1つ失う文・2つ同時の文・注記
  function sentences(p, pv, moveId, M, lang, mode = 'all') {
    const D = dictionary(M, lang);
    const mv = moveOf(pv, moveId);
    const { one, oneToPair } = lossLines(p, mv, M, lang);
    const pairs = pairLines(p, mv, M, lang);
    const summary = [attackLine(p, mv, M, lang), one.length ? fill(D.sumLock, { lines: one.join(D.sepLines) }) : D.sumLockNone];
    if (pairs.length) summary.push(fill(D.sumPair, { lines: pairs.join(D.sepLines) }));
    const two = [...pairs, ...oneToPair];
    return {
      title: moveTitle(p, mv, M, lang),
      summary,
      attack: attackRows(p, pv, mv, mode, M, lang),
      lossOne: one.length ? one : [D.sumLockNone],
      lossTwo: two.length ? two : [D.pairNone],
      notes: moveNotes(p, mv, M, lang),
    };
  }

  // ===== タブ4：記号の一覧と、印刷する3人の表 =====
  // 記号の一覧の行と、値のある列の数（ロ／復の行は線の種類まで、●1の行は何を表すかまで。あとの列は空欄＝null）
  const SYMBOL_ROWS = Object.freeze([['Family', 5], ['Phone', 5], ['Sms', 5], ['Info', 5], ['Doc', 5], ['Paper', 5], ['Mail', 5], ['Role', 3],
    ['Mark', 2]]);
  const SYMBOL_COLUMNS = ['Name', 'Meaning', 'Line', 'Attack', 'Loss'];
  function symbolTable(M, lang) {
    const D = dictionary(M, lang);
    return {
      caption: D.symbolCaption,
      columns: ['symbolColSymbol', 'symbolColMeaning', 'symbolColLine', 'symbolColAttack', 'symbolColLoss'].map((key) => D[key]),
      rows: SYMBOL_ROWS.map(([row, filled]) => ({ id: row, cells: SYMBOL_COLUMNS.map((col, i) => (i < filled ? D['sym' + row + col] : null)) })),
    };
  }
  const STORY_KEYS = { worker: 'storyWorker', parent: 'storyParent', student: 'storyStudent' };
  // 印刷する人物の表（1人1表）：列＝アカウント・入口・攻撃カード4枚・喪失カード3枚。入口は記号（ロ：赤A／復：SMS）、
  // 攻撃の列は最後の段の●段（裏口なら印を添える）か－、喪失の列は閉め出しの表と同じ○・○（＋…で×）・×・消
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
    { n: 3, blocks: [['p', 'lesson3Text1'], ['p', 'lesson3Text2'], ['p', 'lesson3Text3'], ['p', 'lesson3Text4'], ['table', 'backdoors'],
      ['legend', 'fourCardsLegend']], refs: ['Li2018', 'Klivan2023', 'Honan2012', 'Hammann2019'] },
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
  // 座学8の5行（同じ入口を外す手と、紙か書類へ付け替える手。付け替える手のない入口は null）
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
      rows.push([fill(D.lessonStep, { step }),
        ids.filter((id) => result.rank[id] === step).map((id) => heldName(p, nm, id, D, lang)).join(D.sepList),
        ...s.methods.map((m) => {
          const missing = m.requires.filter((r) => !held.has(r));
          return missing.length ? fill(D.lessonMissing, { items: missing.map((r) => nm.tag[r]).join(D.sepList) }) : D.lessonMet;
        }),
        step === fall ? fill(D.srFallen, { rank: fall, via: viaName(p, nm, result.via[accountId], null, D, lang) }) : D.srNotYet]);
    }
    return { caption: fill(D.lesson1FlowCaption, { person: nm.person, account: nm.short[accountId], card: nm.card[cardId] }),
      heads: [D.lesson1ColStep, D.lesson1ColAdded, ...s.methods.map((m) => entranceText(nm, m, D)), D.lessonColResult], rows, grid: false };
  }
  // 座学1の表2：カードが渡すものを条件に含む入口を、かつ・またはで数えたときと、すべての線を「または」として数えたとき（素朴な BFS）
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
  // 座学2：3人のパスワードの系統ごとに、その系統を条件に持つアカウント（データの順）
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
  // 座学3：カード（行）×3人（列）の裏口の数（vectors の cards.<card>.backdoor）
  function lessonBackdoors(people, M, lang) {
    const D = dictionary(M, lang);
    return { caption: D.lesson3Caption, heads: [D.attackColCard, ...people.map(({ p }) => names(p, M, lang).person)],
      rows: people[0].p.cards.map((c) => [{ text: D[CARD_SHORT_KEYS[c.id]], sr: D[CARD_KEYS[c.id]] },
        ...people.map(({ pv }) => String(pv.cards[c.id].backdoor.length))]), grid: true };
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
  // 座学8：同じ入口を外す手と付け替える手の要約（タブ3の要約の文と同じ。付け替える手には札で前後を添える）
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

  // ===== 地図の SVG の座標（目安の寸法。文字は 14px で、図は縮めずに描く） =====
  // colGap＝列の間の平均（図の幅を決める）。step＝通り道の高さと縦の道の間隔、edge＝カードの縁からいちばん外の縦の道まで、
  // minGap＝隣の列へのベジエが曲がれる列の間の下限、laneSep＝同じ縦の道を2本の線が使うときに空ける縦の間、
  // widen＝縦の道を step の間隔で入れるために図を広げてよい上限（720px の画面で、図の枠の中に収まる幅）
  const G = Object.freeze({ margin: 12, boxW: 104, cardW: 160, colGap: 32, rowGap: 16, box: 30, head: 28, row: 24, line: 18,
    pad: 6, step: 4, radius: 6, markGap: 4, edge: 4, minGap: 24, laneSep: 8, widen: 649 });
  // 文字幅の見積もり：全角14・半角8
  function charWidth(ch) {
    const c = ch.codePointAt(0);
    return c >= 0x2E80 || (c >= 0x2190 && c <= 0x2BFF) || c === 0x2026 ? 14 : 8;
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
  // 入口の行：収まらないときは最後の「＋」の前で2行に折り返す
  function wrapRow(symbol, tags, plus, widths) {
    const text = symbol + ' ' + tags.join(plus);
    if (textWidth(text) <= widths[0]) return { lines: [text], cut: false, text };
    if (tags.length > 1) {
      const first = symbol + ' ' + tags.slice(0, -1).join(plus), second = plus.trimStart() + tags[tags.length - 1];
      if (textWidth(first) <= widths[0] && textWidth(second) <= widths[1]) return { lines: [first, second], cut: false, text };
    }
    return { ...wrapText(text, widths), text };
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
  // 直角に折れる線の角を円弧にした経路と、経路を 1px 以下の間隔で分けた点
  function roundedPath(points, radius) {
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
    const samples = [P[0]];
    let current = P[0];
    for (let i = 1; i < P.length; i++) {
      const pt = P[i];
      if (i === P.length - 1) {
        d += ' L ' + round(pt[0]) + ' ' + round(pt[1]);
        sampleSegment(current, pt, samples);
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
      sampleSegment(current, start, samples);
      const center = [start[0] + d2[0] * r, start[1] + d2[1] * r];
      const a0 = Math.atan2(start[1] - center[1], start[0] - center[0]);
      const turn = (sweep ? 1 : -1) * Math.PI / 2;
      const n = Math.max(2, Math.ceil(r * Math.PI / 2 / 0.5));
      for (let j = 1; j <= n; j++) {
        const t = a0 + turn * j / n;
        samples.push([center[0] + Math.cos(t) * r, center[1] + Math.sin(t) * r]);
      }
      current = end;
    }
    return { d, points: samples };
  }
  // 隣の列へは3次ベジエ（M x1 y1 C x1+20 y1, x2−20 y2, x2 y2）
  function bezierPath(x1, y1, x2, y2) {
    const c = [[x1, y1], [x1 + 20, y1], [x2 - 20, y2], [x2, y2]];
    const at = (t) => {
      const u = 1 - t, w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
      return [w.reduce((s, k, i) => s + k * c[i][0], 0), w.reduce((s, k, i) => s + k * c[i][1], 0)];
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
    const d = 'M ' + round(x1) + ' ' + round(y1) + ' C ' + round(x1 + 20) + ' ' + round(y1) + ', ' + round(x2 - 20) + ' '
      + round(y2) + ', ' + round(x2) + ' ' + round(y2);
    return { d, points };
  }
  // 地図の座標。列と順は手の前の人物 p で決める。q を渡したときは、行と箱の高さを前後の文字の長いほうにそろえ、
  // 前後で座標を変えない（外した入口の行も場所を残す。列の横の位置は p だけの図と同じ）。
  // lines＝描く人物（q か p）の条件の線、linesBefore＝q があるときの p の線、gaps＝列の間の幅（左から）
  function layout(p, q, M, lang) {
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
    // 図の幅は列の間を平均 colGap にした値（4列の人で704、3列の人で512）。ふだんの図の縦の道が step の間隔で入らないときは、
    // widen を超えない範囲で、入る幅まで広げる。すき間ごとの幅は縦の道の数で配る（下の gapWidths）
    const fixed = 2 * G.margin + G.boxW + lastCol * G.cardW;
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
    const markReserve = textWidth('●0') + G.markGap;
    const openReserve = textWidth(D.openTag) + G.markGap;
    const rankReserve = textWidth('●9') + G.markGap;
    // 箱とカードと行。縦の位置は文字の行数だけで決まり、列の横の位置 colX には依らない
    function build(colX) {
      const box = {}, rows = {}, bottoms = [];
      columns.forEach((ids, k) => {
        let y = G.margin;
        for (const id of ids) {
          const x = colX(k);
          if (k === 0) {
            const c = after.credentials.find((x2) => x2.id === id);
            const inner = G.boxW - 12;
            const wrapped = wrapText(nmAfter.box[id], [inner - (givable.has(id) ? markReserve : 0), inner]);
            const h = G.box + G.line * (wrapped.lines.length - 1);
            box[id] = { x, y, w: G.boxW, h, kind: 'credential', type: c.type, family: c.family || null, band: c.type === 'pw',
              lines: wrapped.lines.map((value, i) => ({ value, x: x + 8, y: y + 20 + G.line * i })),
              title: nmAfter.full[id], mark: { x: x + G.boxW - 4, y: y + 20 }, added: extra.includes(id) };
            y += h + G.rowGap;
            continue;
          }
          const s = p.services.find((x2) => x2.id === id);
          const inner = G.cardW - 2 * G.pad;
          const head = wrapText((s.important ? '★' : '') + nmBefore.short[id], [inner - rankReserve, inner]);
          const headH = G.head + G.line * (head.lines.length - 1);
          const card = { x, y, w: G.cardW, h: 0, kind: 'account', important: !!s.important, headH,
            lines: head.lines.map((value, i) => ({ value, x: x + G.pad, y: y + 19 + G.line * i })),
            title: nmBefore.full[id], mark: { x: x + G.cardW - G.pad, y: y + 19 }, rows: [] };
          let ry = y + headH;
          for (const m of s.methods) {
            const key = id + '.' + m.id;
            const symbol = D[m.role === 'login' ? 'symbolLog' : 'symbolRec'];
            const textFor = (X, nm) => {
              const xm = X.services.find((x2) => x2.id === id).methods.find((x2) => x2.id === m.id);
              return xm ? wrapRow(symbol, xm.requires.map((r) => nm.tag[r]), D.sepPlus, [inner - openReserve, inner]) : null;
            };
            const before = textFor(p, nmBefore), afterText = q ? textFor(q, nmAfter) : null;
            const lineCount = Math.max(before.lines.length, afterText ? afterText.lines.length : 0);
            const tagLine = key === changed ? 1 : 0;
            const h = G.row + G.line * (lineCount - 1 + tagLine);
            const top = ry;
            const place = (t) => t && { lines: t.lines.map((value, i) => ({ value, x: x + G.pad, y: top + 17 + G.line * i })),
              title: t.cut ? t.text : null };
            rows[key] = { x, y: ry, w: G.cardW, h, role: m.role, service: id, method: m.id, changed: key === changed,
              before: place(before), after: q ? place(afterText) : null,
              mark: { x: x + G.cardW - G.pad, y: ry + 17 },
              tag: key === changed ? { x: x + G.cardW - G.pad, y: ry + 17 + G.line * lineCount } : null };
            card.rows.push(key);
            ry += h;
          }
          card.h = ry - y;
          box[id] = card;
          y = ry + G.rowGap;
        }
        bottoms[k] = y - G.rowGap;
      });
      // 列を2つ以上またぐ線の通り道：途中の列（メールの列）のカードのいちばん下＋12px
      return { box, rows, bottoms, channelBase: Math.max(G.margin, ...bottoms.slice(1, lastCol)) + 12 };
    }
    // 条件の線の道筋のうち y だけで決まるもの（出口と入口の高さ・通り道の高さ・縦の道の番号）と、すき間ごとの縦の道の数
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
      const sourceY = (l) => {
        const b = box[l.from];
        return b.kind === 'credential' ? b.y + b.h / 2 : b.y + b.headH / 2;
      };
      const targetY = (l) => rows[l.to].y + rows[l.to].h / 2;
      // 1つの出口・入口に線が集まるときは、線ごとに 4px ずつ高さをずらして束にしない
      const spread = (n, height) => {
        const step = n > 1 ? Math.min(G.step, (height - 8) / (n - 1)) : 0;
        return Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * step);
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
        ls.sort((a, b) => targetY(a) - targetY(b));
        const b = box[from];
        spread(ls.length, b.kind === 'credential' ? b.h : b.headH).forEach((off, i) => { ls[i].y1 = sourceY(ls[i]) + off; });
      }
      for (const [to, ls] of group('to')) {
        ls.sort((a, b) => a.y1 - b.y1);
        spread(ls.length, rows[to].h).forEach((off, i) => { ls[i].y2 = targetY(ls[i]) + off; });
      }
      // 通り道の高さは行き先の高さの順（浅い行き先ほど上）。線ごとに 4px ずつずらして重ねない
      const far = list.filter((l) => l.c2 - l.c1 > 1).sort((a, b) => a.y2 - b.y2 || a.y1 - b.y1 || a.c1 - b.c1);
      far.forEach((l, i) => { l.channel = geo.channelBase + i * G.step; });
      // 縦に進む区間は、元の列の右のすき間（出口→通り道）と、先の列の左のすき間（通り道→入口）にある。
      // すき間ごとに、縦の範囲が重なる（laneSep より近い）区間どうしへ別の縦の道を割り当てる（区間の彩色）。
      // 道の番号は、元の側はすき間の左から、先の側は右から数える。割り当てる順は、線どうしを入れ子にして交差を減らす順
      const color = (pieces, side) => {
        const lanes = [];
        for (const pc of pieces) {
          let k = 0;
          while (lanes[k] && lanes[k].some(([lo, hi]) => pc.lo < hi + G.laneSep && lo < pc.hi + G.laneSep)) k++;
          (lanes[k] ||= []).push([pc.lo, pc.hi]);
          pc.line[side] = k;
        }
        return lanes.length;
      };
      const piece = (line, a, b) => ({ line, lo: Math.min(a, b), hi: Math.max(a, b) });
      const needs = [];
      for (let g = 0; g < lastCol; g++) {
        const out = far.filter((l) => l.c1 === g), into = far.filter((l) => l.c2 - 1 === g);
        const sources = [...out.filter((l) => l.y1 <= l.channel).sort((a, b) => b.y1 - a.y1),
          ...out.filter((l) => l.y1 > l.channel).sort((a, b) => a.y1 - b.y1)].map((l) => piece(l, l.y1, l.channel));
        const targets = [...into.filter((l) => l.y2 >= l.channel).sort((a, b) => a.y2 - b.y2),
          ...into.filter((l) => l.y2 < l.channel).sort((a, b) => b.y2 - a.y2)].map((l) => piece(l, l.channel, l.y2));
        needs[g] = color(sources, 'laneOut') + color(targets, 'laneIn');
      }
      return { list, needs };
    }
    // すき間の幅：縦の道が s の間隔で入る幅（両端に edge、隣の列へのベジエのために minGap 以上）
    const want = (needs, s) => needs.map((n) => Math.max(G.minGap, 2 * G.edge + Math.max(0, n - 1) * s));
    const sum = (list) => list.reduce((a, b) => a + b, 0);
    // 図の幅：列の間を平均 colGap にした幅。道が step の間隔で入らなければ、widen までの範囲で広げる
    const widthFor = (needs) => Math.max(fixed + lastCol * G.colGap, Math.min(G.widen, fixed + sum(want(needs, G.step))));
    // 合わせて図の幅に収まらなければ、道の間隔を詰める。余りは等しく分け、列の位置は整数にする
    function gapWidths(needs, width) {
      const budget = width - fixed;
      const total = (s) => sum(want(needs, s));
      let s = G.step;
      if (total(s) > budget) {
        let lo = 0, hi = G.step;
        for (let i = 0; i < 40; i++) {
          const mid = (lo + hi) / 2;
          if (total(mid) > budget) hi = mid; else lo = mid;
        }
        s = lo;
      }
      const spare = (budget - total(s)) / needs.length;
      const exact = want(needs, s).map((w) => w + spare);
      const out = exact.map(Math.floor);
      let rest = budget - out.reduce((a, b) => a + b, 0);
      const order = out.map((_, g) => g).sort((a, b) => (exact[b] - out[b]) - (exact[a] - out[a]) || exact[b] - exact[a] || a - b);
      for (const g of order) if (rest-- > 0) out[g]++;
      return out;
    }
    // 手の前後の図（q があるとき）は、ふだんの図と同じ幅と列の位置を使う
    const usual = q ? layout(p, null, M, lang) : null;
    const needs = q ? null : routesFor(p, build(() => 0)).needs;
    const width = q ? usual.width : widthFor(needs);
    const gaps = q ? usual.gaps : gapWidths(needs, width);
    const left = [G.margin];
    for (let k = 1; k <= lastCol; k++) left[k] = left[k - 1] + (k === 1 ? G.boxW : G.cardW) + gaps[k - 1];
    const colX = (k) => left[k];
    const right = (k) => left[k] + (k === 0 ? G.boxW : G.cardW);
    const geo = build(colX);
    const { box, rows, bottoms } = geo;
    // 線を描く。隣の列へは3次ベジエ、2つ以上またぐ線は、縦の道→通り道→縦の道（角は半径6の円弧）
    function linesFor(X) {
      const route = routesFor(X, geo);
      const spacing = route.needs.map((n, g) => (n > 1 ? Math.min(G.step, (gaps[g] - 2 * G.edge) / (n - 1)) : 0));
      return route.list.map((l) => {
        const x1 = right(l.c1), x2 = colX(l.c2);
        let path, channel = null;
        if (l.c2 - l.c1 === 1) path = bezierPath(x1, l.y1, x2, l.y2);
        else {
          const xs = x1 + G.edge + l.laneOut * spacing[l.c1], xt = x2 - G.edge - l.laneIn * spacing[l.c2 - 1];
          channel = l.channel;
          path = roundedPath([[x1, l.y1], [xs, l.y1], [xs, channel], [xt, channel], [xt, l.y2], [x2, l.y2]], G.radius);
        }
        return { from: l.from, to: l.to, kind: l.kind, role: l.role, d: path.d, points: path.points, columns: [l.c1, l.c2], channel };
      });
    }
    const lines = linesFor(after);
    const linesBefore = q ? linesFor(p) : null;
    const channelMax = Math.max(0, ...[...lines, ...(linesBefore || [])].map((l) => l.channel || 0));
    const height = Math.ceil(Math.max(...bottoms, channelMax + 6) + G.margin);
    return { columns, colOf, box, rows, lines, linesBefore, width, height, changed, gaps };
  }

  return Object.freeze({
    fill, names, counts, lastStep, maxRank, givesShort, cardLine, cardNote, stepSummary, stepLine, stepStatus, mapCaption, mapRows, needText,
    detail, fourCards, lockCell, lockTable, lockEntrances, lockChanges, candidates, effect, effectText, rankingNote, sameEntrance, sameRows, afterMap,
    moveTitle, moveChoice, moveOptions, attackLine, lossLines, pairLines, moveNotes, sentences, highlights: HIGHLIGHTS, highlightTitle,
    layout, textWidth, wrapText, wrapRow, mailDepths, symbolTable, printTable,
    lessons: LESSONS, lessonRefs: LESSON_REFS, relatedTools: RELATED_TOOLS, lessonScenes: LESSON_SCENES, lesson8Rows: LESSON8_ROWS, lessonTable,
  });
}));
