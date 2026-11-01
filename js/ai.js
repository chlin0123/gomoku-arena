/**
 * 五子棋對弈系統 (gomoku-arena) — AI 引擎
 *
 * 整個引擎封裝在 GomokuAIFactory() 內，不引用任何外部變數，
 * 因此可以用 Function.toString() 注入 Web Worker 執行（直接以 file:// 開啟也可用）。
 *
 * 棋盤：長度 225 的陣列，0 = 空、1 = 黑、2 = 白。
 * 規則：無禁手自由規則，五子或以上連線即勝。
 */
function GomokuAIFactory() {
  'use strict';

  const N = 15, SIZE = N * N, CENTER = 112;
  const FIVE = 1e7, LIVE4 = 1e6, FOUR_THREE = 2e5, DOUBLE_THREE = 1e5;
  const WIN = 1e9;
  const TIMEOUT = { timeout: true };

  // ------------------------------------------------------------------
  // 棋型表：以落子點為中心，取單一方向左右各 4 格（共 8 格，每格 空/己/阻 三態）
  // 3^8 = 6561 種組合，預先算出棋型：
  // 8 連五, 7 活四, 6 衝四, 5 活三, 4 眠三, 3 活二, 2 眠二, 1 單子, 0 無空間
  // 定義採遞迴：「再下一子可成活四」即為活三，以此類推，精準且無需手寫樣式。
  // ------------------------------------------------------------------
  const POW = [1, 3, 9, 27, 81, 243, 729, 2187];
  const IDX = [0, 1, 2, 3, 5, 6, 7, 8];
  const SHAPE = new Int8Array(6561).fill(-1);

  function shapeOf(key) {
    if (SHAPE[key] >= 0) return SHAPE[key];
    const c = [0, 0, 0, 0, 1, 0, 0, 0, 0];
    let k = key;
    for (let i = 0; i < 8; i++) { c[IDX[i]] = k % 3; k = (k - k % 3) / 3; }
    let five = false, room = false;
    const comp = [];
    for (let s = 0; s <= 4; s++) {
      let me = 0, emp = -1, blocked = false;
      for (let j = s; j < s + 5; j++) {
        if (c[j] === 1) me++;
        else if (c[j] === 0) emp = j;
        else { blocked = true; break; }
      }
      if (blocked) continue;
      room = true;
      if (me === 5) five = true;
      else if (me === 4 && comp.indexOf(emp) < 0) comp.push(emp);
    }
    let r;
    if (five) r = 8;
    else if (comp.length >= 2) r = 7;
    else if (comp.length === 1) r = 6;
    else {
      r = room ? 1 : 0;
      for (let i = 0; i < 8; i++) {
        if (c[IDX[i]] !== 0) continue;
        const s = shapeOf(key + POW[i]);
        if (s >= 4 && s <= 7 && s - 2 > r) r = s - 2;
      }
    }
    SHAPE[key] = r;
    return r;
  }
  for (let k = 0; k < 6561; k++) shapeOf(k);

  // 每個點在 4 個方向上左右各 4 格的座標（-1 表示出界）
  const LINE = new Int16Array(SIZE * 32);
  const DR = [0, 1, 1, 1], DC = [1, 0, 1, -1];
  for (let pos = 0; pos < SIZE; pos++) {
    const r = (pos / N) | 0, c = pos % N;
    for (let d = 0; d < 4; d++) {
      for (let i = 0; i < 8; i++) {
        const off = i < 4 ? i - 4 : i - 3;
        const rr = r + DR[d] * off, cc = c + DC[d] * off;
        LINE[pos * 32 + d * 8 + i] = (rr >= 0 && rr < N && cc >= 0 && cc < N) ? rr * N + cc : -1;
      }
    }
  }
  // 周圍兩格內的點（用來產生候選點）
  const AROUND = [];
  for (let pos = 0; pos < SIZE; pos++) {
    const r = (pos / N) | 0, c = pos % N, arr = [];
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        if (!dr && !dc) continue;
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < N && cc >= 0 && cc < N) arr.push(rr * N + cc);
      }
    }
    AROUND.push(Int16Array.from(arr));
  }

  // ------------------------------------------------------------------
  // 棋盤狀態 + Zobrist 雜湊
  // ------------------------------------------------------------------
  const board = new Int8Array(SIZE);
  const nb = new Int16Array(SIZE);
  let stones = 0;
  const Z1 = new Int32Array(SIZE * 3), Z2 = new Int32Array(SIZE * 3);
  for (let i = 0; i < SIZE * 3; i++) {
    Z1[i] = (Math.random() * 0x7fffffff) | 0;
    Z2[i] = (Math.random() * 0x7fffffff) | 0;
  }
  let h1 = 0, h2 = 0;

  function place(pos, p) {
    board[pos] = p;
    h1 ^= Z1[pos * 3 + p]; h2 ^= Z2[pos * 3 + p];
    const a = AROUND[pos];
    for (let i = 0; i < a.length; i++) nb[a[i]]++;
    stones++;
  }
  function remove(pos) {
    const p = board[pos];
    board[pos] = 0;
    h1 ^= Z1[pos * 3 + p]; h2 ^= Z2[pos * 3 + p];
    const a = AROUND[pos];
    for (let i = 0; i < a.length; i++) nb[a[i]]--;
    stones--;
  }
  function load(arr) {
    board.fill(0); nb.fill(0); h1 = 0; h2 = 0; stones = 0;
    for (let i = 0; i < SIZE; i++) if (arr[i]) place(i, arr[i]);
  }

  // ------------------------------------------------------------------
  // 單點評分：玩家 p 若下在 pos，四個方向的棋型合計價值
  // ------------------------------------------------------------------
  let lastFour = 0; // 最近一次 pointScore 中「可成四/五」的方向數
  function pointScore(pos, p) {
    let n5 = 0, n4o = 0, n4 = 0, n3o = 0, n3 = 0, n2o = 0, n2 = 0, n1 = 0;
    const base = pos * 32;
    for (let d = 0; d < 4; d++) {
      let key = 0;
      const b = base + d * 8;
      for (let i = 0; i < 8; i++) {
        const q = LINE[b + i];
        let v;
        if (q < 0) v = 2;
        else { const s = board[q]; v = s === 0 ? 0 : (s === p ? 1 : 2); }
        key += v * POW[i];
      }
      switch (SHAPE[key]) {
        case 8: n5++; break;
        case 7: n4o++; break;
        case 6: n4++; break;
        case 5: n3o++; break;
        case 4: n3++; break;
        case 3: n2o++; break;
        case 2: n2++; break;
        case 1: n1++; break;
      }
    }
    lastFour = n5 + n4o + n4;
    if (n5) return FIVE;
    if (n4o || n4 >= 2) return LIVE4;
    if (n4 && n3o) return FOUR_THREE;
    if (n3o >= 2) return DOUBLE_THREE;
    return n4 * 2600 + n3o * 3000 + n3 * 500 + n2o * 400 + n2 * 90 + n1 * 15;
  }

  let jitter = 0;
  function scoreCandidates(p) {
    const o = 3 - p, list = [];
    for (let pos = 0; pos < SIZE; pos++) {
      if (board[pos] !== 0 || nb[pos] === 0) continue;
      const sa = pointScore(pos, p);
      const f4 = lastFour;
      const sd = pointScore(pos, o);
      let key = sa + sd * 0.85;
      if (jitter) key *= 1 + Math.random() * jitter;
      list.push({ pos, sa, sd, f4, key, v: 0 });
    }
    list.sort((a, b) => b.key - a.key);
    return list;
  }

  // 帶有「必應」剪枝的候選步產生
  function genMoves(p) {
    const list = scoreCandidates(p);
    if (!list.length) return list;
    for (const m of list) if (m.sa >= FIVE) return [m];          // 我方連五
    for (const m of list) if (m.sd >= FIVE) return [m];          // 擋對方連五
    for (const m of list) if (m.sa >= LIVE4) return [m];         // 我方活四 / 雙四
    if (list.some(m => m.sd >= LIVE4)) {                          // 對方有活三：只考慮防守或衝四
      const r = list.filter(m => m.sd >= 2600 || m.f4 > 0);
      if (r.length) return r;
    }
    return list;
  }

  // 局面靜態評估（以輪到 p 下的角度）
  function evaluate(p, ply) {
    const o = 3 - p;
    let sp = 0, so = 0, maxp = 0, oFive = 0;
    for (let pos = 0; pos < SIZE; pos++) {
      if (board[pos] !== 0 || nb[pos] === 0) continue;
      const a = pointScore(pos, p);
      if (a >= FIVE) return WIN - ply - 1;
      const b = pointScore(pos, o);
      if (b >= FIVE) oFive++;
      if (a > maxp) maxp = a;
      sp += a > 20000 ? 20000 : a;
      so += b > 20000 ? 20000 : b;
    }
    if (oFive >= 2) return -(WIN - ply - 2);
    let v = sp - so * 0.8;
    if (oFive === 0) {
      if (maxp >= LIVE4) return WIN - ply - 3;
      if (maxp >= FOUR_THREE) v += 60000;
      else if (maxp >= DOUBLE_THREE) v += 20000;
    }
    return v;
  }

  // ------------------------------------------------------------------
  // Alpha-Beta 負極大值搜尋 + 置換表
  // ------------------------------------------------------------------
  let nodes = 0, deadline = 0, widths = [12, 12, 10, 8];
  const tt = new Map();

  function negamax(depth, alpha, beta, p, ply) {
    if ((++nodes & 1023) === 0 && Date.now() > deadline) throw TIMEOUT;
    const o = 3 - p;
    const alphaOrig = alpha;
    let ttMove = -1;
    const e = tt.get(h1);
    if (e !== undefined && e.h2 === h2) {
      ttMove = e.move;
      if (e.depth >= depth) {
        if (e.flag === 0) return e.val;
        if (e.flag === 1 && e.val > alpha) alpha = e.val;
        else if (e.flag === 2 && e.val < beta) beta = e.val;
        if (alpha >= beta) return e.val;
      }
    }
    if (depth <= 0) return evaluate(p, ply);

    const moves = genMoves(p);
    if (moves.length === 0) return 0;
    if (moves[0].sa >= FIVE) return WIN - ply;
    if (moves.length === 1 && moves[0].sa >= LIVE4) return WIN - ply - 2;

    if (ttMove >= 0) {
      const i = moves.findIndex(m => m.pos === ttMove);
      if (i > 0) { const t = moves[i]; moves.splice(i, 1); moves.unshift(t); }
    }
    const w = Math.min(moves.length, widths[Math.min(ply, widths.length - 1)]);
    let best = -Infinity, bestMove = moves[0].pos;
    for (let i = 0; i < w; i++) {
      const m = moves[i].pos;
      place(m, p);
      const v = -negamax(depth - 1, -beta, -alpha, o, ply + 1);
      remove(m);
      if (v > best) { best = v; bestMove = m; }
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    const flag = best <= alphaOrig ? 2 : (best >= beta ? 1 : 0);
    if (tt.size > 800000) tt.clear();
    tt.set(h1, { h2, depth, val: best, flag, move: bestMove });
    return best;
  }

  // ------------------------------------------------------------------
  // VCF：連續衝四取勝搜尋
  // ------------------------------------------------------------------
  let vcfNodes = 0, vcfLimit = 0;
  const vcfPath = [];

  function fivePointNear(m, p) {
    const base = m * 32;
    for (let k = 0; k < 32; k++) {
      const q = LINE[base + k];
      if (q >= 0 && board[q] === 0 && pointScore(q, p) >= FIVE) return q;
    }
    return -1;
  }

  // oppFive：對手目前威脅成五的點（-1 表示無），此時我方只能在該點衝四
  function vcf(p, depth, ply, oppFive) {
    if (++vcfNodes > vcfLimit) return false;
    const o = 3 - p;
    const cands = [];
    for (let pos = 0; pos < SIZE; pos++) {
      if (board[pos] !== 0 || nb[pos] === 0) continue;
      const s = pointScore(pos, p);
      if (s >= FIVE) { vcfPath[ply] = pos; return true; }
      if (lastFour > 0 && (oppFive < 0 || pos === oppFive)) cands.push({ pos, s });
    }
    if (depth <= 0 || !cands.length) return false;
    cands.sort((a, b) => b.s - a.s);
    for (const c of cands) {
      place(c.pos, p);
      let win = false;
      if (c.s >= LIVE4) win = true;
      else {
        const d = fivePointNear(c.pos, p);
        if (d >= 0) {
          place(d, o);
          win = vcf(p, depth - 1, ply + 1, fivePointNear(d, o));
          remove(d);
        }
      }
      remove(c.pos);
      if (win) { vcfPath[ply] = c.pos; return true; }
      if (vcfNodes > vcfLimit) return false;
    }
    return false;
  }

  // ------------------------------------------------------------------
  // 根節點搜尋（迭代加深）
  // ------------------------------------------------------------------
  function searchRoot(p, cfg) {
    const o = 3 - p;
    widths = cfg.widths;
    const moves = genMoves(p);
    if (!moves.length) return { move: -1 };
    if (moves[0].sa >= FIVE) return { move: moves[0].pos, note: '連成五子' };
    if (moves.length === 1) {
      return { move: moves[0].pos, note: moves[0].sa >= LIVE4 ? '成活四，勝勢已定' : '必應之著' };
    }

    if (cfg.vcfDepth) {
      vcfNodes = 0; vcfLimit = cfg.vcfNodes;
      if (vcf(p, cfg.vcfDepth, 0, -1)) return { move: vcfPath[0], note: '算出連續衝四殺 (VCF)' };
    }

    let root = moves.slice(0, cfg.rootWidth);
    let note = '';
    if (cfg.defendVCF) {
      vcfNodes = 0; vcfLimit = cfg.vcfNodes;
      if (vcf(o, cfg.vcfDepth, 0, -1)) {
        const safe = [];
        for (const m of moves.slice(0, 30)) {
          place(m.pos, p);
          const f = fivePointNear(m.pos, p);
          vcfNodes = 0; vcfLimit = cfg.vcfNodes >> 2;
          const lose = vcf(o, cfg.vcfDepth, 0, f);
          remove(m.pos);
          if (!lose) safe.push(m);
          if (safe.length >= cfg.rootWidth) break;
        }
        if (safe.length) { root = safe; note = '識破並化解對手的連續衝四'; }
      }
    }
    if (root.length === 1) return { move: root[0].pos, note };

    const snapshot = Array.from(board);
    deadline = Date.now() + cfg.time;
    tt.clear();
    let bestMove = root[0].pos, bestScore = 0, depthDone = 0;
    for (let d = 2; d <= cfg.depth; d++) {
      try {
        let alpha = -Infinity, cb = -1, cs = -Infinity;
        for (const m of root) {
          place(m.pos, p);
          const v = -negamax(d - 1, -Infinity, -alpha, o, 1);
          remove(m.pos);
          m.v = v;
          if (v > cs) { cs = v; cb = m.pos; }
          if (v > alpha) alpha = v;
        }
        if (cs <= -WIN / 2 && depthDone > 0) { depthDone = d; break; } // 皆敗：保留上一層的最佳抵抗
        bestMove = cb; bestScore = cs; depthDone = d;
        root.sort((a, b) => b.v - a.v);
        if (cs >= WIN / 2) { note = note || '已算出必勝'; break; }
      } catch (e) {
        if (e !== TIMEOUT) throw e;
        load(snapshot);
        break;
      }
    }
    if (!note && bestScore <= -WIN / 2) note = '形勢危急';
    return { move: bestMove, depth: depthDone, score: bestScore, note };
  }

  // ------------------------------------------------------------------
  // 各級 AI
  // ------------------------------------------------------------------
  // Lv1 小豆子：隨興，常漏看
  function beginner(p) {
    const list = scoreCandidates(p);
    const win = list.find(m => m.sa >= FIVE);
    if (win && Math.random() < 0.85) return win.pos;
    const blk = list.find(m => m.sd >= FIVE);
    if (blk && Math.random() < 0.5) return blk.pos;
    const top = list.slice(0, 8);
    let total = 0;
    const w = top.map((m, i) => (total += 1 / (i + 1)));
    const r = Math.random() * total;
    for (let i = 0; i < top.length; i++) if (r <= w[i]) return top[i].pos;
    return top[0].pos;
  }

  // Lv2 阿福伯：看一步，有四必擋，活三偶爾漏
  function casual(p) {
    const list = scoreCandidates(p);
    const m = list.find(x => x.sa >= FIVE) || list.find(x => x.sd >= FIVE) || list.find(x => x.sa >= LIVE4);
    if (m) return m.pos;
    const threats = list.filter(x => x.sd >= LIVE4);
    if (threats.length && Math.random() < 0.7) return threats[0].pos;
    const top = list.slice(0, 6).map(x => ({ pos: x.pos, k: x.key * (0.75 + Math.random() * 0.5) }));
    top.sort((a, b) => b.k - a.k);
    return top[0].pos;
  }

  const CFG = {
    2: { depth: 2, time: 1200, rootWidth: 10, widths: [10, 10, 8], vcfDepth: 6, vcfNodes: 3000, defendVCF: false },
    3: { depth: 6, time: 1500, rootWidth: 12, widths: [12, 12, 10, 8], vcfDepth: 10, vcfNodes: 12000, defendVCF: true },
    4: { depth: 12, time: 4000, rootWidth: 16, widths: [16, 14, 12, 10, 8, 8, 6], vcfDepth: 16, vcfNodes: 50000, defendVCF: true },
  };

  function think(req) {
    load(req.board);
    const p = req.player, lv = req.level;
    const t0 = Date.now();
    nodes = 0;
    jitter = stones < 6 ? 0.15 : 0;
    let res;
    if (stones === 0) {
      res = { move: CENTER, note: '天元開局' };
    } else if (stones === 1) {
      const s = board.findIndex(v => v !== 0);
      const r = (s / N) | 0, c = s % N, opts = [];
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if ((dr || dc) && rr >= 0 && rr < N && cc >= 0 && cc < N) opts.push(rr * N + cc);
      }
      res = { move: opts[(Math.random() * opts.length) | 0] };
    } else if (lv <= 0) {
      res = { move: beginner(p) };
    } else if (lv === 1) {
      res = { move: casual(p) };
    } else {
      res = searchRoot(p, CFG[Math.min(lv, 4)]);
    }
    if (res.move == null || res.move < 0 || board[res.move] !== 0) {
      const list = scoreCandidates(p);
      res.move = list.length ? list[0].pos : board.findIndex(v => v === 0);
    }
    res.time = Date.now() - t0;
    res.nodes = nodes;
    return res;
  }

  return { think };
}
