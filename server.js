'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { RoomRegistry } = require('./lib/roomRegistry');

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const registry = new RoomRegistry();

app.use(express.static(path.join(__dirname, 'public')));
app.get('/healthz', (req, res) => res.send('ok'));

function broadcastRoom(room) {
  for (const p of room.players) {
    if (p.connected && p.socketId) {
      io.to(p.socketId).emit('state', room.stateFor(p.id));
    }
  }
}

function fail(cb, error) {
  if (typeof cb === 'function') cb({ ok: false, error });
}

io.on('connection', (socket) => {
  socket.data.code = null;
  socket.data.playerId = null;

  socket.on('create_room', ({ name, playerId } = {}, cb) => {
    if (!playerId) return fail(cb, 'Identifiant joueur manquant.');
    const room = registry.createRoom();
    const result = room.addPlayer(playerId, name);
    if (!result.ok) return fail(cb, result.error);
    room.markConnected(playerId, socket.id, true);
    socket.join(room.code);
    socket.data.code = room.code;
    socket.data.playerId = playerId;
    if (typeof cb === 'function') cb({ ok: true, code: room.code });
    broadcastRoom(room);
  });

  socket.on('join_room', ({ code, name, playerId } = {}, cb) => {
    if (!playerId) return fail(cb, 'Identifiant joueur manquant.');
    const room = registry.getRoom((code || '').trim());
    if (!room) return fail(cb, 'Salle introuvable. Verifie le code.');
    const result = room.addPlayer(playerId, name);
    if (!result.ok) return fail(cb, result.error);
    room.markConnected(playerId, socket.id, true);
    socket.join(room.code);
    socket.data.code = room.code;
    socket.data.playerId = playerId;
    if (typeof cb === 'function') cb({ ok: true, code: room.code });
    broadcastRoom(room);
  });

  socket.on('rejoin', ({ code, playerId } = {}, cb) => {
    const room = registry.getRoom((code || '').trim());
    if (!room || !playerId || !room.findPlayer(playerId)) {
      return fail(cb, 'Impossible de rejoindre cette salle (elle a peut-etre expire).');
    }
    room.markConnected(playerId, socket.id, true);
    socket.join(room.code);
    socket.data.code = room.code;
    socket.data.playerId = playerId;
    if (typeof cb === 'function') cb({ ok: true, code: room.code });
    broadcastRoom(room);
  });

  socket.on('leave_room', (payload, cb) => {
    const { code, playerId } = socket.data;
    const room = registry.getRoom(code);
    if (!room) return fail(cb, 'Salle introuvable.');
    const result = room.removePlayer(playerId);
    if (!result.ok) return fail(cb, result.error);
    socket.leave(room.code);
    socket.data.code = null;
    socket.data.playerId = null;
    if (typeof cb === 'function') cb({ ok: true });
    if (room.isEmpty()) registry.deleteRoom(room.code);
    else broadcastRoom(room);
  });

  socket.on('start_game', (payload, cb) => {
    const { code, playerId } = socket.data;
    const room = registry.getRoom(code);
    if (!room) return fail(cb, 'Salle introuvable.');
    const result = room.startGame(playerId);
    if (!result.ok) return fail(cb, result.error);
    if (typeof cb === 'function') cb({ ok: true });
    broadcastRoom(room);
  });

  socket.on('place_bid', ({ value } = {}, cb) => {
    const { code, playerId } = socket.data;
    const room = registry.getRoom(code);
    if (!room) return fail(cb, 'Salle introuvable.');
    const result = room.placeBid(playerId, Number(value));
    if (!result.ok) return fail(cb, result.error);
    if (typeof cb === 'function') cb({ ok: true });
    broadcastRoom(room);
  });

  socket.on('play_card', ({ cardId, declaration } = {}, cb) => {
    const { code, playerId } = socket.data;
    const room = registry.getRoom(code);
    if (!room) return fail(cb, 'Salle introuvable.');
    const result = room.playCard(playerId, cardId, declaration);
    if (!result.ok) return fail(cb, result.error);
    if (typeof cb === 'function') cb({ ok: true });
    broadcastRoom(room);
  });

  socket.on('next_round', (payload, cb) => {
    const { code, playerId } = socket.data;
    const room = registry.getRoom(code);
    if (!room) return fail(cb, 'Salle introuvable.');
    const result = room.nextRound(playerId);
    if (!result.ok) return fail(cb, result.error);
    if (typeof cb === 'function') cb({ ok: true });
    broadcastRoom(room);
  });

  socket.on('disconnect', () => {
    const { code, playerId } = socket.data;
    if (!code || !playerId) return;
    const room = registry.getRoom(code);
    if (!room) return;
    room.markConnected(playerId, null, false);
    if (room.isEmpty()) {
      registry.deleteRoom(room.code);
    } else {
      broadcastRoom(room);
    }
  });
});

setInterval(() => registry.sweep(), 30 * 60 * 1000).unref();

server.listen(PORT, () => {
  console.log(`Tarot Africain en ecoute sur le port ${PORT}`);
});

module.exports = { app, server, io, registry };
