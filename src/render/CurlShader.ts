/**
 * CurlShader — page-curl as a Skia RuntimeEffect (spike S2, PRD §6.3).
 * Cylinder model: the turning page wraps around a vertical cylinder of
 * radius u_r; the fold line sweeps right→left with progress u_t.
 * - Left of the fold: current page, flat.
 * - On the cylinder: back face of the current page, 12% darker + soft
 *   shading along the curl (DESIGN §5: back-face 12% darker).
 * - Past the curl: the next page revealed underneath, with a soft shadow
 *   hugging the fold line.
 * Settle animation: 300 ms ease-out, no overshoot (DESIGN §5).
 */
import { Skia } from '@shopify/react-native-skia';

export const CURL_SHADER_SRC = `
uniform shader pageA;   // current page (turning)
uniform shader pageB;   // next page (revealed beneath)
uniform float2 u_res;   // canvas size, px
uniform float u_t;      // turn progress 0..1 (finger-follow)
uniform float u_r;      // cylinder radius, px

half4 main(float2 p) {
  float fold = u_res.x * (1.0 - u_t);
  float d = p.x - fold;

  if (d <= 0.0) {
    // Flat region: current page, untouched.
    return pageA.eval(p);
  }

  float theta = d / u_r;
  if (theta < 3.14159265) {
    // On the cylinder: sample the page's back face, mirrored around the fold.
    float sx = fold - sin(theta) * u_r;
    // Clamp to the page edge so the curl never samples outside the page.
    sx = clamp(sx, 0.0, u_res.x);
    half4 c = pageA.eval(half2(sx, p.y));
    // Back-face tint: 12% darker at the fold, easing to 30% at the rim,
    // plus a highlight streak where the cylinder catches the light.
    float shade = 0.88 - 0.18 * sin(theta) + 0.10 * pow(max(0.0, cos(theta)), 8.0);
    return half4(c.rgb * shade, c.a);
  }

  // Revealed region: next page, with a soft shadow near the fold line.
  half4 c = pageB.eval(p);
  float shadowDist = clamp((d - 3.14159265 * u_r) / (u_r * 2.5), 0.0, 1.0);
  float shadow = mix(0.55, 1.0, shadowDist * shadowDist);
  return half4(c.rgb * shadow, c.a);
}
`;

let cached: ReturnType<typeof Skia.RuntimeEffect.Make> | null = null;

/** Compiled curl effect (throws with a clear message if compilation fails). */
export function getCurlEffect() {
  if (!cached) {
    const effect = Skia.RuntimeEffect.Make(CURL_SHADER_SRC);
    if (!effect) throw new Error('CurlShader failed to compile');
    cached = effect;
  }
  return cached;
}

/** Default cylinder radius as a fraction of page width. */
export const CURL_RADIUS_FRACTION = 0.18;
