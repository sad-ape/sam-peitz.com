// An Easter egg, after Tesla's Roadster reveal (October 2026), where the car
// lifted off on SpaceX cold-gas thrusters: hold a finger - or the mouse -
// still on the page for a couple of seconds and the whole website does the
// same. The thrusters spool up with a hiss and a tremble, the page lifts off
// on white jets of vapour, wobbles and flies up, flipping right over as it
// goes, out of sight - and while it's away, in the black it left, the
// original Roadster drifts by with Starman at the wheel, tumbling slowly, as
// it has since 2018 (roadster.jpg, a generated picture on black) - then comes
// back down, brakes on the jets and lands where it was, the vapour billowing
// out along the bottom of the screen and thinning away. The page is <body>, moved by a
// transform; the vapour and the Roadster are drawn on a canvas outside it,
// which stays put.

const FLIGHT = 6.9;                           // seconds, lift-off to touch-down
const DRIFT = [2.0, 4.7];                     // seconds after lift-off: the Roadster crosses
const CAR = { src: 'roadster.jpg', aspect: 417 / 1200 };
const NOZZLES = [0.08, 0.3, 0.7, 0.92];       // along the page's bottom edge

export class Liftoff {
  constructor() {
    this.charge = 0;         // 0..1 while a finger is held still: the spool-up
    this.flight = null;      // once it's off: when it left
    this.puffs = [];
    this.last = 0;
    this.canvas = null;
    this.car = new Image();                  // ready long before anyone holds still
    this.car.src = CAR.src;
    this.carAt = null;                        // where the Roadster is, while it crosses
  }

  get flying() { return this.flight !== null; }

  launch(now) {
    this.flight = { at: now };
    document.documentElement.classList.add('flying');
    document.body.style.willChange = 'transform';
  }

  /// Each frame: where the page is, the vapour, and how hard the thrusters
  /// blow (0..1, returned for the hiss).
  step(now) {
    const dt = Math.min(Math.max((now - this.last) / 1000, 0), 0.05);
    this.last = now;
    let y = 0, tilt = 0, thrust = 0.35 * this.charge;
    if (this.flight) {
      const t = (now - this.flight.at) / 1000;
      ({ y, tilt, thrust } = path(t, innerHeight));
      if (t >= FLIGHT) this.land();
    }
    // the Roadster, drifting across the black right to left, nose first
    this.carAt = null;
    if (this.flight) {
      const u = ((now - this.flight.at) / 1000 - DRIFT[0]) / (DRIFT[1] - DRIFT[0]);
      if (u > 0 && u < 1 && this.car.complete && this.car.naturalWidth) {
        const W = innerWidth, w = Math.min(0.9 * W, 560);
        this.carAt = { x: W + w / 2 + 30 - (W + w + 60) * u, y: innerHeight * (0.46 - 0.03 * Math.sin(Math.PI * u)),
                       w, turn: (7 - 12 * u) * Math.PI / 180 };
      }
    }
    // a tremble while the thrusters spool up
    const shake = this.flight ? 0 : this.charge;
    const jx = shake ? (Math.random() - 0.5) * 2 * shake : 0;
    const jy = shake ? (Math.random() - 0.5) * 1.5 * shake : 0;
    const body = document.body.style;
    if (y || tilt || jx || jy) {
      body.transform = `translate(${jx.toFixed(2)}px, ${(y + jy).toFixed(2)}px) rotate(${tilt.toFixed(3)}deg)`;
    } else if (body.transform) {
      body.transform = '';
    }
    if (thrust > 0.01 || this.puffs.length || this.carAt) {
      this.show();
      this.emit(thrust, y, tilt, dt);
      this.draw(dt);
    } else if (this.canvas && this.canvas.style.display !== 'none') {
      this.canvas.style.display = 'none';
    }
    return thrust;
  }

  land() {
    this.flight = null;
    document.documentElement.classList.remove('flying');
    document.body.style.transform = '';
    document.body.style.willChange = '';
  }

  /// The vapour's canvas: over everything, outside <body> so it doesn't fly.
  show() {
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.canvas.setAttribute('aria-hidden', 'true');
      Object.assign(this.canvas.style, {
        position: 'fixed', left: '0', top: '0', width: '100vw', height: '100vh',
        pointerEvents: 'none', zIndex: '2147483647',
      });
      document.documentElement.appendChild(this.canvas);
      this.sprite = puffSprite();
    }
    const px = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(innerWidth * px), h = Math.round(innerHeight * px);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.canvas.style.display = 'block';
  }

  /// New puffs at each nozzle, shot down the jet - down as the page has it,
  /// which in a flip goes round with it - as many as it blows: many, small
  /// and faint, so that together they run into one cone of vapour.
  emit(thrust, y, tilt, dt) {
    if (thrust <= 0.01) return;
    const W = innerWidth, H = innerHeight;
    const a = tilt * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    const cx = W / 2, cy = H / 2 + y;                       // the page's middle, where it turns
    for (const nx of NOZZLES) {
      const lx = nx * W - W / 2, ly = H / 2 - 2;            // the nozzle, from the middle, upright
      const x = cx + lx * c - ly * s, ny = cy + lx * s + ly * c;
      if (ny < -60) continue;                               // up out of sight
      let n = 300 * thrust * dt;
      while (n >= 1 || Math.random() < n) {
        n -= 1;
        const jx = (Math.random() - 0.5) * 90, jy = 620 + Math.random() * 380;
        this.puffs.push({
          x: x + (Math.random() - 0.5) * 4, y: ny,
          vx: jx * c - jy * s, vy: jx * s + jy * c,
          r: 2 + Math.random() * 3, grow: 55 + Math.random() * 45,
          age: 0, life: 0.55 + Math.random() * 0.5, a: 0.22 + 0.14 * thrust, ground: false,
        });
      }
    }
  }

  /// The puffs move on - a jet hitting the bottom of the screen spreads out
  /// along it and billows up, slowing - and are drawn, fading as they go.
  draw(dt) {
    const H = innerHeight, px = this.canvas.width / innerWidth;
    for (const p of this.puffs) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (!p.ground && p.y >= H - 0.3 * p.r) {
        p.ground = true;
        p.y = H - 0.3 * p.r;
        p.vx += (Math.random() < 0.5 ? -1 : 1) * (140 + Math.random() * 280);
        p.vy = -(20 + Math.random() * 70);
        p.grow *= 1.6;
        p.life = p.age + 0.8 + Math.random() * 0.8;        // a cloud lingers
      }
      const drag = p.ground ? 1.8 : 0.6;
      p.vx *= Math.exp(-drag * dt);
      p.vy *= Math.exp(-(p.ground ? 0.8 : 0.4) * dt);
      p.r = Math.min(p.r + p.grow * dt, 90);
    }
    this.puffs = this.puffs.filter(p => p.age < p.life);
    const g = this.canvas.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    // the Roadster, under the vapour; its black is the black behind it
    if (this.carAt) {
      const { x, y, w, turn } = this.carAt, c = Math.cos(turn), s = Math.sin(turn), h = w * CAR.aspect;
      g.setTransform(px * c, px * s, -px * s, px * c, px * x, px * y);
      g.globalAlpha = 1;
      g.drawImage(this.car, -w / 2, -h / 2, w, h);
    }
    for (const p of this.puffs) {
      const fade = 1 - p.age / p.life;
      g.globalAlpha = p.a * fade * fade;
      // in the jet, drawn out behind it along the way it's going, into a streak
      const long = p.ground ? 0 : Math.hypot(p.vx, p.vy) * 0.04;
      const t = Math.atan2(p.vy, p.vx) - Math.PI / 2, c = Math.cos(t), s = Math.sin(t);
      g.setTransform(px * c, px * s, -px * s, px * c, px * p.x, px * p.y);
      g.drawImage(this.sprite, -p.r, -p.r - long, 2 * p.r, 2 * p.r + long);
    }
    g.globalAlpha = 1;
  }
}

/// Where the page is t seconds after lift-off - y in CSS pixels, up is
/// negative - how far it's turned (degrees, round its middle), and how hard
/// the thrusters blow.
function path(t, H) {
  const ease = x => x * x * (3 - 2 * x);
  const gone = -(H + 360);
  if (t < 0.9) {                                            // lifting off, unsteady
    const u = t / 0.9;
    return { y: -46 * ease(u), tilt: Math.sin(t * 9) * 0.5 * u, thrust: 1 };
  }
  if (t < 2.2) {                                            // up and away, flipping right over as it
    const u = (t - 0.9) / 1.3;                              // goes, about half off the screen by the end
    return { y: -46 + (gone + 46) * u * u, tilt: -360 * ease(Math.min(u / 0.85, 1)), thrust: 1 };
  }
  if (t < 4.8) return { y: gone, tilt: 0, thrust: 0 };     // out of sight: the Roadster goes by
  if (t < 6.0) {                                            // back down, braking on the thrusters
    const u = (t - 4.8) / 1.2;
    return { y: gone + (-34 - gone) * (1 - (1 - u) ** 3), tilt: Math.sin(t * 7) * 0.35 * (1 - u), thrust: 0.4 + 0.6 * u };
  }
  if (t < 6.7) {                                            // a hover, then down onto its feet
    const u = (t - 6.0) / 0.7;
    return { y: -34 * (1 - ease(u)) + 3 * Math.sin(Math.PI * 2 * u) * (1 - u), tilt: 0, thrust: 1 - u };
  }
  return { y: 0, tilt: 0, thrust: 0 };
}

/// One soft puff of vapour: white at the heart, a cool grey at its edge so it
/// still shows on the pale page.
function puffSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
  grad.addColorStop(0.45, 'rgba(240, 244, 248, 0.8)');
  grad.addColorStop(1, 'rgba(200, 208, 216, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return c;
}
