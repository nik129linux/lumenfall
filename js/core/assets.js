import * as THREE from '../vendor/three.module.js';

// Loads the generated atlases plus their frame manifest, and applies the
// settings the pipeline chose for each one.
//
// Nearest filtering everywhere, no mipmaps, no anisotropy: the pixel grid is the
// whole aesthetic, and linear filtering or mipmaps would smear it into mush the
// moment the camera moves a subpixel.

const CHARACTERS = ['kael', 'goodwitch', 'badwitch', 'statue', 'demon'];

function makeTexture(img) {
  const tex = new THREE.Texture(img);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('failed to load ' + url));
    img.src = url;
  });
}

// Three.js needs the image dimensions before the first render to size the
// texture, and doing this on the main thread keeps the manifest the single
// source of truth for both the atlas and the clip layout.
export async function loadAssets(onProgress) {
  const manifest = await fetch('assets/atlases/manifest.json').then((r) => r.json());

  const characters = {};
  const jobs = CHARACTERS.map((name) => async () => {
    const img = await loadImage(`assets/atlases/${name}.png`);
    const def = manifest[name];
    const cellW = def.cell[0], cellH = def.cell[1];
    const frameRect = (i) => {
      const col = i % Math.max(1, Math.floor(def.size[0] / cellW));
      const row = Math.floor(i / Math.max(1, Math.floor(def.size[0] / cellW)));
      return { x: col * cellW, y: row * cellH, w: cellW, h: cellH };
    };
    characters[name] = {
      name,
      texture: makeTexture(img),
      cell: def.cell,
      baseline: def.baseline,
      figure: def.figure,
      // Which way the sheet is natively drawn. The flip is expressed relative to
      // this, so a character drawn facing left is mirrored to face right -- and
      // only once. Assumed rather than recorded and the sprites face the wrong
      // way on exactly the sheets that disagree.
      nativeFacing: def.nativeFacing ?? 1,
      // Flattened clip index lists, resolved lazily by frameRect.
      frames: def.frames,
      frameRect,
    };
  });

  let done = 0;
  for (const job of jobs) {
    await job();
    done++;
    if (onProgress) onProgress(done / jobs.length);
  }

  return { characters };
}
