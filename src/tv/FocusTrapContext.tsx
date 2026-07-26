import React from "react";
import { findNodeHandle, View } from "react-native";

export interface NextFocusTags {
  nextFocusUp?: number;
  nextFocusDown?: number;
  nextFocusLeft?: number;
  nextFocusRight?: number;
}

export interface OverlayFocusController {
  registerItem: (id: string, ref: React.RefObject<View>) => () => void;
  subscribe: (listener: () => void) => () => void;
  getNextFocus: (id: string) => NextFocusTags;
}

export const InsideOverlayContext = React.createContext<OverlayFocusController | null>(null);

// ── Global overlay tracking ──────────────────────────────────────────────────

let _overlayCount = 0;

export const FocusTrap = {
  register() {
    _overlayCount++;
  },
  unregister() {
    _overlayCount = Math.max(0, _overlayCount - 1);
  },
  getCount() {
    return _overlayCount;
  },
};

/**
 * Returns `true` when component is inside an active overlay.
 */
export function useIsFocusTrapped(): boolean {
  const overlayController = React.useContext(InsideOverlayContext);
  return _overlayCount > 0 && overlayController === null;
}

/**
 * Helper hook to create an OverlayFocusController instance for Overlay
 */
export function useOverlayFocusController(): OverlayFocusController {
  const itemsRef = React.useRef<{ id: string; ref: React.RefObject<View> }[]>([]);
  const listenersRef = React.useRef<Set<() => void>>(new Set());

  const notifyListeners = React.useCallback(() => {
    listenersRef.current.forEach((fn) => fn());
  }, []);

  return React.useMemo<OverlayFocusController>(() => {
    return {
      registerItem(id: string, ref: React.RefObject<View>) {
        itemsRef.current = [...itemsRef.current.filter((it) => it.id !== id), { id, ref }];

        // Schedule notification after node handles resolve
        const timer = setTimeout(() => {
          notifyListeners();
        }, 40);

        return () => {
          clearTimeout(timer);
          itemsRef.current = itemsRef.current.filter((it) => it.id !== id);
          notifyListeners();
        };
      },

      subscribe(listener: () => void) {
        listenersRef.current.add(listener);
        return () => {
          listenersRef.current.delete(listener);
        };
      },

      getNextFocus(id: string): NextFocusTags {
        const list = itemsRef.current;
        if (list.length === 0) return {};

        const index = list.findIndex((it) => it.id === id);
        if (index === -1) return {};

        const selfTag = findNodeHandle(list[index].ref.current) ?? undefined;
        if (!selfTag) return {};

        const prevTag = index > 0 ? (findNodeHandle(list[index - 1].ref.current) ?? selfTag) : selfTag;
        const nextTag = index < list.length - 1 ? (findNodeHandle(list[index + 1].ref.current) ?? selfTag) : selfTag;

        return {
          nextFocusUp: prevTag,
          nextFocusDown: nextTag,
          nextFocusLeft: selfTag,
          nextFocusRight: selfTag,
        };
      },
    };
  }, [notifyListeners]);
}
