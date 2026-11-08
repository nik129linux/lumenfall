// Paints one group of level tiles (the tiles common to both worlds, the ones only
// in world A, or only in world B) onto a 2D canvas, using the level's tilesheet.
// The canvas becomes a single textured plane, so a whole level is three draw
// calls however many tiles it has.
//
// Rock is sampled at WORLD coordinates from a texture that tiles seamlessly every
// 64 px, so a crack that leaves one tile carries on into the next instead of
// stopping at a border. The rim (grass lip, hanging fringe, side edges) is drawn
// on top according to which neighbours of a tile are open air.
//
// Canvas y runs down and level y runs up, so tile (tx, ty) lands at canvas row
// (height - 1 - ty).

const T = 8;

// Rows 0..GROUND_ROWS-1 are the floor. A solid block standing on it is a pillar;
// the floor itself is never one.
const FLOOR_TOP = 3;

export function paintGroup({ art, level, width, height, solids, plats, spikes = [], occupied, group }) {
  const sheet = art.levels[level];
  const P = art.period;
  const cv = document.createElement('canvas');
  cv.width = width * T;
  cv.height = height * T;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const key = (x, y) => `${x},${y}`;
  const platSet = new Set(plats.map(([x, y]) => key(x, y)));
  // Anything beyond the sides or below the bottom counts as solid: no edge is drawn
  // at the border of the level. Above the top is open air.
  const has = (x, y) => (x < 0 || x >= width || y < 0) ? true : (y >= height ? false : occupied.has(key(x, y)));
  const empty = (x, y) => x >= 0 && x < width && y >= 0 && y < height && !occupied.has(key(x, y));

  // sx, sy: offset inside the named piece; w, h: size; dx, dy: where on the canvas.
  const blit = (name, sx, sy, w, h, dx, dy) => {
    const r = sheet.rects[name];
    ctx.drawImage(sheet.img, r[0] + sx, r[1] + sy, w, h, dx, dy, w, h);
  };
  const erase = (x, y, w = 1, h = 1) => ctx.clearRect(x, y, w, h);

  const pillars = findPillars(solids, width);

  const paintBody = (tx, ty, cx, cy, pillar) => {
    const px = ((cx % P) + P) % P, py = ((cy % P) + P) % P;
    blit(pillar ? 'masonry' : 'rock', px, py, T, T, cx, cy);
  };

  // ---- thin slabs: platforms, and any solid tile with air above and below
  const paintSlab = (tx, ty) => {
    const cx = tx * T, cy = (height - 1 - ty) * T;
    const px = cx % P;
    const bridge = group === 2 && !platSet.has(key(tx, ty));
    blit(bridge ? 'plank' : 'platform', px, 0, T, T, cx, cy);
    const left = !has(tx - 1, ty), right = !has(tx + 1, ty);
    if (left) { erase(cx, cy, T, T); blit('platL', 0, 0, T, T, cx, cy); }
    if (right) { erase(cx, cy, T, T); blit('platR', 0, 0, T, T, cx, cy); }
    if (empty(tx, ty + 1)) blit('lipOver', px, 0, T, T, cx, cy - T);
    if (empty(tx, ty - 1)) blit('fringe', px, 0, T, T, cx, cy + T);
  };

  const paintSolid = (tx, ty) => {
    const cx = tx * T, cy = (height - 1 - ty) * T;
    const px = cx % P, py = ((cy % P) + P) % P;
    const pil = pillars.get(key(tx, ty));
    const openTop = !has(tx, ty + 1), openBottom = !has(tx, ty - 1);
    const openL = !has(tx - 1, ty), openR = !has(tx + 1, ty);

    paintBody(tx, ty, cx, cy, !!pil);

    if (pil && ty === pil.top) {
      // capital: the whole top row is replaced, not overlaid
      erase(cx, cy, T, T);
      blit(tx === pil.minX ? 'capL' : tx === pil.maxX ? 'capR' : 'capM', 0, 0, T, T, cx, cy);
    } else if (pil && ty === pil.bottom && pil.grounded) {
      erase(cx, cy, T, T);
      blit(tx === pil.minX ? 'baseL' : tx === pil.maxX ? 'baseR' : 'baseM', 0, 0, T, T, cx, cy);
    } else if (openTop) {
      blit('lipTop', px, 0, T, T, cx, cy);
    }

    if (openL) blit('edgeL', 0, py, 4, T, cx, cy);
    if (openR) blit('edgeR', 0, py, 4, T, cx + 4, cy);

    // rounded corners where two open sides meet
    if (openTop && openL) { erase(cx, cy); erase(cx + 1, cy); erase(cx, cy + 1); }
    if (openTop && openR) { erase(cx + 7, cy); erase(cx + 6, cy); erase(cx + 7, cy + 1); }
    if (openBottom && openL) { erase(cx, cy + 7); erase(cx + 1, cy + 7); erase(cx, cy + 6); }
    if (openBottom && openR) { erase(cx + 7, cy + 7); erase(cx + 6, cy + 7); erase(cx + 7, cy + 6); }

    if (openBottom && ty > 0) {
      // the underside: a dark line, then the fringe hanging into the air below
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(cx + (openL ? 1 : 0), cy + 7, T - (openL ? 1 : 0) - (openR ? 1 : 0), 1);
      if (empty(tx, ty - 1)) blit('fringe', px, 0, T, T, cx, cy + T);
    }
    if (openTop && empty(tx, ty + 1)) blit('lipOver', px, 0, T, T, cx, cy - T);
  };

  // Spikes: two teeth per tile, dark with a bright tip so they read as a hazard.
  for (const [tx, ty] of spikes) {
    const cx = tx * T, cy = (height - 1 - ty) * T;
    for (let k = 0; k < 2; k++) {
      ctx.fillStyle = '#4a2a22';
      ctx.beginPath();
      ctx.moveTo(cx + k * 4, cy + T); ctx.lineTo(cx + k * 4 + 2, cy); ctx.lineTo(cx + k * 4 + 4, cy + T);
      ctx.fill();
      ctx.fillStyle = '#c8604a';
      ctx.fillRect(cx + k * 4 + 1, cy, 2, 2);
    }
  }
  for (const [tx, ty] of plats) paintSlab(tx, ty);
  for (const [tx, ty] of solids) {
    const thin = !has(tx, ty + 1) && !has(tx, ty - 1);
    if (thin) paintSlab(tx, ty); else paintSolid(tx, ty);
  }

  // World B is the toxic one: tint everything drawn in this group green.
  if (group === 2) {
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = 'rgba(60,140,40,0.30)';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.globalCompositeOperation = 'source-over';
  }
  return cv;
}

// Solid blocks that stand up from the floor (or hang as walls) and are 1-4 tiles wide, at
// least 3 tall and completely filled are drawn as pillars: capital, shaft, plinth.
// Returns Map "x,y" -> { minX, maxX, top, bottom, grounded }.
function findPillars(solids, width) {
  const set = new Set(solids.filter(([, y]) => y > FLOOR_TOP).map(([x, y]) => `${x},${y}`));
  const seen = new Set();
  const out = new Map();
  for (const k of set) {
    if (seen.has(k)) continue;
    const stack = [k], comp = [];
    seen.add(k);
    while (stack.length) {
      const cur = stack.pop();
      comp.push(cur);
      const [x, y] = cur.split(',').map(Number);
      for (const n of [`${x + 1},${y}`, `${x - 1},${y}`, `${x},${y + 1}`, `${x},${y - 1}`]) {
        if (set.has(n) && !seen.has(n)) { seen.add(n); stack.push(n); }
      }
    }
    const xs = comp.map((c) => +c.split(',')[0]), ys = comp.map((c) => +c.split(',')[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), bottom = Math.min(...ys), top = Math.max(...ys);
    const w = maxX - minX + 1, h = top - bottom + 1;
    if (w > 4 || h < 3 || w * h !== comp.length) continue;
    const info = { minX, maxX, top, bottom, grounded: bottom === FLOOR_TOP + 1 };
    for (const c of comp) out.set(c, info);
  }
  return out;
}
