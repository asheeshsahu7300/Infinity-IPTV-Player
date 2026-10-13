// src/tv/webSpatialNavigation.ts
// Spatial navigation engine for Web & LG webOS TV.
// Calculates 2D Euclidean trajectories to move focus smoothly between Focusable components
// using standard TV remote directional D-Pad keys.

import { Platform } from "react-native";

export interface FocusableNode {
  id: string;
  element: HTMLElement;
  nextFocusUp?: number | string;
  nextFocusDown?: number | string;
  nextFocusLeft?: number | string;
  nextFocusRight?: number | string;
  trapFocusUp?: boolean;
  trapFocusDown?: boolean;
  trapFocusLeft?: boolean;
  trapFocusRight?: boolean;
  isInert?: boolean;
}

const focusableNodes = new Map<string, FocusableNode>();
let activeFocusedId: string | null = null;

export const WebSpatialNavigation = {
  register(node: FocusableNode): () => void {
    if (Platform.OS !== "web") return () => {};
    focusableNodes.set(node.id, node);

    return () => {
      focusableNodes.delete(node.id);
      if (activeFocusedId === node.id) {
        activeFocusedId = null;
      }
    };
  },

  setActive(id: string) {
    activeFocusedId = id;
  },

  getActive(): FocusableNode | null {
    if (
      typeof document !== "undefined" &&
      document.activeElement &&
      document.activeElement instanceof HTMLElement &&
      document.activeElement !== document.body
    ) {
      for (const node of focusableNodes.values()) {
        if (node.element === document.activeElement || node.element.contains(document.activeElement)) {
          activeFocusedId = node.id;
          return node;
        }
      }
      return {
        id: "__active_element__",
        element: document.activeElement,
      };
    }

    if (activeFocusedId && focusableNodes.has(activeFocusedId)) {
      const node = focusableNodes.get(activeFocusedId)!;
      if (typeof document !== "undefined" && document.contains(node.element)) {
        return node;
      }
    }

    return null;
  },

  navigate(direction: "up" | "down" | "left" | "right"): boolean {
    if (Platform.OS !== "web") return false;

    const current = this.getActive();
    if (!current) {
      // Nothing currently focused; focus the first visible focusable node
      const first = Array.from(focusableNodes.values()).find((n) => !n.isInert && isVisible(n.element));
      if (first) {
        first.element.focus();
        activeFocusedId = first.id;
        return true;
      }
      return false;
    }

    // Directional traps
    if (direction === "up" && current.trapFocusUp) return true;
    if (direction === "down" && current.trapFocusDown) return true;
    if (direction === "left" && current.trapFocusLeft) return true;
    if (direction === "right" && current.trapFocusRight) return true;

    const currentRect = current.element.getBoundingClientRect();
    const currentCenter = {
      x: currentRect.left + currentRect.width / 2,
      y: currentRect.top + currentRect.height / 2,
    };

    let bestCandidate: FocusableNode | null = null;
    let minDistance = Infinity;

    for (const candidate of focusableNodes.values()) {
      if (candidate.id === current.id || candidate.isInert) continue;
      if (!isVisible(candidate.element)) continue;

      const candRect = candidate.element.getBoundingClientRect();
      const candCenter = {
        x: candRect.left + candRect.width / 2,
        y: candRect.top + candRect.height / 2,
      };

      const dx = candCenter.x - currentCenter.x;
      const dy = candCenter.y - currentCenter.y;

      // Filter candidates in the correct geometric hemisphere
      let isCandidateInDirection = false;
      let primaryDiff = 0;
      let secondaryDiff = 0;

      switch (direction) {
        case "up":
          isCandidateInDirection = dy < -4; // strictly above
          primaryDiff = -dy;
          secondaryDiff = Math.abs(dx);
          break;
        case "down":
          isCandidateInDirection = dy > 4; // strictly below
          primaryDiff = dy;
          secondaryDiff = Math.abs(dx);
          break;
        case "left":
          isCandidateInDirection = dx < -4; // strictly left
          primaryDiff = -dx;
          secondaryDiff = Math.abs(dy);
          break;
        case "right":
          isCandidateInDirection = dx > 4; // strictly right
          primaryDiff = dx;
          secondaryDiff = Math.abs(dy);
          break;
      }

      if (!isCandidateInDirection) continue;

      // Weight primary direction over secondary deviation (prevents jumping diagonal rows)
      const distance = primaryDiff + secondaryDiff * 2.2;

      if (distance < minDistance) {
        minDistance = distance;
        bestCandidate = candidate;
      }
    }

    if (bestCandidate) {
      bestCandidate.element.focus();
      activeFocusedId = bestCandidate.id;
      try {
        bestCandidate.element.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      } catch {}
      return true;
    }

    return false;
  },
};

function isVisible(el: HTMLElement): boolean {
  if (!el.isConnected) return false;
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
    return false;
  }
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}
