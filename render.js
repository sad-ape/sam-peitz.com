// Draws the blind over the page with WebGL2: the fragment shader is
// Sources/Shaders/Blinds.metal, ported line for line. Differences: the page
// itself is the HTML underneath, so where the page shows, the shader draws
// only the light it loses to the blind, as a veil over it (the camera is a
// video underneath in the same way, left alone but for the hairline gaps
// between shut slats); and the slats' edges are anti-aliased, since the
// website draws at no more than twice a point, and often less, where the
// app draws at the phone's full three.

import { MAX_SLATS } from './blinds.js';

const vertex = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const fragment = `#version 300 es
precision highp float;
precision highp int;

uniform vec4 uEye;       // xyz eye position, w camera focal length
uniform vec4 uViewport;  // xy size in points, zw 1/size
uniform vec4 uGeo;       // pitch, slatDepth, arcRadius, halfThickness
uniform vec4 uArc;       // cosPhi0, sinPhi0, yTop, maxBend
uniform vec4 uCord;      // cordX, points per design point, page depth, slatCount
uniform vec4 uAnchor;    // ladder cord x left, right, crease width, crown sagitta
uniform vec4 uLook;      // gap shadow size, gap shadow strength, sun shadow strength
uniform vec4 uSun;       // xyz direction towards the sun, w penumbra
uniform vec4 uPageSun;   // xyz direction towards the page's low sun, w penumbra
uniform vec4 uPage;      // page showing (else the camera), unused
uniform vec4 uLadder;    // a third ladder cord down the middle, unused
uniform vec4 uPageShade; // rgb multiplier on the page in shade
uniform vec4 uPageLit;   // rgb multiplier where the sun gets through
uniform vec4 uStack;     // bottom slat y, stack gap, first flat slat, unused
uniform vec4 uLiftA;     // lift cord end 0: anchor x, pull x, pull top y, unused
uniform vec4 uLiftB;     // lift cord end 1: the same
uniform vec4 uHandle;    // anchor y, pull length, pull radius, shown
uniform vec4 uRoom;      // rgb tint on the blind and its cords
uniform vec4 uWeather;   // how much cloud (1 the app's breeze), seconds, drift xy in design points
uniform vec4 uLitRef;    // the light the HTML's colours stand for
uniform vec4 uPaperShown;// the paper as the HTML shows it
uniform vec2 uScale;     // device pixels per point
uniform vec4 uSlats[${MAX_SLATS * 2}]; // per slat: yRest, tilt, bendAmp, bendX | openFrac, -, skew, roll

out vec4 outColor;

// Measured off the design mock, sRGB.
const vec3 kFace       = vec3(0.843, 0.871, 0.878);   // #D7DEE0
const vec3 kRim        = vec3(0.894, 0.910, 0.933);   // #E4E8EE
const vec3 kRung       = vec3(0.306, 0.322, 0.341);   // #4E5257
const vec3 kRungEdge   = vec3(0.478, 0.494, 0.518);   // #7A7E84
const vec3 kStrand     = vec3(0.941, 0.957, 0.980);   // #F0F4FA
const vec3 kStrandEdge = vec3(0.690, 0.710, 0.740);
const vec3 kHandle     = vec3(0.930, 0.940, 0.948);
const vec3 kHandleEdge = vec3(0.560, 0.585, 0.610);

// Design sizes, in design points (scaled by uCord.y).
const float kRimWidth  = 0.9;
const float kStrandOff = 2.0;
const float kStrandR   = 1.0;
const float kRungR     = 2.185;
const float kRungShare = 0.4947;
const float kAA        = 0.4;

struct Slat { float yRest; float tilt; float bendAmp; float bendX; float openFrac; float skew; float roll; };

Slat slatAt(int i) {
  vec4 a = uSlats[2 * i], b = uSlats[2 * i + 1];
  return Slat(a.x, a.y, a.z, a.w, b.x, b.z, b.w);
}

float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.x, p.y, p.x) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i), b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0)), d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float bendProfile(float x, float apex, float xL, float xR, float crease) {
  float rl = (x - xL) / max(apex - xL, 4.0);
  float rr = (xR - x) / max(xR - apex, 4.0);
  return clamp(smin(rl, rr, crease), 0.0, 1.0);
}

struct Frame { float yc; float s; float c; };

/// How far the crease has taken the slat here. With a middle ladder cord the
/// fold lives between the two cords either side of the finger.
float bendAt(Slat sl, float x, float xL, float xR, float crease) {
  if (uLadder.x > 0.5) {
    if (sl.bendX > 0.0) xL = 0.0; else xR = 0.0;
  }
  return bendProfile(x, sl.bendX, xL, xR, crease);
}

float slatCentreY(Slat sl, float x, float xL, float xR, float crease) {
  float p = bendAt(sl, x, xL, xR, crease);
  return sl.yRest - sl.bendAmp * p + sl.roll * (x - 0.5 * (xL + xR));
}

Frame slatFrame(Slat sl, float x, float xL, float xR, float crease) {
  Frame f;
  f.yc = slatCentreY(sl, x, xL, xR, crease);
  float p = bendAt(sl, x, xL, xR, crease);
  float a = clamp((x - xL) / max(xR - xL, 1.0), 0.0, 1.0);
  float th = sl.tilt * (1.0 - sl.openFrac * p) + sl.skew * (a - 0.5);
  f.s = sin(th);
  f.c = cos(th);
  return f;
}

float slatIntersect(vec3 ro, vec3 rd, Frame f, float R, float h, float cp, float sp,
                    out vec2 n2, out float uHit) {
  n2 = vec2(0.0);
  uHit = 0.0;
  float py = ro.y - f.yc;
  float ou = py * f.s + ro.z * f.c;
  float ov = py * f.c - ro.z * f.s;
  float du = rd.y * f.s + rd.z * f.c;
  float dv = rd.y * f.c - rd.z * f.s;

  vec2 q0 = vec2(ou, ov + R);
  vec2 dd = vec2(du, dv);

  float A = dot(dd, dd);
  if (A < 1e-9) return -1.0;
  float B  = dot(q0, dd);
  float qq = dot(q0, q0);

  float Ro = R + h, Ri = R - h;
  float disc = B * B - A * (qq - Ro * Ro);
  if (disc < 0.0) return -1.0;
  float sq = sqrt(disc);
  float lo = (-B - sq) / A;
  float hi = (-B + sq) / A;

  float e1 =  du * cp - dv * sp, g1 =  q0.x * cp - q0.y * sp;
  float e2 = -du * cp - dv * sp, g2 = -q0.x * cp - q0.y * sp;
  if (abs(e1) > 1e-9) { float tc = -g1 / e1; if (e1 > 0.0) hi = min(hi, tc); else lo = max(lo, tc); }
  else if (g1 > 0.0) return -1.0;
  if (abs(e2) > 1e-9) { float tc = -g2 / e2; if (e2 > 0.0) hi = min(hi, tc); else lo = max(lo, tc); }
  else if (g2 > 0.0) return -1.0;
  if (hi <= lo) return -1.0;

  float t = max(lo, 0.01);
  if (t > hi) return -1.0;

  float disc2 = B * B - A * (qq - Ri * Ri);
  if (disc2 > 0.0) {
    float sq2 = sqrt(disc2);
    float i0 = (-B - sq2) / A, i1 = (-B + sq2) / A;
    if (t > i0 && t < i1) { t = i1; if (t > hi) return -1.0; }
  }

  vec2 q = q0 + t * dd;
  float r = length(q);
  uHit = q.x;
  if      (abs(r - Ro) < 2e-2) n2 =  q / r;
  else if (abs(r - Ri) < 2e-2) n2 = -q / r;
  else                         n2 = vec2(q.x >= 0.0 ? cp : -cp, -sp);
  return t;
}

struct Hit { float t; vec3 nrm; int idx; };

void stackRange(float ylo, float yhi, out int kLo, out int kHi) {
  int count = int(uCord.w);
  float railY = uStack.x, gap = max(uStack.y, 0.5);
  // uStack.w: how far a broken blind's crooked stack strays (the website's
  // Easter egg; nought otherwise)
  float pad = uAnchor.w + uGeo.w + 2.0 + uStack.w;
  kLo = max(count - 1 - int(ceil((yhi + pad - railY) / gap)), int(uStack.z));
  kHi = min(count - 1 - int(floor((ylo - pad - railY) / gap)), count - 1);
}

bool traceSlats(vec3 ro, vec3 rd, float xEval, out Hit hit) {
  float pitch = uGeo.x, D = uGeo.y, R = uGeo.z, h = uGeo.w;
  float cp = uArc.x, sp = uArc.y, yTop = uArc.z, maxBend = uArc.w;
  float slab = D * 0.5 + 4.0;

  float ta = (-slab - ro.z) / rd.z, tb = (slab - ro.z) / rd.z;
  float y1 = ro.y + ta * rd.y, y2 = ro.y + tb * rd.y;
  float pad = maxBend + slab;
  int first = int(uStack.z);
  int iLo = max(int(floor((yTop - (max(y1, y2) + pad)) / pitch)) - 1, 0);
  int iHi = min(int(ceil ((yTop - (min(y1, y2) - pad)) / pitch)) + 1, first - 1);
  int sLo, sHi;
  stackRange(min(y1, y2), max(y1, y2), sLo, sHi);

  hit.t = 1e9;
  hit.idx = -1;
  hit.nrm = vec3(0.0);
  for (int pass = 0; pass < 2; ++pass) {
    int lo = pass == 0 ? iLo : sLo, hi = pass == 0 ? iHi : sHi;
    for (int i = lo; i <= hi; ++i) {
      Frame f = slatFrame(slatAt(i), xEval, uAnchor.x, uAnchor.y, uAnchor.z);
      vec2 n2; float uh;
      float t = slatIntersect(ro, rd, f, R, h, cp, sp, n2, uh);
      if (t > 0.0 && t < hit.t) {
        hit.t = t;
        hit.idx = i;
        hit.nrm = vec3(0.0, n2.x * f.s + n2.y * f.c, n2.x * f.c - n2.y * f.s);
      }
    }
  }
  return hit.idx >= 0;
}

float capsuleIntersect(vec3 ro, vec3 rd, vec3 a, vec3 b, float r) {
  vec3 ba = b - a, oa = ro - a;
  float baba = dot(ba, ba), bard = dot(ba, rd), baoa = dot(ba, oa);
  float A = baba - bard * bard;
  if (A < 1e-7) return -1.0;
  float B = baba * dot(rd, oa) - baoa * bard;
  float C = baba * dot(oa, oa) - baoa * baoa - r * r * baba;
  float h = B * B - A * C;
  if (h < 0.0) return -1.0;
  float t = (-B - sqrt(h)) / A;
  float y = baoa + t * bard;
  if (y > 0.0 && y < baba) return t;
  vec3 oc = (y <= 0.0) ? oa : ro - b;
  float B2 = dot(rd, oc);
  float h2 = B2 * B2 - (dot(oc, oc) - r * r);
  return h2 > 0.0 ? -B2 - sqrt(h2) : -1.0;
}

bool hitsLiftCord(vec3 ro, vec3 rd) {
  if (uHandle.w < 0.5) return false;
  float z = -(uGeo.y * 0.5 + 3.0 * uCord.y);
  float hLen = uHandle.y, hR = uHandle.z;
  for (int e = 0; e < 2; ++e) {
    vec4 L = e == 0 ? uLiftA : uLiftB;
    vec3 a = vec3(L.x, uHandle.x, z), b = vec3(L.y, L.z, z);
    vec3 d = normalize(b - a);
    if (capsuleIntersect(ro, rd, a, b, kStrandR * uCord.y) > 0.05) return true;
    if (capsuleIntersect(ro, rd, b + d * hR, b + d * (hLen - hR), hR) > 0.05) return true;
  }
  return false;
}

bool occluded(vec3 ro, vec3 rd) {
  float pitch = uGeo.x, D = uGeo.y, R = uGeo.z, h = uGeo.w;
  float cp = uArc.x, sp = uArc.y, yTop = uArc.z, maxBend = uArc.w;
  float slab = D * 0.5 + 4.0;

  float ta = (-slab - ro.z) / rd.z, tb = (slab - ro.z) / rd.z;
  float y1 = ro.y + max(ta, 0.0) * rd.y, y2 = ro.y + max(tb, 0.0) * rd.y;
  float pad = maxBend + slab;
  int first = int(uStack.z);
  int iLo = max(int(floor((yTop - (max(y1, y2) + pad)) / pitch)) - 1, 0);
  int iHi = min(int(ceil ((yTop - (min(y1, y2) - pad)) / pitch)) + 1, first - 1);
  int sLo, sHi;
  stackRange(min(y1, y2), max(y1, y2), sLo, sHi);

  float xEval = ro.x + rd.x * (-ro.z / rd.z);
  for (int pass = 0; pass < 2; ++pass) {
    int lo = pass == 0 ? iLo : sLo, hi = pass == 0 ? iHi : sHi;
    for (int i = lo; i <= hi; ++i) {
      Frame f = slatFrame(slatAt(i), xEval, uAnchor.x, uAnchor.y, uAnchor.z);
      vec2 n2; float uh;
      if (slatIntersect(ro, rd, f, R, h, cp, sp, n2, uh) > 0.05) return true;
    }
  }
  return hitsLiftCord(ro, rd);
}

float lightVis(vec3 p, vec3 n, vec3 L, float cone, float rnd) {
  vec3 T = normalize(cross(L, vec3(1.0, 0.0, 0.0)));
  vec3 X = vec3(1.0, 0.0, 0.0);
  vec3 o = p + n * 0.35 + L * 0.35;
  const int taps = 8;
  float vis = 0.0;
  for (int k = 0; k < taps; ++k) {
    float a = (float(k) + rnd) / float(taps) - 0.5;
    float b = fract(float(k) * 0.618034 + rnd * 0.7548777) - 0.5;
    if (!occluded(o, normalize(L + (T * a + X * b * 0.35) * (2.0 * cone)))) vis += 1.0;
  }
  return vis / float(taps);
}

float cloudFbm(vec2 p) {
  float v = 0.0, a = 0.5, norm = 0.0;
  for (int i = 0; i < 4; ++i) {
    v += a * vnoise(p);
    norm += a;
    p = p * 2.02 + vec2(17.3, 9.1);
    a *= 0.45;
  }
  return v / norm;
}

float cloudCover(vec2 xy) {
  float t = uWeather.y;
  vec2 drift = uWeather.zw * uCord.y;          // rightwards, barely sinking
  vec2 q = (xy - drift) / (420.0 * uCord.y);
  vec2 w = vec2(cloudFbm(q * 0.6 + vec2(0.0, t * 0.015)),
                cloudFbm(q * 0.6 + vec2(5.2, 1.3 - t * 0.012)));
  float n = cloudFbm(q + 0.6 * (w - 0.5));
  return smoothstep(0.46, 0.66, n);
}

float normcdf(float x) { return 1.0 / (1.0 + exp(-1.702 * x)); }

/// The Figma drop shadow under a slat, d design points below its edge.
float figmaShadow(float d) {
  float keep = 1.0;
  keep *= 1.0 - 0.46 * normcdf(( 1.0 - d) / 0.5);
  keep *= 1.0 - 0.40 * normcdf(( 3.0 - d) / 1.5);
  keep *= 1.0 - 0.23 * normcdf(( 6.0 - d) / 2.0);
  keep *= 1.0 - 0.07 * normcdf((11.0 - d) / 2.0);
  keep *= 1.0 - 0.01 * normcdf((17.0 - d) / 2.5);
  return 1.0 - keep;
}

vec2 slatOnScreen(Frame f, float D, float sag, vec3 eye) {
  float lo = 1e9, hi = -1e9;
  for (int k = 0; k < 2; ++k) {
    float u = (k == 0) ? -0.5 * D : 0.5 * D;
    float y = f.yc + u * f.s - sag * f.c;
    float z = u * f.c + sag * f.s;
    float sy = eye.y + (y - eye.y) * (-eye.z) / max(z - eye.z, 1.0);
    lo = min(lo, sy);
    hi = max(hi, sy);
  }
  return vec2(lo, hi);
}

/// What one ray through P2 (world: centre origin, y up) sees before the
/// cords go over it - a slat, lit and shaded; the page, as a veil of the
/// light it loses; or the camera's gap shadows - and whether it's a slat and
/// where that slat's face is, for the rungs. (The website's anti-aliasing
/// asks it more than once a pixel where a slat's edge crosses it.)
vec4 scene(vec2 P2, float rnd, out bool onSlat, out float faceMid, out float faceH, out int surface) {
  vec3 ro = uEye.xyz;
  vec3 rd = normalize(vec3(P2, 0.0) - ro);

  float sc = uCord.y;
  float D = uGeo.y, sag = uAnchor.w;
  float xL = uAnchor.x, xR = uAnchor.y, crease = uAnchor.z;
  float aa = kAA * sc;

  Hit hit;
  onSlat = traceSlats(ro, rd, P2.x, hit);
  surface = onSlat ? hit.idx : -1;

  // premultiplied: a slat is opaque, the page is a veil over the HTML
  vec4 col;
  faceMid = 0.0;
  faceH = 0.0;
  if (onSlat) {
    vec2 own = slatOnScreen(slatFrame(slatAt(hit.idx), P2.x, xL, xR, crease), D, sag, ro);
    float upper = 1e9;
    if (hit.idx > 0) {
      upper = slatOnScreen(slatFrame(slatAt(hit.idx - 1), P2.x, xL, xR, crease), D, sag, ro).x;
    }
    vec3 c = kFace * uRoom.rgb;
    c = mix(c, kRim * uRoom.rgb, 1.0 - smoothstep(kRimWidth * sc - aa, kRimWidth * sc, P2.y - own.x));

    vec3 p = ro + hit.t * rd;
    vec3 n = hit.nrm;
    float lit = lightVis(p, n, uSun.xyz, uSun.w, rnd) * smoothstep(-0.08, 0.12, dot(n, uSun.xyz));
    float cloud = uWeather.x > 0.0 ? cloudCover(P2) * uWeather.x : 0.0;
    lit *= 1.0 - 0.60 * cloud;
    c *= (1.0 - uLook.z * (1.0 - lit)) * (1.0 - 0.10 * cloud);
    col = vec4(c, 1.0);

    float top = min(own.y, upper);
    faceMid = 0.5 * (top + own.x);
    faceH = max(top - own.x, 0.0);
  } else if (uPage.x > 0.5) {
    // the page, lit by its own low sun through the blind. The HTML shows it
    // in full light; what the app would multiply it by becomes a dark veil,
    // plus the little the paper's own colour needs that darkening can't give
    vec3 P = ro + ((uCord.z - ro.z) / max(rd.z, 1e-4)) * rd;
    float lit = lightVis(P, vec3(0.0, 0.0, -1.0), uPageSun.xyz, uPageSun.w, rnd);
    float cloud = uWeather.x > 0.0 ? cloudCover(P2) * uWeather.x : 0.0;
    lit *= 1.0 - 0.60 * cloud;
    vec3 m = mix(uPageShade.rgb, uPageLit.rgb, lit) * (1.0 - 0.08 * cloud);
    // the darkening every channel shares as a veil, and the rest of the
    // light's colour on top - so shade can be cooler than the sun, and a
    // sunset warmer than the paper
    vec3 rel = m / uLitRef.rgb;
    float keep = clamp(min(rel.r, min(rel.g, rel.b)), 0.0, 1.0);
    col = vec4(uPaperShown.rgb * (rel - keep), 1.0 - keep);
  } else {
    // The camera is not touched - except that a tiny gap between shut slats
    // reads dark, as in the design: the slat above throws its shadow into it.
    float pitch = uGeo.x;
    int k0 = int(floor((uArc.z - P2.y) / pitch));
    int count = int(uCord.w);
    float above = 1e9, below = -1e9;
    for (int k = max(k0 - 2, 0); k <= min(k0 + 2, count - 1); ++k) {
      vec2 e = slatOnScreen(slatFrame(slatAt(k), P2.x, xL, xR, crease), D, sag, ro);
      if (e.x >= P2.y) above = min(above, e.x);
      if (e.y <= P2.y) below = max(below, e.y);
    }
    float dark = 0.0;
    if (above < 1e8 && below > -1e8) {
      float tiny = 1.0 - smoothstep(4.0 * sc, 9.0 * sc, above - below);
      dark = tiny * uLook.y * figmaShadow((above - P2.y) / (sc * uLook.x));
    }
    col = vec4(0.0, 0.0, 0.0, dark);
  }
  return col;
}

/// Which surface a ray through P2 meets first: a slat's index, or -1 for
/// what's behind the blind. Cheap - it traces, it doesn't shade.
int surfaceAt(vec2 P2) {
  vec3 ro = uEye.xyz;
  Hit h;
  return traceSlats(ro, normalize(vec3(P2, 0.0) - ro), P2.x, h) ? h.idx : -1;
}

/// Whether a slat's edge, as drawn, passes within \`band\` of P2 - the only
/// pixels worth a closer look. Hanging slats near here (as far off their
/// places as a bend or a broken blind takes them), and the stack.
bool nearEdge(vec2 P2, float band) {
  float pitch = uGeo.x, D = uGeo.y, sag = uAnchor.w;
  int count = int(uCord.w), first = int(uStack.z);
  int k0 = int(floor((uArc.z - P2.y) / pitch));
  int span = int(ceil(uArc.w / pitch)) + 2;
  for (int k = max(k0 - span, 0); k <= min(k0 + span, first - 1); ++k) {
    vec2 e = slatOnScreen(slatFrame(slatAt(k), P2.x, uAnchor.x, uAnchor.y, uAnchor.z), D, sag, uEye.xyz);
    if (abs(e.x - P2.y) < band || abs(e.y - P2.y) < band) return true;
  }
  if (first < count) {
    int sLo, sHi;
    stackRange(P2.y - band, P2.y + band, sLo, sHi);
    for (int k = sLo; k <= sHi; ++k) {
      vec2 e = slatOnScreen(slatFrame(slatAt(k), P2.x, uAnchor.x, uAnchor.y, uAnchor.z), D, sag, uEye.xyz);
      if (abs(e.x - P2.y) < band || abs(e.y - P2.y) < band) return true;
    }
  }
  return false;
}

void main() {
  vec2 vpHalf = uViewport.xy * 0.5;
  vec2 P2 = gl_FragCoord.xy / uScale - vpHalf;       // world: centre origin, y up
  float sc = uCord.y;
  float aa = kAA * sc;
  float rnd = ign(gl_FragCoord.xy);

  bool onSlat;
  float faceMid, faceH;
  int here;
  vec4 col = scene(P2, rnd, onSlat, faceMid, faceH, here);

  // anti-aliasing (the website's): one ray a pixel left the slats' edges
  // stepped. Near an edge, two cheap rays half a pixel above and below say
  // whether one crosses this pixel; if so, a few more find where, and the
  // pixel is the two sides mixed by how much of it each covers. The cords
  // draw their own soft edges over the top.
  float hp = 0.5 / uScale.y;                          // half a pixel, in points
  if (nearEdge(P2, 6.0 * hp)) {
    int above = surfaceAt(P2 + vec2(0.0, hp));
    int below = surfaceAt(P2 - vec2(0.0, hp));
    if (above != here || below != here) {
      float dir = above != here ? 1.0 : -1.0;
      float a = 0.0, b = hp;
      for (int i = 0; i < 4; ++i) {
        float m = 0.5 * (a + b);
        if (surfaceAt(P2 + vec2(0.0, dir * m)) == here) a = m; else b = m;
      }
      float edge = 0.5 * (a + b);
      bool o;
      float m1, h1;
      int s1;
      vec4 other = scene(P2 + vec2(0.0, dir * 0.5 * (edge + hp)), rnd, o, m1, h1, s1);
      col = mix(other, col, (edge + hp) / (2.0 * hp));
    }
  }

  // ladder cords, drawn as designed (a third down the middle of a wide
  // blind); they end at the bottom slat - and, once a broken blind has come
  // off its brackets (uLadder.y, the website's Easter egg), at its top, z
  bool belowBlind = P2.y < uStack.x - uAnchor.w - 2.0 * sc || (uLadder.y > 0.5 && P2.y > uLadder.z);
  for (int side = 0; side < 3 && !belowBlind; ++side) {
    if (side == 2 && uLadder.x < 0.5) break;
    float dx = P2.x - (side == 0 ? -uCord.x : side == 1 ? uCord.x : 0.0);
    float adx = abs(dx);
    if (adx > 12.0 * sc) continue;

    if (onSlat) {
      float left = -dx - (kStrandOff + kStrandR) * sc;
      if (left > 0.0) col.rgb *= 1.0 - 0.20 * exp(-left / (1.8 * sc));
      float right = dx - (kStrandOff + kStrandR) * sc;
      if (right > 0.0) col.rgb *= 1.0 - 0.09 * exp(-right / (0.9 * sc));

      col.rgb *= 1.0 - 0.28 * (1.0 - smoothstep((kStrandOff - kStrandR) * sc - aa,
                                                (kStrandOff - kStrandR) * sc, adx));

      float rungHalf = kRungShare * faceH * 0.5;
      float r = kRungR * sc;
      float seg = max(rungHalf - r, 0.0);
      float dist = length(vec2(dx, max(abs(P2.y - faceMid) - seg, 0.0)));
      if (rungHalf > 0.5 && dist < r) {
        vec3 rung = mix(kRung, kRungEdge, smoothstep(0.35 * r, r, dist)) * uRoom.rgb;
        col = mix(col, vec4(rung, 1.0), 1.0 - smoothstep(r - aa, r, dist));
      }
    }

    for (int k = 0; k < 2; ++k) {
      float t = abs(dx - (k == 0 ? -kStrandOff : kStrandOff) * sc) / (kStrandR * sc);
      if (t >= 1.0) continue;
      vec3 strand = mix(kStrandEdge, kStrand, sqrt(1.0 - t * t)) * uRoom.rgb;
      col = mix(col, vec4(strand, 1.0), 1.0 - smoothstep(1.0 - kAA / kStrandR, 1.0, t));
    }
  }

  // the lift cord and its two pulls; their shadows are traced with the slats'
  if (uHandle.w > 0.5) {
    float hLen = uHandle.y, hR = uHandle.z;
    for (int e = 0; e < 2; ++e) {
      vec4 L = e == 0 ? uLiftA : uLiftB;
      vec2 A = vec2(L.x, uHandle.x), B = vec2(L.y, L.z);
      vec2 d = normalize(B - A);

      // the cord, anchor to pull, drawn like a ladder strand: 2pt of white
      // rounding off to grey, and the same thin shadow beside it - a touch
      // to its left, less to its right - where it hangs against the slats, as
      // the strands' does (on the far page it read as a drop shadow)
      vec2 pa = P2 - A, ba = B - A;
      float along = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
      vec2 across = pa - ba * along;
      float apart = length(across);
      if (apart < 12.0 * sc && onSlat) {
        float side = d.x * across.y - d.y * across.x;          // + to the cord's right
        float left = -side - kStrandR * sc, right = side - kStrandR * sc;
        if (left > 0.0) col = mix(col, vec4(0.0, 0.0, 0.0, 1.0), 0.20 * exp(-left / (1.8 * sc)));
        if (right > 0.0) col = mix(col, vec4(0.0, 0.0, 0.0, 1.0), 0.09 * exp(-right / (0.9 * sc)));
      }
      float t = apart / (kStrandR * sc);
      if (t < 1.0) {
        vec3 strand = mix(kStrandEdge, kStrand, sqrt(1.0 - t * t)) * uRoom.rgb;
        col = mix(col, vec4(strand, 1.0), 1.0 - smoothstep(1.0 - kAA / kStrandR, 1.0, t));
      }

      vec2 p0 = B + d * hR, p1 = B + d * (hLen - hR);
      vec2 pp = P2 - p0, cc = p1 - p0;
      float k = clamp(dot(pp, cc) / dot(cc, cc), 0.0, 1.0);
      vec2 off = pp - cc * k;
      float dist = length(off);
      if (dist < hR) {
        float across = clamp((off.x * d.y - off.y * d.x) / hR, -1.0, 1.0);
        vec3 pull = mix(kHandleEdge, kHandle, sqrt(max(1.0 - across * across, 0.0)));
        pull = mix(pull, kHandleEdge * 0.8, smoothstep(0.82, 1.0, dist / hR)) * uRoom.rgb;
        col = mix(col, vec4(pull, 1.0), 1.0 - smoothstep(hR - aa, hR, dist));
      }
    }
  }

  outColor = col;
}`;

const NAMES = ['uEye', 'uViewport', 'uGeo', 'uArc', 'uCord', 'uAnchor', 'uLook', 'uSun', 'uPageSun', 'uPage', 'uLadder',
               'uPageShade', 'uPageLit', 'uStack', 'uLiftA', 'uLiftB', 'uHandle', 'uRoom', 'uWeather',
               'uLitRef', 'uPaperShown'];

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', {
      alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 is not available');
    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
      return sh;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vertex));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    this.gl = gl;
    this.canvas = canvas;
    this.prog = prog;
    this.vao = gl.createVertexArray();
    this.loc = {};
    for (const n of [...NAMES, 'uScale', 'uSlats']) this.loc[n] = gl.getUniformLocation(prog, n);
  }

  draw(uniforms, slats, count, width, height) {
    const { gl, canvas, loc } = this;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    for (const n of NAMES) gl.uniform4fv(loc[n], uniforms[n]);
    gl.uniform2f(loc.uScale, canvas.width / width, canvas.height / height);
    gl.uniform4fv(loc.uSlats, slats, 0, count * 8);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
