(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // Identite persistante du joueur (survit aux rechargements de page)
  // ---------------------------------------------------------------------
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'p-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function storage() {
    try {
      window.localStorage.setItem('__ta_test__', '1');
      window.localStorage.removeItem('__ta_test__');
      return window.localStorage;
    } catch (e) {
      return null;
    }
  }
  const store = storage();
  const memoryStore = {};

  function getItem(key) {
    if (store) return store.getItem(key);
    return memoryStore[key] || null;
  }
  function setItem(key, val) {
    if (store) store.setItem(key, val);
    else memoryStore[key] = val;
  }
  function removeItem(key) {
    if (store) store.removeItem(key);
    else delete memoryStore[key];
  }

  let playerId = getItem('ta_playerId');
  if (!playerId) {
    playerId = uuid();
    setItem('ta_playerId', playerId);
  }

  // ---------------------------------------------------------------------
  // Elements
  // ---------------------------------------------------------------------
  const screens = {
    landing: document.getElementById('screen-landing'),
    lobby: document.getElementById('screen-lobby'),
    game: document.getElementById('screen-game'),
  };
  function showScreen(name) {
    Object.entries(screens).forEach(([key, el]) => el.classList.toggle('active', key === name));
  }

  const els = {
    tabBtns: document.querySelectorAll('.tab-btn'),
    tabPanels: document.querySelectorAll('.tab-panel'),
    createName: document.getElementById('create-name'),
    btnCreate: document.getElementById('btn-create'),
    joinCode: document.getElementById('join-code'),
    joinName: document.getElementById('join-name'),
    btnJoin: document.getElementById('btn-join'),
    landingError: document.getElementById('landing-error'),

    lobbyCode: document.getElementById('lobby-code'),
    lobbyPlayers: document.getElementById('lobby-players'),
    lobbyMsg: document.getElementById('lobby-msg'),
    btnStart: document.getElementById('btn-start'),
    btnLeave: document.getElementById('btn-leave'),
    btnCopyLink: document.getElementById('btn-copy-link'),
    lobbyError: document.getElementById('lobby-error'),

    gameCode: document.getElementById('game-code'),
    roundTag: document.getElementById('round-tag'),
    playersPanel: document.getElementById('players-panel'),
    trickArea: document.getElementById('trick-area'),
    biddingArea: document.getElementById('bidding-area'),
    biddingPrompt: document.getElementById('bidding-prompt'),
    biddingChoices: document.getElementById('bidding-choices'),
    frontArea: document.getElementById('front-area'),
    frontOthers: document.getElementById('front-others'),
    roundResultArea: document.getElementById('round-result-area'),
    roundResultTable: document.getElementById('round-result-table'),
    btnNextRound: document.getElementById('btn-next-round'),
    roundResultWait: document.getElementById('round-result-wait'),
    gameOverArea: document.getElementById('game-over-area'),
    gameOverTable: document.getElementById('game-over-table'),
    handArea: document.getElementById('hand-area'),
    logPanel: document.getElementById('log-panel'),
    logList: document.getElementById('log-list'),
    btnToggleLog: document.getElementById('btn-toggle-log'),
    toast: document.getElementById('toast'),
  };

  function showError(el, message) {
    if (!message) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.hidden = false;
    el.textContent = message;
  }

  let toastTimer = null;
  function toast(message) {
    els.toast.textContent = message;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.hidden = true;
    }, 3200);
  }

  // ---------------------------------------------------------------------
  // Tabs (landing)
  // ---------------------------------------------------------------------
  els.tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      els.tabBtns.forEach((b) => b.classList.toggle('active', b === btn));
      els.tabPanels.forEach((p) => p.classList.toggle('active', p.id === 'tab-' + btn.dataset.tab));
      showError(els.landingError, '');
    });
  });

  // ---------------------------------------------------------------------
  // Socket.io
  // ---------------------------------------------------------------------
  const socket = io();
  let currentRoomCode = getItem('ta_roomCode');
  let latestState = null;

  socket.on('connect', () => {
    const savedCode = getItem('ta_roomCode');
    if (savedCode) {
      socket.emit('rejoin', { code: savedCode, playerId }, (res) => {
        if (!res || !res.ok) {
          removeItem('ta_roomCode');
          showScreen('landing');
        }
      });
    }
  });

  socket.on('state', (state) => {
    latestState = state;
    currentRoomCode = state.code;
    setItem('ta_roomCode', state.code);
    render(state);
  });

  // ---------------------------------------------------------------------
  // Actions landing / lobby
  // ---------------------------------------------------------------------
  els.btnCreate.addEventListener('click', () => {
    const name = els.createName.value.trim();
    if (!name) return showError(els.landingError, 'Choisis un prenom.');
    showError(els.landingError, '');
    socket.emit('create_room', { name, playerId }, (res) => {
      if (!res.ok) return showError(els.landingError, res.error);
    });
  });

  els.btnJoin.addEventListener('click', () => {
    const code = els.joinCode.value.trim().toUpperCase();
    const name = els.joinName.value.trim();
    if (!code) return showError(els.landingError, 'Entre le code de la salle.');
    if (!name) return showError(els.landingError, 'Choisis un prenom.');
    showError(els.landingError, '');
    socket.emit('join_room', { code, name, playerId }, (res) => {
      if (!res.ok) return showError(els.landingError, res.error);
    });
  });

  els.btnStart.addEventListener('click', () => {
    socket.emit('start_game', {}, (res) => {
      if (!res.ok) showError(els.lobbyError, res.error);
    });
  });

  els.btnLeave.addEventListener('click', () => {
    socket.emit('leave_room', {}, () => {
      removeItem('ta_roomCode');
      latestState = null;
      showScreen('landing');
    });
  });

  els.btnCopyLink.addEventListener('click', async () => {
    const url = location.origin + '/?code=' + (currentRoomCode || '');
    try {
      await navigator.clipboard.writeText(url);
      toast('Lien copie !');
    } catch (e) {
      toast(url);
    }
  });

  els.btnNextRound.addEventListener('click', () => {
    socket.emit('next_round', {}, (res) => {
      if (!res.ok) toast(res.error);
    });
  });

  els.btnToggleLog.addEventListener('click', () => {
    els.logPanel.hidden = !els.logPanel.hidden;
  });

  // Pre-remplissage du code de salle depuis l'URL ( ?code=XXXX )
  (function prefillFromUrl() {
    const params = new URLSearchParams(location.search);
    const code = params.get('code');
    if (code) {
      els.tabBtns.forEach((b) => b.classList.toggle('active', b.dataset.tab === 'join'));
      els.tabPanels.forEach((p) => p.classList.toggle('active', p.id === 'tab-join'));
      els.joinCode.value = code.toUpperCase();
      els.joinName.focus();
    }
  })();

  // ---------------------------------------------------------------------
  // Rendu
  // ---------------------------------------------------------------------
  function cardLabel(card) {
    if (!card) return '';
    if (card.type === 'excuse') return 'Excuse';
    return String(card.value);
  }

  function cardEl(card, opts) {
    opts = opts || {};
    const div = document.createElement('div');
    div.className = opts.className || 'playing-card';
    if (card.hidden) {
      div.classList.add('hidden-card');
      div.textContent = '?';
      return div;
    }
    if (card.type === 'excuse') {
      div.classList.add('excuse');
      div.textContent = opts.declaration === 'mini' ? 'Excuse (mini)' : 'Excuse';
    } else {
      div.textContent = String(card.value);
    }
    return div;
  }

  function playerName(state, id) {
    const p = state.players.find((pl) => pl.id === id);
    return p ? p.name : '?';
  }

  function render(state) {
    if (state.phase === 'lobby') {
      renderLobby(state);
      showScreen('lobby');
      return;
    }
    showScreen('game');
    renderGame(state);
  }

  function renderLobby(state) {
    els.lobbyCode.textContent = state.code;
    els.lobbyPlayers.innerHTML = '';
    state.players.forEach((p) => {
      const li = document.createElement('li');
      const left = document.createElement('span');
      left.textContent = p.name;
      if (p.isHost) {
        const tag = document.createElement('span');
        tag.className = 'tag-host';
        tag.textContent = 'HOTE';
        left.appendChild(tag);
      }
      li.appendChild(left);
      const right = document.createElement('span');
      right.className = 'tag-off';
      right.textContent = p.connected ? '' : 'deconnecte';
      li.appendChild(right);
      els.lobbyPlayers.appendChild(li);
    });

    const isHost = state.hostId === playerId;
    const canStart = isHost && state.players.length >= state.minPlayers;
    els.btnStart.hidden = !isHost;
    els.btnStart.disabled = !canStart;
    if (isHost) {
      els.lobbyMsg.textContent =
        state.players.length < state.minPlayers
          ? `Il faut au moins ${state.minPlayers} joueurs pour lancer la partie.`
          : 'Tu peux lancer la partie quand tu veux (max 4 joueurs).';
    } else {
      els.lobbyMsg.textContent = "En attente que l'hote lance la partie...";
    }
  }

  function renderGame(state) {
    els.gameCode.textContent = state.code;
    const roundNum = state.roundIndex + 1;
    els.roundTag.textContent = `Manche ${roundNum}/5 - cycle ${state.cycle} - ${state.roundSize} carte(s)${
      state.isFrontRound ? ' (au front)' : ''
    }`;

    renderPlayersPanel(state);
    renderTrick(state);
    renderLog(state);

    els.biddingArea.hidden = true;
    els.frontArea.hidden = true;
    els.roundResultArea.hidden = true;
    els.gameOverArea.hidden = true;
    els.handArea.innerHTML = '';

    if (state.isFrontRound && (state.phase === 'bidding' || state.phase === 'playing')) {
      renderFrontOthers(state);
    }

    if (state.phase === 'bidding') {
      renderBidding(state);
    } else if (state.phase === 'playing') {
      renderHand(state);
    } else if (state.phase === 'round_result') {
      renderRoundResult(state);
    } else if (state.phase === 'game_over') {
      renderGameOver(state);
    }
  }

  function renderPlayersPanel(state) {
    els.playersPanel.innerHTML = '';
    state.players.forEach((p) => {
      const chip = document.createElement('div');
      chip.className = 'player-chip';
      if (p.id === state.turnId) chip.classList.add('is-turn');
      if (!p.connected) chip.classList.add('disconnected');

      const row = document.createElement('div');
      row.className = 'name-row';
      const nameSpan = document.createElement('span');
      nameSpan.textContent = p.name + (p.id === playerId ? ' (toi)' : '') + (p.id === state.dealerId ? ' - D' : '');
      const lives = document.createElement('span');
      lives.className = 'lives';
      lives.textContent = '♥ ' + p.lives;
      row.appendChild(nameSpan);
      row.appendChild(lives);
      chip.appendChild(row);

      const meta = document.createElement('div');
      meta.className = 'meta';
      const bits = [];
      if (state.phase !== 'lobby') {
        if (p.bid !== null && p.bid !== undefined) bits.push('annonce ' + p.bid);
        if (state.phase === 'playing' || state.phase === 'round_result') bits.push('plis ' + p.tricksWon);
        if (state.phase === 'bidding' && p.hasBid) bits.push('a annonce');
      }
      meta.textContent = bits.join(' - ');
      chip.appendChild(meta);

      els.playersPanel.appendChild(chip);
    });
  }

  function renderTrick(state) {
    els.trickArea.innerHTML = '';
    if (!state.currentTrick || state.currentTrick.length === 0) {
      if (state.phase === 'playing' || state.phase === 'bidding') {
        const p = document.createElement('p');
        p.className = 'hint';
        p.textContent = state.phase === 'bidding' ? "Phase d'annonces." : 'Pli en cours...';
        els.trickArea.appendChild(p);
      }
      return;
    }
    state.currentTrick.forEach((played) => {
      const wrap = document.createElement('div');
      wrap.className = 'trick-card-wrap';
      const who = document.createElement('div');
      who.className = 'who';
      who.textContent = playerName(state, played.playerId);
      wrap.appendChild(who);
      wrap.appendChild(cardEl(played.card, { declaration: played.declaration }));
      els.trickArea.appendChild(wrap);
    });
  }

  function renderFrontOthers(state) {
    els.frontArea.hidden = false;
    els.frontOthers.innerHTML = '';
    (state.frontOthers || []).forEach((entry) => {
      const wrap = document.createElement('div');
      wrap.className = 'front-other';
      const name = document.createElement('span');
      name.textContent = playerName(state, entry.playerId);
      wrap.appendChild(name);
      if (entry.card) {
        wrap.appendChild(cardEl(entry.card));
      } else {
        const dash = document.createElement('span');
        dash.textContent = '-';
        wrap.appendChild(dash);
      }
      els.frontOthers.appendChild(wrap);
    });
  }

  function renderBidding(state) {
    els.biddingArea.hidden = false;
    const myTurn = state.turnId === playerId;
    els.biddingPrompt.textContent = myTurn
      ? 'Combien de plis penses-tu remporter ?'
      : `En attente de l'annonce de ${playerName(state, state.turnId)}...`;
    els.biddingChoices.innerHTML = '';
    if (myTurn && state.bidAllowedValues) {
      state.bidAllowedValues.forEach((v) => {
        const btn = document.createElement('button');
        btn.className = 'chip-btn';
        btn.textContent = String(v);
        btn.addEventListener('click', () => {
          socket.emit('place_bid', { value: v }, (res) => {
            if (!res.ok) toast(res.error);
          });
        });
        els.biddingChoices.appendChild(btn);
      });
    }
  }

  let pendingExcuseCardId = null;

  function renderHand(state) {
    (state.yourHand || []).forEach((card) => {
      const el = document.createElement('div');
      el.className = 'hand-card';
      if (card.hidden) {
        el.classList.add('hidden-card');
        el.textContent = '?';
      } else if (card.type === 'excuse') {
        el.classList.add('excuse');
        el.textContent = 'Excuse';
      } else {
        el.textContent = String(card.value);
      }

      const legal = state.legalPlays && state.legalPlays.includes(card.id);
      const myTurn = state.turnId === playerId;
      if (myTurn && legal) {
        el.classList.add('playable');
        el.addEventListener('click', () => onCardClick(state, card));
      } else {
        el.classList.add('disabled');
      }
      els.handArea.appendChild(el);
    });
  }

  function onCardClick(state, card) {
    if (card.type === 'excuse' && state.canPlayExcuseFree) {
      openExcuseModal(card.id);
      return;
    }
    socket.emit('play_card', { cardId: card.id }, (res) => {
      if (!res.ok) toast(res.error);
    });
  }

  function openExcuseModal(cardId) {
    pendingExcuseCardId = cardId;
    const backdrop = document.createElement('div');
    backdrop.className = 'excuse-modal-backdrop';
    const modal = document.createElement('div');
    modal.className = 'excuse-modal';
    modal.innerHTML =
      '<h3>Tu entames avec l\'Excuse</h3>' +
      '<p class="hint">Elle vaut la carte la plus forte (maxi, tu remportes le pli) ou la plus faible (mini, tu la sacrifies sans risque).</p>';
    const row = document.createElement('div');
    row.className = 'chip-row';
    const btnMaxi = document.createElement('button');
    btnMaxi.className = 'chip-btn';
    btnMaxi.textContent = 'Maxi (forte)';
    btnMaxi.addEventListener('click', () => {
      document.body.removeChild(backdrop);
      socket.emit('play_card', { cardId, declaration: 'maxi' }, (res) => {
        if (!res.ok) toast(res.error);
      });
    });
    const btnMini = document.createElement('button');
    btnMini.className = 'chip-btn';
    btnMini.textContent = 'Mini (faible)';
    btnMini.addEventListener('click', () => {
      document.body.removeChild(backdrop);
      socket.emit('play_card', { cardId, declaration: 'mini' }, (res) => {
        if (!res.ok) toast(res.error);
      });
    });
    row.appendChild(btnMaxi);
    row.appendChild(btnMini);
    modal.appendChild(row);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
  }

  function renderRoundResult(state) {
    els.roundResultArea.hidden = false;
    const r = state.lastRoundResult;
    const table = els.roundResultTable;
    table.innerHTML = '';
    const thead = document.createElement('tr');
    ['Joueur', 'Annonce', 'Plis', 'Ecart', 'Vies'].forEach((h) => {
      const th = document.createElement('th');
      th.textContent = h;
      thead.appendChild(th);
    });
    table.appendChild(thead);
    state.players.forEach((p) => {
      const res = r && r.results ? r.results[p.id] : null;
      if (!res) return;
      const tr = document.createElement('tr');
      [p.name, res.bid, res.won, res.diff, res.livesAfter].forEach((val) => {
        const td = document.createElement('td');
        td.textContent = String(val);
        tr.appendChild(td);
      });
      table.appendChild(tr);
    });
    const isHost = state.hostId === playerId;
    els.btnNextRound.hidden = !isHost;
    els.roundResultWait.hidden = isHost;
  }

  function renderGameOver(state) {
    els.gameOverArea.hidden = false;
    const r = state.gameOverResult;
    const table = els.gameOverTable;
    table.innerHTML = '';
    const thead = document.createElement('tr');
    ['Classement', 'Joueur', 'Vies restantes'].forEach((h) => {
      const th = document.createElement('th');
      th.textContent = h;
      thead.appendChild(th);
    });
    table.appendChild(thead);
    (r.standings || []).forEach((s, idx) => {
      const tr = document.createElement('tr');
      const rankTxt = s.eliminated ? 'Elimine' : String(idx + 1);
      [rankTxt, s.name, s.lives].forEach((val) => {
        const td = document.createElement('td');
        td.textContent = String(val);
        tr.appendChild(td);
      });
      table.appendChild(tr);
    });
  }

  function renderLog(state) {
    els.logList.innerHTML = '';
    (state.log || []).forEach((entry) => {
      const li = document.createElement('li');
      li.textContent = entry.message;
      els.logList.appendChild(li);
    });
  }

  showScreen('landing');
})();
