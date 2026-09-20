'use strict';

const { GameRoom } = require('./gameRoom');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans O/0/I/1, ambigus

class RoomRegistry {
  constructor() {
    /** @type {Map<string, GameRoom>} */
    this.rooms = new Map();
  }

  _generateCode() {
    let code;
    do {
      code = '';
      for (let i = 0; i < 4; i++) {
        code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      }
    } while (this.rooms.has(code));
    return code;
  }

  createRoom() {
    const code = this._generateCode();
    const room = new GameRoom(code);
    this.rooms.set(code, room);
    return room;
  }

  getRoom(code) {
    if (!code) return null;
    return this.rooms.get(code.toUpperCase()) || null;
  }

  deleteRoom(code) {
    this.rooms.delete(code);
  }

  // Nettoyage periodique des salles vides (personne connecte) depuis > 2h.
  sweep(maxAgeMs = 2 * 60 * 60 * 1000) {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (room.isEmpty() && now - room.createdAt > maxAgeMs) {
        this.rooms.delete(code);
      }
    }
  }
}

module.exports = { RoomRegistry };
