// Sam's words, set out afresh on every visit: the same phrases in the same
// order, with new line breaks and new places each time, always readable. The
// phrases are read off the page as he designed it (index.html), which is
// what anyone without JavaScript sees. The links row stays where he put it,
// centred at the bottom.

const SVG = 'http://www.w3.org/2000/svg';
const ADVANCE = 0.618 * 18.55;      // SF Mono's character width at his size (13pt), mock pixels
const LEAD = 23;                    // his line spacing
const LEFT = 60, RIGHT = 513.5;     // the text column, within his margins
const TOP = 85, BOTTOM = 785;       // first baseline at the earliest; room above the links row
const MAX_CHARS = 28;               // his longest line is 26
const MIN_CHARS = 5;                // no "for" or "tech" left on a line alone
const MIN_GAP = 50;                 // between groups, so they never run together
/// Where the print lies when the page opens, in mock pixels, whatever the
/// screen: lines at these heights keep to its left so none start under it.
/// Tilted six degrees, its top left corner reaches left to 278 and its top
/// edge up to 463, so the zone starts a little left of and above both.
const PRINT = { left: 268, top: 455, bottom: 812 };

const rand = (a, b) => a + Math.random() * (b - a);
const width = line => line.reduce((n, t) => n + t.text.length, 0) + line.length - 1;
const byPrint = y => y > PRINT.top && y < PRINT.bottom + 13;

/// A group's words, in order. A link stays one piece.
function words(group) {
  const out = [];
  for (const text of group.querySelectorAll('text')) {
    if (text.textContent.trim() === '*') continue;
    for (const node of text.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        for (const w of node.textContent.split(/\s+/)) if (w) out.push({ text: w });
      } else {
        out.push({ text: node.textContent, el: node });
      }
    }
  }
  return out;
}

/// New line breaks: short phrases mostly stay whole, long ones take two or
/// three lines, never too long and never with a word or two stranded.
function breakLines(tokens) {
  const total = width(tokens), n = tokens.length, r = Math.random();
  let count;
  if (total <= 12) count = r < 0.7 ? 1 : 2;
  else if (total <= 26) count = r < 0.35 ? 1 : r < 0.85 ? 2 : 3;
  else count = r < 0.6 ? 2 : 3;
  count = Math.min(count, n);
  for (let attempt = 0; attempt < 60; attempt++) {
    const cuts = new Set();
    while (cuts.size < count - 1) cuts.add(1 + Math.floor(Math.random() * (n - 1)));
    const lines = [];
    let from = 0;
    for (const cut of [...cuts].sort((a, b) => a - b).concat(n)) {
      lines.push(tokens.slice(from, cut));
      from = cut;
    }
    if (lines.every(l => width(l) <= MAX_CHARS && (width(l) >= MIN_CHARS || lines.length === 1))) return lines;
    if (attempt % 20 === 19 && count > 1) count -= 1;      // too fussy: fewer lines
  }
  return [tokens];
}

/// Line breaks and heights for every phrase, with the space left over shared
/// out at random between them.
function plan(phrases) {
  const pad = p => (p.starry ? [70, 85] : [0, 0]);
  const broken = phrases.map(p => breakLines(p.tokens));
  const height = phrases.reduce((h, p, i) => h + (broken[i].length - 1) * LEAD + pad(p)[0] + pad(p)[1], 0);
  const spare = Math.max(BOTTOM - TOP - height - MIN_GAP * phrases.length, 0);
  const weights = phrases.map(() => rand(0.5, 1.5)).concat(rand(0.2, 0.8));
  const sum = weights.reduce((a, b) => a + b, 0);
  let y = TOP + rand(0, 25);
  const out = phrases.map((p, i) => {
    y += pad(p)[0];
    const lines = broken[i].map(line => {
      const item = { line, y, w: width(line) * ADVANCE };
      y += LEAD;
      return item;
    });
    y += pad(p)[1] - LEAD + MIN_GAP + spare * weights[i + 1] / sum;
    return lines;
  });
  // it works if every line beside the print fits to its left
  const fits = out.flat().every(l => !byPrint(l.y) || l.w <= PRINT.left - LEFT);
  return { out, fits };
}

function textLine(line, x, y) {
  const text = document.createElementNS(SVG, 'text');
  text.setAttribute('x', x.toFixed(1));
  text.setAttribute('y', y.toFixed(1));
  line.forEach((t, i) => {
    if (i > 0) text.appendChild(document.createTextNode(' '));
    text.appendChild(t.el ? t.el : document.createTextNode(t.text));
  });
  return text;
}

/// Lays the page out anew. Returns the lines of "using technology as a tool"
/// and the asterisks placed around them, which come in once the blind is up.
export function rearrange(page) {
  const groups = [...page.querySelectorAll('.group')];
  groups.pop();                                     // X L I, which stay put
  const phrases = groups.map(g => ({
    group: g,
    tokens: words(g),
    starry: [...g.querySelectorAll('text')].some(t => t.textContent.trim() === '*'),
  }));

  let layout = plan(phrases);
  for (let attempt = 0; attempt < 40 && !layout.fits; attempt++) layout = plan(phrases);

  let tech = null;
  phrases.forEach((p, i) => {
    for (const old of [...p.group.children]) old.remove();
    let x = null;
    const placed = layout.out[i].map(({ line, y, w }) => {
      const right = (byPrint(y) ? PRINT.left : RIGHT) - w;
      // the first line anywhere across the column; the next ones near it
      x = x === null ? rand(LEFT, right) : x + rand(-120, 120);
      x = Math.min(Math.max(x, LEFT), Math.max(right, LEFT));
      const el = textLine(line, x, y);
      p.group.appendChild(el);
      return { el, x, y, w };
    });
    if (p.starry) tech = { lines: placed, stars: scatterStars(p.group, placed) };
  });

  return tech;
}

/// Seven asterisks round the sentence, three above and four below, as in his
/// mock - scattered afresh, clear of the words, of each other and of the print.
function scatterStars(group, lines) {
  const left = Math.min(...lines.map(l => l.x)), right = Math.max(...lines.map(l => l.x + l.w));
  const top = lines[0].y - 13, bottom = lines[lines.length - 1].y + 4;
  const stars = [];
  const bands = [[top - 70, top - 16, 3], [bottom + 22, bottom + 82, 4]];
  for (const [y0, y1, count] of bands) {
    for (let k = 0; k < count; k++) {
      for (let attempt = 0; attempt < 40; attempt++) {
        const y = rand(y0, y1);
        const lo = Math.max(left - 40, LEFT - 20);
        const hi = Math.min(right + 30, byPrint(y) ? PRINT.left - 12 : RIGHT + 10);
        if (lo > hi) continue;
        const x = rand(lo, hi);
        if (stars.every(s => Math.hypot(s.x - x, s.y - y) > 34)) {
          stars.push({ x, y });
          break;
        }
      }
    }
  }
  return stars.map(({ x, y }) => {
    const star = document.createElementNS(SVG, 'text');
    star.setAttribute('x', x.toFixed(1));
    star.setAttribute('y', y.toFixed(1));
    star.setAttribute('class', 'star');
    star.setAttribute('opacity', '0');              // until they sparkle in
    star.dataset.delay = Math.round(rand(0, 700));
    star.textContent = '*';
    group.appendChild(star);
    return star;
  });
}
