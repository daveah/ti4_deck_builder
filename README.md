# TI4 Deck Builder

`ti4_deck_builder.py` builds random but approximately balanced Twilight Imperium 4 tile decks for each player.

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

Supported setup variants:

- `3`: `standard`
- `4`: `standard`
- `5`: `hyperlanes` (default), `standard`
- `6`: `standard` (default), `large`
- `7`: `standard` (default), `alternate`
- `8`: `standard` (default), `alternate`

For setups that require shared faceup tiles near Mecatol Rex, those are reported separately from player decks.

It uses a randomized greedy pass plus swap-based improvement, so the same seed gives the same result.

## Examples

```powershell
uv run python .\ti4_deck_builder.py --mode base --players 6 --seed 7
uv run python .\ti4_deck_builder.py --mode pok --players 5 --setup hyperlanes --seed 42
uv run python .\ti4_deck_builder.py --mode thunders_edge --players 8 --setup standard --seed 99 --format json
```

## Notes

- The tool does not distribute the full eligible tile pool.
- Shared setup tiles and unused leftovers are included in the output.
- Home systems, Mecatol Rex, hyperlanes, Mallice, and other special setup-only tiles are excluded from the dealt decks.
