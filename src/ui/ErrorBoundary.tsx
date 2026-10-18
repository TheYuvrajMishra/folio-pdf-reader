/**
 * Root error boundary (PRD §7.9): no red screens, no blank states.
 * Catches render crashes anywhere below it and shows a designed
 * ErrorState with a retry that resets the tree.
 */
import React from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { ErrorState } from './EmptyState';

interface Props {
  children: React.ReactNode;
}
interface State {
  crashed: boolean;
}

class Boundary extends React.Component<Props, State> {
  state: State = { crashed: false };

  static getDerivedStateFromError(): State {
    return { crashed: true };
  }

  componentDidCatch(): void {
    // M1+: log to a local crash log table. Never send anywhere (no network).
  }

  private reset = (): void => this.setState({ crashed: false });

  render(): React.ReactNode {
    if (this.state.crashed) {
      return <Fallback onRetry={this.reset} />;
    }
    return this.props.children;
  }
}

function Fallback({ onRetry }: { onRetry: () => void }): React.JSX.Element {
  const { colors } = useTheme();
  return (
    <SafeAreaView style={[styles.host, { backgroundColor: colors.bg }]}>
      <ErrorState
        message="The app hit a snag. Your books and notes are safe."
        onRetry={onRetry}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ host: { flex: 1 } });

export function ErrorBoundary({ children }: Props): React.JSX.Element {
  return <Boundary>{children}</Boundary>;
}
