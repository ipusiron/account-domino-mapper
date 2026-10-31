// Account Domino Mapper の計算部（UMD・依存なし・DOM 非依存）。
// 模型：Hammann, Radomirović, Sasse, Basin「User Account Access Graphs」CCS 2019 の account access graph を、教材に要る分だけに絞ったもの。
//   入口＝1つのアカウントに入る手段。入口の条件は「かつ」（論文の同じ色の辺）、入口どうしは「または」（違う色の辺）
//   到達＝最初に持っているものから、条件がそろった入口のアカウントを足していく最小不動点（Horn 節の前向き推論）
//   閉め出し＝本人が何かを失ったあと、手元に残ったものから同じ規則で到達できないアカウント（到達の補集合）
//   漏えいのカードは、漏れたサービスがいまログインに使う系統を渡す（cardGives）
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DominoCore = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ===== 小道具 =====
  const uniq = (a) => [...new Set(a)];
  const kindOrder = { add: 0, replace: 1, remove: 2 };
  const TYPE_TO_KIND = { pw: 'pw', device: 'mfa', phone: 'sms', info: 'desk', idcheck: 'desk', paper: 'paper' };

  // ===== グラフ =====
  // spec = { nodes: [{ id, ... }], clauses: [{ head, method, role, body: [id...] }] }
  // clause（節）＝論文の「ある節点 v への、ある色 c の辺の束」。body が Inc_c(v)、head が v
  function graphFrom(spec) {
    const nodes = spec.nodes.map((n) => n.id);
    const order = new Map(nodes.map((id, i) => [id, i]));
    if (order.size !== nodes.length) throw new Error('duplicate node id');
    const clauses = spec.clauses.map((c) => ({ head: c.head, method: c.method, role: c.role || 'login', body: uniq(c.body) }));
    const byHead = new Map(), watch = new Map();
    clauses.forEach((c, i) => {
      if (!order.has(c.head)) throw new Error('unknown head ' + c.head);
      if (c.body.length === 0) throw new Error('empty body ' + c.method); // 論文の定義3は ∅ ⊊ Inc_c(v) を求める
      for (const a of c.body) if (!order.has(a)) throw new Error('unknown atom ' + a + ' in ' + c.method);
      if (!byHead.has(c.head)) byHead.set(c.head, []);
      byHead.get(c.head).push(i);
      for (const a of c.body) { if (!watch.has(a)) watch.set(a, []); watch.get(a).push(i); }
    });
    return { nodes, order, clauses, byHead, watch, info: new Map(spec.nodes.map((n) => [n.id, n])) };
  }

  // 人物データ → グラフ。節点の順＝資格情報（データ順）→アカウント（データ順）
  function personaSpec(p) {
    const nodes = [
      ...p.credentials.map((c) => ({ id: c.id, type: c.type, service: false })),
      ...p.services.map((s) => ({ id: s.id, type: 'service', service: true, mail: !!s.mail, important: !!s.important })),
    ];
    const clauses = [];
    for (const s of p.services) for (const m of s.methods) clauses.push({ head: s.id, method: `${s.id}.${m.id}`, role: m.role, body: m.requires });
    return { nodes, clauses };
  }
  const personaGraph = (p) => graphFrom(personaSpec(p));

  // 攻撃カードが渡すもの。漏えいのカード（leaks＝漏れたサービスの id）は、そのサービスのログインの入口に使われているパスワードの系統を渡す。
  // 1手でそのサービスの系統を付け替えれば、渡すものも変わる。ほかのカードは gives をそのまま渡す
  function cardGives(p, c) {
    if (!c.leaks) return c.gives;
    const s = p.services.find((x) => x.id === c.leaks);
    const pw = new Set(p.credentials.filter((x) => x.type === 'pw').map((x) => x.id));
    return uniq(s.methods.filter((m) => m.role === 'login').flatMap((m) => m.requires).filter((r) => pw.has(r)));
  }

  // 線の種類（6種）。条件に出てくる節点の型で決まる。アカウント（メール）なら mail
  function lineKind(p, id) {
    const c = p.credentials.find((x) => x.id === id);
    if (c) return TYPE_TO_KIND[c.type];
    const s = p.services.find((x) => x.id === id);
    if (s && s.mail) return 'mail';
    return 'service';
  }

  // ===== 到達（最小不動点） =====
  // Dowling–Gallier の線形時間の前向き推論。節ごとに「まだそろっていない条件の数」を数え、0 になったら頭を足す。
  // blocked＝失われた節点（初めの集合からも、頭としても外す）。O(節点数＋条件の総数)
  function reach(g, initial, blocked = new Set()) {
    const have = new Set(), queue = [];
    const push = (x) => { if (!blocked.has(x) && !have.has(x)) { have.add(x); queue.push(x); } };
    for (const x of initial) push(x);
    const left = g.clauses.map((c) => c.body.length);
    for (let q = 0; q < queue.length; q++) {
      for (const i of g.watch.get(queue[q]) || []) if (--left[i] === 0) push(g.clauses[i].head);
    }
    return have;
  }

  // 段（ラウンド）つきの到達。段 r で足すのは、条件がすべて段 r−1 までにそろった入口のある節点（ヤコビ式。順番に依らない）。
  // via＝その節点を開けた入口。段 r−1 までの節点だけで条件がそろう入口のうち、データ順で最初のもの
  function stepReach(g, initial, blocked = new Set()) {
    const rank = new Map();
    for (const x of initial) if (!blocked.has(x) && !rank.has(x)) rank.set(x, 0);
    for (let r = 1; ; r++) {
      const add = [];
      for (const c of g.clauses) if (!blocked.has(c.head) && !rank.has(c.head) && c.body.every((a) => rank.has(a))) add.push(c.head);
      if (add.length === 0) break;
      for (const h of add) if (!rank.has(h)) rank.set(h, r);
    }
    const via = new Map();
    for (const [v, rv] of rank) {
      if (rv === 0) continue;
      const i = g.byHead.get(v).find((j) => g.clauses[j].body.every((a) => rank.has(a) && rank.get(a) < rv));
      via.set(v, g.clauses[i].method);
    }
    return { rank, via };
  }

  // よくある誤り：辺を全部「または」とみなす BFS。かつ（多要素・2つの条件の再設定）を1本の辺で開けてしまう
  function naiveBfs(g, initial, blocked = new Set()) {
    const have = new Set(), queue = [];
    const push = (x) => { if (!blocked.has(x) && !have.has(x)) { have.add(x); queue.push(x); } };
    for (const x of initial) push(x);
    for (let q = 0; q < queue.length; q++) for (const i of g.watch.get(queue[q]) || []) push(g.clauses[i].head);
    return have;
  }

  // ===== 本人の到達と閉め出し =====
  // holdings＝本人が直接持つもの（資格情報）。lost＝失ったもの（資格情報またはアカウント。アカウントなら、そのアカウントそのものが使えない）
  function userReach(g, holdings, lost = []) {
    const blocked = new Set(lost);
    return reach(g, holdings.filter((x) => !blocked.has(x)), blocked);
  }

  // 論文の定義18をそのまま（最小不動点で）計算したもの。比較用。
  // v を閉め出しに入れる条件：入口が1つ以上あり、すべての入口で条件のどれかが閉め出し済み
  function lockoutDef18(g, V) {
    const L = new Set(V);
    for (let changed = true; changed;) {
      changed = false;
      for (const [v, idx] of g.byHead) {
        if (L.has(v)) continue;
        if (idx.every((i) => g.clauses[i].body.some((a) => L.has(a)))) { L.add(v); changed = true; }
      }
    }
    return L;
  }

  // 依存（条件→頭）に輪がないか（カーンの方法）
  function isAcyclic(g) {
    const indeg = new Map(g.nodes.map((n) => [n, 0]));
    const out = new Map(g.nodes.map((n) => [n, new Set()]));
    for (const c of g.clauses) for (const a of c.body) if (!out.get(a).has(c.head)) { out.get(a).add(c.head); indeg.set(c.head, indeg.get(c.head) + 1); }
    const q = g.nodes.filter((n) => indeg.get(n) === 0); let seen = 0;
    for (let i = 0; i < q.length; i++) { seen++; for (const b of out.get(q[i])) { indeg.set(b, indeg.get(b) - 1); if (indeg.get(b) === 0) q.push(b); } }
    return seen === g.nodes.length;
  }

  // ===== 最小の組（論文の access base・lockout base） =====
  const popcount = (m) => { let c = 0; while (m) { m &= m - 1; c++; } return c; };
  const sortBy = (order, ids) => [...ids].sort((a, b) => order.get(a) - order.get(b));
  function sortSet(g, ids) { return sortBy(g.order, ids); }
  function sortFamilyBy(order, fam) {
    const key = (s) => s.map((x) => order.get(x));
    return fam.map((s) => sortBy(order, s)).sort((A, B) => {
      if (A.length !== B.length) return A.length - B.length;
      const a = key(A), b = key(B);
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
      return 0;
    });
  }
  const sortFamily = (g, fam) => sortFamilyBy(g.order, fam);
  // test(V) が真になる最小の V ⊆ pool を全部返す（大きさの順に調べ、見つけた組の上位集合は飛ばす＝論文の Algorithm 2 と同じ考え）
  // 計算量 O(2^|pool| ×（到達1回の手間）)。3人のデータでは |pool| ≤ 7 なので最大 128 回
  function minimalSets(order, pool, targets, test) {
    const k = pool.length; if (k > 16) throw new Error('pool too large');
    const masks = Array.from({ length: 1 << k }, (_, m) => m).sort((a, b) => popcount(a) - popcount(b) || a - b);
    const found = new Map(targets.map((t) => [t, []]));
    for (const m of masks) {
      const V = pool.filter((_, i) => (m >> i) & 1);
      let cache = null;
      for (const t of targets) {
        const f = found.get(t);
        if (f.some((fm) => (fm & m) === fm)) continue;
        if (cache === null) cache = test(V);
        if (cache(t)) f.push(m);
      }
    }
    const out = {};
    for (const t of targets) out[t] = sortFamilyBy(order, found.get(t).map((m) => pool.filter((_, i) => (m >> i) & 1)));
    return out;
  }
  // 攻撃側：vinit の部分集合から t に到達できる最小の組
  function accessBases(g, vinit, targets) {
    return minimalSets(g.order, vinit, targets, (V) => { const R = reach(g, V); return (t) => R.has(t); });
  }
  // 本人側：vloss の部分集合を失うと t に入れなくなる最小の組（到達の補集合で判定）。def18=true なら論文の定義18で判定
  function lockoutBases(g, holdings, vloss, targets, def18 = false) {
    return minimalSets(g.order, vloss, targets, (V) => {
      if (def18) { const L = lockoutDef18(g, V); return (t) => L.has(t); }
      const R = userReach(g, holdings, V); return (t) => !R.has(t);
    });
  }
  // カードの組で見た最小の組：t を倒すのに要る攻撃カードの最小の組／t に入れなくなる喪失カードの最小の組
  function cardBases(p, g, targets) {
    const order = new Map(p.cards.map((c, i) => [c.id, i]));
    return minimalSets(order, p.cards.map((c) => c.id), targets, (ids) => {
      const R = reach(g, ids.flatMap((id) => cardGives(p, p.cards.find((c) => c.id === id)))); return (t) => R.has(t);
    });
  }
  function lossBases(p, g, targets) {
    const order = new Map(p.losses.map((l, i) => [l.id, i]));
    const holdings = p.credentials.map((c) => c.id);
    return minimalSets(order, p.losses.map((l) => l.id), targets, (ids) => {
      const lost = uniq(ids.flatMap((id) => lostNodes(p, p.losses.find((l) => l.id === id))));
      const R = userReach(g, holdings, lost); const gone = new Set(lost); return (t) => !R.has(t) && !gone.has(t);
    });
  }
  // 最小の組を数える範囲。攻撃側＝カードで手に入りうる型（パスワード・スマホ・電話番号・個人情報）と、カードが直接渡すアカウント。
  // 書類での本人確認と紙の回復コードは、模型では攻撃者の手に入らないので外す。
  // 本人側＝なくしうる型（パスワード＝忘れる・スマホ・電話番号・紙）と、喪失カードで消えるアカウント。個人情報と書類での本人確認はなくさない扱い
  const ATTACKABLE_TYPES = ['pw', 'device', 'phone', 'info'];
  const LOSABLE_TYPES = ['pw', 'device', 'phone', 'paper'];
  // 論文の定義8（足してから最小）の点数。base は集合の集まり
  const scoreSumMin = (base, init) => (base.length ? Math.min(...base.map((S) => S.reduce((t, v) => t + init[v], 0))) : null);

  // ===== 人物データの検査 =====
  function validatePersona(p) {
    const errs = [];
    const ids = [...p.credentials.map((c) => c.id), ...p.services.map((s) => s.id)];
    if (new Set(ids).size !== ids.length) errs.push('duplicate id');
    const has = new Set(ids);
    for (const c of p.credentials) if (!(c.type in TYPE_TO_KIND)) errs.push('unknown type ' + c.type);
    for (const s of p.services) {
      if (!s.methods.some((m) => m.role === 'login')) errs.push('no login method: ' + s.id);
      for (const m of s.methods) {
        if (!['login', 'recovery'].includes(m.role)) errs.push('bad role ' + s.id + '.' + m.id);
        if (!m.requires.length) errs.push('empty requires ' + s.id + '.' + m.id);
        for (const r of m.requires) {
          if (!has.has(r)) errs.push('unknown requirement ' + r);
          else if (r === s.id) errs.push('self requirement ' + s.id);
          else { const k = lineKind(p, r); if (k === 'service') errs.push('requirement must be a credential or an email account: ' + r); }
        }
      }
    }
    for (const c of p.cards) {
      if (!!c.leaks === !!c.gives) { errs.push('card needs exactly one of leaks/gives: ' + c.id); continue; }
      if (c.leaks && !p.services.some((s) => s.id === c.leaks)) { errs.push('card leaks unknown service ' + c.leaks); continue; }
      const gv = cardGives(p, c);
      if (!gv.length) errs.push('card gives nothing: ' + c.id);
      for (const x of gv) if (!has.has(x)) errs.push('card gives unknown ' + x);
    }
    for (const l of p.losses) for (const x of l.lost || []) if (!has.has(x)) errs.push('loss of unknown ' + x);
    // ふだんの本人はすべてのアカウントに入れること
    const g = personaGraph(p); const R = userReach(g, p.credentials.map((c) => c.id), []);
    for (const s of p.services) if (!R.has(s.id)) errs.push('owner cannot reach ' + s.id);
    return errs;
  }

  // ===== 1人分のまとめ =====
  function lostNodes(p, l) {
    return [...(l.lost || []), ...p.credentials.filter((c) => (l.lostTypes || []).includes(c.type)).map((c) => c.id)];
  }
  function summarize(p) {
    const g = personaGraph(p);
    const services = p.services.map((s) => s.id);
    const holdings = p.credentials.map((c) => c.id);
    const cards = {}, losses = {};
    for (const c of p.cards) { const R = reach(g, cardGives(p, c)); cards[c.id] = services.filter((s) => R.has(s)); }
    for (const l of p.losses) {
      const lost = lostNodes(p, l); const R = userReach(g, holdings, lost);
      losses[l.id] = services.filter((s) => !R.has(s) && !lost.includes(s));
    }
    return { g, services, holdings, cards, losses };
  }

  // ===== 1手 =====
  // 手の種類（総当たりの範囲）
  //   add     ：ログインの入口に、スマホ（認証アプリ・パスキー）を足す（アカウントが多要素を用意しているときだけ）
  //   replace ：入口の条件を1つ付け替える。候補は条件の種類と入口の役割で決まり、アカウントが用意している手段に限る
  //               パスワードの系統 → このアカウントだけの系統（その系統をほかのアカウントでも使っているときだけ）
  //               SMS（ログイン） → スマホ（認証アプリ）／SMS（復旧） → 紙の回復コード・書類での本人確認
  //               個人情報（電話の窓口） → 紙の回復コード（復旧のときだけ）・書類での本人確認
  //               メール → ほかのメール（ログイン・復旧）・紙の回復コード（復旧のときだけ）
  //             候補の並び＝ほかのメール（データ順）→スマホ→紙→書類での本人確認→このアカウントだけの系統
  //   remove  ：復旧の入口を1つ外す（ログインの入口は外さない）
  // 新しい紙の回復コード・新しい系統は本人だけが持つ（攻撃カードでは手に入らない）
  function enumerateMoves(p) {
    const mails = p.services.filter((s) => s.mail).map((s) => s.id);
    const famUse = new Map();
    for (const s of p.services) for (const m of s.methods) for (const r of m.requires) {
      const c = p.credentials.find((x) => x.id === r);
      if (c && c.type === 'pw') { if (!famUse.has(r)) famUse.set(r, new Set()); famUse.get(r).add(s.id); }
    }
    const dev = p.credentials.find((c) => c.type === 'device');
    const idc = p.credentials.find((c) => c.type === 'idcheck');
    const typeOf = (id) => {
      const c = p.credentials.find((x) => x.id === id); if (c) return c.type;
      const s = p.services.find((x) => x.id === id); return s && s.mail ? 'mail' : 'service';
    };
    const moves = [];
    for (const s of p.services) {
      const offers = new Set(s.offers || []);
      const paper = `paper:${s.id}`;
      for (const m of s.methods) {
        const rec = m.role === 'recovery';
        if (!rec && offers.has('mfa') && dev && !m.requires.includes(dev.id)) moves.push({ kind: 'add', service: s.id, method: m.id, from: null, to: dev.id });
        for (const r of m.requires) {
          const t = typeOf(r); const alts = [];
          if (t === 'mail') for (const x of mails) if (x !== r && x !== s.id) alts.push(x);
          if (t === 'phone' && !rec && offers.has('mfa') && dev) alts.push(dev.id);
          if (rec && offers.has('paper') && (t === 'phone' || t === 'info' || t === 'mail')) alts.push(paper);
          if (offers.has('idcheck') && idc && ((t === 'phone' && rec) || t === 'info')) alts.push(idc.id);
          if (t === 'pw' && famUse.get(r).size >= 2) alts.push(`pw:own-${s.id}`);
          for (const to of alts) if (!m.requires.includes(to)) moves.push({ kind: 'replace', service: s.id, method: m.id, from: r, to });
        }
        if (rec) moves.push({ kind: 'remove', service: s.id, method: m.id, from: null, to: null });
      }
    }
    return moves.map((mv, index) => ({ id: moveId(mv), index, ...mv }));
  }
  function moveId(mv) {
    if (mv.kind === 'add') return `add:${mv.service}.${mv.method}:+${mv.to}`;
    if (mv.kind === 'replace') return `replace:${mv.service}.${mv.method}:${mv.from}>${mv.to}`;
    return `remove:${mv.service}.${mv.method}`;
  }
  function applyMove(p, mv) {
    const q = JSON.parse(JSON.stringify(p));
    const s = q.services.find((x) => x.id === mv.service);
    const mi = s.methods.findIndex((x) => x.id === mv.method);
    if (mv.kind === 'add') s.methods[mi].requires.push(mv.to);
    else if (mv.kind === 'replace') s.methods[mi].requires = s.methods[mi].requires.map((r) => (r === mv.from ? mv.to : r));
    else s.methods.splice(mi, 1);
    if (mv.to && !q.credentials.some((c) => c.id === mv.to) && !q.services.some((x) => x.id === mv.to)) {
      if (mv.to.startsWith('paper:')) q.credentials.push({ id: mv.to, type: 'paper',
        label: { ja: `紙の回復コード（${s.label.ja}）`, en: `Paper recovery code (${s.label.en})` } });
      else if (mv.to.startsWith('pw:own-')) q.credentials.push({ id: mv.to, type: 'pw', family: 'own',
        label: { ja: `この口座だけの系統（${s.label.ja}）`, en: `Own family (${s.label.en})` } });
      else throw new Error('unknown new node ' + mv.to);
    }
    return q;
  }
  function evaluateMoves(p) {
    const base = summarize(p);
    const S = base.services;
    return enumerateMoves(p).map((mv) => {
      const after = summarize(applyMove(p, mv));
      const cards = {}, losses = {};
      for (const c of p.cards) {
        const b = new Set(base.cards[c.id]), a = new Set(after.cards[c.id]);
        cards[c.id] = { saved: S.filter((s) => b.has(s) && !a.has(s)), exposed: S.filter((s) => a.has(s) && !b.has(s)) };
      }
      for (const l of p.losses) {
        const b = new Set(base.losses[l.id]), a = new Set(after.losses[l.id]);
        losses[l.id] = { newlyLocked: S.filter((s) => a.has(s) && !b.has(s)), unlocked: S.filter((s) => b.has(s) && !a.has(s)) };
      }
      return { ...mv, cards, losses };
    });
  }
  // 並べ方。mode＝カードの id／'all'（4枚の合計）／'lockout'（閉め出しを減らす手）
  //   攻撃のカード：①閉め出しを1つでも増やす手は後ろ ②守れた重要アカウント（守れた−新たに倒れた）の多い順 ③守れたアカウントの多い順
  //                 ④閉め出しの増減（増えた−減った）の少ない順 ⑤全カードで新たに倒れるアカウントの少ない順 ⑥足す→付け替え→外す ⑦列挙の順
  //   lockout    ：①閉め出しの増減の少ない順 ②全カードで新たに倒れるアカウントの少ない順 ③全カードの守れた重要アカウントの多い順 ④守れたアカウントの多い順 ⑤⑥同上
  function moveMetrics(p, ev, mode) {
    const imp = new Set(p.services.filter((s) => s.important).map((s) => s.id));
    const cardIds = mode === 'all' || mode === 'lockout' ? p.cards.map((c) => c.id) : [mode];
    let net = 0, impNet = 0, exposedAll = 0, newly = 0, unlocked = 0;
    for (const k of cardIds) {
      const x = ev.cards[k]; net += x.saved.length - x.exposed.length;
      impNet += x.saved.filter((s) => imp.has(s)).length - x.exposed.filter((s) => imp.has(s)).length;
    }
    for (const c of p.cards) exposedAll += ev.cards[c.id].exposed.length;
    for (const l of p.losses) { newly += ev.losses[l.id].newlyLocked.length; unlocked += ev.losses[l.id].unlocked.length; }
    return { net, impNet, exposedAll, lockoutUp: newly > 0 ? 1 : 0, lockoutDelta: newly - unlocked, kind: kindOrder[ev.kind], index: ev.index };
  }
  function rankMoves(p, evals, mode) {
    const key = (ev) => {
      const m = moveMetrics(p, ev, mode);
      return mode === 'lockout' ? [m.lockoutDelta, m.exposedAll, -m.impNet, -m.net, m.kind, m.index]
        : [m.lockoutUp, -m.impNet, -m.net, m.lockoutDelta, m.exposedAll, m.kind, m.index];
    };
    const keyed = evals.map((ev) => ({ ev, k: key(ev) }));
    keyed.sort((A, B) => { for (let i = 0; i < A.k.length; i++) if (A.k[i] !== B.k[i]) return A.k[i] - B.k[i]; return 0; });
    return keyed.map((x) => x.ev);
  }
  function bestMove(p, ranked, mode) {
    const ok = (ev) => { const m = moveMetrics(p, ev, mode); return mode === 'lockout' ? m.lockoutDelta < 0 : m.net > 0 && m.lockoutUp === 0; };
    const b = ranked.find(ok); return b ? b.id : null;
  }

  // ===== 閉め出しの表と、2つ同時の喪失 =====
  // 列（columns）＝任意（optional）でない喪失カード。3人ともスマホ・番号・メールの3枚。紙の喪失は列にしない
  // 相方（partners）＝その状態で失うものがある喪失カード。紙のカードは、その状態で本人が紙を持つときだけ入る
  // セル（cells.<列>.<アカウント>）＝列のカードを1つ失ったときのアカウントの状態 mark（ok＝入れる／locked＝閉め出し／gone＝そのアカウントが消えた）と、
  //   ok のときだけ plus＝相方のうち、列のカードと同時に失うと閉め出されるもの（表の「○（＋番号で×）」の値）。
  //   同時に失う相方でそのアカウントが消える場合（メールのアカウントとメールのカード）は「消」なので plus に入れない
  // 2つ同時だけの閉め出し（pairOnly.<組>）＝組 {A,B} を同時に失うと閉め出されるが、A だけ・B だけでは閉め出されないアカウント。
  //   喪失カードの最小の組（lossBase）のうち大きさ2の組と同じものになる（personaVectors で確かめる）
  // 1手の前後の差（pairLosses.<組>）
  //   newlyLocked＝手のあと2つ同時だけで閉め出され、手の前はその組で閉め出されなかったアカウント（新たに閉め出される組）
  //   unlocked   ＝手の前は2つ同時だけで閉め出され、手のあとはその組で閉め出されないアカウント（解けた組）
  //   1つの喪失で閉め出されるようになったアカウント（2つ同時→1つ）と、1つの喪失の閉め出しが解けて2つ同時だけが残ったアカウント（1つ→2つ同時）は、
  //   どちらにも入れない。前者は losses.<カード>.newlyLocked に、後者は losses.<カード>.unlocked と手のあとの lossTable.pairOnly に出る
  // 組の名前と並び＝喪失カードのデータ順の2つを「+」でつなぐ（device+number, device+mail, device+paper, number+mail, number+paper, mail+paper）
  function lossPairs(p) {
    const ids = p.losses.map((l) => l.id); const out = [];
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) out.push([ids[i], ids[j]]);
    return out;
  }
  const pairKey = ([a, b]) => `${a}+${b}`;
  // 喪失カード ids を同時に失ったときの、消えたアカウント（gone）と閉め出されたアカウント（locked）。どちらもデータ順
  function lossOutcome(p, g, ids) {
    const lost = uniq(ids.flatMap((id) => lostNodes(p, p.losses.find((l) => l.id === id))));
    const R = userReach(g, p.credentials.map((c) => c.id), lost); const gone = new Set(lost);
    const services = p.services.map((s) => s.id);
    return { gone: services.filter((s) => gone.has(s)), locked: services.filter((s) => !R.has(s) && !gone.has(s)) };
  }
  // 1つの状態（人物データ p）の喪失：1枚ずつ（one）と2枚の組（two）
  function lossState(p) {
    const g = personaGraph(p); const one = {}, two = {};
    for (const l of p.losses) one[l.id] = lossOutcome(p, g, [l.id]);
    for (const pr of lossPairs(p)) two[pairKey(pr)] = lossOutcome(p, g, pr);
    return { one, two };
  }
  function lossTable(p, st = lossState(p)) {
    const services = p.services.map((s) => s.id);
    const columns = p.losses.filter((l) => !l.optional).map((l) => l.id);
    const partners = p.losses.filter((l) => lostNodes(p, l).length > 0).map((l) => l.id);
    const idx = new Map(p.losses.map((l, i) => [l.id, i]));
    const keyOf = (a, b) => (idx.get(a) < idx.get(b) ? `${a}+${b}` : `${b}+${a}`);
    const cells = {};
    for (const a of columns) {
      cells[a] = {};
      for (const s of services) {
        const mark = st.one[a].gone.includes(s) ? 'gone' : st.one[a].locked.includes(s) ? 'locked' : 'ok';
        cells[a][s] = { mark, plus: mark === 'ok' ? partners.filter((b) => b !== a && st.two[keyOf(a, b)].locked.includes(s)) : [] };
      }
    }
    const pairOnly = {};
    for (const [a, b] of lossPairs(p)) pairOnly[`${a}+${b}`] = st.two[`${a}+${b}`].locked
      .filter((s) => !st.one[a].locked.includes(s) && !st.one[b].locked.includes(s));
    return { columns, partners, cells, pairOnly };
  }
  function lossView(p) { const st = lossState(p); return { st, table: lossTable(p, st) }; }
  // 1手の前後（B＝手の前、A＝手のあと。どちらも lossView の値）の、2つ同時の喪失の差
  function pairLossDiff(p, B, A) {
    const out = {};
    for (const pr of lossPairs(p)) {
      const k = pairKey(pr); const nb = new Set(B.st.two[k].locked), na = new Set(A.st.two[k].locked);
      out[k] = { newlyLocked: A.table.pairOnly[k].filter((s) => !nb.has(s)), unlocked: B.table.pairOnly[k].filter((s) => !na.has(s)) };
    }
    return out;
  }
  // 手ごとの、手のあとの表と、2つ同時の喪失の差（並びは enumerateMoves と同じ）
  function moveLossViews(p) {
    const B = lossView(p);
    return enumerateMoves(p).map((mv) => {
      const A = lossView(applyMove(p, mv)); return { id: mv.id, lossTable: A.table, pairLosses: pairLossDiff(p, B, A) };
    });
  }
  // 検算：表の値が、1枚ずつの喪失（losses）と喪失の最小の組（lossBases）に合うか。合わなければ例外
  function checkLossTable(p, table, label) {
    const g = personaGraph(p); const S = p.services.map((s) => s.id);
    const lb = lossBases(p, g, S);
    for (const a of table.columns) {
      const o = lossOutcome(p, g, [a]);
      for (const s of S) {
        const c = table.cells[a][s]; const want = o.gone.includes(s) ? 'gone' : o.locked.includes(s) ? 'locked' : 'ok';
        if (c.mark !== want) throw new Error(`${label}: mark ${a}.${s}`);
        if (c.mark !== 'ok' && c.plus.length) throw new Error(`${label}: plus on ${c.mark} ${a}.${s}`);
      }
    }
    for (const [a, b] of lossPairs(p)) {
      const k = `${a}+${b}`; const viaBase = S.filter((s) => lb[s].some((M) => M.length === 2 && M[0] === a && M[1] === b));
      if (JSON.stringify(viaBase) !== JSON.stringify(table.pairOnly[k]))
        throw new Error(`${label}: pairOnly ${k} ${JSON.stringify(table.pairOnly[k])} != lossBase ${JSON.stringify(viaBase)}`);
    }
  }

  // ===== 1人分の既知の値 =====
  function personaVectors(p) {
    const errs = validatePersona(p); if (errs.length) throw new Error(p.id + ': ' + errs.join('; '));
    const g = personaGraph(p);
    const services = p.services.map((s) => s.id);
    const holdings = p.credentials.map((c) => c.id);
    const svcSet = new Set(services);
    const onlyS = (R) => services.filter((s) => R.has(s));
    const gNoRec = graphFrom({ nodes: personaSpec(p).nodes, clauses: personaSpec(p).clauses.filter((c) => c.role !== 'recovery') });
    const out = { services, holdings, acyclic: isAcyclic(g), clauses: g.clauses.length, atoms: g.clauses.reduce((t, c) => t + c.body.length, 0) };
    out.lineKinds = {}; for (const s of p.services) for (const m of s.methods) out.lineKinds[`${s.id}.${m.id}`] = m.requires.map((r) => lineKind(p, r));
    out.ownerReach = onlyS(userReach(g, holdings, []));
    out.cards = {};
    for (const c of p.cards) {
      const gv = cardGives(p, c);
      const R = reach(g, gv); const { rank, via } = stepReach(g, gv); const N = naiveBfs(g, gv);
      const ordered = [...rank.keys()].sort((a, b) => rank.get(a) - rank.get(b) || g.order.get(a) - g.order.get(b));
      const B = reach(gNoRec, gv);
      out.cards[c.id] = {
        gives: gv,
        leaks: c.leaks || null,
        reached: ordered,
        rank: Object.fromEntries(ordered.map((v) => [v, rank.get(v)])),
        via: Object.fromEntries(ordered.filter((v) => rank.get(v) > 0).map((v) => [v, via.get(v)])),
        services: onlyS(R),
        naiveServices: onlyS(N),
        naiveExtra: services.filter((s) => N.has(s) && !R.has(s)),
        backdoor: services.filter((s) => R.has(s) && !B.has(s)),
      };
      if (ordered.length !== R.size || ordered.some((v) => !R.has(v))) throw new Error('reach != stepReach');
    }
    out.pairs = {};
    for (let i = 0; i < p.cards.length; i++) for (let j = i + 1; j < p.cards.length; j++) {
      const A = p.cards[i], B = p.cards[j]; const R = reach(g, [...cardGives(p, A), ...cardGives(p, B)]);
      out.pairs[`${A.id}+${B.id}`] = onlyS(R);
    }
    out.losses = {};
    for (const l of p.losses) {
      const lost = lostNodes(p, l); const R = userReach(g, holdings, lost); const L18 = lockoutDef18(g, lost); const blocked = new Set(lost);
      const left = {}; for (const s of services) left[s] = blocked.has(s) ? 0 : g.byHead.get(s).filter((i) => g.clauses[i].body.every((a) => R.has(a))).length;
      out.losses[l.id] = { lost, gone: services.filter((s) => blocked.has(s)), locked: services.filter((s) => !R.has(s) && !blocked.has(s)),
        def18Locked: services.filter((s) => L18.has(s) && !blocked.has(s)), methodsLeft: left };
    }
    const vinit = [...p.credentials.filter((c) => ATTACKABLE_TYPES.includes(c.type)).map((c) => c.id),
      ...uniq(p.cards.flatMap((c) => cardGives(p, c)).filter((x) => svcSet.has(x)))];
    out.accessBase = { vinit: sortSet(g, vinit), sets: accessBases(g, sortSet(g, vinit), services) };
    const vloss = [...p.credentials.filter((c) => LOSABLE_TYPES.includes(c.type)).map((c) => c.id),
      ...uniq(p.losses.flatMap((l) => l.lost || []).filter((x) => svcSet.has(x)))];
    out.lockoutBase = { vloss: sortSet(g, vloss), sets: lockoutBases(g, holdings, sortSet(g, vloss), services) };
    out.cardBase = cardBases(p, g, services);
    out.lossBase = lossBases(p, g, services);
    out.lossTable = lossTable(p);
    checkLossTable(p, out.lossTable, p.id + ' base');
    const evals = evaluateMoves(p);
    const lv = moveLossViews(p);
    out.moves = evals.map((ev, i) => {
      if (lv[i].id !== ev.id) throw new Error('move order');
      checkLossTable(applyMove(p, ev), lv[i].lossTable, p.id + ' ' + ev.id);
      // 手のあとの表の × は、ふだんの閉め出し − 解けた ＋ 新たに閉め出し（1枚ずつの評価 losses）と同じになる
      for (const a of lv[i].lossTable.columns) {
        const want = services.filter((s) => (out.losses[a].locked.includes(s) && !ev.losses[a].unlocked.includes(s)) || ev.losses[a].newlyLocked.includes(s));
        const got = services.filter((s) => lv[i].lossTable.cells[a][s].mark === 'locked');
        if (JSON.stringify(want) !== JSON.stringify(got)) throw new Error(`${p.id} ${ev.id}: locked ${a}`);
      }
      return { id: ev.id, kind: ev.kind, service: ev.service, method: ev.method, from: ev.from, to: ev.to,
        cards: ev.cards, losses: ev.losses, pairLosses: lv[i].pairLosses, lossTable: lv[i].lossTable };
    });
    out.ranking = {}; out.best = {};
    for (const mode of [...p.cards.map((c) => c.id), 'all', 'lockout']) {
      const r = rankMoves(p, evals, mode); out.ranking[mode] = r.map((ev) => ev.id); out.best[mode] = bestMove(p, r, mode);
    }
    return out;
  }

  // ===== 論文の例（Hammann ら CCS 2019 の図1・2・8・11・12）。期待値は論文の本文の値 =====
  const N = (...ids) => ids.map((id) => ({ id }));
  const PAPER = {
    fig1: { // 図1＝図8（例1・2・3・4・6・17・18・19）
      nodes: N('pwdshop', 'accshop', 'accmail', 'pwdmail', 'code', 'device', 'finger', 'PIN'),
      clauses: [
        { head: 'accshop', method: 'accshop.c1', role: 'login', body: ['pwdshop'] },
        { head: 'accshop', method: 'accshop.c2', role: 'recovery', body: ['accmail'] },
        { head: 'accmail', method: 'accmail.c1', role: 'login', body: ['pwdmail', 'code'] },
        { head: 'code', method: 'code.c1', role: 'login', body: ['device', 'finger'] },
        { head: 'code', method: 'code.c2', role: 'login', body: ['device', 'PIN'] },
      ],
    },
    fig2: { // 例5（輪がある）
      nodes: N('accbackup', 'pwdbackup', 'manager', 'pwdmanager', 'code', 'device', 'seed'),
      clauses: [
        { head: 'accbackup', method: 'accbackup.c1', role: 'login', body: ['pwdbackup', 'code'] },
        { head: 'code', method: 'code.c1', role: 'login', body: ['device'] },
        { head: 'code', method: 'code.c2', role: 'login', body: ['seed'] },
        { head: 'pwdmanager', method: 'pwdmanager.c1', role: 'login', body: ['accbackup'] },
        { head: 'seed', method: 'seed.c1', role: 'login', body: ['accbackup'] },
        { head: 'manager', method: 'manager.c1', role: 'login', body: ['pwdmanager'] },
        { head: 'pwdbackup', method: 'pwdbackup.c1', role: 'login', body: ['manager'] },
      ],
    },
    fig11: { // 例22（裏口）
      nodes: N('pwdbank', 'codebank', 'device', 'codemailA', 'pwdmailA', 'pwdmailB', 'accbank', 'accmailA', 'accmailB'),
      clauses: [
        { head: 'accbank', method: 'accbank.c1', role: 'login', body: ['pwdbank', 'codebank'] },
        { head: 'accbank', method: 'accbank.red', role: 'recovery', body: ['accmailA'] },
        { head: 'codebank', method: 'codebank.c1', role: 'login', body: ['device'] },
        { head: 'accmailA', method: 'accmailA.c1', role: 'login', body: ['pwdmailA', 'codemailA'] },
        { head: 'accmailA', method: 'accmailA.red', role: 'recovery', body: ['accmailB'] },
        { head: 'codemailA', method: 'codemailA.c1', role: 'login', body: ['device'] },
        { head: 'accmailB', method: 'accmailB.c1', role: 'login', body: ['pwdmailB'] },
      ],
    },
    fig12: { // 例23（役に立たない復旧）
      nodes: N('pwdshop', 'accshop', 'accmail', 'pwdmail', 'codemail', 'codeshop', 'device', 'manager'),
      clauses: [
        { head: 'accshop', method: 'accshop.c1', role: 'login', body: ['pwdshop', 'codeshop'] },
        { head: 'accshop', method: 'accshop.red', role: 'recovery', body: ['accmail'] },
        { head: 'accmail', method: 'accmail.c1', role: 'login', body: ['pwdmail', 'codemail'] },
        { head: 'codemail', method: 'codemail.c1', role: 'login', body: ['device'] },
        { head: 'codeshop', method: 'codeshop.c1', role: 'login', body: ['device'] },
        { head: 'manager', method: 'manager.c1', role: 'login', body: ['device'] },
        { head: 'pwdshop', method: 'pwdshop.c1', role: 'login', body: ['manager'] },
      ],
    },
    cycle: { // 輪の例：2つのメールが互いを回復先にしている（定義18の最小不動点が閉め出しを見落とす）
      nodes: N('pwA', 'pwB', 'mailA', 'mailB'),
      clauses: [
        { head: 'mailA', method: 'mailA.login', role: 'login', body: ['pwA'] },
        { head: 'mailA', method: 'mailA.rec', role: 'recovery', body: ['mailB'] },
        { head: 'mailB', method: 'mailB.login', role: 'login', body: ['pwB'] },
        { head: 'mailB', method: 'mailB.rec', role: 'recovery', body: ['mailA'] },
      ],
    },
  };
  const withoutRecovery = (spec) => ({ nodes: spec.nodes, clauses: spec.clauses.filter((c) => c.role !== 'recovery') });
  const leavesOf = (g) => g.nodes.filter((n) => !g.byHead.has(n));

  function paperVectors() {
    const assert = (c, m) => { if (!c) throw new Error('PAPER ' + m); };
    const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const o = {};
    const g1 = graphFrom(PAPER.fig1); const L1 = leavesOf(g1);
    const ex2 = sortSet(g1, reach(g1, ['pwdmail', 'device', 'PIN']));
    assert(eq(ex2, sortSet(g1, ['pwdmail', 'device', 'PIN', 'code', 'accmail', 'accshop'])), 'ex2');
    const ex3 = accessBases(g1, g1.nodes, ['accmail']).accmail;
    assert(eq(ex3, sortFamily(g1, [['accmail'], ['pwdmail', 'code'], ['pwdmail', 'device', 'finger'], ['pwdmail', 'device', 'PIN']])), 'ex3');
    const ex4 = accessBases(g1, L1, ['accshop']).accshop;
    assert(eq(ex4, sortFamily(g1, [['pwdshop'], ['pwdmail', 'device', 'finger'], ['pwdmail', 'device', 'PIN']])), 'ex4');
    const init6 = { pwdshop: 1, pwdmail: 1, device: 2, finger: 2, PIN: 1 };
    const ex6 = { evalSets: ex4.map((S) => S.reduce((t, v) => t + init6[v], 0)), score: scoreSumMin(ex4, init6) };
    assert(ex6.score === 1 && eq([...ex6.evalSets].sort(), [1, 4, 5]), 'ex6');
    const init17 = { ...init6, accshop: 3, accmail: 3, code: 5 };
    const all17 = accessBases(g1, g1.nodes, ['accmail', 'accshop']);
    assert(eq(all17.accshop, sortFamily(g1, [['accshop'], ['accmail'], ['pwdshop'], ['pwdmail', 'code'],
      ['pwdmail', 'device', 'finger'], ['pwdmail', 'device', 'PIN']])), 'ex17 base');
    const ex17 = { accmail: all17.accmail, accshop: all17.accshop,
      scoreAccmail: scoreSumMin(all17.accmail, init17), scoreAccshop: scoreSumMin(all17.accshop, init17) };
    assert(ex17.scoreAccmail === 3 && ex17.scoreAccshop === 1, 'ex17 score');
    const ex18 = sortSet(g1, lockoutDef18(g1, ['pwdshop', 'device']));
    assert(eq(ex18, sortSet(g1, ['pwdshop', 'device', 'code', 'accmail', 'accshop'])), 'ex18');
    const ex19 = lockoutBases(g1, L1, L1, ['accshop']).accshop;
    const ex19d = lockoutBases(g1, L1, L1, ['accshop'], true).accshop;
    assert(eq(ex19, sortFamily(g1, [['pwdshop', 'pwdmail'], ['pwdshop', 'device'], ['pwdshop', 'finger', 'PIN']])) && eq(ex19, ex19d), 'ex19');
    Object.assign(o, { ex2, ex3, ex4, ex6, ex17, ex18, ex19 });

    const g2 = graphFrom(PAPER.fig2);
    const ex5 = { vinit: ['pwdbackup', 'pwdmanager', 'device', 'seed'],
      base: accessBases(g2, ['pwdbackup', 'pwdmanager', 'device', 'seed'], ['accbackup']).accbackup,
      leaves: leavesOf(g2), baseFromLeaves: accessBases(g2, leavesOf(g2), ['accbackup']).accbackup, acyclic: isAcyclic(g2) };
    assert(eq(ex5.base, sortFamily(g2, [['pwdbackup', 'device'], ['pwdbackup', 'seed'], ['pwdmanager', 'device'], ['pwdmanager', 'seed']]))
      && eq(ex5.leaves, ['device']) && ex5.baseFromLeaves.length === 0 && !ex5.acyclic, 'ex5');
    o.ex5 = ex5;

    const g11 = graphFrom(PAPER.fig11), g11p = graphFrom(withoutRecovery(PAPER.fig11)); const L11 = leavesOf(g11);
    const init22 = { pwdbank: 1, device: 2, pwdmailA: 1, pwdmailB: 1 };
    const b22 = accessBases(g11, L11, ['accbank']).accbank, b22p = accessBases(g11p, L11, ['accbank']).accbank;
    const ex22 = { vinit: L11, baseG: b22, baseGprime: b22p, scoreG: scoreSumMin(b22, init22), scoreGprime: scoreSumMin(b22p, init22) };
    ex22.hasBackdoor = ex22.scoreG < ex22.scoreGprime;
    assert(eq(b22, sortFamily(g11, [['pwdbank', 'device'], ['pwdmailA', 'device'], ['pwdmailB']]))
      && eq(b22p, sortFamily(g11, [['pwdbank', 'device']])) && ex22.scoreG === 1 && ex22.scoreGprime === 3 && ex22.hasBackdoor, 'ex22');
    o.ex22 = ex22;

    const g12 = graphFrom(PAPER.fig12), g12p = graphFrom(withoutRecovery(PAPER.fig12)); const H12 = ['pwdmail', 'pwdshop', 'device'];
    const init23 = { pwdmail: 1, device: 2, pwdshop: 3 };
    const l23 = lockoutBases(g12, H12, H12, ['accshop']).accshop, l23p = lockoutBases(g12p, H12, H12, ['accshop']).accshop;
    const l23d = lockoutBases(g12, H12, H12, ['accshop'], true).accshop, l23pd = lockoutBases(g12p, H12, H12, ['accshop'], true).accshop;
    const ex23 = { vinit: sortSet(g12, H12), lockoutG: l23, lockoutGprime: l23p, scoreG: scoreSumMin(l23, init23), scoreGprime: scoreSumMin(l23p, init23) };
    ex23.ineffectiveRec = ex23.scoreG <= ex23.scoreGprime;
    assert(eq(l23, sortFamily(g12, [['device'], ['pwdmail', 'pwdshop']])) && eq(l23p, sortFamily(g12, [['device'], ['pwdshop']]))
      && eq(l23, l23d) && eq(l23p, l23pd) && ex23.scoreG === 2 && ex23.scoreGprime === 2 && ex23.ineffectiveRec, 'ex23');
    o.ex23 = ex23;

    const gc = graphFrom(PAPER.cycle); const Hc = ['pwA', 'pwB'];
    const cyc = {
      acyclic: isAcyclic(gc),
      lostBoth: { complementLocked: ['mailA', 'mailB'].filter((s) => !userReach(gc, Hc, Hc).has(s)),
        def18Locked: ['mailA', 'mailB'].filter((s) => lockoutDef18(gc, Hc).has(s)) },
      lostA: { complementLocked: ['mailA', 'mailB'].filter((s) => !userReach(gc, Hc, ['pwA']).has(s)),
        def18Locked: ['mailA', 'mailB'].filter((s) => lockoutDef18(gc, ['pwA']).has(s)) },
      lockoutBase: lockoutBases(gc, Hc, Hc, ['mailA', 'mailB']),
      lockoutBaseDef18: lockoutBases(gc, Hc, Hc, ['mailA', 'mailB'], true),
    };
    assert(!cyc.acyclic && eq(cyc.lostBoth.complementLocked, ['mailA', 'mailB']) && cyc.lostBoth.def18Locked.length === 0
      && cyc.lostA.complementLocked.length === 0 && cyc.lostA.def18Locked.length === 0, 'cycle');
    assert(eq(cyc.lockoutBase.mailA, [['pwA', 'pwB']]) && cyc.lockoutBaseDef18.mailA.length === 0, 'cycle base');
    o.cycle = cyc;
    return o;
  }

  // ===== 乱数のグラフ（突き合わせ用） =====
  function xorshift32(seed) { let x = seed >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x; }; }
  function randomSpec(rng) {
    const nc = 2 + (rng() % 3), na = 2 + (rng() % 4);
    const creds = Array.from({ length: nc }, (_, i) => `c${i}`), accts = Array.from({ length: na }, (_, i) => `a${i}`);
    const all = [...creds, ...accts]; const clauses = [];
    for (const a of accts) {
      const nm = 1 + (rng() % 3);
      for (let j = 0; j < nm; j++) {
        const bsz = 1 + (rng() % 3); const body = [];
        for (let t = 0; t < bsz; t++) { const x = all[rng() % all.length]; if (x !== a && !body.includes(x)) body.push(x); }
        if (!body.length) body.push(creds[rng() % nc]);
        clauses.push({ head: a, method: `${a}.m${j}`, role: j === 0 ? 'login' : 'recovery', body });
      }
    }
    const init = creds.filter(() => rng() % 2 === 1);
    const lost = creds.filter(() => rng() % 3 === 0);
    return { spec: { nodes: all.map((id) => ({ id })), clauses }, creds, accts, init, lost };
  }
  function randomVector(rc) {
    const g = graphFrom(rc.spec);
    const R = reach(g, rc.init); const { rank, via } = stepReach(g, rc.init); const Nv = naiveBfs(g, rc.init);
    const U = userReach(g, rc.creds, rc.lost); const L18 = lockoutDef18(g, rc.lost);
    return {
      nodes: rc.spec.nodes.map((n) => n.id), clauses: rc.spec.clauses, creds: rc.creds, init: rc.init, lost: rc.lost,
      acyclic: isAcyclic(g),
      reach: sortSet(g, R),
      rank: Object.fromEntries(sortSet(g, R).map((v) => [v, rank.get(v)])),
      via: Object.fromEntries(sortSet(g, R).filter((v) => rank.get(v) > 0).map((v) => [v, via.get(v)])),
      naive: sortSet(g, Nv),
      locked: rc.accts.filter((a) => !U.has(a)),
      def18Locked: rc.accts.filter((a) => L18.has(a)),
      accessBase: accessBases(g, rc.creds, rc.accts),
    };
  }

  // 自己検査（vectors.json には入れない）。乱数のグラフで、数え上げ法・段つき・定義18の関係を確かめる
  function selfTest(count = 3000, seed = 20261029) {
    const rng = xorshift32(seed); const st = { graphs: 0, cyclic: 0, lossChecks: 0, lossChecksCyclic: 0,
      def18MissCyclic: 0, def18MissAcyclic: 0, naiveOver: 0, initChecks: 0 };
    for (let n = 0; n < count; n++) {
      const rc = randomSpec(rng); const g = graphFrom(rc.spec); const acyc = isAcyclic(g); st.graphs++; if (!acyc) st.cyclic++;
      const k = rc.creds.length;
      for (let m = 0; m < 1 << k; m++) {
        const V = rc.creds.filter((_, i) => (m >> i) & 1); st.initChecks++;
        const R = reach(g, V), { rank } = stepReach(g, V), Nv = naiveBfs(g, V);
        if (R.size !== rank.size || [...R].some((x) => !rank.has(x))) throw new Error('counter != stepReach');
        if ([...R].some((x) => !Nv.has(x))) throw new Error('naive must be a superset');
        if (Nv.size > R.size) st.naiveOver++;
        for (let i = 0; i < k; i++) {
          const W = new Set([...V, rc.creds[i]]); const R2 = reach(g, W); if ([...R].some((x) => !R2.has(x))) throw new Error('not monotone');
        }
        // 失ったもの＝V として本人側を見る
        const U = userReach(g, rc.creds, V), L18 = lockoutDef18(g, V); st.lossChecks++; if (!acyc) st.lossChecksCyclic++;
        const comp = rc.accts.filter((a) => !U.has(a)), d18 = rc.accts.filter((a) => L18.has(a));
        if (d18.some((a) => !comp.includes(a))) throw new Error('def18 must be a subset of the complement');
        if (comp.length !== d18.length) { if (acyc) st.def18MissAcyclic++; else st.def18MissCyclic++; }
      }
    }
    if (st.def18MissAcyclic) throw new Error('def18 differs on an acyclic graph');
    return st;
  }

  function buildVectors(sample, sampleSha256) {
    const v = { schema: 'account-domino-mapper/vectors@1', sampleSha256, personas: {}, paper: paperVectors(), random: [] };
    for (const p of sample.personas) v.personas[p.id] = personaVectors(p);
    const rng = xorshift32(1029);
    for (let i = 0; i < 150; i++) v.random.push(randomVector(randomSpec(rng)));
    return v;
  }

  // ===== 葉の値の比較（件数を数える） =====
  function compareLeaves(a, b, path = '$', st = { leaves: 0, mismatches: [] }) {
    const ta = Array.isArray(a) ? 'array' : a === null ? 'null' : typeof a, tb = Array.isArray(b) ? 'array' : b === null ? 'null' : typeof b;
    if (ta !== tb) { st.mismatches.push(path + ' type ' + ta + '/' + tb); return st; }
    if (ta === 'array') {
      if (a.length !== b.length) st.mismatches.push(path + ' length ' + a.length + '/' + b.length);
      for (let i = 0; i < Math.min(a.length, b.length); i++) compareLeaves(a[i], b[i], `${path}[${i}]`, st); return st;
    }
    if (ta === 'object') {
      const ka = Object.keys(a), kb = Object.keys(b); if (ka.join('\u0000') !== kb.join('\u0000')) st.mismatches.push(path + ' keys');
      for (const k of ka) if (k in b) compareLeaves(a[k], b[k], `${path}.${k}`, st); return st;
    }
    st.leaves++; if (a !== b) st.mismatches.push(`${path} ${JSON.stringify(a)} != ${JSON.stringify(b)}`); return st;
  }

  return Object.freeze({
    graphFrom, personaSpec, personaGraph, cardGives, lineKind, reach, stepReach, naiveBfs, userReach, lockoutDef18,
    isAcyclic, accessBases, lockoutBases, cardBases, lossBases, sortFamily, validatePersona, lostNodes, enumerateMoves,
    moveId, applyMove, evaluateMoves, moveMetrics, rankMoves, bestMove, lossPairs, pairKey, lossOutcome, lossState,
    lossTable, lossView, pairLossDiff, moveLossViews, personaVectors, PAPER, paperVectors, xorshift32, randomSpec,
    randomVector, selfTest, buildVectors, compareLeaves, TYPE_TO_KIND, ATTACKABLE_TYPES, LOSABLE_TYPES, scoreSumMin
  });
}));
