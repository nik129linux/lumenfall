# Stage 2b — Three polish fixes on the story

Same rules as stage 2 (assets/ read-only, never delete files you did not create, only
what is written here). Commit and stop.

1. **Portraits are unreadable.** The 48 px idle sprite scaled x3 is a blob of noise.
   Use crops of the cutscene paintings instead (CSS `background-image` + `background-size`
   + `background-position`, no new files):
   - Kael: `assets/cutscenes/04.png`, his face, roughly x 30%–60%, y 5%–45% of the image.
   - Elder: `assets/cutscenes/03.png`, his face, roughly x 62%–85%, y 36%–58%.
   Tune the rectangles by looking at the screenshot until each portrait shows one face,
   centred, filling the frame. Portrait frame 96x96 CSS px, keep the accent-colour border.
   `image-rendering: auto` (these are paintings).
2. **Panels over the level are semi-transparent.** In `deal-portraits.png` panel 03 is at
   ~60% opacity and the level shows through it. When a panel is shown during the deal it
   must reach full opacity (the blurred backdrop copy fills the sides). Only the 400 ms
   crossfade may be partial.
3. **Duplicated level title.** On entering L1 the toast reads
   "Santuario de la Brasa — Santuario de la Brasa". Show the name once.

Acceptance: rerun `tools/story.mjs`; `.scratch/stage2b/` screenshots of the deal with
portraits (one ES, one EN), panel 04, and the L1 title toast. Read them yourself.
Commit `Stage 2b: painted portraits, opaque panels, single level title`.
