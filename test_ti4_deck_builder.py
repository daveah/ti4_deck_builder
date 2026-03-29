import unittest

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
        decks, leftovers, _ = builder.deal_color_group(blue_pool, players=8, per_player=4, seed=13, restarts=50)
        dealt = [tile.tile_id for deck in decks for tile in deck]
        self.assertEqual(len(dealt), 32)
        self.assertEqual(len(set(dealt)), 32)
        self.assertEqual(len(leftovers), len(blue_pool) - 32)

    def test_seed_is_deterministic(self) -> None:
        pool = builder.pool_for_mode("pok")
        blue_pool = [tile for tile in pool if tile.board_color == "blue"]
        decks_a, _, _ = builder.deal_color_group(blue_pool, players=6, per_player=3, seed=5, restarts=50)
        decks_b, _, _ = builder.deal_color_group(blue_pool, players=6, per_player=3, seed=5, restarts=50)
        self.assertEqual(
            [[tile.tile_id for tile in deck] for deck in decks_a],
            [[tile.tile_id for tile in deck] for deck in decks_b],
        )

    def test_build_game_leaves_unused_tiles(self) -> None:
        result = builder.build_game(builder.pool_for_mode("base"), mode="base", players=6, setup="standard", seed=7, restarts=50)
        self.assertEqual(sum(len(deck) for deck in result["decks"]), 30)
        self.assertEqual(len(result["summary"]["unused_tiles"]), 2)
        self.assertEqual(len(result["summary"]["shared_tiles"]), 0)
        self.assertLessEqual(result["summary"]["max_spread"]["resources"], 1)
        self.assertLessEqual(result["summary"]["max_spread"]["influence"], 1)

    def test_five_player_default_setup_is_hyperlanes(self) -> None:
        self.assertEqual(builder.resolve_setup_name("pok", 5, None), "hyperlanes")

    def test_summary_uses_combined_trait_and_skip_metrics(self) -> None:
        result = builder.build_game(builder.pool_for_mode("base"), mode="base", players=6, setup="standard", seed=7, restarts=50)
        totals = result["summary"]["players"][0]["totals"]
        self.assertIn("traits", totals)
        self.assertIn("tech_skips", totals)
        self.assertNotIn("cultural", totals)
        self.assertNotIn("biotic", totals)


if __name__ == "__main__":
    unittest.main()
