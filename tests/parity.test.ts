import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { buildGame, type Mode } from "../src/deckBuilder";

const cases: Array<{ mode: Mode; players: number; setup?: string; seed: number }> = [
  { mode: "base", players: 6, setup: "standard", seed: 7 },
  { mode: "pok", players: 5, setup: "hyperlanes", seed: 42 },
  { mode: "thunders_edge", players: 8, setup: "standard", seed: 11 }
];

function normalizeTypeScript(mode: Mode, players: number, setup: string | undefined, seed: number) {
  const result = buildGame({ mode, players, setup, seed });
  return {
    mode: result.mode,
    players: result.players,
    setup: result.setup,
    decks: result.decks.map((deck, index) => ({
      player: `Player ${index + 1}`,
      tileIds: deck.map((tile) => tile.tile_id),
      totals: result.summary.players[index].totals
    })),
    shared: result.summary.shared_tiles.map((tile) => tile.id),
    unused: result.summary.unused_tiles.map((tile) => tile.id),
    spread: result.summary.max_spread
  };
}

function normalizePython(mode: Mode, players: number, setup: string | undefined, seed: number) {
  const args = ["run", "python", "ti4_deck_builder.py", "--mode", mode, "--players", String(players), "--seed", String(seed), "--format", "json"];
  if (setup) args.push("--setup", setup);
  const output = execFileSync("uv", args, { cwd: process.cwd(), encoding: "utf8" });
  const parsed = JSON.parse(output);
  return {
    mode: parsed.mode,
    players: parsed.players,
    setup: parsed.setup,
    decks: parsed.decks.map((deck: { player: string; tiles: Array<{ id: string }>; totals: Record<string, number> }) => ({
      player: deck.player,
      tileIds: deck.tiles.map((tile) => tile.id),
      totals: deck.totals
    })),
    shared: parsed.summary.shared_tiles.map((tile: { id: string }) => tile.id),
    unused: parsed.summary.unused_tiles.map((tile: { id: string }) => tile.id),
    spread: parsed.summary.max_spread
  };
}

describe("typescript parity with python", () => {
  for (const testCase of cases) {
    it(`${testCase.mode} ${testCase.players}p seed ${testCase.seed}`, () => {
      expect(normalizeTypeScript(testCase.mode, testCase.players, testCase.setup, testCase.seed)).toEqual(
        normalizePython(testCase.mode, testCase.players, testCase.setup, testCase.seed)
      );
    }, 20000);
  }
});
