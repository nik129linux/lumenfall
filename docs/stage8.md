# Stage 8 — Make the game light enough to host

The 19 cutscene panels and 3 backgrounds weigh ~45 MB of PNG. A static host or a teammate on a
slow connection will choke. Shrink them WITHOUT losing the pixel-art look, and keep the originals.

Done when `python3 tools/gate8.py` prints GATE PASS. Run it, read the FAIL lines, fix, repeat. Do not edit the gate.
Do not run `git commit`.

## Files you may edit
`tools/compress-panels.py` (NEW), `assets/cutscenes/*.png`, `assets/bg/l1.png`, `l2.png`, `l3.png`, and the new folder `assets-src/`. Nothing else, and do not rename or delete any file.

## Steps (in this order)
1. FIRST copy every current `assets/cutscenes/NN.png` (01..19) into `assets-src/cutscenes/` and `assets/bg/l1.png l2.png l3.png` into `assets-src/bg/`, unchanged. These are the originals; the gate checks they exist and are byte-identical to what the compressor starts from.
2. Write `tools/compress-panels.py` (Pillow): reads from `assets-src/`, writes the shrunk PNGs into `assets/`. For every image: resize with LANCZOS so the width is at most 1280 (never upscale; keep the aspect ratio), then reduce the palette with `Image.quantize(colors=N, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG)` and save with `optimize=True`. Pick N per image (start at 192) and lower it only while the gate's quality check still passes.
3. Run it. Do not touch `assets-src/`.

## Targets the gate checks
- every panel in `assets/cutscenes/` is at most 900 KB and the folder totals at most 9 MB
- every background in `assets/bg/` is at most 1.4 MB
- width of each output is `min(original width, 1280)` and the aspect ratio is within 1%
- quality: downscale original and result to 256 px wide; the mean absolute difference per channel must be at most 10 (of 255)
- each output is still a valid PNG that opens with Pillow
