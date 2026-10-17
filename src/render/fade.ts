/**
 * Fade page transition — framework-free spec (PRD §6.3, DESIGN.md §7).
 *
 * Plain linear cross-fade: outgoing 1 → 0, incoming 0 → 1, 180 ms.
 * Used as the reduced-motion transition (120 ms variant, see REDUCED_MOTION
 * note) and as the cheapest fallback if slide ever janks.
 *
 * M2 integration: drive `t` 0→1 with Reanimated
 * `withTiming(1, { duration: FADE_DURATION_MS, easing: Easing.linear })`.
 */

/** Fade duration in ms (DESIGN.md §7). */
export const FADE_DURATION_MS = 180;

/**
 * Reduced-motion fade duration in ms. When the OS "Remove animations" setting
 * (or the in-app reduced-motion toggle) is on, ALL transitions become fades of
 * this length and page animation is forced to None unless the user overrides
 * (PRD §6.3, DESIGN.md §7).
 */
export const REDUCED_MOTION_FADE_MS = 120;

export interface FadeFrame {
  /** Outgoing page opacity 1 → 0. */
  outgoingOpacity: number;
  /** Incoming page opacity 0 → 1. */
  incomingOpacity: number;
}

/** Describe one frame of the fade transition; t is linear progress 0..1. */
export function fadeFrameAt(t: number): FadeFrame {
  const clamped = Math.min(1, Math.max(0, t));
  return {
    outgoingOpacity: 1 - clamped,
    incomingOpacity: clamped,
  };
}
