import { Platform, Dimensions } from 'react-native';

const screenDims = Dimensions.get('screen');
const windowDims = Dimensions.get('window');
const maxDim = Math.max(screenDims.width || 0, screenDims.height || 0);
const maxWinDim = Math.max(windowDims.width || 0, windowDims.height || 0);

/**
 * Shared TV detection utility.
 * Returns true on Android TV, Fire TV, and any large-screen Android device (>1000px width in landscape).
 * Used across all screens for consistent TV behavior regardless of orientation.
 */
export const isTV =
    Platform.isTV ||
    (Platform.OS === 'android' && maxDim > 1000) ||
    (Platform.OS === 'web' && maxWinDim > 800);
