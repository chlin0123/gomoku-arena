/**
 * 五子棋對弈系統 (gomoku-arena) — 介面、對局流程與打譜
 */
(function () {
  'use strict';

  const N = 15;
  const COLS = 'ABCDEFGHIJKLMNO';
  const STARS = [48, 56, 112, 168, 176];

  // ------------------------------------------------------------------
  // 五位 AI 對手
  // ------------------------------------------------------------------
  const AIS = [
    {
      name: '小豆子', title: '入門', stars: 1, avatar: '👦', color: '#8bc34a', delay: 500,
      style: '隨興落子 · 常有疏漏',
      bio: '鄰居家八歲的小朋友，上星期才學會規則。下棋全憑感覺，常常忘記擋你的四，但偶爾也會誤打誤撞連成五子。',
      winQuote: '哇！我贏了！我要去跟媽媽說！',
      loseQuote: '再一次啦～這次不算！',
    },
    {
      name: '阿福伯', title: '初級', stars: 2, avatar: '👴', color: '#fbc02d', delay: 600,
      style: '一步看一步 · 攻守直覺',
      bio: '公園涼亭的常客，泡茶下棋三十年。看得懂眼前的攻防，有四必擋，但算不遠，對手的活三偶爾會漏看。',
      winQuote: '呵呵，少年仔，再練練啦。',
      loseQuote: '後生可畏啊！來，喝杯茶。',
    },
    {
      name: '林書生', title: '中級', stars: 3, avatar: '🧑‍🎓', color: '#4fc3f7', delay: 500,
      style: '穩健佈局 · 兩步推演',
      bio: '大學棋社社長，擅長佈局與活三進攻。每一步都會推演雙方的應對，也能抓住短手數的連續衝四殺。',
      winQuote: '承讓了，這盤的佈局值得復盤。',
      loseQuote: '精彩！我得回去研究這個變化。',
    },
    {
      name: '墨隱', title: '高級', stars: 4, avatar: '🥷', color: '#ba68c8', delay: 400,
      style: '凌厲殺法 · 四層搜尋',
      bio: '隱居山林的劍客棋士，出手凌厲。精通 VCF 連續衝四殺法，能看穿你的殺著並預先化解，一旦露出破綻便難以翻身。',
      winQuote: '破綻已現，勝負早定。',
      loseQuote: '……好棋。我會再來。',
    },
    {
      name: '天元', title: '大師', stars: 5, avatar: '🧙', color: '#ef5350', delay: 300,
      style: '深算全局 · 攻防無隙',
      bio: '傳說中的五子棋聖，據說執黑從未輸過。以迭代加深搜尋、置換表與深度威脅計算，洞察十餘步之後的殺機。',
      winQuote: '棋盤之上，萬變皆在算中。',
      loseQuote: '妙哉！老夫已多年未嘗敗績。',
    },
  ];
  const HINT_LEVEL = 3;

  // ------------------------------------------------------------------
  // 小工具
  // ------------------------------------------------------------------
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LS_LIB = 'gomoku.library', LS_STATS = 'gomoku.stats', LS_PREF = 'gomoku.prefs';
  const loadLS = (k, d) => {
    try {
      const v = JSON.parse(localStorage.getItem(k));
      if (v == null || typeof v !== typeof d || Array.isArray(v) !== Array.isArray(d)) return d;
      return v;
    } catch (e) { return d; }
  };
  const saveLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } };

  const posToCoord = pos => COLS[pos % N] + (N - Math.floor(pos / N));
  function coordToPos(s) {
    const m = /^([a-oA-O])(\d{1,2})$/.exec(String(s).trim());
    if (!m) return null;
    const c = COLS.indexOf(m[1].toUpperCase()), row = +m[2];
    if (row < 1 || row > N) return null;
    return (N - row) * N + c;
  }
  const sideAt = n => (n % 2 === 0 ? 1 : 2);
  const colorName = c => (c === 1 ? '黑' : '白');

  function checkWin(b, pos) {
    const p = b[pos], r = Math.floor(pos / N), c = pos % N;
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
      const line = [pos];
      for (const s of [1, -1]) {
        let rr = r + dr * s, cc = c + dc * s;
        while (rr >= 0 && rr < N && cc >= 0 && cc < N && b[rr * N + cc] === p) {
          line.push(rr * N + cc); rr += dr * s; cc += dc * s;
        }
      }
      if (line.length >= 5) return line;
    }
    return null;
  }

  // ------------------------------------------------------------------
  // 狀態
  // ------------------------------------------------------------------
  const rawPrefs = loadLS(LS_PREF, {});
  const prefs = {
    aiIndex: (Number.isInteger(rawPrefs.aiIndex) && rawPrefs.aiIndex >= 0 && rawPrefs.aiIndex < AIS.length) ? rawPrefs.aiIndex : 2,
    colorChoice: [0, 1, 2].includes(rawPrefs.colorChoice) ? rawPrefs.colorChoice : 1,
    showNumbers: !!rawPrefs.showNumbers,
    sound: rawPrefs.sound === undefined ? true : !!rawPrefs.sound,
    speed: [350, 800, 1500].includes(rawPrefs.speed) ? rawPrefs.speed : 800,
  };
  const savePrefs = () => saveLS(LS_PREF, prefs);

  const state = {
    mode: 'ai',
    gameAi: prefs.aiIndex,   // 本局對手
    humanColor: 1,
    moves: [],               // {pos, player, comment, win}
    cursor: 0,               // 目前顯示到第幾手
    thinking: false,
    hint: -1,
    result: null,            // {winner: 0|1|2, reason}
    counted: false,
    hover: -1,
    autoplay: null,
    meta: null,              // 載入棋譜的資訊
    info: '',
  };

  function boardAt(n) {
    const b = new Int8Array(N * N);
    for (let i = 0; i < n; i++) b[state.moves[i].pos] = state.moves[i].player;
    return b;
  }
  const atLatest = () => state.cursor === state.moves.length;
  const winAtCursor = () => state.cursor > 0 && !!state.moves[state.cursor - 1].win;
  const turnColor = () => sideAt(state.mode === 'study' ? state.cursor : state.moves.length);

  // ------------------------------------------------------------------
  // AI 引擎（Web Worker，失敗時退回主執行緒）
  // ------------------------------------------------------------------
  const Engine = {
    worker: null, local: null, cbs: new Map(),
    init() {
      try {
        const src = 'const AI=(' + GomokuAIFactory.toString() + ')();\n' +
          'self.onmessage=function(e){var r=AI.think(e.data.req);r.id=e.data.id;self.postMessage(r);};';
        const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
        this.worker = new Worker(url);
        URL.revokeObjectURL(url);
        this.worker.onmessage = e => {
          const cb = this.cbs.get(e.data.id);
          if (cb) { this.cbs.delete(e.data.id); cb(e.data); }
        };
      } catch (err) {
        this.worker = null;
        this.local = GomokuAIFactory();
      }
    },
    think(req, id, cb) {
      if (this.worker) { this.cbs.set(id, cb); this.worker.postMessage({ req, id }); }
      else setTimeout(() => cb(this.local.think(req)), 30);
    },
    cancel() {
      if (this.worker && this.cbs.size) { this.worker.terminate(); this.cbs.clear(); this.init(); }
    },
  };

  let reqSeq = 0, aiReq = null, hintReq = null;

  function requestAI() {
    if (state.mode !== 'ai' || state.result || state.moves.length >= N * N) return;
    if (sideAt(state.moves.length) === state.humanColor) return;
    const id = 'a' + (++reqSeq);
    aiReq = id;
    state.thinking = true;
    const ai = AIS[state.gameAi];
    const t0 = performance.now();
    render();
    Engine.think({ board: Array.from(boardAt(state.moves.length)), player: sideAt(state.moves.length), level: state.gameAi }, id, res => {
      if (aiReq !== id) return;
      const wait = Math.max(0, ai.delay - (performance.now() - t0));
      setTimeout(() => {
        if (aiReq !== id) return;
        aiReq = null;
        state.thinking = false;
        const parts = [`${ai.name} 落子 ${posToCoord(res.move)}`];
        if (res.note) parts.push(res.note);
        if (res.depth) parts.push(`深度 ${res.depth}`);
        if (res.nodes) parts.push(`${res.nodes.toLocaleString()} 節點`);
        parts.push(`${(res.time / 1000).toFixed(2)}s`);
        state.info = parts.join(' · ');
        placeMove(res.move);
      }, wait);
    });
  }

  function cancelAI() {
    aiReq = null; hintReq = null;
    state.thinking = false;
    Engine.cancel();
  }

  function requestHint() {
    if (state.thinking || hintReq) return;
    if (winAtCursor() || (state.mode !== 'study' && (state.result || !atLatest()))) return;
    const id = 'h' + (++reqSeq);
    hintReq = id;
    state.info = '💡 提示計算中…';
    render();
    const n = state.cursor;
    Engine.think({ board: Array.from(boardAt(n)), player: sideAt(n), level: HINT_LEVEL }, id, res => {
      if (hintReq !== id) return;
      hintReq = null;
      if (state.cursor !== n) { render(); return; }
      state.hint = res.move;
      state.info = `💡 建議${colorName(sideAt(n))}方下 ${posToCoord(res.move)}` + (res.note ? ' · ' + res.note : '');
      render();
    });
  }

  // ------------------------------------------------------------------
  // 對局流程
  // ------------------------------------------------------------------
  function newGame() {
    cancelAI(); stopAutoplay(); hideOverlay();
    state.moves = []; state.cursor = 0; state.result = null; state.counted = false;
    state.hint = -1; state.meta = null; state.info = '';
    if (state.mode === 'ai') {
      state.gameAi = prefs.aiIndex;
      const ch = prefs.colorChoice;
      state.humanColor = ch === 0 ? (Math.random() < 0.5 ? 1 : 2) : ch;
      state.info = `對手：${AIS[state.gameAi].name}（${AIS[state.gameAi].title}）· 你執${colorName(state.humanColor)}`;
    }
    renderAIList();
    render();
    requestAI();
  }

  function setMode(mode) {
    if (mode === state.mode) return;
    const prev = state.mode;
    state.mode = mode;
    if (mode === 'study') {
      // 保留目前棋局，方便直接復盤研究
      cancelAI(); stopAutoplay(); hideOverlay();
      if (!state.meta && state.moves.length) {
        state.meta = { title: '', black: playerInfoFor(prev, 1).name, white: playerInfoFor(prev, 2).name };
      }
      state.result = null;
      state.info = state.moves.length ? '已切換至打譜：可自由瀏覽、試下變化與加註解' : '打譜模式：雙方輪流自由落子';
      render();
    } else {
      newGame();
    }
  }

  function placeMove(pos) {
    const b = boardAt(state.cursor);
    if (b[pos]) return false;
    if (state.cursor < state.moves.length) state.moves.length = state.cursor;
    const player = sideAt(state.cursor);
    b[pos] = player;
    const win = checkWin(b, pos);
    state.moves.push({ pos, player, comment: '', win });
    state.cursor = state.moves.length;
    state.hint = -1; hintReq = null;
    playClick();
    if (win) finishGame(player, '連成五子');
    else if (state.moves.length === N * N) finishGame(0, '棋盤已滿');
    render();
    return true;
  }

  function finishGame(winner, reason) {
    if (state.mode === 'study') return;
    state.result = { winner, reason };
    if (state.mode === 'ai' && !state.counted) {
      state.counted = true;
      const st = loadLS(LS_STATS, {});
      const k = state.gameAi;
      st[k] = st[k] || { w: 0, l: 0, d: 0 };
      if (winner === 0) st[k].d++;
      else if (winner === state.humanColor) st[k].w++;
      else st[k].l++;
      saveLS(LS_STATS, st);
      renderAIList();
    }
    setTimeout(showResult, 350);
  }

  function onBoardClick(e) {
    const pos = eventToPos(e);
    if (pos < 0) return;
    if (state.autoplay) stopAutoplay();
    if (state.thinking) { toast('對手思考中，請稍候…'); return; }
    if (state.mode !== 'study') {
      if (state.result) { toast('本局已結束，按「新局」再來一盤，或切換到「打譜研究」復盤'); return; }
      if (!atLatest()) { toast('目前在回顧中，按 ⏭ 回到最新局面'); return; }
      if (state.mode === 'ai' && sideAt(state.cursor) !== state.humanColor) return;
    } else if (winAtCursor()) {
      toast('此局面已分出勝負'); return;
    }
    if (boardAt(state.cursor)[pos]) return;
    if (state.mode === 'study' && !atLatest()) toast(`已從第 ${state.cursor + 1} 手開始新的變化`);
    state.info = '';
    placeMove(pos);
    requestAI();
  }

  function undo() {
    stopAutoplay(); hideOverlay();
    if (state.mode === 'ai') {
      cancelAI();
      if (!state.moves.length) return;
      state.moves.pop();
      while (state.moves.length && sideAt(state.moves.length) !== state.humanColor) state.moves.pop();
    } else {
      if (!state.moves.length) return;
      if (state.mode === 'study' && !atLatest()) state.moves.length = state.cursor; // 打譜：刪到目前位置
      state.moves.pop();
    }
    state.cursor = state.moves.length;
    state.result = null; state.hint = -1; state.info = '已悔棋';
    render();
    requestAI();
  }

  function resign() {
    if (state.result || !state.moves.length) return;
    let loser;
    if (state.mode === 'ai') { cancelAI(); loser = state.humanColor; }
    else loser = sideAt(state.moves.length);
    finishGame(3 - loser, `${colorName(loser)}方認輸`);
    render();
  }

  function takeover() {
    if (winAtCursor()) { toast('此局面已分出勝負'); return; }
    stopAutoplay();
    cancelAI();
    const moves = state.moves.slice(0, state.cursor);
    state.mode = 'ai';
    state.gameAi = prefs.aiIndex;
    state.moves = moves; state.cursor = moves.length;
    state.humanColor = sideAt(moves.length);
    state.result = null; state.counted = true; state.meta = null; state.hint = -1;
    state.info = `你執${colorName(state.humanColor)}，與 ${AIS[state.gameAi].name} 從第 ${moves.length + 1} 手續弈（不計戰績）`;
    renderAIList();
    render();
  }

  // ------------------------------------------------------------------
  // 瀏覽 / 自動播放
  // ------------------------------------------------------------------
  function goto(n) {
    state.cursor = Math.max(0, Math.min(state.moves.length, n));
    state.hint = -1;
    render();
  }
  function toggleAutoplay() {
    if (state.autoplay) { stopAutoplay(); return; }
    if (!state.moves.length) return;
    if (atLatest()) state.cursor = 0;
    state.autoplay = setInterval(() => {
      if (atLatest()) { stopAutoplay(); return; }
      state.cursor++;
      playClick();
      render();
    }, prefs.speed);
    render();
  }
  function stopAutoplay() {
    if (state.autoplay) { clearInterval(state.autoplay); state.autoplay = null; render(); }
  }

  // ------------------------------------------------------------------
  // 繪製棋盤
  // ------------------------------------------------------------------
  const canvas = $('#board');
  const ctx = canvas.getContext('2d');

  function geom() {
    const size = canvas.clientWidth;
    const m = size * 0.06;
    return { size, m, cell: (size - 2 * m) / (N - 1) };
  }
  function eventToPos(e) {
    const rect = canvas.getBoundingClientRect();
    const { m, cell } = geom();
    const c = Math.round((e.clientX - rect.left - m) / cell);
    const r = Math.round((e.clientY - rect.top - m) / cell);
    if (r < 0 || r >= N || c < 0 || c >= N) return -1;
    return r * N + c;
  }

  function drawStone(x, y, r, player, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.beginPath();
    ctx.arc(x + r * 0.12, y + r * 0.16, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fill();
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
    if (player === 1) { g.addColorStop(0, '#6a6a6a'); g.addColorStop(1, '#0c0c0c'); }
    else { g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#cfcac0'); }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
  }

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const { size, m, cell } = geom();
    if (!size) return;
    const px = Math.round(size * dpr);
    if (canvas.width !== px) { canvas.width = px; canvas.height = px; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 木紋底
    const g = ctx.createLinearGradient(0, 0, size, size);
    g.addColorStop(0, '#eac784'); g.addColorStop(0.5, '#dfb468'); g.addColorStop(1, '#d1a052');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    ctx.save();
    ctx.globalAlpha = 0.07;
    ctx.strokeStyle = '#7a4a12';
    for (let i = 0; i < 26; i++) {
      ctx.beginPath();
      const y0 = (i / 26) * size;
      ctx.moveTo(0, y0);
      for (let x = 0; x <= size; x += size / 20) ctx.lineTo(x, y0 + Math.sin(x / size * 6 + i * 1.7) * size * 0.012);
      ctx.lineWidth = 1 + (i % 3);
      ctx.stroke();
    }
    ctx.restore();

    const X = c => m + c * cell, Y = r => m + r * cell;

    // 格線
    ctx.strokeStyle = '#4a3114';
    ctx.lineWidth = 1;
    for (let i = 0; i < N; i++) {
      ctx.beginPath(); ctx.moveTo(X(0), Y(i)); ctx.lineTo(X(N - 1), Y(i)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(X(i), Y(0)); ctx.lineTo(X(i), Y(N - 1)); ctx.stroke();
    }
    ctx.lineWidth = 2;
    ctx.strokeRect(X(0), Y(0), cell * (N - 1), cell * (N - 1));
    ctx.fillStyle = '#4a3114';
    for (const s of STARS) {
      ctx.beginPath(); ctx.arc(X(s % N), Y(Math.floor(s / N)), Math.max(2.5, cell * 0.1), 0, Math.PI * 2); ctx.fill();
    }
    // 座標
    ctx.fillStyle = '#5b3d18';
    ctx.font = `${Math.max(9, cell * 0.32)}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = 0; i < N; i++) {
      ctx.fillText(COLS[i], X(i), m * 0.42);
      ctx.fillText(COLS[i], X(i), size - m * 0.42);
      ctx.fillText(String(N - i), m * 0.42, Y(i));
      ctx.fillText(String(N - i), size - m * 0.42, Y(i));
    }

    // 棋子
    const r = cell * 0.46;
    const n = state.cursor;
    for (let i = 0; i < n; i++) {
      const mv = state.moves[i];
      drawStone(X(mv.pos % N), Y(Math.floor(mv.pos / N)), r, mv.player);
    }
    if (prefs.showNumbers) {
      ctx.font = `bold ${Math.max(8, cell * (n >= 100 ? 0.3 : 0.38))}px sans-serif`;
      for (let i = 0; i < n; i++) {
        const mv = state.moves[i];
        ctx.fillStyle = i === n - 1 ? '#e53935' : (mv.player === 1 ? '#f2f2f2' : '#222');
        ctx.fillText(String(i + 1), X(mv.pos % N), Y(Math.floor(mv.pos / N)) + 0.5);
      }
    } else if (n > 0) {
      const last = state.moves[n - 1].pos;
      ctx.fillStyle = '#e53935';
      ctx.beginPath(); ctx.arc(X(last % N), Y(Math.floor(last / N)), r * 0.24, 0, Math.PI * 2); ctx.fill();
    }

    // 五連線
    if (winAtCursor()) {
      const line = state.moves[n - 1].win.slice().sort((a, b) => a - b);
      ctx.save();
      ctx.strokeStyle = 'rgba(229,57,53,0.85)';
      ctx.lineWidth = Math.max(3, cell * 0.12);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(X(line[0] % N), Y(Math.floor(line[0] / N)));
      const e = line[line.length - 1];
      ctx.lineTo(X(e % N), Y(Math.floor(e / N)));
      ctx.stroke();
      ctx.restore();
    }

    // 提示
    if (state.hint >= 0) {
      const hx = X(state.hint % N), hy = Y(Math.floor(state.hint / N));
      drawStone(hx, hy, r, sideAt(n), 0.45);
      ctx.save();
      ctx.strokeStyle = '#2e7d32'; ctx.lineWidth = 3; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.arc(hx, hy, r * 1.08, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    // 滑鼠預覽
    if (state.hover >= 0 && canPlaceAt(state.hover)) {
      drawStone(X(state.hover % N), Y(Math.floor(state.hover / N)), r, sideAt(n), 0.4);
    }
  }

  function canPlaceAt(pos) {
    if (state.thinking || state.autoplay) return false;
    if (boardAt(state.cursor)[pos]) return false;
    if (state.mode === 'study') return !winAtCursor();
    if (state.result || !atLatest()) return false;
    return state.mode === 'pvp' || sideAt(state.cursor) === state.humanColor;
  }

  // ------------------------------------------------------------------
  // 介面渲染
  // ------------------------------------------------------------------
  function playerInfoFor(mode, color) {
    if (mode === 'ai') {
      if (color === state.humanColor) return { name: '你', avatar: '🙂', sub: '玩家', bg: '#546e7a' };
      const a = AIS[state.gameAi];
      return { name: a.name, avatar: a.avatar, sub: `${a.title} ${'★'.repeat(a.stars)}`, bg: a.color, ai: true };
    }
    if (mode === 'pvp') return { name: color === 1 ? '黑方' : '白方', avatar: color === 1 ? '⚫' : '⚪', sub: '玩家', bg: '#546e7a' };
    const meta = state.meta;
    return {
      name: (meta && (color === 1 ? meta.black : meta.white)) || (color === 1 ? '黑方' : '白方'),
      avatar: '📖', sub: '打譜', bg: '#6d4c41',
    };
  }

  function renderPlayers() {
    const turn = turnColor();
    for (const color of [1, 2]) {
      const el = $('#player-' + color);
      const p = playerInfoFor(state.mode, color);
      const thinking = state.thinking && p.ai;
      el.classList.toggle('active', !state.result && !winAtCursor() && turn === color);
      el.innerHTML = `
        <span class="stone-ico c${color}"></span>
        <span class="avatar" style="background:${p.bg}">${p.avatar}</span>
        <span class="pinfo"><div class="pname">${esc(p.name)}</div><div class="psub">${esc(p.sub)}</div></span>
        ${thinking ? '<span class="thinking">思考中<i></i><i></i><i></i></span>' : ''}`;
    }
  }

  function renderStatus() {
    let s;
    const n = state.moves.length;
    if (state.result) {
      const w = state.result.winner;
      if (w === 0) s = `🤝 和棋（${state.result.reason}）`;
      else s = `🏆 ${playerInfoFor(state.mode, w).name}（${colorName(w)}）獲勝 · ${state.result.reason}`;
    } else if (state.mode === 'study') {
      if (winAtCursor()) s = `🏆 ${colorName(state.moves[state.cursor - 1].player)}方連成五子`;
      else s = `第 ${state.cursor + 1} 手 · 輪到${colorName(sideAt(state.cursor))}方`;
      if (!atLatest()) s += `（之後還有 ${n - state.cursor} 手）`;
    } else if (state.thinking) {
      s = `⏳ ${AIS[state.gameAi].name} 思考中…`;
    } else {
      const t = sideAt(n);
      s = state.mode === 'ai'
        ? (t === state.humanColor ? `👉 輪到你落子（${colorName(t)}）` : `${AIS[state.gameAi].name} 的回合`)
        : `👉 輪到${colorName(t)}方落子`;
      if (!atLatest()) s = `🔍 回顧中：第 ${state.cursor} / ${n} 手`;
    }
    $('#status').textContent = s;
    $('#engine-info').textContent = state.info || '';
  }

  function renderMoveList() {
    const box = $('#move-list');
    if (!state.moves.length) {
      box.innerHTML = '<div class="empty">尚無棋步</div>';
    } else {
      box.innerHTML = state.moves.map((m, i) => `
        <span class="mv${i === state.cursor - 1 ? ' cur' : ''}${i >= state.cursor ? ' future' : ''}${m.comment ? ' has-note' : ''}" data-i="${i}" title="${m.comment ? esc(m.comment) : ''}">
          <b>${i + 1}</b><i class="dot c${m.player}"></i>${posToCoord(m.pos)}
        </span>`).join('');
      const cur = box.querySelector('.mv.cur');
      if (cur) {
        const top = cur.offsetTop - box.offsetTop;
        if (top < box.scrollTop || top > box.scrollTop + box.clientHeight - 30) box.scrollTop = top - box.clientHeight / 2;
      }
    }
    $('#record-title').textContent = state.meta && state.meta.title ? '· ' + state.meta.title : '';
  }

  function renderComment() {
    const ta = $('#comment');
    if (document.activeElement === ta) return;
    if (state.cursor === 0) { ta.value = ''; ta.disabled = true; ta.placeholder = '選擇一手棋後可加上註解'; }
    else {
      ta.disabled = false;
      ta.placeholder = `為第 ${state.cursor} 手（${posToCoord(state.moves[state.cursor - 1].pos)}）加上註解…`;
      ta.value = state.moves[state.cursor - 1].comment || '';
    }
  }

  function renderControls() {
    const n = state.moves.length;
    $('#nav-pos').textContent = `${state.cursor} / ${n}`;
    $('#nav-first').disabled = $('#nav-prev').disabled = state.cursor === 0;
    $('#nav-next').disabled = $('#nav-last').disabled = atLatest();
    $('#nav-play').disabled = !n;
    $('#nav-play').classList.toggle('on', !!state.autoplay);
    $('#nav-play').textContent = state.autoplay ? '⏸' : '⏯';
    $('#btn-undo').disabled = !n;
    $('#btn-undo').textContent = state.mode === 'study' ? '↶ 刪除一手' : '↶ 悔棋';
    $('#btn-hint').disabled = state.thinking || !!hintReq || winAtCursor() ||
      (state.mode !== 'study' && (!!state.result || !atLatest() || (state.mode === 'ai' && sideAt(n) !== state.humanColor)));
    $('#btn-resign').disabled = !!state.result || !n;
    $('#btn-takeover').disabled = winAtCursor();
    $$('[data-modes]').forEach(el => { el.hidden = !el.dataset.modes.split(' ').includes(state.mode); });
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.mode === state.mode));
  }

  function render() {
    renderPlayers();
    renderStatus();
    renderMoveList();
    renderComment();
    renderControls();
    draw();
  }

  function renderAIList() {
    const st = loadLS(LS_STATS, {});
    $('#ai-list').innerHTML = AIS.map((a, i) => {
      const s = st[i] || {};
      const r = { w: Math.max(0, s.w | 0), l: Math.max(0, s.l | 0), d: Math.max(0, s.d | 0) };
      const total = r.w + r.l + r.d;
      const rec = total ? `戰績：${r.w} 勝 ${r.l} 敗${r.d ? ' ' + r.d + ' 和' : ''}（勝率 ${Math.round(r.w / total * 100)}%）` : '尚未交手';
      const playing = state.mode === 'ai' && state.gameAi === i && state.moves.length > 0 && !state.result;
      return `
        <div class="ai-card${prefs.aiIndex === i ? ' selected' : ''}" data-ai="${i}">
          <span class="avatar" style="background:${a.color}">${a.avatar}</span>
          <div class="ai-main">
            <div class="ai-head">
              <span class="ai-name">${a.name}</span>
              <span class="ai-level" style="background:${a.color}">Lv.${i + 1} ${a.title}</span>
              <span class="ai-stars">${'★'.repeat(a.stars)}${'☆'.repeat(5 - a.stars)}</span>
              ${playing ? '<span class="ai-tag">對戰中</span>' : ''}
            </div>
            <div class="ai-style">${a.style}</div>
            <div class="ai-bio">${a.bio}</div>
            <div class="ai-record">${rec}</div>
          </div>
        </div>`;
    }).join('');
  }

  // ------------------------------------------------------------------
  // 結果覆蓋層
  // ------------------------------------------------------------------
  function showResult() {
    if (!state.result || state.mode === 'study') return;
    const w = state.result.winner;
    let html;
    if (state.mode === 'ai') {
      const a = AIS[state.gameAi];
      if (w === 0) html = `<div class="big">🤝 和棋</div>`;
      else if (w === state.humanColor) {
        html = `<span class="avatar" style="background:${a.color}">${a.avatar}</span>
          <div class="big">🎉 你贏了！</div><div class="quote">${a.name}：「${a.loseQuote}」</div>`;
      } else {
        html = `<span class="avatar" style="background:${a.color}">${a.avatar}</span>
          <div class="big">${a.name} 獲勝</div><div class="quote">「${a.winQuote}」</div>`;
      }
    } else {
      html = w === 0 ? `<div class="big">🤝 和棋</div>` : `<div class="big">🏆 ${colorName(w)}方獲勝</div>`;
    }
    html += `<div class="sub">${esc(state.result.reason)} · 共 ${state.moves.length} 手</div>
      <div class="btn-row" style="justify-content:center">
        <button class="btn primary" data-act="again">再來一局</button>
        <button class="btn" data-act="study">打譜復盤</button>
        <button class="btn" data-act="save">儲存棋譜</button>
        <button class="btn" data-act="close">關閉</button>
      </div>`;
    const ov = $('#overlay');
    ov.innerHTML = `<div class="result-card">${html}</div>`;
    ov.hidden = false;
  }
  function hideOverlay() { $('#overlay').hidden = true; }

  // ------------------------------------------------------------------
  // 棋譜：儲存 / 棋譜庫 / 匯入 / 匯出
  // ------------------------------------------------------------------
  function resultText() {
    if (state.result) {
      const w = state.result.winner;
      return w === 0 ? '和棋' : `${colorName(w)}勝（${state.result.reason}）`;
    }
    const last = state.moves[state.moves.length - 1];
    if (last && last.win) return `${colorName(last.player)}勝`;
    return '未完';
  }
  function defaultTitle() {
    const d = new Date();
    const ds = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    if (state.meta && state.meta.title) return state.meta.title;
    return `${playerInfoFor(state.mode, 1).name} vs ${playerInfoFor(state.mode, 2).name} · ${ds}`;
  }
  function makeRecord(title) {
    return {
      id: Date.now() + Math.floor(Math.random() * 1000),
      title,
      date: new Date().toISOString(),
      black: playerInfoFor(state.mode, 1).name,
      white: playerInfoFor(state.mode, 2).name,
      result: resultText(),
      moves: state.moves.map(m => posToCoord(m.pos)),
      comments: state.moves.map(m => m.comment || ''),
    };
  }

  function openModal(html) {
    $('#modal-box').innerHTML = html;
    $('#modal').hidden = false;
    const f = $('#modal-box input[type=text], #modal-box textarea');
    if (f) setTimeout(() => f.focus(), 30);
  }
  function closeModal() { $('#modal').hidden = true; }

  function openSave() {
    if (!state.moves.length) { toast('目前沒有棋步可儲存'); return; }
    openModal(`
      <h3>💾 儲存棋譜</h3>
      <label>棋譜名稱<input type="text" id="m-title" value="${esc(defaultTitle())}"></label>
      <div class="hint-text">共 ${state.moves.length} 手 · 結果：${esc(resultText())} · 註解會一併保存</div>
      <div class="modal-actions">
        <button class="btn" data-close>取消</button>
        <button class="btn primary" id="m-ok">儲存</button>
      </div>`);
    $('#m-ok').onclick = () => {
      const rec = makeRecord($('#m-title').value.trim() || defaultTitle());
      const lib = loadLS(LS_LIB, []);
      lib.unshift(rec);
      saveLS(LS_LIB, lib);
      state.meta = { title: rec.title, black: rec.black, white: rec.white };
      closeModal();
      render();
      toast('已儲存至棋譜庫');
    };
  }

  function openLibrary() {
    const lib = loadLS(LS_LIB, []).filter(r => r && Array.isArray(r.moves));
    const items = lib.length ? lib.map(r => `
      <div class="lib-item">
        <div class="meta">
          <div class="t">${esc(r.title)}</div>
          <div class="d">${esc(r.black)} vs ${esc(r.white)} · ${esc(r.result || '')} · ${r.moves.length} 手 · ${esc(new Date(r.date).toLocaleString())}</div>
        </div>
        <button class="btn primary" data-lib="load" data-id="${esc(r.id)}">載入</button>
        <button class="btn" data-lib="export" data-id="${esc(r.id)}">匯出</button>
        <button class="btn danger" data-lib="del" data-id="${esc(r.id)}">刪除</button>
      </div>`).join('') : '<div class="hint-text" style="text-align:center;padding:20px">棋譜庫是空的，下完一盤後按「儲存」即可收藏。</div>';
    openModal(`<h3>📚 棋譜庫（${lib.length}）</h3>${items}
      <div class="modal-actions">
        ${lib.length ? '<button class="btn" id="m-export-all">全部匯出</button>' : ''}
        <button class="btn" data-close>關閉</button>
      </div>`);
    const all = $('#m-export-all');
    if (all) all.onclick = () => download('gomoku-library.json', JSON.stringify(lib, null, 2));
  }

  function loadRecord(rec) {
    rec = normalizeRecord(rec);
    if (!rec) throw new Error('棋譜格式無效');
    const posList = rec.moves.map(m => typeof m === 'number' ? m : coordToPos(m));
    const b = new Int8Array(N * N);
    const moves = [];
    for (let i = 0; i < posList.length; i++) {
      const pos = posList[i];
      if (!Number.isInteger(pos) || pos < 0 || pos >= N * N || b[pos]) throw new Error(`第 ${i + 1} 手（${rec.moves[i]}）位置無效或重複`);
      const player = sideAt(i);
      b[pos] = player;
      const win = checkWin(b, pos);
      moves.push({ pos, player, comment: (rec.comments && rec.comments[i]) || '', win });
      if (win) break;
    }
    cancelAI(); stopAutoplay(); hideOverlay();
    state.mode = 'study';
    state.moves = moves;
    state.cursor = 0;
    state.result = null; state.hint = -1;
    state.meta = { title: rec.title || '匯入的棋譜', black: rec.black || '黑方', white: rec.white || '白方' };
    state.info = `已載入「${state.meta.title}」共 ${moves.length} 手 · 按 ⏯ 自動播放或用 ← → 逐手瀏覽`;
    render();
  }

  const MAX_IMPORT_BYTES = 1024 * 1024;
  function parseRecordText(text) {
    text = String(text || '').trim();
    if (!text) throw new Error('內容是空的');
    if (text.length > MAX_IMPORT_BYTES) throw new Error('棋譜內容過大（上限 1 MB）');
    if (text[0] === '{' || text[0] === '[') {
      const obj = JSON.parse(text);
      const list = Array.isArray(obj) ? obj : [obj];
      const valid = list.map(normalizeRecord).filter(Boolean);
      if (!valid.length) throw new Error('JSON 中找不到 moves 欄位');
      return valid;
    }
    const tokens = text.match(/[a-oA-O](?:1[0-5]|[1-9])(?![0-9])/g) || [];
    if (!tokens.length) throw new Error('找不到任何棋步（格式例：H8 I9 J10 …）');
    return [normalizeRecord({ title: '匯入的棋譜', moves: tokens.map(t => t.toUpperCase()) })];
  }

  // 將不可信的外部棋譜正規化：只保留已知欄位、強制型別與長度，並一律重新產生 id
  let idSeq = 0;
  function normalizeRecord(r) {
    if (!r || typeof r !== 'object' || !Array.isArray(r.moves)) return null;
    const str = (v, d, max) => (v == null || v === '' ? d : String(v)).slice(0, max || 200);
    const t = Date.parse(r.date);
    return {
      id: Date.now() * 1000 + (idSeq++ % 1000),
      title: str(r.title, '匯入的棋譜'),
      date: isNaN(t) ? new Date().toISOString() : new Date(t).toISOString(),
      black: str(r.black, '黑方'),
      white: str(r.white, '白方'),
      result: str(r.result, ''),
      moves: r.moves.slice(0, N * N).map(m => (typeof m === 'number' ? m : String(m).slice(0, 4))),
      comments: Array.isArray(r.comments) ? r.comments.slice(0, N * N).map(c => (c == null ? '' : String(c).slice(0, 2000))) : [],
    };
  }

  function openImport() {
    openModal(`
      <h3>📥 匯入棋譜</h3>
      <label>貼上棋譜（支援本系統 JSON 或座標文字，例如 <code>H8 I9 J10 H9</code> 或 <code>1.H8 2.I9</code>）
        <textarea id="m-text" placeholder="H8 I9 I8 J8 ..."></textarea></label>
      <label>或選擇檔案 <input type="file" id="m-file" accept=".json,.txt"></label>
      <div class="hint-text">座標：橫向 A–O（左到右），縱向 1–15（下到上），黑棋先行。匯入 JSON 陣列時會全部加入棋譜庫。</div>
      <div class="modal-actions">
        <button class="btn" data-close>取消</button>
        <button class="btn primary" id="m-ok">匯入並打譜</button>
      </div>`);
    $('#m-file').onchange = e => {
      const f = e.target.files[0];
      if (!f) return;
      if (f.size > MAX_IMPORT_BYTES) { toast('檔案過大（上限 1 MB）'); e.target.value = ''; return; }
      const rd = new FileReader();
      rd.onload = () => { $('#m-text').value = rd.result; };
      rd.readAsText(f, 'utf-8');
    };
    $('#m-ok').onclick = () => {
      try {
        const recs = parseRecordText($('#m-text').value);
        if (recs.length > 1) {
          const lib = loadLS(LS_LIB, []);
          recs.forEach(r => lib.unshift(r));
          saveLS(LS_LIB, lib);
          toast(`已將 ${recs.length} 份棋譜加入棋譜庫`);
        }
        loadRecord(recs[0]);
        closeModal();
      } catch (err) {
        toast('匯入失敗：' + err.message);
      }
    };
  }

  function download(name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
    a.download = String(name || 'gomoku.json').replace(/[\x00-\x1f\x7f\\/:*?"<>|]/g, '_').slice(0, 120);
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function exportCurrent() {
    if (!state.moves.length) { toast('目前沒有棋步可匯出'); return; }
    const rec = makeRecord(defaultTitle());
    download(rec.title + '.json', JSON.stringify(rec, null, 2));
  }
  async function copyRecord() {
    if (!state.moves.length) { toast('目前沒有棋步可複製'); return; }
    const text = state.moves.map((m, i) => `${i + 1}.${posToCoord(m.pos)}`).join(' ');
    try { await navigator.clipboard.writeText(text); }
    catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove();
    }
    toast('已複製文字棋譜，可貼到「匯入」還原');
  }

  // ------------------------------------------------------------------
  // 音效 / 提示訊息
  // ------------------------------------------------------------------
  let audioCtx = null;
  function playClick() {
    if (!prefs.sound) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const t = audioCtx.currentTime;
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(820, t);
      o.frequency.exponentialRampToValueAtTime(180, t + 0.07);
      g.gain.setValueAtTime(0.25, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
      o.connect(g).connect(audioCtx.destination);
      o.start(t); o.stop(t + 0.12);
    } catch (e) { /* ignore */ }
  }
  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  // ------------------------------------------------------------------
  // 事件綁定
  // ------------------------------------------------------------------
  function bind() {
    canvas.addEventListener('click', onBoardClick);
    canvas.addEventListener('mousemove', e => {
      const p = eventToPos(e);
      if (p !== state.hover) { state.hover = p; draw(); }
    });
    canvas.addEventListener('mouseleave', () => { state.hover = -1; draw(); });
    new ResizeObserver(() => draw()).observe(canvas);

    $$('.tab').forEach(t => t.addEventListener('click', () => setMode(t.dataset.mode)));

    $('#ai-list').addEventListener('click', e => {
      const card = e.target.closest('.ai-card');
      if (!card) return;
      prefs.aiIndex = +card.dataset.ai;
      savePrefs();
      if (!state.moves.length || state.result) newGame();
      else { renderAIList(); toast(`已選擇 ${AIS[prefs.aiIndex].name}，按「新局」開始對弈`); }
    });
    $$('input[name=color]').forEach(r => {
      r.checked = +r.value === prefs.colorChoice;
      r.addEventListener('change', () => {
        prefs.colorChoice = +r.value;
        savePrefs();
        if (!state.moves.length || state.result) newGame();
        else toast('執子顏色將於下一局生效');
      });
    });

    $('#btn-new').onclick = () => {
      if (state.mode === 'study') {
        cancelAI(); stopAutoplay();
        state.moves = []; state.cursor = 0; state.meta = null; state.hint = -1; state.info = '打譜模式：雙方輪流自由落子';
        render();
      } else newGame();
    };
    $('#btn-undo').onclick = undo;
    $('#btn-hint').onclick = requestHint;
    $('#btn-resign').onclick = resign;
    $('#btn-takeover').onclick = takeover;

    $('#nav-first').onclick = () => { stopAutoplay(); goto(0); };
    $('#nav-prev').onclick = () => { stopAutoplay(); goto(state.cursor - 1); };
    $('#nav-next').onclick = () => { stopAutoplay(); goto(state.cursor + 1); };
    $('#nav-last').onclick = () => { stopAutoplay(); goto(state.moves.length); };
    $('#nav-play').onclick = toggleAutoplay;
    $('#speed').value = String(prefs.speed);
    $('#speed').onchange = e => {
      prefs.speed = +e.target.value; savePrefs();
      if (state.autoplay) { stopAutoplay(); toggleAutoplay(); }
    };
    $('#toggle-num').checked = prefs.showNumbers;
    $('#toggle-num').onchange = e => { prefs.showNumbers = e.target.checked; savePrefs(); draw(); };
    $('#toggle-sound').checked = prefs.sound;
    $('#toggle-sound').onchange = e => { prefs.sound = e.target.checked; savePrefs(); };

    $('#move-list').addEventListener('click', e => {
      const mv = e.target.closest('.mv');
      if (mv) { stopAutoplay(); goto(+mv.dataset.i + 1); }
    });
    $('#comment').addEventListener('input', e => {
      if (state.cursor > 0) { state.moves[state.cursor - 1].comment = e.target.value; renderMoveList(); }
    });

    $('#btn-save').onclick = openSave;
    $('#btn-library').onclick = openLibrary;
    $('#btn-import').onclick = openImport;
    $('#btn-export').onclick = exportCurrent;
    $('#btn-copy').onclick = copyRecord;

    $('#modal').addEventListener('click', e => {
      if (e.target.id === 'modal' || e.target.hasAttribute('data-close')) { closeModal(); return; }
      const btn = e.target.closest('[data-lib]');
      if (!btn) return;
      const lib = loadLS(LS_LIB, []);
      const rec = lib.find(r => String(r.id) === btn.dataset.id);
      if (!rec) return;
      const act = btn.dataset.lib;
      if (act === 'load') {
        try { loadRecord(rec); closeModal(); } catch (err) { toast('載入失敗：' + err.message); }
      } else if (act === 'export') {
        download(rec.title + '.json', JSON.stringify(rec, null, 2));
      } else if (act === 'del') {
        if (confirm(`確定刪除「${rec.title}」？`)) {
          saveLS(LS_LIB, lib.filter(r => r !== rec));
          openLibrary();
        }
      }
    });

    $('#overlay').addEventListener('click', e => {
      const act = e.target.dataset && e.target.dataset.act;
      if (!act) return;
      if (act === 'again') newGame();
      else if (act === 'study') { hideOverlay(); setMode('study'); }
      else if (act === 'save') { hideOverlay(); openSave(); }
      else hideOverlay();
    });

    document.addEventListener('keydown', e => {
      if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
      if (!$('#modal').hidden) { if (e.key === 'Escape') closeModal(); return; }
      if (e.key === 'ArrowLeft') { stopAutoplay(); goto(state.cursor - 1); }
      else if (e.key === 'ArrowRight') { stopAutoplay(); goto(state.cursor + 1); }
      else if (e.key === 'Home') { stopAutoplay(); goto(0); }
      else if (e.key === 'End') { stopAutoplay(); goto(state.moves.length); }
      else if (e.key === ' ') { e.preventDefault(); toggleAutoplay(); }
      else return;
      e.preventDefault();
    });
  }

  // ------------------------------------------------------------------
  Engine.init();
  bind();
  newGame();
})();
