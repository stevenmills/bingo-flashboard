export const CARD_SESSION_CHANGED_EVENT = "bingo:card-session-changed";
export const APP_MODE_CHANGED_EVENT = "bingo:app-mode-changed";
export const BOARD_AUTH_CHANGED_EVENT = "bingo:board-auth-changed";

export function notifyCardSessionChanged() {
  window.dispatchEvent(new CustomEvent(CARD_SESSION_CHANGED_EVENT));
}

export function notifyAppModeChanged() {
  window.dispatchEvent(new CustomEvent(APP_MODE_CHANGED_EVENT));
}

export function notifyBoardAuthChanged() {
  window.dispatchEvent(new CustomEvent(BOARD_AUTH_CHANGED_EVENT));
}
