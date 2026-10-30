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

  // 渡すものの札（漏えい＝系統のデータのラベル、SIMスワップ＝電話番号のデータのラベル、メールの乗っ取り＝メールの短い名前、窓口＝「個人情報」）
  function givesShort(p, cardId, M, lang) {
    const D = dictionary(M, lang), nm = names(p, M, lang);
    const gives = Core.cardGives(p, p.cards.find((c) => c.id === cardId));
    return gives.map((id) => {
      const c = p.credentials.find((x) => x.id === id);
      if (!c) return nm.short[id];
      if (c.type === 'info') return D.tagInfo;
      return ownerOf(id) ? nm.req[id] : c.label[lang];
    }).join(D.sepList);
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
        entrances: s.methods.map((m) => entranceText(nm, m, D)), cell };
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
    return { heading: fill(D.sameEntrance, { account: nm.full[first.service], method: methodText(p, first, M, lang), n: ids.length }),
      rows };
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
  // 攻撃（カード4枚）の表の行と、合計（延べ）の行。表の行の名前は全名（要約の行は短い名前）
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
    rows.push({ card: 'all', label: D.attackTotal, selected: mode === 'all', before: sum('before'), after: sum('after'),
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
    detail, fourCards, lockCell, lockTable, candidates, effect, effectText, rankingNote, sameEntrance, sameRows, afterMap, moveTitle,
    attackLine, lossLines, pairLines, moveNotes, sentences, highlights: HIGHLIGHTS, highlightTitle, layout, textWidth, wrapText,
    wrapRow, mailDepths,
  });
}));
