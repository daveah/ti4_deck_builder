import contextlib
import io
import json
import runpy
import sys
import unittest
from argparse import Namespace
from pathlib import Path
from unittest.mock import patch

import ti4_deck_builder as builder


class DeckBuilderTests(unittest.TestCase):
    def test_base_pool_size(self) -> None:
        self.assertEqual(len(builder.pool_for_mode("base")), 32)

    def test_pok_pool_size(self) -> None:
        self.assertEqual(len(builder.pool_for_mode("pok")), 54)

    def test_thunders_edge_pool_size(self) -> None:
        self.assertEqual(len(builder.pool_for_mode("thunders_edge")), 74)

    def test_color_group_uses_needed_tiles_once(self) -> None:
        pool = builder.pool_for_mode("thunders_edge")
        blue_pool = [tile for tile in pool if tile.board_color == "blue"]
        decks, leftovers, _ = builder.deal_color_group(
            blue_pool, players=8, per_player=4, seed=13, restarts=50
        )
        dealt = [tile.tile_id for deck in decks for tile in deck]
        self.assertEqual(len(dealt), 32)
        self.assertEqual(len(set(dealt)), 32)
        self.assertEqual(len(leftovers), len(blue_pool) - 32)

    def test_seed_is_deterministic(self) -> None:
        pool = builder.pool_for_mode("pok")
        blue_pool = [tile for tile in pool if tile.board_color == "blue"]
        decks_a, _, _ = builder.deal_color_group(
            blue_pool, players=6, per_player=3, seed=5, restarts=50
        )
        decks_b, _, _ = builder.deal_color_group(
            blue_pool, players=6, per_player=3, seed=5, restarts=50
        )
        self.assertEqual(
            [[tile.tile_id for tile in deck] for deck in decks_a],
            [[tile.tile_id for tile in deck] for deck in decks_b],
        )

    def test_build_game_leaves_unused_tiles(self) -> None:
        result = builder.build_game(
            builder.pool_for_mode("base"),
            mode="base",
            players=6,
            setup="standard",
            seed=7,
            restarts=50,
        )
        self.assertEqual(sum(len(deck) for deck in result["decks"]), 30)
        self.assertEqual(len(result["summary"]["unused_tiles"]), 2)
        self.assertEqual(len(result["summary"]["shared_tiles"]), 0)
        self.assertLessEqual(result["summary"]["max_spread"]["resources"], 1)
        self.assertLessEqual(result["summary"]["max_spread"]["influence"], 1)

    def test_five_player_default_setup_is_hyperlanes(self) -> None:
        self.assertEqual(builder.resolve_setup_name("pok", 5, None), "hyperlanes")

    def test_summary_uses_combined_trait_and_skip_metrics(self) -> None:
        result = builder.build_game(
            builder.pool_for_mode("base"),
            mode="base",
            players=6,
            setup="standard",
            seed=7,
            restarts=50,
        )
        totals = result["summary"]["players"][0]["totals"]
        self.assertIn("traits", totals)
        self.assertIn("tech_skips", totals)
        self.assertNotIn("cultural", totals)
        self.assertNotIn("biotic", totals)

    def test_seeded_rng_zero_seed_uses_fallback_state(self) -> None:
        rng = builder.SeededRng(0)
        self.assertEqual(rng.state, 0x6D2B79F5)

    def test_deal_color_group_rejects_oversized_request(self) -> None:
        pool = builder.pool_for_mode("base")
        blue_pool = [tile for tile in pool if tile.board_color == "blue"]
        with self.assertRaisesRegex(ValueError, "Need 36 tiles from a pool of 20."):
            builder.deal_color_group(blue_pool, players=6, per_player=6, seed=1)

    def test_validate_mode_players_errors_for_base_and_expansion(self) -> None:
        with self.assertRaisesRegex(
            ValueError, "Base game mode supports 3 through 6 players."
        ):
            builder.validate_mode_players("base", 8)
        with self.assertRaisesRegex(
            ValueError, "This mode supports 3 through 8 players."
        ):
            builder.validate_mode_players("pok", 2)

    def test_resolve_setup_name_rejects_unknown_setup(self) -> None:
        with self.assertRaisesRegex(
            ValueError, "Unsupported setup 'bogus' for 6 players."
        ):
            builder.resolve_setup_name("base", 6, "bogus")

    def test_build_game_raises_if_primary_constraint_is_not_met(self) -> None:
        with patch.object(builder, "satisfies_primary_constraint", return_value=False):
            with self.assertRaisesRegex(
                ValueError,
                "Unable to generate decks with resource and influence spread both at 1 or less.",
            ):
                builder.build_game(
                    builder.pool_for_mode("base"),
                    mode="base",
                    players=6,
                    setup="standard",
                    seed=7,
                    restarts=5,
                )

    def test_format_text_output_includes_shared_and_empty_unused_sections(self) -> None:
        summary = {
            "score": 1.5,
            "per_player": {"blue": 3, "red": 2},
            "shared_tiles": [{"id": "18", "name": "Mecatol Rex"}],
            "players": [
                {
                    "player": "Player 1",
                    "tile_count": 2,
                    "tiles": [{"id": "2", "name": "A"}, {"id": "1", "name": "B"}],
                    "totals": {
                        "resources": 5.0,
                        "influence": 4.0,
                        "traits": 3.0,
                        "tech_skips": 1.0,
                        "wormholes": 0.0,
                    },
                }
            ],
            "max_spread": {
                "resources": 1.0,
                "influence": 1.0,
                "traits": 0.0,
                "tech_skips": 0.0,
                "wormholes": 0.0,
            },
            "unused_tiles": [],
        }
        text = builder.format_text_output("base", 6, "standard", None, summary)
        self.assertIn("Seed: random", text)
        self.assertIn("Shared setup tiles: 18 Mecatol Rex", text)
        self.assertIn("  Tiles: 1 B, 2 A", text)
        self.assertTrue(text.endswith("None"))

    def test_parse_args_reads_all_cli_options(self) -> None:
        argv = [
            "ti4_deck_builder.py",
            "--mode",
            "base",
            "--players",
            "6",
            "--setup",
            "standard",
            "--seed",
            "7",
            "--restarts",
            "55",
            "--format",
            "json",
        ]
        with patch.object(sys, "argv", argv):
            args = builder.parse_args()
        self.assertEqual(args.mode, "base")
        self.assertEqual(args.players, 6)
        self.assertEqual(args.setup, "standard")
        self.assertEqual(args.seed, 7)
        self.assertEqual(args.restarts, 55)
        self.assertEqual(args.format, "json")

    def test_main_prints_json_output(self) -> None:
        fake_args = Namespace(
            mode="base",
            players=6,
            setup="standard",
            seed=7,
            restarts=50,
            format="json",
        )
        fake_summary = {
            "score": 0.0,
            "per_player": {"blue": 3, "red": 2},
            "shared_tiles": [],
            "players": [],
            "max_spread": {
                "resources": 0.0,
                "influence": 0.0,
                "traits": 0.0,
                "tech_skips": 0.0,
                "wormholes": 0.0,
            },
            "unused_tiles": [],
        }
        fake_result = {
            "mode": "base",
            "players": 6,
            "setup": "standard",
            "seed": 7,
            "decks": [[builder.tile(1, "Alpha", "base", board_color="blue")]],
            "summary": fake_summary,
        }
        stdout = io.StringIO()
        with (
            patch.object(builder, "parse_args", return_value=fake_args),
            patch.object(builder, "pool_for_mode", return_value=[]),
            patch.object(builder, "build_game", return_value=fake_result),
            contextlib.redirect_stdout(stdout),
        ):
            builder.main()
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["mode"], "base")
        self.assertEqual(payload["decks"][0]["tiles"][0]["id"], "1")

    def test_main_prints_text_output(self) -> None:
        fake_args = Namespace(
            mode="base",
            players=6,
            setup="standard",
            seed=7,
            restarts=50,
            format="text",
        )
        fake_result = {
            "mode": "base",
            "players": 6,
            "setup": "standard",
            "seed": 7,
            "decks": [],
            "summary": {},
        }
        stdout = io.StringIO()
        with (
            patch.object(builder, "parse_args", return_value=fake_args),
            patch.object(builder, "pool_for_mode", return_value=[]),
            patch.object(builder, "build_game", return_value=fake_result),
            patch.object(builder, "format_text_output", return_value="hello world"),
            contextlib.redirect_stdout(stdout),
        ):
            builder.main()
        self.assertEqual(stdout.getvalue().strip(), "hello world")

    def test_module_main_entrypoint_invokes_main(self) -> None:
        module_path = Path(builder.__file__).resolve()
        argv = [
            str(module_path),
            "--mode",
            "base",
            "--players",
            "6",
            "--setup",
            "standard",
            "--seed",
            "7",
            "--format",
            "json",
        ]
        stdout = io.StringIO()
        with (
            patch.object(sys, "argv", argv),
            contextlib.redirect_stdout(stdout),
        ):
            runpy.run_path(str(module_path), run_name="__main__")
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["mode"], "base")

    def test_test_module_main_entrypoint_invokes_unittest_main(self) -> None:
        test_path = Path(__file__).resolve()
        with patch("unittest.main") as mocked_main:
            runpy.run_path(str(test_path), run_name="__main__")
        mocked_main.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
