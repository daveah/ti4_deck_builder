from __future__ import annotations

import argparse
import json
import math
import secrets
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, MutableSequence, TypeVar

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
T = TypeVar("T")


FEATURE_ORDER = (
    "resources",
    "influence",
    "planets",
    "traits",
    "tech_skips",
    "wormholes",
    "legendary",
)

FEATURE_WEIGHTS = {
    "resources": 25.0,
    "influence": 25.0,
    "planets": 0.25,
    "traits": 0.8,
    "tech_skips": 0.8,
    "wormholes": 0.8,
    "legendary": 0.5,
}

PRIMARY_CONSTRAINT_FEATURES = ("resources", "influence")
MAX_PRIMARY_SPREAD = 1.0


class SeededRng:
    def __init__(self, seed: int | None = None) -> None:
        value = secrets.randbits(32) if seed is None else seed
        self.state = value & 0xFFFFFFFF
        if self.state == 0:
            self.state = 0x6D2B79F5

    def random(self) -> float:
        self.state = (1664525 * self.state + 1013904223) & 0xFFFFFFFF
        return self.state / 4294967296.0

    def shuffle(self, items: MutableSequence[T]) -> None:
        for index in range(len(items) - 1, 0, -1):
            swap_index = int(self.random() * (index + 1))
            items[index], items[swap_index] = items[swap_index], items[index]


@dataclass(frozen=True)
class Planet:
    name: str
    resources: int
    influence: int
    traits: tuple[str, ...] = ()
    techs: tuple[str, ...] = ()
    legendary: bool = False
    station: bool = False


@dataclass(frozen=True)
class Tile:
    tile_id: str
    name: str
    expansion: str
    board_color: str
    planets: tuple[Planet, ...] = ()
    wormholes: tuple[str, ...] = ()
    anomalies: tuple[str, ...] = ()
    special: bool = False
    _metrics: dict[str, float] = field(init=False, repr=False, compare=False)

    def __post_init__(self) -> None:
        metrics = {feature: 0.0 for feature in FEATURE_ORDER}
        metrics["resources"] = sum(planet.resources for planet in self.planets)
        metrics["influence"] = sum(planet.influence for planet in self.planets)
        metrics["planets"] = float(len(self.planets))
        metrics["wormholes"] = float(len(self.wormholes))
        for planet in self.planets:
            if planet.legendary:
                metrics["legendary"] += 1.0
            metrics["traits"] += float(len(planet.traits))
            metrics["tech_skips"] += float(len(planet.techs))
        object.__setattr__(self, "_metrics", metrics)

    @property
    def metrics(self) -> dict[str, float]:
        return self._metrics


def planet(
    name: str,
    resources: int,
    influence: int,
    *,
    traits: Iterable[str] = (),
    techs: Iterable[str] = (),
    legendary: bool = False,
    station: bool = False,
) -> Planet:
    return Planet(
        name=name,
        resources=resources,
        influence=influence,
        traits=tuple(traits),
        techs=tuple(techs),
        legendary=legendary,
        station=station,
    )


def tile(
    tile_id: str | int,
    name: str,
    expansion: str,
    *,
    board_color: str,
    planets: Iterable[Planet] = (),
    wormholes: Iterable[str] = (),
    anomalies: Iterable[str] = (),
    special: bool = False,
) -> Tile:
    return Tile(
        tile_id=str(tile_id),
        name=name,
        expansion=expansion,
        board_color=board_color,
        planets=tuple(planets),
        wormholes=tuple(wormholes),
        anomalies=tuple(anomalies),
        special=special,
    )


def load_tiles_from_json(path: Path | None = None) -> list[Tile]:
    source = path or DATA_DIR / "tiles.json"
    payload: list[dict[str, Any]] = json.loads(source.read_text(encoding="utf-8"))
    tiles: list[Tile] = []
    for entry in payload:
        planets = [
            planet(
                planet_entry["name"],
                planet_entry["resources"],
                planet_entry["influence"],
                traits=planet_entry.get("traits", ()),
                techs=planet_entry.get("techs", ()),
                legendary=planet_entry.get("legendary", False),
                station=planet_entry.get("station", False),
            )
            for planet_entry in entry.get("planets", [])
        ]
        tiles.append(
            tile(
                entry["tile_id"],
                entry["name"],
                entry["expansion"],
                board_color=entry["board_color"],
                planets=planets,
                wormholes=entry.get("wormholes", ()),
                anomalies=entry.get("anomalies", ()),
                special=entry.get("special", False),
            )
        )
    return tiles


def load_setup_rules(
    path: Path | None = None,
) -> dict[str, dict[int, dict[str, dict[str, dict[str, int]]]]]:
    source = path or DATA_DIR / "setup_rules.json"
    payload: dict[str, dict[str, dict[str, dict[str, dict[str, int]]]]] = json.loads(
        source.read_text(encoding="utf-8")
    )
    return {
        group: {int(players): setups for players, setups in group_rules.items()}
        for group, group_rules in payload.items()
    }


ALL_TILES = load_tiles_from_json()
TILES_BY_MODE = {
    "base": {"base"},
    "pok": {"base", "pok"},
    "prophecy_of_kings": {"base", "pok"},
    "thunders_edge": {"base", "pok", "thunders_edge"},
    "thunder_edge": {"base", "pok", "thunders_edge"},
}
SETUP_RULES = load_setup_rules()


def feature_totals(tiles: Iterable[Tile]) -> dict[str, float]:
    totals = {feature: 0.0 for feature in FEATURE_ORDER}
    for entry in tiles:
        for feature in FEATURE_ORDER:
            totals[feature] += entry.metrics[feature]
    return totals


def score_totals(
    player_totals: list[dict[str, float]], targets: list[dict[str, float]]
) -> float:
    score = 0.0
    for totals, target in zip(player_totals, targets):
        for feature in FEATURE_ORDER:
            delta = totals[feature] - target[feature]
            score += FEATURE_WEIGHTS[feature] * delta * delta
    for feature in PRIMARY_CONSTRAINT_FEATURES:
        values = [totals[feature] for totals in player_totals]
        spread_over = max(values) - min(values) - MAX_PRIMARY_SPREAD
        if spread_over > 0:
            score += 1_000_000.0 * spread_over * spread_over
    return score


def build_targets(
    overall_totals: dict[str, float], capacities: list[int]
) -> list[dict[str, float]]:
    total_tiles = sum(capacities)
    targets: list[dict[str, float]] = []
    for capacity in capacities:
        share = capacity / total_tiles
        targets.append(
            {feature: overall_totals[feature] * share for feature in FEATURE_ORDER}
        )
    return targets


def weighted_magnitude(entry: Tile) -> float:
    return sum(
        FEATURE_WEIGHTS[feature] * value for feature, value in entry.metrics.items()
    )


def player_label(index: int) -> str:
    return f"Player {index + 1}"


def totals_with_delta(
    totals: dict[str, float], add: Tile | None = None, remove: Tile | None = None
) -> dict[str, float]:
    updated = totals.copy()
    if remove is not None:
        for feature in FEATURE_ORDER:
            updated[feature] -= remove.metrics[feature]
    if add is not None:
        for feature in FEATURE_ORDER:
            updated[feature] += add.metrics[feature]
    return updated


def primary_spreads(player_totals: list[dict[str, float]]) -> dict[str, float]:
    return {
        feature: max(totals[feature] for totals in player_totals)
        - min(totals[feature] for totals in player_totals)
        for feature in PRIMARY_CONSTRAINT_FEATURES
    }


def satisfies_primary_constraint(player_totals: list[dict[str, float]]) -> bool:
    spreads = primary_spreads(player_totals)
    return all(spread <= MAX_PRIMARY_SPREAD for spread in spreads.values())


def refine_decks(
    decks: list[list[Tile]],
    capacities: list[int],
    max_passes: int = 200,
) -> tuple[list[list[Tile]], list[dict[str, float]]]:
    deck_totals = [feature_totals(deck) for deck in decks]
    overall_totals = feature_totals(tile for deck in decks for tile in deck)
    targets = build_targets(overall_totals, capacities)

    for _ in range(max_passes):
        current_score = score_totals(deck_totals, targets)
        improved = False
        for first_player in range(len(decks)):
            for second_player in range(first_player + 1, len(decks)):
                for first_index, first_tile in enumerate(decks[first_player]):
                    for second_index, second_tile in enumerate(decks[second_player]):
                        trial_first = totals_with_delta(
                            deck_totals[first_player],
                            add=second_tile,
                            remove=first_tile,
                        )
                        trial_second = totals_with_delta(
                            deck_totals[second_player],
                            add=first_tile,
                            remove=second_tile,
                        )
                        trial_totals = deck_totals[:]
                        trial_totals[first_player] = trial_first
                        trial_totals[second_player] = trial_second
                        trial_score = score_totals(trial_totals, targets)
                        if trial_score + 1e-9 < current_score:
                            (
                                decks[first_player][first_index],
                                decks[second_player][second_index],
                            ) = (second_tile, first_tile)
                            deck_totals[first_player] = trial_first
                            deck_totals[second_player] = trial_second
                            improved = True
                            break
                    if improved:
                        break
                if improved:
                    break
            if improved:
                break
        if not improved:
            break
    return decks, deck_totals


def deal_color_group(
    tiles: list[Tile],
    players: int,
    per_player: int,
    seed: int | None = None,
    restarts: int = 500,
) -> tuple[list[list[Tile]], list[Tile], dict[str, object]]:
    rng = SeededRng(seed)
    total_needed = players * per_player
    if total_needed > len(tiles):
        raise ValueError(f"Need {total_needed} tiles from a pool of {len(tiles)}.")

    selected = tiles[:]
    rng.shuffle(selected)
    selected = selected[:total_needed]
    leftovers = [entry for entry in tiles if entry not in selected]
    capacities = [per_player] * players

    totals = feature_totals(selected)
    targets = build_targets(totals, capacities)
    best_assignment: list[list[Tile]] | None = None
    best_score = math.inf

    for _ in range(restarts):
        decks: list[list[Tile]] = [[] for _ in range(players)]
        deck_totals = [
            {feature: 0.0 for feature in FEATURE_ORDER} for _ in range(players)
        ]
        counts = [0] * players

        ordered_tiles = [
            (weighted_magnitude(entry) + rng.random() * 0.25, int(entry.tile_id), entry)
            for entry in selected
        ]
        ordered_tiles.sort(key=lambda item: (-item[0], item[1]))

        for _, _, entry in ordered_tiles:
            candidate_scores: list[tuple[float, int]] = []
            for player_index in range(players):
                if counts[player_index] >= capacities[player_index]:
                    continue
                next_count = counts[player_index] + 1
                fill_ratio = next_count / capacities[player_index]
                provisional_target = {
                    feature: targets[player_index][feature] * fill_ratio
                    for feature in FEATURE_ORDER
                }
                score = 0.0
                for feature in FEATURE_ORDER:
                    projected = (
                        deck_totals[player_index][feature] + entry.metrics[feature]
                    )
                    delta = projected - provisional_target[feature]
                    score += FEATURE_WEIGHTS[feature] * delta * delta
                score += rng.random() * 0.01
                candidate_scores.append((score, player_index))

            _, chosen_player = min(candidate_scores, key=lambda pair: pair[0])
            decks[chosen_player].append(entry)
            counts[chosen_player] += 1
            for feature in FEATURE_ORDER:
                deck_totals[chosen_player][feature] += entry.metrics[feature]

        decks, deck_totals = refine_decks(decks, capacities)
        final_score = score_totals(deck_totals, targets)
        if final_score < best_score:
            best_score = final_score
            best_assignment = decks

    assert best_assignment is not None

    summary = summarize_assignment(best_assignment, capacities)
    summary["score"] = round(best_score, 4)
    summary["leftover_tiles"] = [
        {"id": entry.tile_id, "name": entry.name}
        for entry in sorted(leftovers, key=lambda tile: int(tile.tile_id))
    ]
    return best_assignment, leftovers, summary


def setup_rules_for_mode(mode: str) -> dict[int, dict[str, dict[str, dict[str, int]]]]:
    return SETUP_RULES["base"] if mode == "base" else SETUP_RULES["expansion"]


def validate_mode_players(mode: str, players: int) -> None:
    if players not in setup_rules_for_mode(mode):
        if mode == "base":
            raise ValueError("Base game mode supports 3 through 6 players.")
        raise ValueError("This mode supports 3 through 8 players.")


def resolve_setup_name(mode: str, players: int, setup: str | None) -> str:
    options = setup_rules_for_mode(mode)[players]
    if setup is None:
        return next(iter(options))
    normalized = setup.lower()
    if normalized not in options:
        raise ValueError(
            f"Unsupported setup '{setup}' for {players} players. Choose from: {', '.join(sorted(options))}."
        )
    return normalized


def build_game(
    all_tiles: list[Tile],
    mode: str,
    players: int,
    setup: str | None,
    seed: int | None = None,
    restarts: int = 500,
) -> dict[str, Any]:
    validate_mode_players(mode, players)
    setup_name = resolve_setup_name(mode, players, setup)
    rules = setup_rules_for_mode(mode)[players][setup_name]
    rng = SeededRng(seed)

    blue_pool = [entry for entry in all_tiles if entry.board_color == "blue"]
    red_pool = [entry for entry in all_tiles if entry.board_color == "red"]

    shuffled_blue = blue_pool[:]
    shuffled_red = red_pool[:]
    rng.shuffle(shuffled_blue)
    rng.shuffle(shuffled_red)

    shared_blue = shuffled_blue[: rules["shared"]["blue"]]
    shared_red = shuffled_red[: rules["shared"]["red"]]
    player_blue_pool = shuffled_blue[rules["shared"]["blue"] :]
    player_red_pool = shuffled_red[rules["shared"]["red"] :]

    blue_seed = None if seed is None else seed * 2 + 1
    red_seed = None if seed is None else seed * 2 + 2
    blue_decks, blue_leftovers, _ = deal_color_group(
        player_blue_pool,
        players,
        rules["per_player"]["blue"],
        seed=blue_seed,
        restarts=restarts,
    )
    red_decks, red_leftovers, _ = deal_color_group(
        player_red_pool,
        players,
        rules["per_player"]["red"],
        seed=red_seed,
        restarts=restarts,
    )

    capacities = [rules["per_player"]["blue"] + rules["per_player"]["red"]] * players
    decks: list[list[Tile]] = []
    for index in range(players):
        merged = blue_decks[index] + red_decks[index]
        merged.sort(key=lambda entry: int(entry.tile_id))
        decks.append(merged)

    decks, deck_totals = refine_decks(decks, capacities)
    summary = summarize_assignment(decks, capacities)
    overall_totals = feature_totals(tile for deck in decks for tile in deck)
    targets = build_targets(overall_totals, capacities)
    if not satisfies_primary_constraint(deck_totals):
        raise ValueError(
            "Unable to generate decks with resource and influence spread both at 1 or less."
        )
    summary["score"] = round(score_totals(deck_totals, targets), 4)
    summary["setup"] = setup_name
    summary["per_player"] = rules["per_player"]
    summary["shared_tiles"] = [
        {"id": entry.tile_id, "name": entry.name}
        for entry in sorted(
            shared_blue + shared_red, key=lambda tile: int(tile.tile_id)
        )
    ]
    summary["unused_tiles"] = [
        {"id": entry.tile_id, "name": entry.name}
        for entry in sorted(
            blue_leftovers + red_leftovers, key=lambda tile: int(tile.tile_id)
        )
    ]
    return {
        "mode": mode,
        "players": players,
        "setup": setup_name,
        "seed": seed,
        "decks": decks,
        "summary": summary,
    }


def summarize_assignment(
    decks: list[list[Tile]], capacities: list[int]
) -> dict[str, Any]:
    overall_totals = feature_totals(tile for deck in decks for tile in deck)
    targets = build_targets(overall_totals, capacities)
    result_players: list[dict[str, Any]] = []
    actual_totals: list[dict[str, float]] = []
    for player_index, deck in enumerate(decks):
        totals = feature_totals(deck)
        actual_totals.append(totals)
        result_players.append(
            {
                "player": player_label(player_index),
                "tile_count": len(deck),
                "target_tile_count": capacities[player_index],
                "tile_ids": [entry.tile_id for entry in deck],
                "tiles": [{"id": entry.tile_id, "name": entry.name} for entry in deck],
                "totals": totals,
            }
        )

    max_spread: dict[str, float] = {}
    for feature in FEATURE_ORDER:
        values = [totals[feature] for totals in actual_totals]
        max_spread[feature] = max(values) - min(values)

    return {
        "players": result_players,
        "target_totals": targets,
        "max_spread": max_spread,
    }


def format_text_output(
    mode: str, players: int, setup: str, seed: int | None, summary: dict[str, Any]
) -> str:
    lines = [
        f"Mode: {mode}",
        f"Players: {players}",
        f"Setup: {setup}",
        f"Seed: {seed if seed is not None else 'random'}",
        f"Balance score: {summary['score']}",
        f"Per player: {summary['per_player']['blue']} blue, {summary['per_player']['red']} red",
        "",
    ]
    if summary["shared_tiles"]:
        lines.append(
            "Shared setup tiles: "
            + ", ".join(
                f"{tile['id']} {tile['name']}" for tile in summary["shared_tiles"]
            )
        )
        lines.append("")
    for player in summary["players"]:
        lines.append(f"{player['player']} ({player['tile_count']} tiles)")
        lines.append(
            "  Tiles: "
            + ", ".join(
                f"{tile['id']} {tile['name']}"
                for tile in sorted(player["tiles"], key=lambda entry: entry["id"])
            )
        )
        totals = player["totals"]
        lines.append(
            "  Totals: "
            f"R={totals['resources']:.0f}, I={totals['influence']:.0f}, "
            f"traits={totals['traits']:.0f}, "
            f"tech_skips={totals['tech_skips']:.0f}, "
            f"wormholes={totals['wormholes']:.0f}"
        )
        lines.append("")

    spread = summary["max_spread"]
    lines.append(
        "Max spread: "
        f"R={spread['resources']:.0f}, I={spread['influence']:.0f}, "
        f"traits={spread['traits']:.0f}, "
        f"tech_skips={spread['tech_skips']:.0f}, "
        f"wormholes={spread['wormholes']:.0f}"
    )
    lines.append("")
    lines.append(f"Unused tiles: {len(summary['unused_tiles'])}")
    lines.append(
        ", ".join(f"{tile['id']} {tile['name']}" for tile in summary["unused_tiles"])
        if summary["unused_tiles"]
        else "None"
    )
    return "\n".join(lines)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build balanced Twilight Imperium 4 system-tile decks."
    )
    parser.add_argument(
        "--mode",
        choices=("base", "pok", "prophecy_of_kings", "thunders_edge", "thunder_edge"),
        required=True,
        help="Which tile pool to use.",
    )
    parser.add_argument(
        "--players",
        type=int,
        required=True,
        help="Number of players to build decks for.",
    )
    parser.add_argument(
        "--setup",
        default=None,
        help="Board setup variant. Examples: standard, hyperlanes, alternate, large.",
    )
    parser.add_argument(
        "--seed", type=int, default=None, help="Random seed for reproducible output."
    )
    parser.add_argument(
        "--restarts",
        type=int,
        default=500,
        help="How many random balancing attempts to try.",
    )
    parser.add_argument(
        "--format",
        choices=("text", "json"),
        default="text",
        help="Output format.",
    )
    return parser.parse_args()


def pool_for_mode(mode: str) -> list[Tile]:
    canonical = mode.lower()
    allowed = TILES_BY_MODE[canonical]
    return [
        entry for entry in ALL_TILES if entry.expansion in allowed and not entry.special
    ]


def main() -> None:
    args = parse_args()
    pool = pool_for_mode(args.mode)
    result = build_game(
        pool,
        args.mode,
        args.players,
        args.setup,
        seed=args.seed,
        restarts=args.restarts,
    )
    if args.format == "json":
        payload = {
            "mode": result["mode"],
            "players": result["players"],
            "setup": result["setup"],
            "seed": result["seed"],
            "decks": [
                {
                    "player": player_label(index),
                    "tiles": [
                        {"id": entry.tile_id, "name": entry.name} for entry in deck
                    ],
                    "totals": feature_totals(deck),
                }
                for index, deck in enumerate(result["decks"])
            ],
            "summary": result["summary"],
        }
        print(json.dumps(payload, indent=2))
        return

    print(
        format_text_output(
            result["mode"],
            result["players"],
            result["setup"],
            result["seed"],
            result["summary"],
        )
    )


if __name__ == "__main__":
    main()
