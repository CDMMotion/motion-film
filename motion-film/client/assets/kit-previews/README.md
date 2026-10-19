# Kit preset preview media

These files are generated automatically now -- you don't need to drop
anything in here by hand anymore. Saving a preset from the Kit tab's
footer ("Preset layers"/"Preset comp") renders a real preview clip of
it right after saving, using After Effects' own Render Queue, and saves
it here under the preset's own id (the `id` field the panel generates,
e.g. `kit-1788226106563`):

- `<id>.jpg` -- poster image (a real frame from the clip), shown at rest.
- `<id>.mp4` -- a short (up to 2.5s) looping clip, plays (muted) on hover.

**Why `.mp4`, not `.webm`:** confirmed live that an `.mp4` rendered by
AE's own "H.264 - Match Render Settings" Output Module template plays
back fine in this panel's Chromium. That's a *different* encoder than
the ffmpeg build bundled for the Captions tab (whose own H.264 encoder,
`libopenh264`, doesn't reliably play back here -- that's why Captions-
adjacent video work in this project uses `.webm`/VP9 instead). Kit
previews don't touch that ffmpeg at all: AE renders the `.mp4` directly
to this folder, and the poster `.jpg` is grabbed client-side afterward
from that same file via `<canvas>` -- so this whole pipeline has **zero
external dependencies** and works even if the Captions tools were never
installed.

See `renderKitPreviewClip` (`host/host.jsx`) and
`generateKitPresetPreview`/`captureKitPreviewPoster`
(`client/panel.js`) for how this actually works.

If a file is missing (nothing generated yet, or generation failed), that
preset just falls back to the small CSS-animation placeholder --
nothing breaks, nothing shows a broken-image icon.

**Curated presets** (`KIT_PRESETS`/`KIT_LAYER_GROUP_PRESETS` in
`host.jsx`, baked into the source rather than saved through the footer)
don't get a preview generated automatically -- there's no "save" step
for those to hang the render off of. One can still be generated for a
curated preset the same way, by hand, using the same
`renderKitPreviewClip` host function directly.
