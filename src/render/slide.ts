/**
 * Slide page transition — framework-free spec (PRD §6.3, DESIGN.md §7).
 *
 * Outgoing page translates 30% of the page width (in the turn direction) while
 * dimming slightly (brightness 1 → 0.9); the incoming page translates the full
 * 100% from off-screen. Duration 280 ms, easing cubic-bezier(0.2, 0.8, 0.2, 1).
 *
 * M2 integration: drive `t` 0→1 with a Reanimated `withTiming(1, {duration:
 * SLIDE_DURATION_MS, easing: Easing.bezier(...SLIDE_EASING)})` shared value and
 * map each frame through `slideFrameAt(t, pageWidth)`. All values are plain
 * numbers so the same spec works in worklets and in unit tests.
 */

/** Slide duration in ms (DESIGN.md §7). */
export const SLIDE_DURATION_MS = 280;

/** cubic-bezier(0.2, 0.8, 0.2, 1) control points (DESIGN.md §7). */
export const SLIDE_EASING: readonly [number, number, number, number] = [
  0.2, 0.8, 0.2, 1,
];

/** Fraction of page width the outgoing page travels. */
export const SLIDE_OUTGOING_DISTANCE = 0.3;

/** Dim applied to the outgoing page: 1 (start) → 0.9 (end). */
export const SLIDE_OUTGOING_DIM_START = 1.0;
export const SLIDE_OUTGOING_DIM_END = 0.9;

export type SlideDirection = "forward" | "backward";

export interface SlideFrame {
  /** Outgoing page x-offset in px (negative = moves left on forward turn). */
  outgoingX: number;
  /** Outgoing page brightness multiplier, 1 → 0.9. */
  outgoingDim: number;
  /** Incoming page x-offset in px (starts off-screen, settles at 0). */
  incomingX: number;
  /** Eased progress 0..1 (useful for driving ancillary effects). */
  easedT: number;
}

/** Evaluate a cubic bezier curve's y at parameter t for control points (0,0),(x1,y1),(x2,y2),(1,1). */
export function cubicBezierY(
  t: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const u = 1 - t;
  return (
    3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t
  );
}

/**
 * Describe one frame of the slide transition.
 * @param t linear progress 0..1 (caller applies SLIDE_EASING before calling,
 *          or pass raw t and read easedT — this function eases internally).
 */
export function slideFrameAt(
  t: number,
  pageWidth: number,
  direction: SlideDirection = "forward",
): SlideFrame {
  const clamped = Math.min(1, Math.max(0, t));
  const e = cubicBezierY(clamped, ...SLIDE_EASING);
  const sign = direction === "forward" ? 1 : -1;
  return {
    outgoingX: -sign * e * SLIDE_OUTGOING_DISTANCE * pageWidth,
    outgoingDim:
      SLIDE_OUTGOING_DIM_START +
      e * (SLIDE_OUTGOING_DIM_END - SLIDE_OUTGOING_DIM_START),
    incomingX: sign * (1 - e) * pageWidth,
    easedT: e,
  };
}
