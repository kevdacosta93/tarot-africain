'use strict';

// Test de bout en bout : simule une partie complete a 3 joueurs (bots
// jouant des coups valides au hasard) jusqu'a la fin de partie, et
// verifie que le serveur ne plante pas et applique les regles
// (personne ne peut jouer un coup illegal, le jeu se termine bien).

process.env.PORT = process.env.PORT || '3979';
const PORT = process.env.PORT;

const { io: ioClient } = require('socket.io-client');
const { server } = require('../server');

const NUM_PLAYERS = Number(process.env.NUM_PLAYERS || 3);
const NAMES = ['Awa', 'Moussa', 'Khadija', 'Ibrahim'].slice(0, NUM_PLAYERS);

let failed = false;
function assert(cond, msg) {
  if (!cond) {
    failed = true;
    console.error('ECHEC ASSERTION:', msg);
  }
}

function rand(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function main() {
  const sockets = [];
  for (let i = 0; i < NUM_PLAYERS; i++) {
    sockets.push(ioClient(`http://localhost:${PORT}`, { transports: ['websocket'] }));
  }

  await Promise.all(
    sockets.map(
      (s) =>
        new Promise((resolve) => {
          s.on('connect', resolve);
        }),
    ),
  );
  console.log('Sockets connectes.');

  const playerIds = sockets.map((_, i) => 'test-player-' + i);
  const states = new Array(NUM_PLAYERS).fill(null);
  let roundsPlayed = 0;
  let lastRoundIndexSeen = new Array(NUM_PLAYERS).fill(-1);

  let gameOverResolve;
  const gameOverPromise = new Promise((resolve) => (gameOverResolve = resolve));

  function actOnState(i, state) {
    states[i] = state;
    const myId = playerIds[i];

    if (state.phase === 'bidding' && state.turnId === myId) {
      const allowed = state.bidAllowedValues || [];
      assert(allowed.length > 0, 'aucune annonce autorisee pour ' + myId);
      const value = rand(allowed);
      sockets[i].emit('place_bid', { value }, (res) => {
        assert(res.ok, 'annonce refusee: ' + JSON.stringify(res));
      });
    } else if (state.phase === 'playing' && state.turnId === myId) {
      const legal = state.legalPlays || [];
      assert(legal.length > 0, 'aucune carte jouable pour ' + myId);
      const cardId = rand(legal);
      const isExcuse = cardId === 'excuse';
      const payload = { cardId };
      if (isExcuse && state.canPlayExcuseFree) payload.declaration = rand(['maxi', 'mini']);
      sockets[i].emit('play_card', payload, (res) => {
        assert(res.ok, 'coup refuse: ' + JSON.stringify(res));
      });
    } else if (state.phase === 'round_result' && state.hostId === myId) {
      if (state.roundIndex !== lastRoundIndexSeen[i]) {
        lastRoundIndexSeen[i] = state.roundIndex;
        roundsPlayed += 1;
        setTimeout(() => {
          sockets[i].emit('next_round', {}, (res) => {
            assert(res.ok, 'next_round refuse: ' + JSON.stringify(res));
          });
        }, 5);
      }
    } else if (state.phase === 'game_over') {
      assert(Array.isArray(state.gameOverResult.standings), 'standings manquant');
      assert(state.gameOverResult.standings.length === NUM_PLAYERS, 'standings incomplet');
      const anyEliminated = state.gameOverResult.standings.some((s) => s.eliminated);
      assert(anyEliminated, 'aucun joueur elimine en fin de partie');
      gameOverResolve();
    }
  }

  sockets.forEach((s, i) => {
    s.on('state', (state) => actOnState(i, state));
  });

  // Creation + rejoin
  await new Promise((resolve) => {
    sockets[0].emit('create_room', { name: NAMES[0], playerId: playerIds[0] }, (res) => {
      assert(res.ok, 'creation salle echouee: ' + JSON.stringify(res));
      resolve(res);
    });
  });
  const code = states[0] ? states[0].code : null;

  // Recuperer le code via un court delai si besoin (event 'state' asynchrone)
  await new Promise((r) => setTimeout(r, 100));
  const roomCode = (states[0] && states[0].code) || code;
  assert(roomCode, 'code de salle introuvable');

  for (let i = 1; i < NUM_PLAYERS; i++) {
    await new Promise((resolve) => {
      sockets[i].emit('join_room', { code: roomCode, name: NAMES[i], playerId: playerIds[i] }, (res) => {
        assert(res.ok, `join_room ${i} echoue: ` + JSON.stringify(res));
        resolve();
      });
    });
  }

  await new Promise((r) => setTimeout(r, 150));

  sockets[0].emit('start_game', {}, (res) => {
    assert(res.ok, 'start_game refuse: ' + JSON.stringify(res));
  });

  const timeoutMs = 30000;
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Timeout: la partie ne s\'est pas terminee a temps')), timeoutMs),
  );

  try {
    await Promise.race([gameOverPromise, timeout]);
  } catch (e) {
    failed = true;
    console.error(e.message);
  }

  console.log(`Manches jouees avant fin de partie : au moins ${roundsPlayed}`);

  sockets.forEach((s) => s.close());
  server.close();

  if (failed) {
    console.error('\nTEST E2E : ECHEC');
    process.exit(1);
  } else {
    console.log('\nTEST E2E : SUCCES - partie complete simulee sans erreur.');
    process.exit(0);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
