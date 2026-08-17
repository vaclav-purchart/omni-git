# App icon

`inf-diagonal.svg` is the source of truth. Everything under `src-tauri/icons/`
and `public/icon.svg` is generated from it — edit the SVG, never the PNGs.

## Regenerating

```sh
npx tauri icon design/icons/inf-diagonal.svg
cp design/icons/inf-diagonal.svg public/icon.svg
rm -rf src-tauri/icons/android src-tauri/icons/ios src-tauri/icons/64x64.png
```

`tauri icon` accepts the SVG directly, so no rasteriser needs to be installed.
It also emits Android and iOS icon sets and a `64x64.png` that nothing
references; this project has no mobile targets, hence the `rm`.

## Checking a change

Open `preview.html` in a browser. It renders the live SVG at 224/128/64/32/16px
on both a dark and a light surround. Judge it at 32px and 16px — that is where
icons fail, and three earlier drafts died there: a ring with one diagonal tail
became a magnifying glass, a ring with three evenly spaced nodes became the
system share glyph, and a branch that merged back enclosed an area that read as
a play button.

`preview.html` shows the browser's downscaling, which is not resvg's. For a
final check, rasterise with `tauri icon` and look at the real PNGs.

## Gotchas found the hard way

- A gradient on a straight vertical line renders as nothing. The default
  `gradientUnits="objectBoundingBox"` is undefined when the bounding box has
  zero width, and resvg drops the stroke. Use `userSpaceOnUse`.
- Put commits inside the same transform group as the lane they sit on rather
  than at hand-computed coordinates, or they drift when the group is rotated.
- Dashes need the full run between two nodes to read as dashes. A short stub
  just looks like a rendering fault.

`candidates/` holds the rejected drafts, kept because the reasons above are
easier to see next to the shapes that caused them.
