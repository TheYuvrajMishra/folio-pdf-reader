/**
 * Page-curl transition — Skia RuntimeEffect (SkSL) source + typed uniforms builder.
 *
 * Model: cylinder roll. The current page lifts off its free edge and wraps around
 * an imaginary cylinder of radius `curlRadius`; the revealed next page is drawn
 * underneath. Finger-driven via the `progress` uniform (0..1); the release/commit
 * spring animates `progress` → 0 or 1 (spring {damping:20, stiffness:180, mass:1},
 * ≈420 ms settle per DESIGN.md §7).
 *
 * M2 integration note (react-native-skia):
 *   const effect = Skia.RuntimeEffect.Make(CURL_SHADER_SOURCE);
 *   <Fill>
 *     <Shader source={effect} uniforms={buildCurlUniforms({...})}>
 *       <ImageShader image={frontImage} ... />  // must match 1st `uniform shader`
 *       <ImageShader image={backImage} ... />   // must match 2nd `uniform shader`
 *     </Shader>
 *   </Fill>
 * Child shaders bind in *declaration order* of the `uniform shader` lines below.
 *
 * Coordinate space: device pixels of the page rect, origin top-left, +x right.
 */
import type { Uniforms } from "@shopify/react-native-skia";

/** Turn direction: 'forward' lifts the right edge (next page), 'backward' the left. */
export type CurlDirection = "forward" | "backward";

/** Back-face darkening: DESIGN.md §7 — the curled page's reverse side is 12% darker. */
export const CURL_BACKFACE_TINT = 0.88;

/** Default cylinder radius as a fraction of page width (tune on-device). */
export const CURL_RADIUS_FRACTION = 0.14;

/** Master shadow gain range. 0 disables both shadow terms (perf fallback). */
export const CURL_SHADOW_STRENGTH_DEFAULT = 1.0;

export interface CurlUniformParams {
  /** Page size in device pixels. */
  width: number;
  height: number;
  /** Curl progress 0..1 (finger-driven or spring-animated). Clamped in-shader. */
  progress: number;
  direction: CurlDirection;
  /** Cylinder radius in px. Defaults to CURL_RADIUS_FRACTION * width. */
  radiusPx?: number;
  /** 0..1 master gain for the two shadow terms. Defaults to 1. */
  shadowStrength?: number;
}

/**
 * Build the value-uniform dict for the curl RuntimeEffect.
 * (Child samplers `frontPage`/`backPage` are bound as <Shader> children, not here —
 *  Skia's getUniformCount() only counts value uniforms.)
 */
export function buildCurlUniforms(params: CurlUniformParams): Uniforms {
  "worklet";
  const {
    width,
    height,
    progress,
    direction,
    radiusPx = CURL_RADIUS_FRACTION * width,
    shadowStrength = CURL_SHADOW_STRENGTH_DEFAULT,
  } = params;
  return {
    pageSize: [width, height],
    progress: Math.min(1, Math.max(0, progress)),
    curlRadius: Math.max(1, radiusPx),
    direction: direction === "forward" ? 1 : -1,
    shadowStrength: Math.min(1, Math.max(0, shadowStrength)),
  };
}

/**
 * Map a horizontal finger drag to curl progress 0..1 (1:1 finger follow, DESIGN.md §7).
 * Forward turn: user drags right→left, so `dx` is negative. Backward: mirrored.
 * Progress is unitless; the caller clamps the spring target to {0, 1} on release
 * using the commit rule (>35% or fling > 800 px/s commits, PRD §6.3).
 */
export function curlProgressFromDrag(
  dx: number,
  pageWidth: number,
  direction: CurlDirection = "forward",
): number {
  "worklet";
  if (pageWidth <= 0) {
    return 0;
  }
  const signed = direction === "forward" ? -dx : dx;
  return Math.min(1, Math.max(0, signed / pageWidth));
}

/**
 * SkSL source for the cylinder page curl.
 *
 * Static-review status (no Skia runtime on this VM — see docs/spikes/S2.md):
 * - Entry point `vec4 main(vec2 fragcoord)` — the required RuntimeEffect signature.
 * - Uniforms declared without initializers; `uniform shader` children sampled
 *   with `.eval(vec2)` (the documented child-sampling API).
 * - No loops (sidesteps SkSL's constant-bounds loop rule entirely), no arrays,
 *   no recursion, no `texture()`, no derivatives, no `discard`.
 * - All float literals carry decimal points (SkSL has no implicit int→float).
 * - Builtins used (clamp/min/max/asin/sin/cos/exp/smoothstep/mix/abs) are all in
 *   the SkSL standard library.
 */
export const CURL_SHADER_SOURCE = `
uniform vec2  pageSize;       // (W, H) in device px
uniform float progress;       // 0..1 curl progress
uniform float curlRadius;     // cylinder radius in px (> 0)
uniform float direction;      // +1 forward (right edge lifts), -1 backward
uniform float shadowStrength; // 0..1 master shadow gain
uniform shader frontPage;     // current page — curls (child 0)
uniform shader backPage;      // next page — revealed underneath (child 1)

const float PI = 3.14159265;
const float HALF_PI = 1.57079633;
const float BACKFACE_TINT = 0.88; // DESIGN.md 7: back face 12% darker

vec4 main(vec2 fragcoord) {
  float W = pageSize.x;
  float y = fragcoord.y;

  // Base layer: the revealed next page, fullscreen.
  vec4 base = backPage.eval(fragcoord);

  float p = clamp(progress, 0.0, 1.0);
  float r = max(curlRadius, 1.0);

  // Mirror so the free (lifting) edge is always at xm = W.
  float xm = direction > 0.0 ? fragcoord.x : (W - fragcoord.x);

  // Cylinder geometry, in mirrored paper space (paper coord xi in [0, W]).
  float tipArc = p * (W + PI * r); // arc length of lifted paper
  float c = W - tipArc;            // tangent point: paper leaves the plane here
  float thetaTip = tipArc / r;     // total wrap angle of the free edge

  // ---- Region 1: the roll, screen xm in (c, c + r] ----
  if (xm > c && p > 0.0) {
    float s = (xm - c) / r;
    if (s <= 1.0) {
      float thLow = asin(clamp(s, 0.0, 1.0)); // front-face branch, [0, PI/2]
      if (thLow <= thetaTip) {
        if (thetaTip < HALF_PI) {
          // Early curl: front face bending away from the viewer.
          float xi = c + r * thLow;
          vec2 fuv = direction > 0.0 ? vec2(xi, y) : vec2(W - xi, y);
          float shade = 0.55 + 0.45 * cos(thLow);
          return vec4(frontPage.eval(fuv).rgb * shade, 1.0);
        }
        float thHigh = PI - thLow; // back-face branch, [PI/2, PI]
        if (thHigh <= thetaTip) {
          float xi = c + r * thHigh;
          // Back face shows the reverse side of the sheet: mirrored sample.
          vec2 backUV = direction > 0.0 ? vec2(W - xi, y) : vec2(xi, y);
          float shade = 0.45 + 0.55 * abs(cos(thHigh)); // darkest at silhouette
          float crease = smoothstep(0.0, 0.35, s);      // inner crease shadow
          vec3 col = frontPage.eval(backUV).rgb * BACKFACE_TINT * shade;
          col *= mix(0.55, 1.0, crease);
          return vec4(col, 1.0);
        }
      }
    }
    // No paper at this screen position (gap past the tip): fall through
    // to the revealed page below.
  }

  // ---- Region 2: tip folded back over the flat page (thetaTip > PI) ----
  // Deeper wraps pass *under* the first fold (lower z), so only the first
  // fold layer (theta = PI + alpha, the topmost) is rendered.
  if (thetaTip > PI && xm <= c) {
    float thCap = min(thetaTip, 2.0 * PI);
    float foldMin = c + r * (thCap <= 1.5 * PI ? sin(thCap) : -1.0);
    if (xm >= foldMin) {
      float alpha = asin(clamp((c - xm) / r, 0.0, 1.0));
      float theta = PI + alpha;
      float xi = c + r * theta;
      vec2 backUV = direction > 0.0 ? vec2(W - xi, y) : vec2(xi, y);
      float shade = 0.45 + 0.55 * abs(cos(theta));
      vec3 col = frontPage.eval(backUV).rgb * BACKFACE_TINT * shade;
      return vec4(col, 1.0);
    }
  }

  // ---- Region 3: flat front page, with soft shadow near the curl line ----
  if (xm <= c) {
    vec4 flat = frontPage.eval(fragcoord);
    float dShadow = (c - xm) / (2.5 * r);
    float sh = 1.0 - shadowStrength * 0.38 * exp(-dShadow * dShadow);
    return vec4(flat.rgb * sh, 1.0);
  }

  // ---- Region 4: paper lifted away -> revealed next page + roll shadow ----
  float dUnder = (xm - c - r) / (1.5 * r);
  float shU = 1.0 - shadowStrength * 0.30 * exp(-dUnder * dUnder);
  return vec4(base.rgb * shU, 1.0);
}
`;
