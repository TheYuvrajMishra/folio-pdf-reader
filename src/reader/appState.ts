/**
 * appState.ts — thin indirection over react-native's AppState.
 *
 * Lives in its own module so the resume controller stays unit-testable in
 * Node: tests `jest.mock('./appState')` instead of pulling in react-native.
 */

import { AppState, type AppStateStatus } from 'react-native';

export type { AppStateStatus };

export type AppStateChangeHandler = (status: AppStateStatus) => void;

export interface AppStateSubscription {
  remove(): void;
}

/** Subscribe to AppState 'change' events; returns a removable subscription. */
export function addAppStateListener(handler: AppStateChangeHandler): AppStateSubscription {
  return AppState.addEventListener('change', handler);
}
