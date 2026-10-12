# EPIXS template cloud

Remote template updates for the Picok booth. This is a static folder hosted on Firebase Hosting (or on
any HTTPS static host). The booth downloads `manifest.json` at start-up and every 6 hours, and also when
the operator taps **Admin → Templates → Check for updates now**.

**No photos are ever stored here.** The booth only downloads from this folder and never uploads to it.

## Deploy

```bash
cd template_cloud
firebase login
firebase use --add            # pick the EPIXS Firebase project
firebase deploy --only hosting
```

In the booth, set **Admin → Templates → Manifest URL** to `https://<project>.web.app/manifest.json`.

## Publishing a new pack

1. Create `public/packs/<pack_id>/pack.json`. Copy one of the festival packs as a starting point.
   - The pack id may contain only lowercase letters, digits, `_` and `-`.
2. Put any PNG artwork or extra fonts next to the pack file, and reference them with relative paths.
3. Add the pack to `manifest.json`.
4. Every time you change a pack, **raise its `version`**. Booths only download a pack when its version
   number goes up.
5. Run `firebase deploy --only hosting`.

To remove a pack from all booths, delete its entry from `manifest.json`.

## `manifest.json`

```json
{
  "packs": [
    { "id": "festival_diwali_2026", "version": 1, "url": "packs/festival_diwali_2026/pack.json" }
  ],
  "settings": { "version": 0 }
}
```

`settings` is optional. Booths apply it only when the operator has switched on **Accept prices & settings
from the cloud**, and only when `version` is higher than the last one they applied. Supported keys:

- `prices`: `{ "4x6": { "colour": 15000, "bw": 15000, "extraCopy": 7000 } }`, in paise
- `maxCopies`
- `freeMode`
- `eventName`
- `eventDate`

## `pack.json`

```json
{
  "id": "festival_diwali_2026", "name": "Diwali 2026", "version": 1,
  "activeFrom": "2026-10-28", "activeTo": "2026-11-12",
  "fonts": [ { "family": "MyFont", "file": "fonts/MyFont.ttf" } ],
  "templates": [ { …template… } ]
}
```

`activeFrom` and `activeTo` are inclusive dates. The pack switches on and off by itself. A template can
also set its own dates.

## Template format

All coordinates are pixels at 300 dpi on the portrait canvas:

| Size | Canvas |
| --- | --- |
| 4×6 | 1200 × 1800 |
| 2×6 | 600 × 1800 (the booth prints two strips on one 4×6 sheet) |
| 3.5×5 | 1050 × 1500 |
| 5×7 | 1500 × 2100 |
| 6×8 | 1800 × 2400 |

With `"landscape": true`, the width and height are swapped.

| Key | Meaning |
| --- | --- |
| `id`, `name`, `description` | Unique id and display text |
| `category` | `festival`, `event`, `retro` or `standard` |
| `size` | `4x6`, `2x6`, `3.5x5`, `5x7` or `6x8` |
| `filter` | `none`, `warm_film`, `neon_pop`, `poster`, `sepia`, `vivid`, `classic_bw`, `fade` or `cool` |
| `background` | `{ "color": "#RRGGBB" }` or `{ "gradient": { "colors": [...], "stops": [...], "begin": [x,y], "end": [x,y] } }`. Gradient points are relative (0–1). Add `"type": "radial"` with `center` and `radius` for a radial gradient. |
| `slots` | 1–4 photo windows: `x`, `y`, `w`, `h`, plus optional `radius`, `rotation` (degrees), `borderWidth`, `borderColor` and `shadow` |
| `logo` | Brand logo strip: `x`, `y`, `w`, `h`, plus optional `bg`, `textColor` and `font`. Keep it at the bottom; every print must carry the client logo. |
| `layers` | Decorations, drawn in order. Add `"z": "above"` to draw a layer over the photos. Add `"opacity"` (0–1) to any layer. |

Colours are `#RRGGBB` or `#AARRGGBB`.

### Layer types

| Type | Keys |
| --- | --- |
| `rect` | `x y w h`, `color` or `gradient`, `radius`, `rotation`, `stroke {color,width}`, `glow`, `shadow {color,dx,dy,blur}` |
| `circle` | `cx cy r`, `color` or `gradient`, `stroke`, `glow` |
| `text` | `text`, `x y w`, optional `h` (centres the text vertically), `font`, `size`, `weight`, `color`, `align`, `letterSpacing`, `lineHeight`, `maxLines`, `italic`, `uppercase`, `rotation`, `stroke`, `shadow`, `glow {color,blur}`, `fallback` |
| `arcs` | Rainbow bands: `cx cy r band gap start sweep colors[]` |
| `grid` | Synthwave grid: `x y w h cols rows color width glow perspective` |
| `dots` | Halftone: `x y w h spacing rMax rMin color direction`. `direction` is `none`, `down`, `up`, `radial` or `edges`. |
| `stripes` | `x y w h colors[] width angle` |
| `rays` | Sunburst: `cx cy count colors[] r rotation clip{x,y,w,h}` |
| `starburst` | Comic burst: `cx cy points rOuter rInner jitter rotation color stroke shadow` |
| `sprockets` | Film holes: `x y w h holeW holeH gap radius color` |
| `sun` | Synthwave sun: `cx cy r colors[] bands bandColor glow` |
| `line` | `x1 y1 x2 y2 width color dash[on,off] glow` |
| `lines` | Newspaper-style text columns: `x y w h columns gutter lineHeight thickness color` |
| `polygon` | `points [[x,y],…] color stroke` |
| `image` | `src` (a PNG in the pack folder), `x y w h`, `fit` (`fill`, `cover` or `contain`) |

Text placeholders:

- `{event}`: the event name
- `{EVENT}`: the event name in capitals
- `{date}`: the event date

If a placeholder is empty, the layer's `fallback` text is used instead.

The fonts built into the booth are:

- Poppins
- Shrikhand
- Monoton
- Bangers
- Rye
- SpecialElite
- UnifrakturMaguntia
- OldStandard
- Pacifico
- BebasNeue

A pack can add more fonts with `fonts` (TTF, OFL-licensed).

**Checking a pack before you publish it:** run `flutter test test/render_templates_test.dart` in
`kiosk_app/`. The test renders every pack in `template_cloud/public/packs` to PNG files in
`kiosk_app/build/template_previews/`.

Artwork must be original or licensed. Don't use film posters, celebrity images or copyrighted characters.
