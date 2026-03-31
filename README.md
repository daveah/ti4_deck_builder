# TI4 Deck Builder

Check this out at https://ti4.dah.me.uk/

## Summary

This project now includes:

- a Python CLI in `ti4_deck_builder.py`
- a TypeScript web app with the same balancing rules
- parity tests to ensure both versions produce the same seeded results

It supports three pools:

- `base`
- `pok` / `prophecy_of_kings`
- `thunders_edge` / `thunder_edge`

The balancer tries to even out:

- resources
- influence
- total planet traits
- total tech skips
- wormholes

It uses the actual board-setup counts from TI4 rules, so it only deals the tiles needed for the selected player count and setup variant. Remaining eligible tiles are reported as unused.

The shared setup counts now live in [data/setup_rules.json](C:\Users\dave\dev\ti4_deck_builder\data\setup_rules.json), and both the TypeScript app and Python tool read from that file.

Supported setup variants:

- `3`: `standard`
- `4`: `standard`
- `5`: `hyperlanes` (default), `standard`
- `6`: `standard` (default), `large`
- `7`: `standard` (default), `alternate`
- `8`: `standard` (default), `alternate`

For setups that require shared faceup tiles near Mecatol Rex, those are reported separately from player decks.

It uses a randomized greedy pass plus swap-based improvement, so the same seed gives the same result.

## Python CLI

```powershell
uv run python .\ti4_deck_builder.py --mode base --players 6 --seed 7
uv run python .\ti4_deck_builder.py --mode pok --players 5 --setup hyperlanes --seed 42
uv run python .\ti4_deck_builder.py --mode thunders_edge --players 8 --setup standard --seed 99 --format json
```

## TypeScript Web App

```powershell
npm install
npm run dev
```

Then open the local Vite URL in your browser.

To build the production version:

```powershell
npm run build
```

### JSON board layouts

The web UI board preview is driven by [src/layouts.json](C:\Users\dave\dev\ti4_deck_builder\src\layouts.json). Each entry is a board layout keyed by:

- `base:3:standard`
- `pok:5:hyperlanes`
- `thunders_edge:8:hyperlanes`

Each layout can contain either:

- `tiles`: the explicit board tiles for that configuration
- `ref`: a reference to another layout key when two configurations share the same board geometry

Example layout alias:

```json
{
  "key": "thunders_edge:3:standard",
  "title": "Thunder's Edge 3-player standard",
  "ref": "base:3:standard"
}
```

When a layout uses `tiles`, every tile object supports:

- `q`: axial hex column
- `r`: axial hex row
- `kind`: `red`, `green`, `hyperlane`, `blue`, or one of `blue1`, `blue2`, `blue3`, `blue4`
- `label`: optional text such as `MR`, `H1`, or `S1`
- `hyperlaneId`: optional hyperlane tile id such as `83A`
- `rotation`: optional clockwise rotation in 60-degree steps, from `0` to `5`
- `connections`: optional hyperlane edge pairs such as `[[0,2],[3,5]]`

Blue ring shades:

- `blue1`: lightest blue
- `blue2`: medium-light blue
- `blue3`: medium-dark blue
- `blue4`: darkest blue
- `blue`: legacy/default mid-blue alias

Example:

```json
{
  "key": "pok:5:hyperlanes",
  "title": "PoK 5-player hyperlanes",
  "tiles": [
    { "q": 0, "r": 0, "kind": "red", "label": "MR" },
    { "q": -3, "r": 1, "kind": "green", "label": "H1" },
    {
      "q": -1,
      "r": 4,
      "kind": "hyperlane",
      "hyperlaneId": "83A",
      "rotation": 0,
      "connections": [
        [0, 2],
        [3, 5]
      ]
    }
  ]
}
```

Axial coordinate guide used by the renderer:

```text
        (0,-1)   (1,-1)
    (-1,0)   (0,0)   (1,0)
        (-1,1)   (0,1)
```

Hyperlane edge numbering:

```text
          1   0
        2   •   5
          3   4
```

That means `connections: [[0,3]]` draws a line from the upper-right edge to the lower-left edge of the hex. If you also set `rotation`, the whole hyperlane glyph rotates after those edge numbers are interpreted.

## WebDAV Deploy

The project includes a WebDAV deployment tool for the built TypeScript app:

```powershell
$env:WEBDAV_URL = "https://example.com/webdav"
$env:WEBDAV_USERNAME = "your-user"
$env:WEBDAV_PASSWORD = "your-password"
$env:WEBDAV_REMOTE_PATH = "/public_html/ti4"
npm run deploy:webdav
```

Optional environment variables:

- `WEBDAV_LOCAL_DIR` to deploy a directory other than `dist`
- `WEBDAV_CLEAN_REMOTE=true` to delete existing remote files before upload
- `WEBDAV_SKIP_BUILD=true` to skip the automatic `npm run build` step

## Tests

Python tests:

```powershell
uv run python -m unittest -v
```

TypeScript parity tests:

```powershell
npm test
```

Combined checks:

```powershell
npm run check:all
```

You can also run just one side:

```powershell
npm run check:python
npm run check:ts
```

## Notes

- The tool does not distribute the full eligible tile pool.
- Shared setup tiles and unused leftovers are included in the output.
- Home systems, Mecatol Rex, hyperlanes, Mallice, and other special setup-only tiles are excluded from the dealt decks.
- The Python and TypeScript versions use the same seeded RNG so fixed seeds match across both implementations.
