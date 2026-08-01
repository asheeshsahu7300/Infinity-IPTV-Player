// src/services/networkActivity.ts
//
// Ref-counted "is a portal request in flight" flag.
//
// Screens keep their own `isLoading` for fetches they start themselves, but a lot
// of traffic is started elsewhere: the boot sync, the 30-minute refresh, the
// app-resume refresh, and the retry fired when a portal answers with an empty
// body. None of that touched any screen's state, so a screen with nothing to show
// rendered its empty state ("No Channels Found") while a request that would fill
// it was still running. This is the shared signal for that.
//
// A counter, not a boolean: several requests overlap constantly, and the last one
// to finish must not clear the flag while others are still going.

import React from "react";

let inFlight = 0;
const listeners = new Set<() => void>();

const emit = () => {
  listeners.forEach((listener) => listener());
};

/**
 * Deliberately a boolean, not the count. `useSyncExternalStore` compares
 * snapshots with `Object.is`, so returning the count would re-render every
 * subscriber on a 1→2 transition that leaves the flag unchanged — and the MAG
 * warm fires six requests back to back.
 */
const getSnapshot = () => inFlight > 0;

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const NetworkActivity = {
  begin() {
    inFlight++;
    emit();
  },

  end() {
    inFlight = Math.max(0, inFlight - 1);
    emit();
  },

  /** Runs `fn` with the counter raised, releasing it even if `fn` throws. */
  async track<T>(fn: () => Promise<T>): Promise<T> {
    NetworkActivity.begin();
    try {
      return await fn();
    } finally {
      NetworkActivity.end();
    }
  },

  get count() {
    return inFlight;
  },

  subscribe,
};

/** `true` while any portal request is in flight. */
export function useNetworkActivity(): boolean {
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export default NetworkActivity;
