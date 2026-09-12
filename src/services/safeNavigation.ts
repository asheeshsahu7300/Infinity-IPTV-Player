// src/services/safeNavigation.ts
// Centralized, deduplicated navigation and back-handling service.
// Ensures pressing the remote Back button NEVER navigates back to the same screen
// or loops through duplicate route history.

import { BackHandler } from "react-native";
import { StackActions, NavigationContainerRefWithCurrent } from "@react-navigation/native";
import { router } from "expo-router";

let navigationRef: NavigationContainerRefWithCurrent<any> | null = null;
let lastBackTimestamp = 0;
let lastNavTimestamp = 0;

export function setSafeNavigationRef(ref: NavigationContainerRefWithCurrent<any> | null) {
  navigationRef = ref;
}

/**
 * Safely navigates back without ever landing on the same screen.
 * - Skips all duplicate instances of the current screen in the navigation stack.
 * - Pops past them in a single atomic StackActions.pop() transition.
 * - If at root or dashboard, gracefully exits/minimizes the app.
 * - Debounced to eliminate remote key bounce.
 */
export function safeBack(): boolean {
  const now = Date.now();
  if (now - lastBackTimestamp < 250) {
    return true; // absorb hardware bounce
  }
  lastBackTimestamp = now;

  try {
    if (!navigationRef || !navigationRef.isReady || !navigationRef.isReady()) {
      if (router.canGoBack()) {
        router.back();
        return true;
      }
      router.replace("/dashboard");
      return true;
    }

    const state = navigationRef.getRootState();
    if (!state) {
      if (router.canGoBack()) {
        router.back();
        return true;
      }
      return false;
    }

    // Find the deepest stack navigator state
    let activeStack: any = state;
    while (activeStack && activeStack.routes && activeStack.routes.length > 0) {
      const activeRoute = activeStack.routes[activeStack.index ?? activeStack.routes.length - 1];
      if (activeRoute && activeRoute.state && activeRoute.state.routes) {
        activeStack = activeRoute.state;
      } else {
        break;
      }
    }

    const routes: any[] = activeStack?.routes ?? [];
    const currentIndex: number = activeStack?.index ?? routes.length - 1;

    if (routes.length === 0 || currentIndex < 0) {
      if (router.canGoBack()) {
        router.back();
        return true;
      }
      return false;
    }

    const currentRoute = routes[currentIndex];
    const currentName = currentRoute?.name;

    // Special case: If user is on dashboard, pressing BACK should exit the app,
    // not go back to portals, add-portal, or splash/index!
    if (currentName === "dashboard") {
      BackHandler.exitApp();
      return true;
    }

    // Scan backwards for the first route that is DIFFERENT from currentName
    let targetIndex = currentIndex - 1;
    while (targetIndex >= 0 && routes[targetIndex]?.name === currentName) {
      targetIndex--;
    }

    // If target is "index" (the initial redirector), skip it as well
    if (targetIndex >= 0 && routes[targetIndex]?.name === "index") {
      targetIndex--;
    }

    if (targetIndex >= 0) {
      const popCount = currentIndex - targetIndex;
      if (popCount > 1) {
        navigationRef.dispatch(StackActions.pop(popCount));
      } else {
        navigationRef.goBack();
      }
      return true;
    }

    // If no different route in history exists, go to dashboard
    router.replace("/dashboard");
    return true;
  } catch (err) {
    console.warn("safeBack error:", err);
    try {
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace("/dashboard");
      }
    } catch {}
    return true;
  }
}

/**
 * Debounced navigation helper to prevent rapid remote clicks from pushing
 * the same screen multiple times.
 */
export function safeNavigate(route: string, params?: Record<string, any>) {
  const now = Date.now();
  if (now - lastNavTimestamp < 200) return;
  lastNavTimestamp = now;

  // Prevent pushing the identical screen if already on it
  try {
    if (navigationRef && navigationRef.isReady && navigationRef.isReady()) {
      const currentRoute = navigationRef.getCurrentRoute();
      const targetName = route.replace(/^\//, "").split("?")[0];
      if (currentRoute && currentRoute.name === targetName && !params) {
        return;
      }
    }
  } catch {}

  if (params) {
    router.push({ pathname: route as any, params });
  } else {
    router.push(route as any);
  }
}
