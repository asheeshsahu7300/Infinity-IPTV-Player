// src/services/PlaybackState.ts
// Tiny global flag so background work (periodic sync, resume-refresh) can back
// off while video is on screen. Deliberately not in the Zustand store: nothing
// should re-render when this flips.

let active = false;

export const PlaybackState = {
  setActive(value: boolean) {
    active = value;
  },
  get isActive(): boolean {
    return active;
  },
};

export default PlaybackState;
