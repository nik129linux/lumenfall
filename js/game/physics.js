// Axis-aligned tile collision.
//
// All of it runs in the level group's local space, which is axis-aligned when
// the group is at rest. During the L2 rotation the physics is switched off
// entirely (see level.js), which is what lets a 90-degree rotation happen
// without any rotated-box maths anywhere in the codebase.

export const TILE = 8;

export class Body {
  constructor(x, y, w, h) {
    this.x = x; this.y = y;      // bottom-left corner
    this.w = w; this.h = h;
    this.vx = 0; this.vy = 0;
    this.onGround = false;
    this.hitCeiling = false;
    this.wallLeft = false;
    this.wallRight = false;
    this.enabled = true;
  }

  get left() { return this.x; }
  get right() { return this.x + this.w; }
  get top() { return this.y + this.h; }
  get bottom() { return this.y; }
  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }
}

// A level is stored as a grid of tile ids. 0 is empty.
export const SOLID = 1;
export const PLATFORM = 2;   // one-way: only solid from above
export const SPIKE = 3;
export const DECOR = 4;

export function tileAt(level, tx, ty) {
  if (ty < 0 || ty >= level.height) return SOLID;   // ceiling and floor are solid
  if (tx < 0 || tx >= level.width) return SOLID;
  return level.grid[ty * level.width + tx];
}

export function isSolid(level, tx, ty) {
  return tileAt(level, tx, ty) === SOLID;
}

// Sweeps a body one axis at a time. Resolving X before Y is what makes a body
// slide along a wall instead of catching on its corners.
export function moveX(body, level, dx) {
  body.wallLeft = body.wallRight = false;
  if (dx === 0 || !body.enabled) return false;
  body.x += dx;

  const y0 = Math.floor(body.bottom / TILE);
  const y1 = Math.floor((body.top - 0.001) / TILE);

  if (dx > 0) {
    const tx = Math.floor((body.right - 0.001) / TILE);
    for (let ty = y0; ty <= y1; ty++) {
      if (isSolid(level, tx, ty)) {
        body.x = tx * TILE - body.w;
        body.vx = 0;
        body.wallRight = true;
        return true;
      }
    }
  } else {
    const tx = Math.floor(body.left / TILE);
    for (let ty = y0; ty <= y1; ty++) {
      if (isSolid(level, tx, ty)) {
        body.x = (tx + 1) * TILE;
        body.vx = 0;
        body.wallLeft = true;
        return true;
      }
    }
  }
  return false;
}

export function moveY(body, level, dy) {
  const wasOnGround = body.onGround;
  body.onGround = false;
  body.hitCeiling = false;
  if (dy === 0 || !body.enabled) return false;
  body.y += dy;

  const x0 = Math.floor(body.left / TILE);
  const x1 = Math.floor((body.right - 0.001) / TILE);

  if (dy > 0) {
    // Rising (+y is up): only a ceiling stops us.
    const ty = Math.floor(body.top / TILE);
    for (let tx = x0; tx <= x1; tx++) {
      if (isSolid(level, tx, ty)) {
        body.y = (ty - 1) * TILE - body.h;
        body.vy = 0;
        body.hitCeiling = true;
        return true;
      }
    }
  } else {
    // Falling.
    const ty = Math.floor(body.bottom / TILE);
    for (let tx = x0; tx <= x1; tx++) {
      const t = tileAt(level, tx, ty);
      if (t === SOLID) {
        body.y = (ty + 1) * TILE;
        body.vy = 0;
        body.onGround = true;
        return true;
      }
      // One-way platforms only catch a body that was already falling and was
      // above the tile last frame. Passing `wasOnGround` through as "was
      // airborne" is what lets you jump up through them and land on top.
      if (t === PLATFORM && !wasOnGround) {
        const surface = ty * TILE;
        if (body.bottom - dy >= surface) {
          body.y = surface;
          body.vy = 0;
          body.onGround = true;
          return true;
        }
      }
    }
  }
  return false;
}

export function overlaps(a, b) {
  return a.left < b.right && a.right > b.left && a.bottom < b.top && a.top > b.bottom;
}

export function rectOf(x, y, w, h) { return { left: x, right: x + w, bottom: y, top: y + h }; }

export function bodyRect(body) {
  return { left: body.left, right: body.right, bottom: body.bottom, top: body.top };
}

// Every solid tile overlapping a world rect, for attacks and enemy senses.
export function tilesInRect(level, rect) {
  const out = [];
  const x0 = Math.floor(rect.left / TILE);
  const x1 = Math.floor((rect.right - 0.001) / TILE);
  const y0 = Math.floor(rect.bottom / TILE);
  const y1 = Math.floor((rect.top - 0.001) / TILE);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (tileAt(level, tx, ty) === SOLID) out.push({ tx, ty });
    }
  }
  return out;
}
