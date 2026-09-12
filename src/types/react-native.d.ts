import 'react-native';

declare module 'react-native' {
  interface PressableProps {
    nextFocusUp?: number | null;
    nextFocusDown?: number | null;
    nextFocusLeft?: number | null;
    nextFocusRight?: number | null;
  }

  interface TextInputProps {
    nextFocusUp?: number | null;
    nextFocusDown?: number | null;
    nextFocusLeft?: number | null;
    nextFocusRight?: number | null;
  }
}
