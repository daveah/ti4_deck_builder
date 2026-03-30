import { describe, expect, it, vi } from "vitest";
import {
  SeededRng,
  buildGame,
  dealColorGroup,
  getSetupOptions,
  poolForMode,
  resolveSetupName,
  satisfiesPrimaryConstraint,
  type Tile,
  validateModePlayers,
} from "../src/deckBuilder";

function makeTile(
  tileId: string,
  boardColor: "blue" | "red",
  resources = 1,
  influence = 1,
): Tile {
  return {
    tile_id: tileId,
    name: `Tile ${tileId}`,
    expansion: "base",
    board_color: boardColor,
    wormholes: [],
    anomalies: [],
    special: false,
    planets: [
      {
        name: `Planet ${tileId}`,
        resources,
        influence,
        traits: [],
        techs: [],
        legendary: false,
        station: false,
      },
    ],
  };
}

describe("deckBuilder coverage cases", () => {
  it("handles alias modes and unsupported setup-option lookups", () => {
    expect(poolForMode("prophecy_of_kings")).toHaveLength(
      poolForMode("pok").length,
    );
    expect(poolForMode("thunder_edge")).toHaveLength(
      poolForMode("thunders_edge").length,
    );
    expect(getSetupOptions("base", 8)).toEqual([]);
  });

  it("uses the fallback state for a zero seed", () => {
    expect(new SeededRng(0).state).toBe(0x6d2b79f5);
  });

  it("validates player counts and setup names", () => {
    expect(resolveSetupName("pok", 5, null)).toBe("hyperlanes");
    expect(() => validateModePlayers("base", 8)).toThrow(
      "Base game mode supports 3 through 6 players.",
    );
    expect(() => validateModePlayers("pok", 2)).toThrow(
      "This mode supports 3 through 8 players.",
    );
    expect(() => resolveSetupName("base", 8, "standard")).toThrow(
      "Base game mode supports 3 through 6 players.",
    );
    expect(() => resolveSetupName("pok", 2, "standard")).toThrow(
      "This mode supports 3 through 8 players.",
    );
    expect(() => resolveSetupName("base", 6, "bogus")).toThrow(
      "Unsupported setup 'bogus' for 6 players.",
    );
  });

  it("rejects impossible color-group requests and zero-restart attempts", () => {
    const baseBluePool = poolForMode("base").filter(
      (tile) => tile.board_color === "blue",
    );
    expect(() =>
      dealColorGroup(baseBluePool, 6, 6, 1, 10),
    ).toThrowErrorMatchingInlineSnapshot(
      `[Error: Need 36 tiles from a pool of 20.]`,
    );

    const tinyPool = [makeTile("1", "blue"), makeTile("2", "blue")];
    expect(() => dealColorGroup(tinyPool, 2, 1, 1, 0)).toThrow(
      "Failed to assign tiles.",
    );
  });

  it("covers the weighted tie-break path during dealing", () => {
    const tiles = [makeTile("2", "blue"), makeTile("1", "blue")];
    const randomSpy = vi
      .spyOn(SeededRng.prototype, "random")
      .mockReturnValue(0);
    try {
      const result = dealColorGroup(tiles, 2, 1, 5, 1);
      expect(
        result.decks
          .flat()
          .map((tile) => tile.tile_id)
          .sort(),
      ).toEqual(["1", "2"]);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("checks the primary-constraint helper directly", () => {
    expect(
      satisfiesPrimaryConstraint([
        {
          resources: 5,
          influence: 5,
          planets: 0,
          traits: 0,
          tech_skips: 0,
          wormholes: 0,
          legendary: 0,
        },
        {
          resources: 6,
          influence: 4,
          planets: 0,
          traits: 0,
          tech_skips: 0,
          wormholes: 0,
          legendary: 0,
        },
      ]),
    ).toBe(true);
    expect(
      satisfiesPrimaryConstraint([
        {
          resources: 5,
          influence: 5,
          planets: 0,
          traits: 0,
          tech_skips: 0,
          wormholes: 0,
          legendary: 0,
        },
        {
          resources: 7,
          influence: 5,
          planets: 0,
          traits: 0,
          tech_skips: 0,
          wormholes: 0,
          legendary: 0,
        },
      ]),
    ).toBe(false);
  });

  it("surfaces the final primary-constraint failure when injected", () => {
    expect(() =>
      buildGame({
        mode: "base",
        players: 6,
        setup: "standard",
        seed: 7,
        restarts: 10,
        constraintCheck: () => false,
      }),
    ).toThrow(
      "Unable to generate decks with resource and influence spread both at 1 or less.",
    );
  });
});
