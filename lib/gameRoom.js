'use strict';

/**
 * Tarot Africain (alias "Poulpe", "Ascenseur", "Whist 22").
 *
 * Regles retenues (confirmees avec l'utilisateur) :
 * - 2 a 4 joueurs.
 * - 22 cartes : les atouts 1 a 21 + l'Excuse.
 * - Un "cycle" = 5 manches, avec un nombre de cartes decroissant :
 *   5, 4, 3, 2, 1 (la manche a 1 carte se joue "au front" : chaque
 *   joueur voit la carte de tout le monde sauf la sienne).
 * - Avant chaque manche, chaque joueur annonce (dans l'ordre, a partir
 *   du joueur a gauche du donneur, le donneur annoncant en dernier) le
 *   nombre de plis qu'il pense remporter. Le total des annonces ne doit
 *   pas etre egal au nombre de cartes de la manche : le dernier
 *   annonceur (le donneur) n'a pas le droit de choisir la valeur qui
 *   rendrait le total exact. Le donneur (et donc le premier a annoncer)
 *   est le meme sur les 5 manches d'un cycle ; il ne change qu'au debut
 *   du cycle suivant, ou il passe au joueur suivant.
 * - A chaque pli, un joueur peut jouer n'importe quelle carte de sa main,
 *   sans obligation de monter (pas d'obligation de jouer plus fort que la
 *   meilleure carte du pli en cours).
 * - L'Excuse vaut, au choix du joueur qui la joue (a tout moment, meme en
 *   cours de pli), soit la plus forte carte (22, "maxi"), soit la plus
 *   faible (0, "mini").
 * - A la fin d'une manche, un joueur qui n'a pas realise exactement son
 *   contrat perd un nombre de vies egal a l'ecart absolu entre son
 *   annonce et ses plis reels. Les vies sont representees par les 14
 *   cartes d'une couleur de tarot (Roi, Dame, Cavalier, Valet, 10 a 2,
 *   As) : chaque joueur commence avec 14 vies (le Roi).
 * - Des qu'un joueur tombe a 0 vie ou moins, la partie s'arrete
 *   immediatement (c'est le "premier perdant") ; les autres joueurs
 *   sont classes par vies restantes.
 * - Si personne n'est elimine a la fin d'un cycle de 5 manches, on
 *   relance un nouveau cycle (nouvelle donne complete), le donneur
 *   passant au joueur suivant.
 *
 * Choix d'implementation non specifies par les sources (tranches pour
 * garder une regle simple et coherente) : un jeu de 22 cartes neuf est
 * rebattu a chaque manche (les cartes non distribuees sont simplement
 * ecartees).
 */

const ROUND_SIZES = [5, 4, 3, 2, 1];
const FRONT_ROUND_INDEX = ROUND_SIZES.length - 1; // manche "au front"
const STARTING_LIVES = 14;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 4;

function buildDeck() {
  const deck = [];
  for (let v = 1; v <= 21; v++) {
    deck.push({ id: 'c' + v, type: 'number', value: v });
  }
  deck.push({ id: 'excuse', type: 'excuse', value: null });
  return deck;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function effectiveValue(card, declaration) {
  if (card.type === 'excuse') {
    return declaration === 'mini' ? 0 : 22;
  }
  return card.value;
}

class GameRoom {
  constructor(code) {
    this.code = code;
    this.createdAt = Date.now();
    /** @type {Array<{id:string,name:string,socketId:?string,connected:boolean,lives:number}>} */
    this.players = [];
    this.hostId = null;
    this.phase = 'lobby'; // lobby | bidding | playing | round_result | game_over
    this.cycle = 1;
    this.roundIndex = 0;
    this.dealerIndex = 0;

    this.hands = {}; // playerId -> [card,...]
    this.biddingOrder = [];
    this.bidTurnPos = 0;
    this.bids = {}; // playerId -> number
    this.tricksWon = {}; // playerId -> number
    this.currentTrick = { cards: [], leaderId: null };
    this.turnId = null;
    this.lastRoundResult = null;
    this.gameOverResult = null;
    this.log = [];
    // Quand un pli vient de se terminer, on le laisse affiche (avec son
    // vainqueur) le temps que tout le monde le voie, avant d'enchainer sur
    // le pli ou la manche suivante (voir playCard / finishTrick).
    this.awaitingTrickAck = false;
    this.pendingTrickWinnerId = null;
  }

  get roundSize() {
    return ROUND_SIZES[this.roundIndex];
  }

  get isFrontRound() {
    return this.roundIndex === FRONT_ROUND_INDEX;
  }

  get playerCount() {
    return this.players.length;
  }

  findPlayer(id) {
    return this.players.find((p) => p.id === id) || null;
  }

  seatIndex(id) {
    return this.players.findIndex((p) => p.id === id);
  }

  pushLog(message) {
    this.log.push({ t: Date.now(), message });
    if (this.log.length > 80) this.log.shift();
  }

  // ---- Lobby ----------------------------------------------------------

  addPlayer(id, name) {
    if (this.findPlayer(id)) {
      return { ok: true }; // deja present (reconnexion avant que la salle ne redemarre)
    }
    if (this.phase !== 'lobby') {
      return { ok: false, error: 'La partie a deja commence.' };
    }
    if (this.players.length >= MAX_PLAYERS) {
      return { ok: false, error: 'La salle est pleine (4 joueurs max).' };
    }
    const trimmed = (name || '').trim().slice(0, 20) || 'Joueur';
    if (this.players.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) {
      return { ok: false, error: 'Ce nom est deja pris dans la salle.' };
    }
    this.players.push({
      id,
      name: trimmed,
      socketId: null,
      connected: true,
      lives: STARTING_LIVES,
    });
    if (!this.hostId) this.hostId = id;
    this.pushLog(`${trimmed} a rejoint la salle.`);
    return { ok: true };
  }

  removePlayer(id) {
    if (this.phase !== 'lobby') return { ok: false, error: 'Impossible de quitter une partie en cours.' };
    const p = this.findPlayer(id);
    if (!p) return { ok: false, error: 'Joueur introuvable.' };
    this.players = this.players.filter((pl) => pl.id !== id);
    if (this.hostId === id) {
      this.hostId = this.players.length ? this.players[0].id : null;
    }
    this.pushLog(`${p.name} a quitte la salle.`);
    return { ok: true };
  }

  markConnected(id, socketId, connected) {
    const p = this.findPlayer(id);
    if (!p) return;
    p.socketId = connected ? socketId : null;
    p.connected = connected;
  }

  isEmpty() {
    return this.players.every((p) => !p.connected);
  }

  // ---- Deroulement de partie -------------------------------------------

  startGame(requesterId) {
    if (this.phase !== 'lobby') return { ok: false, error: 'La partie a deja commence.' };
    if (requesterId !== this.hostId) return { ok: false, error: "Seul l'hote peut lancer la partie." };
    if (this.players.length < MIN_PLAYERS) {
      return { ok: false, error: `Il faut au moins ${MIN_PLAYERS} joueurs.` };
    }
    this.cycle = 1;
    this.roundIndex = 0;
    // Le donneur est place juste avant le premier joueur (siege 0), pour
    // que ce soit toujours ce premier joueur qui annonce en premier lors
    // du premier cycle (le donneur annonce toujours en dernier).
    this.dealerIndex = this.playerCount - 1;
    this.players.forEach((p) => (p.lives = STARTING_LIVES));
    this._startRound();
    return { ok: true };
  }

  _startRound() {
    const n = this.playerCount;
    const size = this.roundSize;
    const deck = shuffle(buildDeck());
    this.hands = {};
    this.players.forEach((p, idx) => {
      this.hands[p.id] = deck.slice(idx * size, idx * size + size);
    });

    this.biddingOrder = [];
    for (let i = 1; i <= n; i++) {
      this.biddingOrder.push(this.players[(this.dealerIndex + i) % n].id);
    }
    this.bidTurnPos = 0;
    this.bids = {};
    this.tricksWon = {};
    this.players.forEach((p) => (this.tricksWon[p.id] = 0));
    this.currentTrick = { cards: [], leaderId: this.biddingOrder[0] };
    this.turnId = this.biddingOrder[0];
    this.lastRoundResult = null;
    this.phase = 'bidding';

    this.pushLog(
      `Manche ${this.roundIndex + 1}/5 (cycle ${this.cycle}) : ${size} carte(s)${
        this.isFrontRound ? ' - au front' : ''
      }. Donneur : ${this.players[this.dealerIndex].name}.`,
    );
  }

  bidAllowedValues(playerId) {
    const size = this.roundSize;
    const values = [];
    const isLast = this.biddingOrder[this.biddingOrder.length - 1] === playerId;
    const sumSoFar = Object.values(this.bids).reduce((a, b) => a + b, 0);
    for (let v = 0; v <= size; v++) {
      if (isLast && sumSoFar + v === size) continue;
      values.push(v);
    }
    return values;
  }

  placeBid(playerId, value) {
    if (this.phase !== 'bidding') return { ok: false, error: "Ce n'est pas la phase d'annonces." };
    if (this.turnId !== playerId) return { ok: false, error: "Ce n'est pas ton tour d'annoncer." };
    const allowed = this.bidAllowedValues(playerId);
    if (!allowed.includes(value)) {
      return { ok: false, error: 'Annonce invalide.' };
    }
    this.bids[playerId] = value;
    this.pushLog(`${this.findPlayer(playerId).name} annonce ${value}.`);
    this.bidTurnPos += 1;
    if (this.bidTurnPos >= this.biddingOrder.length) {
      this.phase = 'playing';
      this.turnId = this.currentTrick.leaderId;
    } else {
      this.turnId = this.biddingOrder[this.bidTurnPos];
    }
    return { ok: true };
  }

  // ---- Plis --------------------------------------------------------------

  legalPlays(playerId) {
    const hand = this.hands[playerId] || [];
    if (this.phase !== 'playing' || this.turnId !== playerId) return [];
    // Pas d'obligation de monter : n'importe quelle carte de la main est
    // jouable, a tout moment. L'Excuse est toujours jouable en "maxi" ou
    // "mini", au choix du joueur qui la joue.
    return hand.map((c) => ({ cardId: c.id, freeDeclaration: c.type === 'excuse' }));
  }

  playCard(playerId, cardId, declaration) {
    if (this.phase !== 'playing') return { ok: false, error: "Ce n'est pas la phase de jeu." };
    if (this.turnId !== playerId) return { ok: false, error: "Ce n'est pas ton tour de jouer." };
    const legal = this.legalPlays(playerId);
    const choice = legal.find((c) => c.cardId === cardId);
    if (!choice) return { ok: false, error: 'Carte non jouable.' };

    const hand = this.hands[playerId];
    const cardIdx = hand.findIndex((c) => c.id === cardId);
    const card = hand[cardIdx];

    let decl = null;
    if (card.type === 'excuse') {
      decl = declaration === 'mini' ? 'mini' : 'maxi';
    }
    hand.splice(cardIdx, 1);
    const played = { playerId, card, declaration: decl, effectiveValue: effectiveValue(card, decl) };
    this.currentTrick.cards.push(played);

    const n = this.playerCount;
    const seat = this.seatIndex(playerId);

    if (this.currentTrick.cards.length < n) {
      this.turnId = this.players[(seat + 1) % n].id;
      return { ok: true };
    }

    // Pli complet : determiner le vainqueur, mais laisser le pli affiche
    // (toutes les cartes visibles) le temps que tout le monde le voie,
    // au lieu de passer tout de suite au pli suivant. C'est finishTrick()
    // (appelee par le serveur apres un court delai) qui enchainera.
    let winner = this.currentTrick.cards[0];
    for (const c of this.currentTrick.cards) {
      if (c.effectiveValue > winner.effectiveValue) winner = c;
    }
    this.tricksWon[winner.playerId] += 1;
    this.pushLog(`${this.findPlayer(winner.playerId).name} remporte le pli.`);
    this.awaitingTrickAck = true;
    this.pendingTrickWinnerId = winner.playerId;
    this.turnId = null;
    return { ok: true, trickComplete: true };
  }

  /**
   * A appeler par le serveur (apres un court delai) une fois qu'un pli
   * complet a ete laisse affiche assez longtemps. Vide le pli et passe
   * la main au vainqueur pour le pli suivant, ou termine la manche si
   * plus personne n'a de cartes.
   */
  finishTrick() {
    if (!this.awaitingTrickAck) return { ok: false, error: 'Aucun pli en attente.' };
    const winnerId = this.pendingTrickWinnerId;
    this.awaitingTrickAck = false;
    this.pendingTrickWinnerId = null;

    const handsRemaining = Object.values(this.hands).some((h) => h.length > 0);
    if (handsRemaining) {
      this.currentTrick = { cards: [], leaderId: winnerId };
      this.turnId = winnerId;
      return { ok: true, roundEnded: false };
    }
    const res = this._endRound();
    return { ok: true, roundEnded: true, gameOver: !!res.gameOver };
  }

  _endRound() {
    const results = {};
    this.players.forEach((p) => {
      const bid = this.bids[p.id] || 0;
      const won = this.tricksWon[p.id] || 0;
      const diff = Math.abs(won - bid);
      p.lives -= diff;
      results[p.id] = { bid, won, diff, livesAfter: p.lives };
    });
    this.lastRoundResult = {
      roundIndex: this.roundIndex,
      roundSize: this.roundSize,
      results,
    };

    const eliminated = this.players.filter((p) => p.lives <= 0);
    if (eliminated.length > 0) {
      const standings = this.players
        .slice()
        .sort((a, b) => b.lives - a.lives)
        .map((p) => ({ id: p.id, name: p.name, lives: p.lives, eliminated: p.lives <= 0 }));
      this.gameOverResult = { standings, eliminatedIds: eliminated.map((p) => p.id) };
      this.phase = 'game_over';
      this.pushLog(
        `Fin de partie : ${eliminated.map((p) => p.name).join(', ')} n'a/n'ont plus de vies.`,
      );
      return { ok: true, gameOver: true };
    }

    this.phase = 'round_result';
    return { ok: true, gameOver: false };
  }

  nextRound(requesterId) {
    if (this.phase !== 'round_result') return { ok: false, error: 'Pas de manche en attente.' };
    if (requesterId !== this.hostId) return { ok: false, error: "Seul l'hote peut lancer la manche suivante." };
    this.roundIndex += 1;
    if (this.roundIndex >= ROUND_SIZES.length) {
      this.roundIndex = 0;
      this.cycle += 1;
      // Le donneur (et donc le premier a annoncer) ne change qu'au debut
      // d'un nouveau cycle : a l'interieur d'un cycle, c'est toujours le
      // meme joueur qui annonce en premier sur les 5 manches.
      this.dealerIndex = (this.dealerIndex + 1) % this.playerCount;
    }
    this._startRound();
    return { ok: true };
  }

  // ---- Vues (etat public + main privee par joueur) -----------------------

  publicPlayers() {
    return this.players.map((p) => ({
      id: p.id,
      name: p.name,
      lives: p.lives,
      connected: p.connected,
      isHost: p.id === this.hostId,
      tricksWon: this.tricksWon[p.id] ?? null,
      hasBid: Object.prototype.hasOwnProperty.call(this.bids, p.id),
      bid: this.phase === 'playing' || this.phase === 'round_result' || this.phase === 'game_over'
        ? this.bids[p.id] ?? null
        : null,
      handCount: (this.hands[p.id] || []).length,
    }));
  }

  stateFor(playerId) {
    const base = {
      code: this.code,
      phase: this.phase,
      cycle: this.cycle,
      roundIndex: this.roundIndex,
      roundSize: this.phase === 'lobby' ? null : this.roundSize,
      isFrontRound: this.phase === 'lobby' ? false : this.isFrontRound,
      dealerId: this.players[this.dealerIndex] ? this.players[this.dealerIndex].id : null,
      hostId: this.hostId,
      players: this.publicPlayers(),
      turnId: this.turnId,
      currentTrick: this.currentTrick.cards.map((c) => ({
        playerId: c.playerId,
        card: c.card,
        declaration: c.declaration,
      })),
      awaitingTrickAck: this.awaitingTrickAck,
      trickWinnerId: this.pendingTrickWinnerId,
      bidAllowedValues: this.phase === 'bidding' && this.turnId === playerId ? this.bidAllowedValues(playerId) : null,
      lastRoundResult: this.lastRoundResult,
      gameOverResult: this.gameOverResult,
      log: this.log.slice(-15),
      minPlayers: MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS,
    };

    let yourHand = [];
    let frontOthers = null;
    if (this.phase !== 'lobby') {
      const hand = this.hands[playerId] || [];
      if (this.isFrontRound && (this.phase === 'bidding' || this.phase === 'playing')) {
        yourHand = hand.map((c) => ({ id: c.id, hidden: true }));
        frontOthers = this.players
          .filter((p) => p.id !== playerId)
          .map((p) => ({ playerId: p.id, card: (this.hands[p.id] || [])[0] || null }));
      } else {
        yourHand = hand;
      }
    }
    base.yourHand = yourHand;
    base.frontOthers = frontOthers;
    base.legalPlays = this.phase === 'playing' && this.turnId === playerId ? this.legalPlays(playerId).map((c) => c.cardId) : [];
    // L'Excuse peut toujours etre declaree "maxi" ou "mini" au choix du
    // joueur qui la joue (plus de restriction liee a l'obligation de
    // monter, qui a ete retiree des regles).
    base.canPlayExcuseFree = this.phase === 'playing' && this.turnId === playerId;
    return base;
  }
}

module.exports = { GameRoom, ROUND_SIZES, FRONT_ROUND_INDEX, STARTING_LIVES, MIN_PLAYERS, MAX_PLAYERS, buildDeck, shuffle, effectiveValue };
