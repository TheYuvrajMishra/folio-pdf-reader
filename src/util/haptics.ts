/**
 * Haptics wrapper (DESIGN §3.5). Every haptic goes through here so the
 * user can toggle them in one place. Kinds:
 * light = taps/toggles · selection = ruler step / scrub tick ·
 * success = milestone · warning = destructive.
 */
import * as Haptics from 'expo-haptics';

export type HapticKind = 'light' | 'selection' | 'success' | 'warning' | 'none';

let enabled = true;
export function setHapticsEnabled(v: boolean): void {
  enabled = v;
}
export function isHapticsEnabled(): boolean {
  return enabled;
}

const impl: Record<Exclude<HapticKind, 'none'>, () => Promise<void>> = {
  light: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  selection: () => Haptics.selectionAsync(),
  success: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  warning: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
};

/** Fire-and-forget; never throws, never blocks the press response. */
export function haptic(kind: HapticKind): void {
  if (!enabled || kind === 'none') return;
  try {
    const p = impl[kind]();
    // Swallow rejections (e.g. headless test envs) — haptics are best-effort.
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch {
    /* best-effort */
  }
}
