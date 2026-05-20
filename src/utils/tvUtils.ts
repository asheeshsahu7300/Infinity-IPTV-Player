import { Platform, Dimensions } from 'react-native';

/**
 * Shared TV detection utility.
 * Returns true on Android TV, Fire TV, and any large-screen Android device (>1000px width).
 * Used across all screens for consistent TV behavior.
 */
export const isTV =
    Platform.isTV ||
    (Platform.OS === 'android' && Dimensions.get('screen').width > 1000) ||
    (Platform.OS === 'web' && Dimensions.get('window').width > 800);
