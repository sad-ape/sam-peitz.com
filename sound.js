// Sound, made here as it plays, so nothing repeats or loops audibly. Far in
// the back: wind that comes and goes, wind chimes it knocks together, birds
// now and then by day. Close by: the blind itself - thin metal slats ticking
// as they turn, clicking home when let go, a cord running through the rail -
// the sounds the app gives as haptics. On a phone it starts off, until the
// speaker is pressed: browsers allow sound only after a touch anyway, and a
// speaker showing on over a silent page (X's in-app browser) read as broken.
// On a computer main.js turns it on from the start.

const CHIME = [880, 990, 1100, 1320, 1485, 1760];    // a pentatonic set, A5 to A6
const PARTIALS = [[1, 1, 3.2], [2.76, 0.45, 1.8], [5.40, 0.22, 0.9], [8.93, 0.10, 0.5]];  // ratio, level, seconds
/// Thin sheet metal rings at many close, inharmonic frequencies, damped
/// almost at once: what it gives is a dry crack with a hint of metal in it,
/// not a note. A clear sine at one pitch read as a toy.
const METAL = [1, 1.41, 1.93, 2.57, 3.18];
/// How loud: the scene far back, the blind close but quiet - twice what they
/// first were, which on a phone came out too quiet.
const FAR = 1.4, NEAR = 1;
/// The tilt's squeaks, at their loudest: slight - a steady buzz, then a steady
/// whistle, were both too much.
const SQUEAK = 0.02;

export class Soundscape {
  constructor() {
    this.ctx = null;
    this.on = false;     // until the speaker is pressed, or main.js on a computer
    this.day = 1;        // 0 night .. 1 day: birds only by day
    this.wind = 0.45;    // how windy: breeze blows harder
    this.rattle = 0;     // ticks owed to turning slats
    this.spin = 0;       // how fast the slats have lately been turned, radians a second
    this.squeakUntil = 0; // when the next squeak may start
  }

  /// On a touch or key, and when the speaker turns it on: starts it the
  /// first time, and wakes it later if the browser put it to sleep.
  wake() {
    if (!this.on) return;
    if (!this.ctx) this.build();
    if (this.ctx.state !== 'running') {
      this.ctx.resume().catch(() => {});     // refused before a touch or a key: the next one tries again
      // iOS lets a page make sound only once something starts playing inside
      // a touch that has ended or a tap: a single silent sample does it
      const blip = this.ctx.createBufferSource();
      blip.buffer = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
      blip.connect(this.ctx.destination);
      blip.start();
    }
  }

  setOn(on) {
    this.on = on;
    if (!this.ctx) {
      if (on) this.wake();
      return;
    }
    const now = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setTargetAtTime(on ? 1 : 0, now, 0.3);
    if (on) this.ctx.resume();
    else setTimeout(() => { if (!this.on) this.ctx.suspend(); }, 1500);
  }

  /// Quiet while the page can't be seen.
  pause(hidden) {
    if (!this.ctx) return;
    if (hidden) this.ctx.suspend();
    else if (this.on) this.ctx.resume();
  }

  get live() { return this.ctx && this.ctx.state === 'running'; }

  build() {
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.out = ctx.createGain();
    this.out.connect(ctx.destination);

    // far away: the top taken off, a room around it, fading in
    this.far = ctx.createGain();
    this.far.gain.value = 0;
    this.far.gain.setTargetAtTime(FAR, ctx.currentTime, 1.2);
    const distance = ctx.createBiquadFilter();
    distance.type = 'lowpass';
    distance.frequency.value = 6500;
    this.far.connect(distance).connect(this.out);
    this.room = ctx.createConvolver();
    this.room.buffer = impulse(ctx, 2.8);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    this.room.connect(wet).connect(this.far);

    // close by: the blind, dry
    this.near = ctx.createGain();
    this.near.gain.value = NEAR;
    this.near.connect(this.out);

    this.noise = pinkNoise(ctx, 12);
    this.click = clickNoise(ctx);
    this.buildWind();
    this.buildHands();
    this.gusts();
    this.birds();
  }

  /// Wind: air, not surf - pink noise with the rumble taken out, through a
  /// band that the gusts push up and open, and a thin whistle over it.
  buildWind() {
    const ctx = this.ctx;
    const src = loop(ctx, this.noise);
    const low = ctx.createBiquadFilter();
    low.type = 'highpass';
    low.frequency.value = 350;
    this.band = ctx.createBiquadFilter();
    this.band.type = 'bandpass';
    this.band.frequency.value = 1000;
    this.band.Q.value = 1.1;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    src.connect(low).connect(this.band).connect(this.windGain);
    this.windGain.connect(this.far);
    this.windGain.connect(this.room);

    this.whistle = ctx.createBiquadFilter();
    this.whistle.type = 'bandpass';
    this.whistle.frequency.value = 2100;
    this.whistle.Q.value = 9;
    this.whistleGain = ctx.createGain();
    this.whistleGain.gain.value = 0;
    low.connect(this.whistle).connect(this.whistleGain).connect(this.far);
  }

  /// What the hand makes: the tilt squeaking while a cord is dragged, like
  /// metal louvres in a vent - a bright, rough tone, its pitch never quite
  /// steady, sounded in short squeaks (squeak) - and the lift cord running
  /// through the rail. (A steady tone read as a buzz, and higher and purer,
  /// as a whistle.)
  buildHands() {
    const ctx = this.ctx;
    this.squeakTone = ctx.createOscillator();
    this.squeakTone.type = 'sawtooth';
    this.squeakTone.frequency.value = 2800;
    // metal catching and slipping: the pitch shaken by a little noise
    const shake = ctx.createBiquadFilter();
    shake.type = 'lowpass';
    shake.frequency.value = 500;
    this.squeakShake = ctx.createGain();
    this.squeakShake.gain.value = 0;
    loop(ctx, this.noise).connect(shake).connect(this.squeakShake).connect(this.squeakTone.frequency);
    this.squeakBand = ctx.createBiquadFilter();
    this.squeakBand.type = 'bandpass';
    this.squeakBand.frequency.value = 4200;
    this.squeakBand.Q.value = 0.9;
    this.squeakGain = ctx.createGain();
    this.squeakGain.gain.value = 0;
    this.squeakTone.connect(this.squeakBand).connect(this.squeakGain).connect(this.near);
    this.squeakTone.start();

    const bed = (freq, q) => {
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      loop(ctx, this.noise).connect(f).connect(g).connect(this.near);
      return g;
    };
    this.rub = bed(2300, 1.6);
  }

  /// Every sixth of a second the wind picks where it's heading - quick and
  /// uneven, as gusts are, not the slow swell of waves - and now and then
  /// knocks the chimes.
  gusts() {
    let walk = Math.random(), speed = 0;
    const tick = () => {
      if (this.live) {
        speed += (Math.random() - 0.5) * 0.12 - speed * 0.2;
        walk = Math.min(Math.max(walk + speed, 0), 1);
        const gust = this.wind * (0.25 + 0.75 * walk);
        const now = this.ctx.currentTime;
        this.windGain.gain.setTargetAtTime(0.05 * gust, now, 0.4);          // toned back
        this.band.frequency.setTargetAtTime(700 + 1000 * gust, now, 0.5);
        this.whistleGain.gain.setTargetAtTime(0.005 * gust * gust, now, 0.6);
        this.whistle.frequency.setTargetAtTime(1800 + 700 * walk, now, 0.8);
        // the harder it blows, the more the chimes knock together
        if (Math.random() < 0.01 + 0.25 * Math.max(gust - 0.35, 0)) this.chime(now + Math.random() * 0.15);
      }
      setTimeout(tick, 160);
    };
    tick();
  }

  /// One tube struck: a few inharmonic partials ringing away.
  chime(at) {
    const ctx = this.ctx;
    const f = CHIME[Math.floor(Math.random() * CHIME.length)];
    const out = this.panned((Math.random() - 0.5) * 1.2, this.far, this.room);
    out.gain.value = 0.012 * (0.5 + Math.random() * 0.5);     // kept back: they stood out
    for (const [ratio, level, decay] of PARTIALS) {
      tone(ctx, out, f * ratio * (1 + (Math.random() - 0.5) * 0.004), level, at, 0.003, decay);
    }
  }

  /// Now and then a bird somewhere off: a short phrase of chirps, sweeps up
  /// or down, sometimes a trill. Only by day.
  birds() {
    const next = () => setTimeout(() => {
      if (this.live && Math.random() < this.day) this.phrase();
      next();
    }, 4000 + Math.random() * 12000);
    next();
  }

  phrase() {
    const ctx = this.ctx;
    const out = this.panned((Math.random() - 0.5) * 1.6, this.far, this.room);
    out.gain.value = 0.02 + Math.random() * 0.02;
    let t = ctx.currentTime + 0.05;
    const base = 2600 + Math.random() * 1600;
    const trill = Math.random() < 0.3;
    const chirps = 2 + Math.floor(Math.random() * 5);
    for (let i = 0; i < chirps; i++) {
      const length = 0.05 + Math.random() * 0.09;
      const osc = ctx.createOscillator();
      const from = base * (0.85 + Math.random() * 0.3), to = from * (0.7 + Math.random() * 0.7);
      osc.frequency.setValueAtTime(from, t);
      osc.frequency.exponentialRampToValueAtTime(to, t + length);
      if (trill) {
        const lfo = ctx.createOscillator(), depth = ctx.createGain();
        lfo.frequency.value = 28 + Math.random() * 14;
        depth.gain.value = 250;
        lfo.connect(depth).connect(osc.frequency);
        lfo.start(t);
        lfo.stop(t + length + 0.05);
      }
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.001, t + length);
      osc.connect(g).connect(out);
      osc.start(t);
      osc.stop(t + length + 0.05);
      t += length + 0.05 + Math.random() * 0.12;
    }
  }

  // ------------------------------------------------------------- the blind

  /// Something thin and hard knocked: a crack of noise - most of it - and a
  /// few short, slightly detuned partials of the metal, each knock a little
  /// different. `pitch` moves the whole thing up or down (lower is duller,
  /// plastic), `ring` is how long the metal lasts, `tone` how much of it
  /// there is against the crack, `knock` a dull thud of what it hits.
  strike({ level, pitch = 1, ring = 0.025, tone: metal = 0.3, knock = 0, when = null, pan = 0 }) {
    if (!this.live) return;
    const ctx = this.ctx;
    when ??= ctx.currentTime;
    const out = this.panned(pan, this.near);
    out.gain.value = level;
    // the crack
    const n = ctx.createBufferSource();
    n.buffer = this.click;
    n.playbackRate.value = 0.75 + Math.random() * 0.5;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1400 * pitch;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 9000 * Math.min(pitch, 1.2);
    n.connect(hp).connect(lp).connect(out);
    n.start(when);
    // the metal: close, inharmonic, each a little off, gone almost at once
    const base = 2500 * pitch * (0.8 + Math.random() * 0.4);
    for (const r of METAL) {
      const level = metal * (0.3 + Math.random() * 0.7) / METAL.length;
      tone(ctx, out, base * r * (0.96 + Math.random() * 0.08), level, when, 0.0005, ring * (0.5 + Math.random()));
    }
    // what it knocks against
    if (knock) tone(ctx, out, 480 * pitch * (0.85 + Math.random() * 0.3), knock, when, 0.001, 0.018);
  }

  /// A finger on a slat: barely a touch.
  touch() { this.strike({ level: 0.04, pitch: 1.25, ring: 0.01, tone: 0.15 }); }

  /// A slat let go, landing back against its ladder rung: the app's click.
  snap(strength) {
    this.strike({ level: 0.06 + 0.12 * strength, pitch: 0.95, ring: 0.035, tone: 0.35, knock: 0.25 });
  }

  /// Turned as far as it goes. Shut, the slats land on one another one after
  /// the next down the blind - a quick cascade of clacks, fading as it runs
  /// down; wide open they only stop against their rungs, a shorter one.
  clack(strength, shut = true) {
    if (!this.live) return;
    const now = this.ctx.currentTime;
    const n = (shut ? 8 : 4) + Math.floor(Math.random() * (shut ? 6 : 3));
    const span = (shut ? 0.12 : 0.06) + Math.random() * 0.06;
    for (let i = 0; i < n; i++) {
      const f = i / n;
      this.strike({ level: (0.03 + 0.07 * strength) * (1 - 0.6 * f) * (0.6 + Math.random() * 0.4),
                    pitch: 0.75 + Math.random() * 0.4, ring: 0.045, tone: 0.4, knock: 0.3,
                    when: now + span * f + Math.random() * 0.008, pan: (Math.random() - 0.5) * 1.2 });
    }
  }

  /// The cord lock catching as a pull is let go: a small ratchet, two clicks.
  lock() {
    if (!this.live) return;
    const now = this.ctx.currentTime;
    this.strike({ level: 0.025, pitch: 0.55, ring: 0.01, tone: 0.15, knock: 0.5, pan: 0.3 });
    this.strike({ level: 0.015, pitch: 0.6, ring: 0.008, tone: 0.15, knock: 0.4, when: now + 0.018, pan: 0.3 });
  }

  /// A slat joining the stack under the raised blind, or leaving it: a soft,
  /// muffled knock - raising and lowering read as too clicky with more.
  stack() {
    this.strike({ level: 0.022, pitch: 0.5 + Math.random() * 0.12, ring: 0.012, tone: 0.12, knock: 0.6,
                  pan: (Math.random() - 0.5) * 0.4 });
  }

  /// A pull taken in hand: a small, dull plastic tock.
  grab() { this.strike({ level: 0.05, pitch: 0.45, ring: 0.015, tone: 0.15, knock: 0.5, pan: 0.3 }); }

  /// Slats turning, radians a second. While the blind is being opened or
  /// shut - a hand on a cord, or a double tap - the tilt squeaks now and then,
  /// more often, a little louder and higher the faster it goes, with a few
  /// dry ticks of slats on rungs. Let go mid-drag, it stops: slats coasting
  /// on make no sound until they hit an end.
  turning(speed, dt, dragging) {
    if (!this.live) return;
    const now = this.ctx.currentTime;
    // a hand moves in fits and starts, with frames where it hasn't moved at
    // all: held for a moment, so a steady turn reads as one
    this.spin = Math.max(speed, this.spin * Math.exp(-dt / 0.04));
    const v = dragging ? Math.min(this.spin / 2, 1) : 0;
    if (dragging && this.spin > 0.1 && now >= this.squeakUntil) this.squeak(now, v);
    if (!dragging) return;
    this.rattle += speed * dt * 25;
    let n = 0;
    while (this.rattle >= 1 && n++ < 4) {
      this.rattle -= 1;
      this.strike({ level: 0.008 + 0.014 * v, pitch: 0.8 + Math.random() * 0.6, ring: 0.01, tone: 0.25,
                    when: now + Math.random() * dt, pan: (Math.random() - 0.5) * 1.4 });
    }
    if (this.rattle > 1) this.rattle = 0;
  }

  /// One squeak of the tilt, `v` 0..1 how fast it turns: the metal catches,
  /// its pitch slides up a little and back, and it lets go - then a pause,
  /// shorter the faster the turn.
  squeak(at, v) {
    const length = 0.05 + 0.04 * v + Math.random() * 0.08;
    const f = (2400 + 800 * v) * (0.9 + Math.random() * 0.2);
    const level = SQUEAK * (0.5 + 0.5 * v) * (0.6 + Math.random() * 0.4);
    const g = this.squeakGain.gain, pitch = this.squeakTone.frequency;
    g.cancelScheduledValues(at);
    pitch.cancelScheduledValues(at);
    g.setValueAtTime(0, at);
    g.linearRampToValueAtTime(level, at + 0.01);
    g.linearRampToValueAtTime(level * 0.7, at + length * 0.75);
    g.linearRampToValueAtTime(0, at + length);
    pitch.setValueAtTime(f * 0.95, at);
    pitch.linearRampToValueAtTime(f * (1.02 + Math.random() * 0.05), at + length * 0.6);
    pitch.linearRampToValueAtTime(f * (0.96 + Math.random() * 0.03), at + length);
    this.squeakBand.frequency.setValueAtTime(f * 1.5, at);
    this.squeakShake.gain.setValueAtTime(f * 0.2, at);
    this.squeakUntil = at + length + (0.28 - 0.2 * v) * (0.5 + Math.random());
  }

  /// The lift cord running through the rail, as fast as the blind moves: a
  /// rub with the grain of the cord in it.
  cord(speed) {
    if (!this.live) return;
    const v = Math.min(Math.abs(speed) / 900, 1) * (0.6 + Math.random() * 0.8);
    this.rub.gain.setTargetAtTime(0.03 * v, this.ctx.currentTime, 0.02);
  }

  /// A gain on its way to `to` (and `also`), panned left or right.
  panned(pan, to, also) {
    const g = this.ctx.createGain();
    let last = g;
    if (this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p);
      last = p;
    }
    last.connect(to);
    if (also) last.connect(also);
    return g;
  }
}

/// A sine that starts at `at`, rises in `attack` and dies away over `decay`.
function tone(ctx, out, freq, level, at, attack, decay) {
  const osc = ctx.createOscillator();
  osc.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(level, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  osc.connect(g).connect(out);
  osc.start(at);
  osc.stop(at + attack + decay + 0.02);
}

function loop(ctx, buffer) {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  src.start(0, Math.random() * buffer.duration);
  return src;
}

/// Pink noise that loops without a seam: the end is crossfaded into the
/// start, so the last sample leads straight into the first.
function pinkNoise(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds), fade = Math.floor(ctx.sampleRate * 0.5);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const x = new Float32Array(len + fade);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < x.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      x[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = x[i];
    for (let i = 0; i < fade; i++) {
      const w = i / fade;
      d[i] = x[i] * Math.sqrt(w) + x[len + i] * Math.sqrt(1 - w);
    }
  }
  return buf;
}

/// The contact in a tick: a few milliseconds of noise, dying fast.
function clickNoise(ctx) {
  const len = Math.floor(ctx.sampleRate * 0.012);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4) * 0.6;
  return buf;
}

/// A room to put it all in: a few seconds of decaying noise, darker as it
/// dies away.
function impulse(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let low = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      low += ((Math.random() * 2 - 1) - low) * (0.5 - 0.4 * t);
      d[i] = low * Math.pow(1 - t, 3);
    }
  }
  return buf;
}
