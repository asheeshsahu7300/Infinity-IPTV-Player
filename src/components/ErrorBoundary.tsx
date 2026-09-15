import React, { Component, ReactNode } from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { phoneDp, THEME } from '../theme/tokens';
import * as P from '../theme/palette';
import { RADIUS } from '../theme/materials';
import { RefreshCw, TriangleAlert } from 'lucide-react-native';
import { Text } from './Text';


interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  attempt: number;
}

const MAX_AUTO_RETRIES = 2;

export default class ErrorBoundary extends Component<Props, State> {
  private autoRetryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      attempt: 0,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    if (this.state.attempt < MAX_AUTO_RETRIES) {
      if (this.autoRetryTimer) clearTimeout(this.autoRetryTimer);
      this.autoRetryTimer = setTimeout(() => {
        this.setState((prev) => ({
          hasError: false,
          error: null,
          attempt: prev.attempt + 1,
        }));
      }, 800);
    }
  }

  componentWillUnmount() {
    if (this.autoRetryTimer) clearTimeout(this.autoRetryTimer);
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      attempt: 0,
    });
  };

  render() {
    if (this.state.hasError) {
      if (this.state.attempt < MAX_AUTO_RETRIES) {
        return (
          <View style={styles.container}>
            <ActivityIndicator size="large" color={THEME.colors.primary} />
          </View>
        );
      }
      return (
        <View style={styles.container}>
          <View style={styles.content}>
            <TriangleAlert size={64} color={P.systemRed} />
            <Text style={styles.title}>Oops! Something went wrong</Text>
            <Text style={styles.subtitle}>
              The app encountered an unexpected error
            </Text>
            {__DEV__ && this.state.error && (
              <View style={styles.errorDetails}>
                <Text style={styles.errorText}>
                  {this.state.error.toString()}
                </Text>
              </View>
            )}
            <TouchableOpacity style={styles.button} onPress={this.handleReset}>
              <RefreshCw size={phoneDp(20)} color={P.onTint} />
              <Text style={[styles.buttonText, { marginLeft: 8 }]}>Try Again</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: P.systemBackground,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  content: {
    alignItems: 'center',
    maxWidth: 400,
  },
  title: {
    fontSize: 24,
    fontFamily: THEME.fonts.semibold,
    color: P.label,
    marginTop: 24,
    marginBottom: 12,
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 16,
    color: P.secondaryLabel,
    textAlign: 'center',
    marginBottom: 32,
  },
  errorDetails: {
    backgroundColor: P.secondaryElevatedSystemBackground,
    padding: 16,
    borderRadius: RADIUS.card,
    borderCurve: 'continuous',
    marginBottom: 24,
    maxWidth: '100%',
  },
  errorText: {
    color: P.systemRed,
    fontSize: 12,
    fontFamily: 'monospace',
  },
  // A filled tint button with dark ink, which is the pairing this file has now
  // had in both directions: the original `#F5F5F5` fill with white text was
  // invisible, and so would a tint fill with white text be. Ink on tint is
  // always `onTint` — see the note on `selectedText` in tokens.
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: RADIUS.card,
    borderCurve: 'continuous',
  },
  buttonText: {
    color: P.onTint,
    fontSize: 16,
    fontFamily: THEME.fonts.semibold,
  },
});
