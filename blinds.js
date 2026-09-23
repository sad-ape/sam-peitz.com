// The blind's state and physics, ported line for line from
// Sources/App/BlindsCore.swift. The app is the reference: a change there
// belongs here too. World units are CSS pixels: origin at the centre of the
// window, +x right, +y up.

export const Config = {
  refWidth: 402,
  pitch: 55.22,
  slatDepth: 54.4,
  arcRadius: 80,
  thickness: 0.62,
  cordInset: 42.5,
  firstSlatCenter: 17.3,
  eyeDistance: 1400,
  subjectDepth: 760,
  creaseWidth: 0.12,
  tiltClosed: 78 * Math.PI / 180,
  tiltLimit: 78 * Math.PI / 180,
  cordTravel: 150,
  sunUp: 0.85, sunView: 0.52, sunSide: 0.10, sunPenumbra: 0.30,
  shadowStrength: 0.38,
  pageSunUp: 0.34, pageSunView: 0.94, pageSunSide: 0.10, pagePenumbra: 0.01,
  pageShade: [0.61, 0.585, 0.545],
  pageSunlit: [1.06, 1.01, 0.895],
  dayRoom: [1.03, 1.0, 0.93],
  nightShade: [0.55, 0.60, 0.72],
  nightMoonlit: [1.55, 1.70, 2.00],
  nightRoom: [0.34, 0.38, 0.48],
  liftGearing: 3,
  liftCordX: 128,
  liftCordSpacing: 6,
  liftHandleRest: 0.08,
  liftCordStagger: 16,
  liftHandleLength: 26,
  liftHandleRadius: 3.8,
  liftAnchorAbove: 260,
  cordSwingLimit: 40,
  cordDamping: 0.12,
  gravity: 20200,
  stackGap: 3.2,
  stackFlatten: 20,
  pageDepth: 420,
  slatYJitter: 3.2,
  slatTiltJitter: 0.075,
  slatSkew: 0.07,
  slatRoll: 0.0185,
  slatFrequency: 20,
  slatDamping: 0.68,
  creaseTwist: 0.95,
  pushGive: 0.65,
  gapShadowSize: 1.8,
  gapShadowStrength: 0.8,
  /// Web only: a blind more than about two phones wide gets a third ladder
  /// cord down the middle, as a real wide blind has, and a push bends a slat
  /// only between the two cords either side of the finger.
  middleLadderWidth: 800,
};

/// The shader has room for this many slats.
export const MAX_SLATS = 64;

/// A light from how far up, towards the viewer and to one side it sits.
/// Up is fixed: the app's lights don't follow the phone yet either.
function light(wUp, wView, wSide) {
  let L = [wSide, wUp, -wView];
  let n = Math.hypot(...L);
  L = L.map(v => v / n);
  if (L[2] > -0.15) {
    L[2] = -0.15;
    n = Math.hypot(...L);
    L = L.map(v => v / n);
  }
  return L;
}

/// The same untidiness as the app: Swift's wrapping 64-bit product keeps the
/// same low 16 bits as a 32-bit one.
function jitter(i, salt) {
  const x = ((Math.imul(i, 73856093) ^ Math.imul(salt, 19349663)) & 0xFFFF) / 65535;
  return x - 0.5;
}

/// Swift's rounded(): halves away from zero.
function round(x) { return Math.sign(x) * Math.round(Math.abs(x)); }

export class BlindsModel {
  constructor() {
    this.width = Config.refWidth;
    this.height = 874;
    this.s = 1;
    this.count = 0;
    this.yTop = 0;
    this.extraTop = 0;
    this.tilt = Config.tiltClosed * 0.97;
    this.tiltVel = 0;
    this.amp = [];
    this.vel = [];
    this.apexX = [];
    this.heldAmp = [];
    this.fingered = [];
    this.lift = 0;
    this.liftEnabled = false;
    this.swing = [0, 0];
    this.swingVel = [0, 0];
    this.swingHeld = [null, null];
    this.grabOffset = [0, 0];
    this.liftVel = 0;
    this.middleLadder = false;
    // what the app turns into haptics, and the page into sound
    this.snapImpulse = 0;
    this.stackClick = false;
    this.stackedCount = 0;
  }

  /// How hard the last slat landed back home, 0..1, cleared as it is read.
  takeSnapImpulse() {
    const s = this.snapImpulse;
    this.snapImpulse = 0;
    return s;
  }

  /// Whether a slat joined or left the stack, cleared as it is read.
  takeStackClick() {
    const c = this.stackClick;
    this.stackClick = false;
    return c;
  }

  get railY() { return this.yRest(this.count - 1) + this.lift; }
  get maxLift() { return this.height / 2 + 40 * this.s - this.yRest(this.count - 1); }

  stackY(k) { return this.railY + (this.count - 1 - k) * Config.stackGap * this.s; }

  pushedUp(k) { return this.lift > 0 ? Math.max(this.stackY(k) - this.yRest(k), 0) : 0; }

  isStacked(k) { return this.pushedUp(k) > 0; }

  get firstFlat() {
    if (!(this.lift > 0)) return this.count;
    const flat = Config.stackFlatten * this.s;
    let k = this.count - 1;
    while (k > 0 && this.pushedUp(k - 1) >= flat) k -= 1;
    return this.pushedUp(k) >= flat ? k : this.count;
  }

  get handleTops() {
    const rest = this.height * Config.liftHandleRest;
    const stagger = Config.liftCordStagger * this.s / 2;
    const travel = this.lift / Config.liftGearing;
    return [rest - stagger - travel, rest + stagger + travel];
  }

  get liftCordX() { return Config.liftCordX * this.s; }
  get liftAnchorY() { return this.height / 2 + Config.liftAnchorAbove * this.s; }

  cordAnchorX(h) { return this.liftCordX + (h === 0 ? -0.5 : 0.5) * Config.liftCordSpacing * this.s; }
  handleX(h) { return this.cordAnchorX(h) + this.swing[h]; }

  liftHandle(x, y) {
    if (!this.liftEnabled) return null;
    const tops = this.handleTops;
    const len = Config.liftHandleLength * this.s;
    for (let i = 0; i < 2; i++) {
      const top = tops[i];
      if (Math.abs(x - this.handleX(i)) < 18 * this.s && y < top + 16 * this.s && y > top - len - 16 * this.s) return i;
    }
    return null;
  }

  beginLift(h, x) {
    this.grabOffset[h] = x - this.handleX(h);
    this.swingHeld[h] = this.swing[h];
  }

  dragLift(h, dy, x) {
    const pull = h === 0 ? dy : -dy;
    this.lift = Math.min(Math.max(this.lift + pull * Config.liftGearing, 0), this.maxLift);
    const limit = Config.cordSwingLimit * this.s;
    this.swingHeld[h] = Math.min(Math.max(x - this.grabOffset[h] - this.cordAnchorX(h), -limit), limit);
  }

  endLift(h) {
    this.swingHeld[h] = null;
    const other = 1 - h;
    this.swingVel[other] += (h === 0 ? 1 : -1) * Math.min(Math.abs(this.liftVel), 3000) * 0.012;
  }

  get pitch() { return Config.pitch * this.s; }
  get depth() { return Config.slatDepth * this.s; }
  get cordX() { return this.width / 2 - Config.cordInset * this.s; }

  /// `s` is the blind's scale from the app's 402pt-wide phone; the page sets
  /// it so slats and type keep the proportions they have in the app.
  resize(w, h, s) {
    if (!(w > 0 && h > 0)) return;
    this.width = w;
    this.height = h;
    this.s = s;
    this.middleLadder = w / s >= Config.middleLadderWidth;
    const p = this.pitch;
    this.extraTop = 12;
    this.yTop = h / 2 - Config.firstSlatCenter * s + this.extraTop * p;
    const n = Math.min(Math.ceil((this.yTop + h / 2) / p) + 2, MAX_SLATS);
    if (n !== this.count) {
      this.count = n;
      this.amp = new Array(n).fill(0);
      this.vel = new Array(n).fill(0);
      this.apexX = new Array(n).fill(0);
      this.heldAmp = new Array(n).fill(null);
      this.fingered = new Array(n).fill(false);
    }
  }

  yRest(i) { return this.yTop - i * this.pitch + jitter(i, 11) * Config.slatYJitter * this.s; }

  slatTilt(i) { return this.tilt + jitter(i, 29) * Config.slatTiltJitter; }
  slatSkew(i) { return jitter(i, 71) * Config.slatSkew; }
  slatRollSlope(i) {
    const r = jitter(i, 89) * 2;
    return r * r * r * Config.slatRoll;
  }

  slatAtWorldY(y) {
    const i = round((this.yTop - y) / this.pitch);
    return Math.min(Math.max(i, 0), Math.max(this.count - 1, 0));
  }

  gap(u, l, x, p, ampU, ampL, twistU, twistL) {
    const a = Math.min(Math.max((x + this.cordX) / (2 * this.cordX), 0), 1);
    const tu = this.slatTilt(u) * (1 - twistU * p) + this.slatSkew(u) * (a - 0.5);
    const tl = this.slatTilt(l) * (1 - twistL * p) + this.slatSkew(l) * (a - 0.5);
    const yu = this.yRest(u) + this.slatRollSlope(u) * x - ampU * p;
    const yl = this.yRest(l) + this.slatRollSlope(l) * x - ampL * p;
    const R = Config.arcRadius * this.s;
    const crown = R * (1 - Math.cos(Math.asin(Math.min(1, this.depth / (2 * R)))));
    return (yu - yl) - this.depth / 2 * (Math.sin(tu) + Math.sin(tl)) - crown * (Math.cos(tu) - Math.cos(tl));
  }

  mustDrop(l, u) {
    const x = this.apexX[u];
    const now = this.gap(u, l, x, 1, this.amp[u], this.amp[l], this.openFrac(u), this.openFrac(l));
    const rest = this.gap(u, l, x, 1, 0, 0, 0, 0);
    return this.amp[l] + Math.min(rest, 0) - now;
  }

  mustRise(u, l) {
    const x = this.apexX[l];
    const now = this.gap(u, l, x, 1, this.amp[u], this.amp[l], this.openFrac(u), this.openFrac(l));
    const rest = this.gap(u, l, x, 1, 0, 0, 0, 0);
    return this.amp[u] - (Math.min(rest, 0) - now);
  }

  openFrac(i) {
    return this.fingered[i] ? Math.min(Config.creaseTwist, Math.abs(this.amp[i]) / (this.pitch * 0.85)) : 0;
  }

  // input

  beginBend(i, x) {
    if (i < 0 || i >= this.count || this.isStacked(i)) return;
    this.apexX[i] = this.clampApex(x);
    this.heldAmp[i] = this.amp[i];
    this.fingered[i] = true;
  }

  /// `drag` is how far the finger has moved since touching down, positive
  /// downwards. The slat follows it one for one.
  updateBend(i, x, drag) {
    if (i < 0 || i >= this.count || this.heldAmp[i] === null) return;
    this.apexX[i] = this.clampApex(x);
    this.heldAmp[i] = drag;
  }

  endBend(i) {
    if (i < 0 || i >= this.count) return;
    this.heldAmp[i] = null;
  }

  clampApex(x) {
    x = Math.min(Math.max(x, -this.cordX + 10 * this.s), this.cordX - 10 * this.s);
    // a slat held by the middle cord doesn't fold right on it either
    if (this.middleLadder && Math.abs(x) < 10 * this.s) x = (x < 0 ? -10 : 10) * this.s;
    return x;
  }

  dragTilt(dy) {
    this.tilt += dy * Config.tiltLimit / (Config.cordTravel * this.s);
    this.tilt = Math.min(Math.max(this.tilt, 0), Config.tiltLimit);
    this.tiltVel = 0;
  }

  flingTilt(dy) { this.tiltVel = dy * Config.tiltLimit / (Config.cordTravel * this.s); }

  toggleOpen() {
    const target = this.tilt > Math.PI / 5 ? 0 : Config.tiltClosed;
    this.tiltVel = (target - this.tilt) * 9;
  }

  /// Nothing moving and nothing held: the last frame drawn still stands.
  get atRest() {
    if (this.tiltVel !== 0) return false;
    for (let i = 0; i < this.count; i++) {
      if (this.amp[i] !== 0 || this.vel[i] !== 0 || this.heldAmp[i] !== null) return false;
    }
    for (let h = 0; h < 2; h++) {
      if (this.swing[h] !== 0 || this.swingVel[h] !== 0 || this.swingHeld[h] !== null) return false;
    }
    return this.liftEnabled || this.lift === 0;
  }

  // integration

  step(dt) {
    const h = Math.min(dt, 1 / 30);
    const liftAtStart = this.lift;
    const sub = 8;
    for (let i = 0; i < sub; i++) this.integrate(h / sub);
    if (h > 0) this.liftVel = (this.lift - liftAtStart) / h;
  }

  integrate(dt) {
    if (!this.liftEnabled && this.lift > 0) {
      this.lift *= Math.exp(-8 * dt);
      if (this.lift < 0.5) this.lift = 0;
    }

    // each end of the lift cord is a pendulum as long as its cord
    const tops = this.handleTops;
    for (let h = 0; h < 2; h++) {
      const target = this.swingHeld[h];
      if (target !== null) {
        this.swingVel[h] = (target - this.swing[h]) / Math.max(dt, 1e-4);
        this.swing[h] = target;
      } else {
        const length = Math.max(this.liftAnchorY - tops[h] + Config.liftHandleLength * this.s / 2, 40 * this.s);
        const w = Math.sqrt(Config.gravity * this.s / length);
        this.swingVel[h] += (-w * w * this.swing[h] - 2 * Config.cordDamping * w * this.swingVel[h]) * dt;
        this.swing[h] += this.swingVel[h] * dt;
        if (Math.abs(this.swing[h]) < 0.05 && Math.abs(this.swingVel[h]) < 0.5) {
          this.swing[h] = 0;
          this.swingVel[h] = 0;
        }
      }
    }

    let stacked = 0;
    for (let i = 0; i < this.count; i++) if (this.isStacked(i)) stacked++;
    if (stacked !== this.stackedCount) {
      this.stackedCount = stacked;
      this.stackClick = true;
    }

    // tilt: inertia with soft end stops
    if (this.tiltVel !== 0) {
      this.tilt += this.tiltVel * dt;
      this.tiltVel *= Math.exp(-6 * dt);
      if (Math.abs(this.tiltVel) < 0.002) this.tiltVel = 0;
    }
    const lim = Config.tiltLimit;
    if (this.tilt > lim) { this.tilt = lim; this.tiltVel = Math.min(this.tiltVel, 0); }
    if (this.tilt < 0) { this.tilt = 0; this.tiltVel = Math.max(this.tiltVel, 0); }

    // slats: stiff and well damped, so a released slat snaps home
    const w = 2 * Math.PI * Config.slatFrequency;
    const k = w * w, c = 2 * Config.slatDamping * w;
    const pitch = this.pitch;
    for (let i = 0; i < this.count; i++) {
      const target = this.heldAmp[i];
      if (target !== null) {
        const next = Math.min(Math.max(target, -pitch * 0.98), pitch * 0.98);
        this.vel[i] = (next - this.amp[i]) / Math.max(dt, 1e-4);
        this.amp[i] = next;
      } else {
        const was = this.amp[i];
        this.vel[i] += (-k * this.amp[i] - c * this.vel[i]) * dt;
        this.amp[i] += this.vel[i] * dt;
        // it just passed through its rest position: that is the click
        if (was !== 0 && (was > 0) !== (this.amp[i] > 0)) {
          this.snapImpulse = Math.max(this.snapImpulse, Math.min(1, Math.abs(this.vel[i]) / 700));
        }
        if (Math.abs(this.amp[i]) < 0.02 && Math.abs(this.vel[i]) < 0.4) {
          this.amp[i] = 0;
          this.vel[i] = 0;
          this.fingered[i] = false;
        }
      }
    }

    // A slat pushed down lands on the one below and carries it down; a slat
    // pulled up lifts the one above.
    const give = Config.pushGive;
    for (let u = 0; u < this.count - 1; u++) {
      if (!(this.amp[u] > 0.01)) continue;
      const l = u + 1;
      if (this.heldAmp[l] !== null || this.isStacked(l)) continue;
      const was = this.apexX[l];
      this.apexX[l] = this.apexX[u];
      let need = this.mustDrop(l, u);
      if (!this.fingered[u]) need *= give;
      if (need > this.amp[l]) {
        this.amp[l] = need;
        this.vel[l] = 0;
      } else {
        this.apexX[l] = was;
      }
    }
    for (let l = this.count - 1; l >= 1; l--) {
      if (!(this.amp[l] < -0.01)) continue;
      const u = l - 1;
      if (this.heldAmp[u] !== null || this.isStacked(u)) continue;
      const was = this.apexX[u];
      this.apexX[u] = this.apexX[l];
      let need = this.mustRise(u, l);
      if (!this.fingered[l]) need *= give;
      if (need < this.amp[u]) {
        this.amp[u] = need;
        this.vel[u] = 0;
      } else {
        this.apexX[u] = was;
      }
    }
  }

  // GPU packing: two vec4 per slat, as the shader reads them

  packSlats(out) {
    const flatten = Config.stackFlatten * this.s;
    for (let i = 0; i < this.count; i++) {
      const up = this.pushedUp(i);
      const flat = Math.min(up / flatten, 1);
      const o = i * 8;
      out[o] = this.yRest(i) + up;
      out[o + 1] = this.slatTilt(i) * (1 - flat);
      out[o + 2] = up > 0 ? 0 : this.amp[i];
      out[o + 3] = this.apexX[i];
      out[o + 4] = this.openFrac(i);
      out[o + 5] = 0;
      out[o + 6] = this.slatSkew(i);
      out[o + 7] = this.slatRollSlope(i);
    }
  }

  /// `page` false: the camera is behind the blind instead of the page.
  /// `cloud` is how much cloud goes over (1 the app's breeze), `drift` how far
  /// it has blown, in design points. `sky`, if given, sets the light instead
  /// of the app's: where the two suns are (up, towards the viewer, to the
  /// side) and the colours of sun, shade and room.
  uniforms({ page = true, night = false, cloud = 0, drift = [0, 0], time = 0, sky = null } = {}) {
    const s = this.s;
    const focal = Config.eyeDistance * s;
    const R = Config.arcRadius * s;
    const D = this.depth;
    const phi0 = Math.asin(Math.min(1, D / (2 * R)));
    let maxAmp = 0;
    for (let i = 0; i < this.count; i++) maxAmp = Math.max(maxAmp, Math.abs(this.amp[i]));
    const [ha, hb] = this.handleTops;
    const L = sky ? light(...sky.sun) : light(Config.sunUp, Config.sunView, Config.sunSide);
    const P = sky ? light(...sky.pageSun) : light(Config.pageSunUp, Config.pageSunView, Config.pageSunSide);
    const shade = sky ? sky.shade : night ? Config.nightShade : Config.pageShade;
    const lit = sky ? sky.lit : night ? Config.nightMoonlit : Config.pageSunlit;
    const room = !page ? [1, 1, 1] : sky ? sky.room : night ? Config.nightRoom : Config.dayRoom;
    return {
      uEye: [0, 0, -focal, focal],
      uViewport: [this.width, this.height, 1 / this.width, 1 / this.height],
      uGeo: [this.pitch, D, R, Config.thickness * s / 2],
      uArc: [Math.cos(phi0), Math.sin(phi0), this.yTop,
             Math.max(maxAmp, this.lift > 0 ? Config.stackFlatten * s : 0) + 2],
      uCord: [this.cordX, s, (page ? Config.pageDepth : Config.subjectDepth) * s, this.count],
      uAnchor: [-this.cordX, this.cordX, Config.creaseWidth, R * (1 - Math.cos(phi0))],
      uLook: [Config.gapShadowSize, Config.gapShadowStrength, Config.shadowStrength, 0],
      uSun: [...L, Config.sunPenumbra],
      uPageSun: [...P, Config.pagePenumbra],
      uPage: [page ? 1 : 0, 0, 0, 0],
      uLadder: [this.middleLadder ? 1 : 0, 0, 0, 0],
      uPageShade: [...shade, 0],
      uPageLit: [...lit, 0],
      uStack: [this.railY, Config.stackGap * s, this.firstFlat, 0],
      uLiftA: [this.cordAnchorX(0), this.handleX(0), ha, 0],
      uLiftB: [this.cordAnchorX(1), this.handleX(1), hb, 0],
      uHandle: [this.liftAnchorY, Config.liftHandleLength * s, Config.liftHandleRadius * s, this.liftEnabled ? 1 : 0],
      uRoom: [...room, 0],
      uWeather: [cloud, time % 3600, drift[0], drift[1]],
    };
  }
}
