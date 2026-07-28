import React from "react";
import { findNodeHandle, View } from "react-native";

export interface NextFocusTags {
  nextFocusUp?: number;
  nextFocusDown?: number;
  nextFocusLeft?: number;
  nextFocusRight?: number;
}

/** Direction the overlay's focusable items are laid out in. */
export type OverlayAxis = "vertical" | "horizontal";

export interface OverlayFocusController {
  registerItem: (id: string, ref: React.RefObject<View>) => () => void;
  subscribe: (listener: () => void) => () => void;
  getNextFocus: (id: string) => NextFocusTags;
}

export const InsideOverlayContext = React.createContext<OverlayFocusController | null>(null);

// ── Global overlay tracking ──────────────────────────────────────────────────
// This has to be an observable store, not a bare module variable: components
// call `useIsFocusTrapped()` during render, and memoised list rows will not
// re-render on their own when an overlay opens. Without a subscription the
// background stays focusable and the trap only exists on paper.

let _overlayCount = 0;
const _listeners = new Set<() => void>();

const getOverlayCount = () => _overlayCount;

const subscribeOverlayCount = (listener: () => void) => {
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
};

const emit = () => {
  _listeners.forEach((listener) => listener());
};

export const FocusTrap = {
  register() {
    _overlayCount++;
    emit();
  },
  unregister() {
    _overlayCount = Math.max(0, _overlayCount - 1);
    emit();
  },
  getCount: getOverlayCount,
  subscribe: subscribeOverlayCount,
};

/**
 * Returns `true` when the component is in the background behind an active
 * overlay (i.e. an overlay is open and this component is not inside it).
 */
export function useIsFocusTrapped(): boolean {
  const overlayController = React.useContext(InsideOverlayContext);
  const count = React.useSyncExternalStore(
    subscribeOverlayCount,
    getOverlayCount,
    getOverlayCount
  );
  return count > 0 && overlayController === null;
}

/**
 * Creates an OverlayFocusController for `Overlay`.
 *
 * Items are chained along `axis` via native `nextFocus*` tags so the OS focus
 * engine walks them in mount order. The cross axis is deliberately left
 * undefined — containment is the job of the surrounding `TVFocusGuideView`'s
 * `trapFocus*` props. Pinning the cross axis back to the item itself would
 * make a horizontally laid-out overlay impossible to navigate.
 */
export function useOverlayFocusController(axis: OverlayAxis = "vertical"): OverlayFocusController {
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

        const prevTag =
          index > 0 ? (findNodeHandle(list[index - 1].ref.current) ?? selfTag) : selfTag;
        const nextTag =
          index < list.length - 1
            ? (findNodeHandle(list[index + 1].ref.current) ?? selfTag)
            : selfTag;

        return axis === "horizontal"
          ? { nextFocusLeft: prevTag, nextFocusRight: nextTag }
          : { nextFocusUp: prevTag, nextFocusDown: nextTag };
      },
    };
  }, [notifyListeners, axis]);
}
