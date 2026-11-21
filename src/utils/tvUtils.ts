import { Platform, Dimensions } from 'react-native';

export const isWebOS =
  typeof window !== 'undefined' &&
  (Boolean((window as any).PalmSystem) ||
   Boolean((window as any).webOS) ||
   Boolean((window as any).__WEBOS__) ||
   (typeof navigator !== 'undefined' && /Web0S|webOS/i.test(navigator.userAgent)));

if (isWebOS && Platform.OS === 'web') {
  (Platform as any).isTV = true;
}

const screenDims = Dimensions.get('screen');
const windowDims = Dimensions.get('window');

const winW =
  windowDims.width > 0
    ? windowDims.width
    : typeof window !== 'undefined' && window.innerWidth > 0
    ? window.innerWidth
    : 1920;

const winH =
  windowDims.height > 0
    ? windowDims.height
    : typeof window !== 'undefined' && window.innerHeight > 0
    ? window.innerHeight
    : 1080;

const maxDim = Math.max(screenDims.width || winW, screenDims.height || winH);
const maxWinDim = Math.max(winW, winH);

/**
 * Shared TV detection utility.
 * Returns true on Android TV, Fire TV, webOS TV, and any large-screen device (>800px width in landscape).
 * Used across all screens for consistent TV behavior regardless of orientation.
 */
export const isTV =
  Platform.isTV ||
  isWebOS ||
  (Platform.OS === 'android' && maxDim > 1000) ||
  (Platform.OS === 'web' && maxWinDim > 800);

