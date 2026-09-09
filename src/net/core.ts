/**
 * The single entry the Node server imports. `npm run build:core` bundles this file and everything
 * it pulls in to `server/core/game-core.mjs`, so the rules the server enforces are the exact
 * TypeScript the browser and the unit tests run. No hand-translated second copy to drift.
 */
export {
  ATTACK_INTERVAL, ATTACK_TRAVEL, BOSS_HP, PLAYER_HP, RUN_DURATION, STEP, WEAPONS, WEAPON_ORDER, WORLD,
} from '../game/config'
export {
  activePlayers, addPlayer, applyCommand, bestAvailableWeapon, clearTriggers, createGame, createPlayer,
  removePlayer, setConnected, stepGame,
} from '../game/simulation'
export {
  COMMAND_RATE_LIMIT, ERROR_TEXT, FOREIGN_EVENT_BUDGET, MAX_MESSAGE_BYTES, MAX_NAME_LENGTH, MAX_ROOMS,
  PING_INTERVAL, PING_TIMEOUT, ROOM_CAP, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, ROSTER_EVERY, SNAPSHOT_HZ,
  eventOwner, filterEvents, isBroadcastEvent,
  normalizeName, normalizeRoomCode, parseClientMessage, roomCode,
} from './protocol'
