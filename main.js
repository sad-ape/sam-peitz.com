// Sam's page with the blind over it: layout, touch and the frame loop. The
// touch rules are the app's (Sources/App/BlindsView.swift).

import { BlindsModel, Config, MAX_SLATS } from './blinds.js';
import { Renderer } from './render.js';
import { rearrange } from './page.js';
import { Soundscape } from './sound.js';

// Sam's mock: its width, its height and the size of its type (13pt on a
// 402pt page), in the units the page is laid out in (Sources/App/PageDesign.swift)
const MOCK_W = 573.5, MOCK_H = 953.6, TYPE = 18.55;
// the page's colours as designed, sRGB
const PAPER = [0.941, 0.961, 0.961];   // #F0F5F5
const INK = [0.071, 0.071, 0.071];     // #121212
/// The print from someday.soon's welcome, in points on a 402pt phone: 40% of
/// its width, 1.28 times as tall as wide, 36pt in from the right and 130pt up
/// from the bottom, tilted six degrees. A tap on it says hi on X.
const PRINT = { width: 0.4 * 402, aspect: 1.28, right: 24 + 12, bottom: 130, tilt: -6,
                link: 'https://x.com/samdape' };
/// How quickly a let-go print slows down, per second: it glides on a tenth
/// of a second's worth of its speed.
const GLIDE = 2 * Math.PI / 0.6;

const canvas = document.getElementById('blind');
const page = document.getElementById('page');
const hint = document.getElementById('hint');
const photo = document.getElementById('photo');
const video = document.getElementById('camera');
const closeButton = document.getElementById('close');
const humans = document.getElementById('humans');

const model = new BlindsModel();
model.liftEnabled = true;
const slats = new Float32Array(MAX_SLATS * 8);

let renderer = null;
try {
  renderer = new Renderer(canvas);
} catch (error) {
  console.warn('No blind, just the page:', error);
  document.body.classList.remove('veiled');
  hint.remove();
}

// ---------------------------------------------------------------- the page

// Sam's designed page is an SVG laid out off his mock; a plain HTML page
// (traditional.html, for trying a more usual layout) just flows, scaled with
// the blind, and has no print, camera or asterisks.
const designed = page instanceof SVGSVGElement;

// a new arrangement of the words on every visit; the technology sentence's
// asterisks wait for the blind to go up past it
const tech = designed ? rearrange(page) : null;
let techTop = Infinity, techBottom = Infinity, starsIn = null;

const groups = [...page.querySelectorAll('.group')].map(el => {
  const ys = [...el.querySelectorAll('text')].map(t => parseFloat(t.getAttribute('y')));
  return { el, mid: (Math.min(...ys) + Math.max(...ys)) / 2 };
});

/// Underlines as the mock has them: the width of the linked characters,
/// 0.12em under the baseline, 0.05em thick.
function underline() {
  for (const old of page.querySelectorAll('rect')) old.remove();
  for (const a of page.querySelectorAll('a')) {
    const text = a.closest('text');
    let start = 0;
    for (const node of text.childNodes) {
      if (node === a) break;
      start += node.textContent.length;
    }
    const end = start + a.textContent.length;
    const x0 = text.getStartPositionOfChar(start).x;
    const x1 = text.getEndPositionOfChar(end - 1).x;
    const y = parseFloat(text.getAttribute('y'));
    const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    r.setAttribute('x', x0);
    r.setAttribute('y', y + 0.1235 * TYPE);
    r.setAttribute('width', x1 - x0);
    r.setAttribute('height', 0.049 * TYPE);
    text.parentNode.appendChild(r);
  }
}
if (designed) {
  underline();
  document.fonts?.ready.then(underline);
}

let W = 0, H = 0;
let dirty = true;

/// The print lies where someday.soon puts it; the hand moves it from there.
const print = { x: 0, y: 0, angle: PRINT.tilt, glide: null };
let printCentre = { x: 0, y: 0 };

function placePrint() {
  if (photo) photo.style.transform = `translate(${print.x}px, ${print.y}px) rotate(${print.angle}deg)`;
}

/// One scale for the page and the blind, from whichever of the mock's width
/// or height is tighter: on a phone the width, so the mock fills it edge to
/// edge and its groups spread over the taller screen, each keeping its own
/// spacing (as in the app); on a computer the height, the page a column down
/// the middle. The slats keep their size against the type.
function layout() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!(w > 0 && h > 0)) return;
  W = w;
  H = h;
  const k = Math.min(W / MOCK_W, H / MOCK_H);
  const vbW = W / k, vbH = H / k;
  if (designed) page.setAttribute('viewBox', `${(MOCK_W - vbW) / 2} 0 ${vbW} ${vbH}`);
  for (const g of groups) g.el.setAttribute('transform', `translate(0 ${g.mid * (vbH / MOCK_H - 1)})`);
  if (tech) {
    const boxes = tech.lines.map(l => l.el.getBoundingClientRect());
    techTop = Math.min(...boxes.map(b => b.top));
    techBottom = Math.max(...boxes.map(b => b.bottom));
  }
  const s = k * MOCK_W / Config.refWidth;
  model.resize(W, H, s);
  page.style.setProperty('--s', s);              // a flowing page scales with the blind

  // the print, at the bottom right of the page
  const pw = PRINT.width * s, ph = pw * PRINT.aspect;
  const right = (W + MOCK_W * k) / 2 - PRINT.right * s;
  printCentre = { x: right - pw / 2, y: H - PRINT.bottom * s - ph / 2 };
  if (photo) Object.assign(photo.style, {
    width: `${pw}px`,
    height: `${ph}px`,
    left: `${right - pw}px`,
    top: `${H - PRINT.bottom * s - ph}px`,
    borderRadius: `${3 * s}px`,
    // tight: it lies on the page rather than hovering over it
    boxShadow: `0 ${0.6 * s}px ${1.2 * s}px rgba(0, 0, 0, 0.2), 0 ${1.5 * s}px ${4 * s}px rgba(0, 0, 0, 0.08)`,
  });
  placePrint();

  if (renderer) {
    // every pixel is ray traced, so big windows get fewer of them
    const budget = Math.sqrt(2.6e6 / (W * H));
    const px = Math.min(window.devicePixelRatio || 1, 2, Math.max(budget, 1));
    canvas.width = Math.round(W * px);
    canvas.height = Math.round(H * px);
  }
  dirty = true;
}
layout();
window.addEventListener('resize', layout);

// ------------------------------------------------------------------ light

/// The light through a whole day, set by the slider at the bottom: midnight
/// at the left, midday in the middle, midnight again at the right - and the
/// page opens at the visitor's own time. Each moment (by the hour) says where
/// the two suns are - the high soft one the slats see, the low one that
/// stripes the page - as up, towards the viewer and to the side (morning
/// from the left, evening from the right), the colour of the page in sun and
/// in shade and of the room, and how far into night the page is. Colours are
/// against plain white light: in the midday sun the page is exactly Sam's
/// colours. Night is the app's: the moon, the room dimmed, the page turned
/// over - which the dawn and the dusk fade in and out of.
/// The moon comes in from where the evening sun went down and leaves from
/// where the morning sun comes up, so the stripes stay put through dusk and
/// dawn - a moon in the afternoon's place made them jump.
const MOON = { night: 1, lit: Config.nightMoonlit, shade: Config.nightShade, room: Config.nightRoom };
const DAWN = { sun: [0.25, 0.60, -0.55], pageSun: [0.06, 0.95, -0.60] };
const DUSK = { sun: [0.30, 0.60, 0.50], pageSun: [0.10, 0.95, 0.50] };
const DAY = [
  { h: 0, ...MOON, ...DAWN },
  { h: 4.5, ...MOON, ...DAWN },
  { h: 5.5, night: 0, ...DAWN,                                                    // before sunrise: grey twilight
    lit: [0.46, 0.46, 0.49], shade: [0.39, 0.39, 0.42], room: [0.60, 0.61, 0.67] },
  { h: 6.25, night: 0, sun: [0.32, 0.60, -0.50], pageSun: [0.10, 0.95, -0.55],  // sunrise: warm, a touch red
    lit: [1.0, 0.76, 0.58], shade: [0.50, 0.46, 0.45], room: [1.0, 0.88, 0.80] },
  { h: 7.5, night: 0, sun: [0.55, 0.58, -0.35], pageSun: [0.20, 0.95, -0.40],   // morning
    lit: [1.0, 0.89, 0.78], shade: [0.54, 0.52, 0.52], room: [0.99, 0.94, 0.90] },
  { h: 9.5, night: 0, sun: [0.78, 0.50, -0.15], pageSun: [0.32, 0.93, -0.20],
    lit: [1.0, 0.97, 0.93], shade: [0.57, 0.57, 0.58], room: [1.0, 0.99, 0.97] },
  { h: 12, night: 0, sun: [0.92, 0.42, 0.00], pageSun: [0.45, 0.90, -0.05],     // midday: white
    lit: [1.0, 1.0, 1.0], shade: [0.58, 0.58, 0.59], room: [1.03, 1.02, 0.99] },
  { h: 15.5, night: 0, sun: [Config.sunUp, Config.sunView, Config.sunSide],     // afternoon: the app's
    pageSun: [Config.pageSunUp, Config.pageSunView, Config.pageSunSide],
    lit: Config.pageSunlit.map(v => v / 1.06), shade: Config.pageShade.map(v => v / 1.06),
    room: Config.dayRoom },
  { h: 19, night: 0, sun: [0.45, 0.60, 0.45], pageSun: [0.16, 0.95, 0.45],      // sunset: gold
    lit: [1.0, 0.82, 0.58], shade: [0.47, 0.44, 0.43], room: [1.06, 0.92, 0.80] },
  { h: 20.25, night: 0, ...DUSK,                                                  // dusk: no sun left
    lit: [0.45, 0.45, 0.47], shade: [0.38, 0.385, 0.41], room: [0.58, 0.60, 0.68] },
  { h: 21.5, ...MOON, ...DUSK },
  { h: 24, ...MOON, ...DUSK },
];

function skyAt(t) {
  const h = t * 24;
  let i = 0;
  while (i < DAY.length - 2 && h > DAY[i + 1].h) i++;
  const a = DAY[i], b = DAY[i + 1];
  const f0 = Math.min(Math.max((h - a.h) / (b.h - a.h), 0), 1), f = f0 * f0 * (3 - 2 * f0);
  const blend = (p, q) => p.map((v, k) => v + (q[k] - v) * f);
  const night = a.night + (b.night - a.night) * f;
  // the HTML's colours stand for white light by day, full moonlight by night
  const ref = [1, 1, 1].map((v, k) => v + (Config.nightMoonlit[k] - v) * night);
  return { night, sun: blend(a.sun, b.sun), pageSun: blend(a.pageSun, b.pageSun),
           lit: blend(a.lit, b.lit), shade: blend(a.shade, b.shade), room: blend(a.room, b.room), ref };
}

/// The page's colours in its light: Sam's by day; at night turned over and
/// moonlit, as the app's. On the way the paper darkens, and the words fade
/// into the dusk and come back pale in the moonlight - never grey on grey
/// for more than a moment.
function pageColours(n) {
  const moon = c => c.map((v, i) => Math.min(1, v * Config.nightMoonlit[i]));
  const lerp = (p, q, f) => p.map((v, i) => v + (q[i] - v) * f);
  const nightPaper = moon(INK), nightInk = moon(PAPER);
  const paper = lerp(PAPER, nightPaper, n);
  const mid = lerp(PAPER, nightPaper, 0.5);
  const ink = n < 0.5 ? lerp(INK, mid, n / 0.5) : lerp(mid, nightInk, (n - 0.5) / 0.5);
  return { paper, ink };
}

/// Wind, chimes and birds, far in the back. Browsers allow sound only after a
/// touch or a key, so it wakes with the first; the speaker turns it off.
const sound = new Soundscape();
for (const type of ['pointerdown', 'pointerup', 'keydown']) {
  window.addEventListener(type, () => sound.wake(), { capture: true });
}
const soundButton = document.getElementById('sound');
soundButton?.addEventListener('click', () => {
  sound.setOn(!sound.on);
  soundButton.classList.toggle('off', !sound.on);
  soundButton.setAttribute('aria-pressed', String(sound.on));
});
document.addEventListener('visibilitychange', () => sound.pause(document.hidden));

/// A few faint clouds always go over, day and night, drifting slowly one way
/// (right, barely sinking); breeze - a three-finger tap - brings the app's
/// heavier ones, faster.
const CLOUDS = { faint: 0.45, faintSpeed: 0.55, breezeSpeed: [22, 3] };
const drift = [0, 0];
let breeze = false;
let lastCloudFrame = 0;
let sky = skyAt(0.5);
let paperShown = PAPER;
const slider = document.getElementById('time');

function applySky(t) {
  sky = skyAt(t);
  const { paper, ink } = pageColours(sky.night);
  const css = c => `rgb(${c.map(v => Math.round(v * 255)).join(' ')})`;
  paperShown = paper;
  document.documentElement.style.setProperty('--paper', css(paper));
  document.documentElement.style.setProperty('--ink', css(ink));
  document.body.classList.toggle('night', sky.night > 0.5);
  sound.day = 1 - sky.night;                                   // birds by day
  // by moonlight the print is dim and nearly colourless, like everything else
  if (photo) photo.style.filter = sky.night > 0 ? `brightness(${1 - 0.58 * sky.night}) saturate(${1 - 0.45 * sky.night})` : '';
  dirty = true;
}
// it opens at the visitor's own time of day
const clock = new Date();
slider.value = Math.round((clock.getHours() + clock.getMinutes() / 60) / 24 * 1000);
applySky(slider.value / 1000);
slider.addEventListener('input', () => applySky(slider.value / 1000));

// ----------------------------------------------------------------- camera

/// "humans" puts the visitor behind the blind: the selfie camera, as the
/// app's camera mode, unmirrored. The pill at the bottom, Escape, or leaving
/// the tab closes it again.
let stream = null;

async function openCamera() {
  if (stream || !video) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    console.warn('The camera needs the page on https');
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 3840 }, height: { ideal: 2160 } },
      audio: false,
    });
  } catch (error) {
    console.warn('No camera:', error);
    stream = null;
    return;
  }
  video.srcObject = stream;
  video.play().catch(() => {});
  document.body.classList.add('camera');
  dirty = true;
}

function closeCamera() {
  if (!stream) return;
  for (const track of stream.getTracks()) track.stop();
  stream = null;
  video.srcObject = null;
  document.body.classList.remove('camera');
  dirty = true;
}

closeButton?.addEventListener('click', closeCamera);
window.addEventListener('keydown', e => { if (e.key === 'Escape') closeCamera(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) closeCamera(); });

// ------------------------------------------------------------------ touch

const drags = new Map();
let lastTap = { t: -1e9, x: 0, y: 0 };
// fingers that went down together, for the three-finger tap
let touchGroup = null;
// fingers on the print, in the order they landed; the first one drags it
const holds = new Map();
let hold = null;

function world(e) {
  const r = canvas.getBoundingClientRect();
  const sx = e.clientX - r.left, sy = e.clientY - r.top;
  return { x: sx - W / 2, y: H / 2 - sy, sy };
}

/// The cord columns are narrow in the design, so the grab zone reaches from
/// them out to the edge of the window; the middle cord of a wide blind tilts
/// it too.
function isCord(x) {
  return Math.abs(x) > model.cordX - 24 * model.s || (model.middleLadder && Math.abs(x) < 16 * model.s);
}

function onPrint(e) {
  return !!photo && !stream && document.elementsFromPoint(e.clientX, e.clientY).includes(photo);
}

function hideHint() { hint.classList.add('gone'); }
setTimeout(hideHint, 6000);

canvas.addEventListener('pointerdown', e => {
  try { canvas.setPointerCapture(e.pointerId); } catch {}   // a pointer already gone
  hideHint();
  const w = world(e);
  const d = { grip: 'tilt', index: -1, startWorldY: w.y, lastY: w.sy, lastT: e.timeStamp,
              velocity: 0, moved: 0, touch: e.pointerType === 'touch' };
  const handle = model.liftHandle(w.x, w.y);
  if (handle !== null) {
    d.grip = 'lift';
    d.index = handle;
    model.beginLift(handle, w.x);
    sound.grab();
  } else if (w.y < model.railY - 6 * model.s) {
    // below the raised blind: the page, or the print lying on it
    d.grip = onPrint(e) ? 'print' : 'none';
    if (d.grip === 'print') grabPrint(e);
  } else if (!isCord(w.x)) {
    const i = model.slatAtWorldY(w.y);
    if (model.isStacked(i)) {
      d.grip = 'none';
    } else {
      d.grip = 'bend';
      d.index = i;
      model.beginBend(i, w.x);
      sound.touch();
    }
  }
  drags.set(e.pointerId, d);
  if (e.pointerType === 'mouse') {
    canvas.style.cursor = d.grip === 'tilt' ? 'ns-resize' : d.grip === 'none' ? canvas.style.cursor : 'grabbing';
  }

  if (d.touch) {
    if (!touchGroup) touchGroup = { start: e.timeStamp, fingers: 0, most: 0, moved: 0 };
    touchGroup.fingers += 1;
    touchGroup.most = Math.max(touchGroup.most, touchGroup.fingers);
  }
  dirty = true;
});

canvas.addEventListener('pointermove', e => {
  const d = drags.get(e.pointerId);
  if (!d) {
    if (e.pointerType === 'mouse') canvas.style.cursor = cursorAt(e);
    return;
  }
  const w = world(e);
  const dy = w.sy - d.lastY;
  const dt = Math.max((e.timeStamp - d.lastT) / 1000, 1 / 240);
  d.moved += Math.abs(dy);
  if (d.touch && touchGroup) touchGroup.moved = Math.max(touchGroup.moved, d.moved);
  switch (d.grip) {
    case 'bend': model.updateBend(d.index, w.x, d.startWorldY - w.y); break;
    case 'lift': model.dragLift(d.index, dy, w.x); break;
    case 'print': movePrint(e); break;
    case 'tilt':
      model.dragTilt(dy);
      d.velocity = d.velocity * 0.7 + (dy / dt) * 0.3;
      break;
  }
  d.lastY = w.sy;
  d.lastT = e.timeStamp;
  dirty = true;
});

function finish(e, cancelled) {
  const d = drags.get(e.pointerId);
  if (!d) return;
  drags.delete(e.pointerId);
  const tap = !cancelled && d.moved < 12;
  switch (d.grip) {
    case 'bend': model.endBend(d.index); break;
    case 'tilt': model.flingTilt(Math.min(Math.max(d.velocity, -2600), 2600)); break;
    case 'lift': model.endLift(d.index); break;     // the cord lock holds the blind
    case 'print': releasePrint(e, cancelled); break;
    case 'none': if (tap) tapPage(e.clientX, e.clientY); break;
  }
  if (tap) {
    if (e.timeStamp - lastTap.t < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40) {
      model.toggleOpen();
      lastTap.t = -1e9;
    } else {
      lastTap = { t: e.timeStamp, x: e.clientX, y: e.clientY };
    }
  }

  // three fingers down and up again quickly: breeze on or off
  if (d.touch && touchGroup && --touchGroup.fingers === 0) {
    if (touchGroup.most === 3 && touchGroup.moved < 12 && e.timeStamp - touchGroup.start < 500
        && !cancelled && !stream) {
      breeze = !breeze;
      sound.wind = breeze ? 0.9 : 0.45;
      dirty = true;
    }
    touchGroup = null;
  }
  dirty = true;
}
canvas.addEventListener('pointerup', e => {
  finish(e, false);
  if (e.pointerType === 'mouse') canvas.style.cursor = cursorAt(e);
});
canvas.addEventListener('pointercancel', e => finish(e, true));
canvas.addEventListener('contextmenu', e => e.preventDefault());

/// "humans", or a link, on the bare page at this point. The targets reach a
/// little past the letters, which are smaller than a finger; the one-letter
/// links reach halfway to their neighbours.
function linkAt(x, y) {
  if (stream) return null;
  const near = (el, pad) => {
    const r = el.getBoundingClientRect();
    return x > r.left - pad && x < r.right + pad && y > r.top - pad && y < r.bottom + pad;
  };
  if (humans && near(humans, 8)) return humans;
  for (const a of page.querySelectorAll('a[href]')) {
    if (near(a, a.textContent.length === 1 ? 12 : 8)) return a;
  }
  return null;
}

/// A tap on the bare page under a raised blind.
function tapPage(x, y) {
  const a = linkAt(x, y);
  if (a === humans) openCamera();
  else if (a) openLink(a.getAttribute('href'));
}

/// Links open in a new tab, leaving the site where it is. Browsers open a
/// tab only from a real click, so the tap marks the link and the click that
/// follows it opens it.
let pendingLink = null;
function openLink(href) { pendingLink = { href, t: performance.now() }; }
canvas.addEventListener('click', () => {
  if (pendingLink && performance.now() - pendingLink.t < 1000) window.open(pendingLink.href, '_blank', 'noopener');
  pendingLink = null;
});

/// The cursor for a mouse over this point, from what a press would take hold
/// of: a hand to point at links, an open hand for what drags - pulls, slats,
/// the print - and an up-down arrow on the cords that tilt the blind.
function cursorAt(e) {
  const w = world(e);
  if (model.liftHandle(w.x, w.y) !== null) return 'grab';
  if (w.y < model.railY - 6 * model.s) {
    if (onPrint(e)) return 'grab';
    return linkAt(e.clientX, e.clientY) ? 'pointer' : '';
  }
  if (isCord(w.x)) return 'ns-resize';
  return model.isStacked(model.slatAtWorldY(w.y)) ? '' : 'grab';
}

// ------------------------------------------------------------------ print

function grabPrint(e) {
  holds.set(e.pointerId, { x: e.clientX, y: e.clientY });
  print.glide = null;
  if (!hold) {
    hold = { id: e.pointerId, x0: e.clientX, y0: e.clientY, px: print.x, py: print.y,
             trail: [{ t: e.timeStamp, x: print.x, y: print.y }], start: e.timeStamp, moved: 0,
             twist: null, twisted: false };
  } else if (!hold.twist && holds.size === 2) {
    // a second finger: the two of them twist the print around
    const [a, b] = [...holds.values()];
    hold.twist = { a0: Math.atan2(b.y - a.y, b.x - a.x), angle0: print.angle };
  }
}

function movePrint(e) {
  const p = holds.get(e.pointerId);
  if (!p) return;
  p.x = e.clientX;
  p.y = e.clientY;
  if (hold && e.pointerId === hold.id) {
    const nx = hold.px + (e.clientX - hold.x0), ny = hold.py + (e.clientY - hold.y0);
    // where it has been over the last tenth of a second, for its speed
    hold.trail.push({ t: e.timeStamp, x: nx, y: ny });
    while (hold.trail.length > 2 && e.timeStamp - hold.trail[0].t > 100) hold.trail.shift();
    hold.moved = Math.max(hold.moved, Math.hypot(e.clientX - hold.x0, e.clientY - hold.y0));
    print.x = nx;
    print.y = ny;
  }
  if (hold?.twist && holds.size >= 2) {
    const [a, b] = [...holds.values()];
    print.angle = hold.twist.angle0 + (Math.atan2(b.y - a.y, b.x - a.x) - hold.twist.a0) * 180 / Math.PI;
    hold.twisted = true;
  }
  placePrint();
}

function releasePrint(e, cancelled) {
  holds.delete(e.pointerId);
  if (!hold) return;
  if (e.pointerId !== hold.id) {
    hold.twist = null;                              // the twisting finger let go
    return;
  }
  if (!cancelled && !hold.twisted && hold.moved < 12 && e.timeStamp - hold.start < 500) {
    openLink(PRINT.link);                           // a tap says hi on X
  } else {
    // It carries on at the finger's speed and slows to a stop, like paper
    // sliding on paper - no pause, no spring. A finger that stopped before it
    // let go flicks nothing.
    const trail = hold.trail, last = trail[trail.length - 1];
    const first = trail.find(p => last.t - p.t <= 80) ?? trail[0];
    const span = (last.t - first.t) / 1000;
    const still = e.timeStamp - last.t > 80 || span < 0.01;
    let vx = still ? 0 : (last.x - first.x) / span, vy = still ? 0 : (last.y - first.y) / span;
    // unlike the app, it never glides out of reach: its centre stays on
    // screen, and it eases to the edge rather than sailing past and back
    const clampX = x => Math.min(Math.max(x, -printCentre.x), W - printCentre.x);
    const clampY = y => Math.min(Math.max(y, -printCentre.y), H - printCentre.y);
    const x1 = clampX(print.x + vx / GLIDE), y1 = clampY(print.y + vy / GLIDE);
    if (x1 !== print.x + vx / GLIDE) vx = 0;
    if (y1 !== print.y + vy / GLIDE) vy = 0;
    print.glide = { x0: print.x, y0: print.y, x1, y1, vx, vy, t0: performance.now() };
  }
  hold = null;
  holds.clear();
}

// ------------------------------------------------------------------ frames

const start = performance.now();
let last = start;

/// The asterisks' sparkle: each spins in from nothing, pops past its size,
/// dims for a twinkle and settles, one after another. Done with SVG
/// transform attributes rather than CSS, which Safari mangles on SVG text.
const SPARKLE = [[0, 0, 0.2, -120], [0.45, 1, 1.5, 15], [0.65, 0.5, 0.9, -5], [0.8, 1, 1.15, 0], [1, 1, 1, 0]];
const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
let sparkled = false;

function sparkle(now) {
  let done = true;
  for (const star of tech.stars) {
    const t0 = Math.min(Math.max((now - starsIn - +star.dataset.delay) / 900, 0), 1);
    if (t0 < 1) done = false;
    if (calm || t0 >= 1) {
      star.setAttribute('opacity', calm && t0 <= 0 ? '0' : '1');
      star.removeAttribute('transform');
      continue;
    }
    const t = 1 - (1 - t0) ** 3;                                   // quick in, slow to settle
    let i = 0;
    while (i < SPARKLE.length - 2 && t > SPARKLE[i + 1][0]) i++;
    const [ta, oa, sa, ra] = SPARKLE[i], [tb, ob, sb, rb] = SPARKLE[i + 1];
    const f = Math.min(Math.max((t - ta) / (tb - ta), 0), 1);
    const o = oa + (ob - oa) * f, sc = sa + (sb - sa) * f, rot = ra + (rb - ra) * f;
    if (!star.centre) {
      const b = star.getBBox();
      star.centre = [b.x + b.width / 2, b.y + b.height / 2];
    }
    const [cx, cy] = star.centre;
    star.setAttribute('opacity', o.toFixed(3));
    star.setAttribute('transform', `translate(${cx} ${cy}) rotate(${rot.toFixed(2)}) scale(${sc.toFixed(3)}) translate(${-cx} ${-cy})`);
  }
  if (done) sparkled = true;
}

function frame(now) {
  requestAnimationFrame(frame);
  if (starsIn !== null && !sparkled) sparkle(now);

  if (print.glide) {
    // critically damped from the finger's speed; aimed where friction alone
    // would stop it, this is a plain exponential slow-down
    const g = print.glide, t = Math.max(now - g.t0, 0) / 1000, k = Math.exp(-GLIDE * t);
    print.x = g.x1 + ((g.x0 - g.x1) + (g.vx + GLIDE * (g.x0 - g.x1)) * t) * k;
    print.y = g.y1 + ((g.y0 - g.y1) + (g.vy + GLIDE * (g.y0 - g.y1)) * t) * k;
    if (k < 1e-3) {
      print.x = g.x1;
      print.y = g.y1;
      print.glide = null;
    }
    placePrint();
  }

  if (!renderer) return;
  const dt = Math.max(now - last, 0) / 1000;
  const moving = !model.atRest;
  const tiltBefore = model.tilt;
  model.step(dt);
  last = now;

  // what the hand does to the blind, heard: slats ticking as they turn, a
  // clack at either end, a click as a let-go slat lands, the stack, the cord
  const turn = Math.abs(model.tilt - tiltBefore) / Math.max(dt, 1e-3);
  sound.turning(turn, Math.min(dt, 0.1));
  const lim = Config.tiltLimit;
  if ((model.tilt <= 0 && tiltBefore > 0) || (model.tilt >= lim && tiltBefore < lim)) sound.clack(Math.min(turn / 3, 1));
  const snap = model.takeSnapImpulse();
  if (snap > 0.05) sound.snap(snap);
  if (model.takeStackClick()) sound.stack();
  sound.cord(model.liftVel);

  // the first time the blind is up past "using technology as a tool", its
  // asterisks sparkle in, and then they stay
  if (tech && starsIn === null && H / 2 - model.railY < techTop - 6) starsIn = now;

  // the clouds keep blowing whether or not a frame is drawn; the camera
  // gets none, as in the app
  const pageShows = !stream;
  const cloud = pageShows ? (breeze ? 1 : CLOUDS.faint) : 0;
  const speed = breeze ? 1 : CLOUDS.faintSpeed;
  drift[0] += CLOUDS.breezeSpeed[0] * speed * dt;
  drift[1] += CLOUDS.breezeSpeed[1] * speed * dt;

  // A still blind needs no new frame, except for the clouds - and they move
  // so slowly that 30 a second is plenty, which spares the battery.
  const cloudsDue = cloud > 0 && now - lastCloudFrame >= 33;
  if (!(moving || dirty || cloudsDue || drags.size > 0)) return;
  dirty = false;
  lastCloudFrame = now;
  model.packSlats(slats);
  const u = model.uniforms({ page: pageShows, cloud, drift, time: (now - start) / 1000,
                             sky: pageShows ? sky : null });
  u.uLitRef = [...sky.ref, 0];
  u.uPaperShown = [...paperShown, 0];
  renderer.draw(u, slats, model.count, W, H);
  document.body.classList.remove('veiled');
}
requestAnimationFrame(frame);
