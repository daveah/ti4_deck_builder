import tileData from "../data/tiles.json";

export type Mode = "base" | "pok" | "prophecy_of_kings" | "thunders_edge" | "thunder_edge";
export type Planet = {
  name: string;
  resources: number;
  influence: number;
  traits: string[];
  techs: string[];
  legendary: boolean;
  station: boolean;
};

export type Tile = {
  tile_id: string;
  name: string;
  expansion: string;
  board_color: "blue" | "red";
  wormholes: string[];
  anomalies: string[];
  special: boolean;
  planets: Planet[];
};

const FEATURE_ORDER = ["resources", "influence", "planets", "traits", "tech_skips", "wormholes", "legendary"] as const;
type Feature = (typeof FEATURE_ORDER)[number];
export type Totals = Record<Feature, number>;

export type PlayerSummary = {
  player: string;
  tile_count: number;
  target_tile_count: number;
  tile_ids: string[];
  tiles: Array<{ id: string; name: string }>;
  totals: Totals;
};

export type Summary = {
  players: PlayerSummary[];
  target_totals: Totals[];
  max_spread: Totals;
  score: number;
  setup: string;
  per_player: { blue: number; red: number };
  shared_tiles: Array<{ id: string; name: string }>;
  unused_tiles: Array<{ id: string; name: string }>;
};

export type BuildGameResult = {
  mode: Mode;
  players: number;
  setup: string;
  seed: number | null;
  decks: Tile[][];
  summary: Summary;
};

const FEATURE_WEIGHTS: Totals = {
  resources: 25,
  influence: 25,
  planets: 0.25,
  traits: 0.8,
  tech_skips: 0.8,
  wormholes: 0.8,
  legendary: 0.5
};

const PRIMARY_CONSTRAINT_FEATURES = ["resources", "influence"] as const;
const MAX_PRIMARY_SPREAD = 1;

const TILES_BY_MODE: Record<Mode, Set<string>> = {
  base: new Set(["base"]),
  pok: new Set(["base", "pok"]),
  prophecy_of_kings: new Set(["base", "pok"]),
  thunders_edge: new Set(["base", "pok", "thunders_edge"]),
  thunder_edge: new Set(["base", "pok", "thunders_edge"])
};

const BASE_SETUP_RULES = {
  3: { standard: { per_player: { blue: 6, red: 2 }, shared: { blue: 0, red: 0 } } },
  4: { standard: { per_player: { blue: 5, red: 3 }, shared: { blue: 0, red: 0 } } },
  5: { standard: { per_player: { blue: 4, red: 2 }, shared: { blue: 0, red: 1 } } },
  6: { standard: { per_player: { blue: 3, red: 2 }, shared: { blue: 0, red: 0 } } }
} as const;

const EXPANSION_SETUP_RULES = {
  3: { standard: { per_player: { blue: 6, red: 2 }, shared: { blue: 0, red: 0 } } },
  4: { standard: { per_player: { blue: 5, red: 3 }, shared: { blue: 0, red: 0 } } },
  5: { hyperlanes: { per_player: { blue: 3, red: 2 }, shared: { blue: 0, red: 0 } } },
  6: { standard: { per_player: { blue: 3, red: 2 }, shared: { blue: 0, red: 0 } } },
  7: { hyperlanes: { per_player: { blue: 4, red: 2 }, shared: { blue: 3, red: 2 } } },
  8: { hyperlanes: { per_player: { blue: 4, red: 2 }, shared: { blue: 2, red: 2 } } }
} as const;

export class SeededRng {
  state: number;

  constructor(seed: number | null = null) {
    const initial = seed === null ? Math.floor(Math.random() * 0xffffffff) : seed;
    this.state = initial >>> 0;
    if (this.state === 0) {
      this.state = 0x6d2b79f5;
    }
  }

  random(): number {
    this.state = (Math.imul(1664525, this.state) + 1013904223) >>> 0;
    return this.state / 4294967296;
  }

  shuffle<T>(items: T[]): void {
    for (let index = items.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(this.random() * (index + 1));
      [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
    }
  }
}

function emptyTotals(): Totals {
  return { resources: 0, influence: 0, planets: 0, traits: 0, tech_skips: 0, wormholes: 0, legendary: 0 };
}

function tileMetrics(tile: Tile): Totals {
  const totals = emptyTotals();
  totals.resources = tile.planets.reduce((sum, planet) => sum + planet.resources, 0);
  totals.influence = tile.planets.reduce((sum, planet) => sum + planet.influence, 0);
  totals.planets = tile.planets.length;
  totals.wormholes = tile.wormholes.length;
  for (const planet of tile.planets) {
    if (planet.legendary) totals.legendary += 1;
    totals.traits += planet.traits.length;
    totals.tech_skips += planet.techs.length;
  }
  return totals;
}

export const ALL_TILES: Tile[] = (tileData as Tile[]).map((tile) => ({ ...tile }));

export function poolForMode(mode: Mode): Tile[] {
  const allowed = TILES_BY_MODE[mode];
  return ALL_TILES.filter((tile) => allowed.has(tile.expansion) && !tile.special);
}

function featureTotals(tiles: Iterable<Tile>): Totals {
  const totals = emptyTotals();
  for (const tile of tiles) {
    const metrics = tileMetrics(tile);
    for (const feature of FEATURE_ORDER) totals[feature] += metrics[feature];
  }
  return totals;
}

function buildTargets(overallTotals: Totals, capacities: number[]): Totals[] {
  const totalTiles = capacities.reduce((sum, value) => sum + value, 0);
  return capacities.map((capacity) => {
    const share = capacity / totalTiles;
    const totals = emptyTotals();
    for (const feature of FEATURE_ORDER) totals[feature] = overallTotals[feature] * share;
    return totals;
  });
}

function scoreTotals(playerTotals: Totals[], targets: Totals[]): number {
  let score = 0;
  for (let index = 0; index < playerTotals.length; index += 1) {
    for (const feature of FEATURE_ORDER) {
      const delta = playerTotals[index][feature] - targets[index][feature];
      score += FEATURE_WEIGHTS[feature] * delta * delta;
    }
  }
  for (const feature of PRIMARY_CONSTRAINT_FEATURES) {
    const values = playerTotals.map((totals) => totals[feature]);
    const spreadOver = Math.max(...values) - Math.min(...values) - MAX_PRIMARY_SPREAD;
    if (spreadOver > 0) score += 1_000_000 * spreadOver * spreadOver;
  }
  return score;
}

function weightedMagnitude(tile: Tile): number {
  const metrics = tileMetrics(tile);
  return FEATURE_ORDER.reduce((sum, feature) => sum + FEATURE_WEIGHTS[feature] * metrics[feature], 0);
}

function totalsWithDelta(totals: Totals, add?: Tile, remove?: Tile): Totals {
  const updated = { ...totals };
  if (remove) {
    const metrics = tileMetrics(remove);
    for (const feature of FEATURE_ORDER) updated[feature] -= metrics[feature];
  }
  if (add) {
    const metrics = tileMetrics(add);
    for (const feature of FEATURE_ORDER) updated[feature] += metrics[feature];
  }
  return updated;
}

function satisfiesPrimaryConstraint(playerTotals: Totals[]): boolean {
  return PRIMARY_CONSTRAINT_FEATURES.every((feature) => {
    const values = playerTotals.map((totals) => totals[feature]);
    return Math.max(...values) - Math.min(...values) <= MAX_PRIMARY_SPREAD;
  });
}

function refineDecks(decks: Tile[][], capacities: number[]): { decks: Tile[][]; deckTotals: Totals[] } {
  const deckTotals = decks.map((deck) => featureTotals(deck));
  const targets = buildTargets(featureTotals(decks.flat()), capacities);

  for (let pass = 0; pass < 200; pass += 1) {
    const currentScore = scoreTotals(deckTotals, targets);
    let improved = false;
    for (let firstPlayer = 0; firstPlayer < decks.length && !improved; firstPlayer += 1) {
      for (let secondPlayer = firstPlayer + 1; secondPlayer < decks.length && !improved; secondPlayer += 1) {
        for (let firstIndex = 0; firstIndex < decks[firstPlayer].length && !improved; firstIndex += 1) {
          for (let secondIndex = 0; secondIndex < decks[secondPlayer].length && !improved; secondIndex += 1) {
            const firstTile = decks[firstPlayer][firstIndex];
            const secondTile = decks[secondPlayer][secondIndex];
            const trialFirst = totalsWithDelta(deckTotals[firstPlayer], secondTile, firstTile);
            const trialSecond = totalsWithDelta(deckTotals[secondPlayer], firstTile, secondTile);
            const trialTotals = deckTotals.slice();
            trialTotals[firstPlayer] = trialFirst;
            trialTotals[secondPlayer] = trialSecond;
            if (scoreTotals(trialTotals, targets) + 1e-9 < currentScore) {
              decks[firstPlayer][firstIndex] = secondTile;
              decks[secondPlayer][secondIndex] = firstTile;
              deckTotals[firstPlayer] = trialFirst;
              deckTotals[secondPlayer] = trialSecond;
              improved = true;
            }
          }
        }
      }
    }
    if (!improved) break;
  }

  return { decks, deckTotals };
}

function summarizeAssignment(decks: Tile[][], capacities: number[]) {
  const overallTotals = featureTotals(decks.flat());
  const targets = buildTargets(overallTotals, capacities);
  const actualTotals = decks.map((deck) => featureTotals(deck));
  const maxSpread = emptyTotals();
  for (const feature of FEATURE_ORDER) {
    const values = actualTotals.map((totals) => totals[feature]);
    maxSpread[feature] = Math.max(...values) - Math.min(...values);
  }
  return {
    players: decks.map((deck, index) => ({
      player: `Player ${index + 1}`,
      tile_count: deck.length,
      target_tile_count: capacities[index],
      tile_ids: deck.map((tile) => tile.tile_id),
      tiles: deck.map((tile) => ({ id: tile.tile_id, name: tile.name })),
      totals: actualTotals[index]
    })),
    target_totals: targets,
    max_spread: maxSpread
  };
}

function setupRulesForMode(mode: Mode) {
  return mode === "base" ? BASE_SETUP_RULES : EXPANSION_SETUP_RULES;
}

export function getSetupOptions(mode: Mode, players: number): string[] {
  const options = setupRulesForMode(mode)[players as keyof ReturnType<typeof setupRulesForMode>];
  return options ? Object.keys(options) : [];
}

function validateModePlayers(mode: Mode, players: number): void {
  if (!(players in setupRulesForMode(mode))) {
    throw new Error(mode === "base" ? "Base game mode supports 3 through 6 players." : "This mode supports 3 through 8 players.");
  }
}

export function resolveSetupName(mode: Mode, players: number, setup?: string | null): string {
  const options = setupRulesForMode(mode)[players as keyof ReturnType<typeof setupRulesForMode>];
  if (!options) throw new Error(mode === "base" ? "Base game mode supports 3 through 6 players." : "This mode supports 3 through 8 players.");
  if (!setup) return Object.keys(options)[0];
  if (!(setup in options)) throw new Error(`Unsupported setup '${setup}' for ${players} players.`);
  return setup;
}

function dealColorGroup(tiles: Tile[], players: number, perPlayer: number, seed: number | null, restarts: number) {
  const rng = new SeededRng(seed);
  const totalNeeded = players * perPlayer;
  if (totalNeeded > tiles.length) throw new Error(`Need ${totalNeeded} tiles from a pool of ${tiles.length}.`);

  const selected = tiles.slice();
  rng.shuffle(selected);
  const chosen = selected.slice(0, totalNeeded);
  const chosenIds = new Set(chosen.map((tile) => tile.tile_id));
  const leftovers = tiles.filter((tile) => !chosenIds.has(tile.tile_id));
  const capacities = Array.from({ length: players }, () => perPlayer);
  const targets = buildTargets(featureTotals(chosen), capacities);

  let bestAssignment: Tile[][] | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let attempt = 0; attempt < restarts; attempt += 1) {
    const decks = Array.from({ length: players }, () => [] as Tile[]);
    const deckTotals = Array.from({ length: players }, () => emptyTotals());
    const counts = Array.from({ length: players }, () => 0);
    const orderedTiles = chosen
      .map((tile) => ({ priority: weightedMagnitude(tile) + rng.random() * 0.25, tileId: Number(tile.tile_id), tile }))
      .sort((left, right) => (left.priority === right.priority ? left.tileId - right.tileId : right.priority - left.priority));

    for (const { tile } of orderedTiles) {
      const metrics = tileMetrics(tile);
      let bestCandidate = Number.POSITIVE_INFINITY;
      let chosenPlayer = 0;
      for (let playerIndex = 0; playerIndex < players; playerIndex += 1) {
        if (counts[playerIndex] >= capacities[playerIndex]) continue;
        const nextCount = counts[playerIndex] + 1;
        const fillRatio = nextCount / capacities[playerIndex];
        let candidateScore = rng.random() * 0.01;
        for (const feature of FEATURE_ORDER) {
          const projected = deckTotals[playerIndex][feature] + metrics[feature];
          const delta = projected - targets[playerIndex][feature] * fillRatio;
          candidateScore += FEATURE_WEIGHTS[feature] * delta * delta;
        }
        if (candidateScore < bestCandidate) {
          bestCandidate = candidateScore;
          chosenPlayer = playerIndex;
        }
      }
      decks[chosenPlayer].push(tile);
      counts[chosenPlayer] += 1;
      for (const feature of FEATURE_ORDER) deckTotals[chosenPlayer][feature] += metrics[feature];
    }

    const refined = refineDecks(decks, capacities);
    const finalScore = scoreTotals(refined.deckTotals, targets);
    if (finalScore < bestScore) {
      bestScore = finalScore;
      bestAssignment = refined.decks.map((deck) => deck.slice());
    }
  }

  if (!bestAssignment) throw new Error("Failed to assign tiles.");
  return { decks: bestAssignment, leftovers };
}

export function buildGame(options: { mode: Mode; players: number; setup?: string | null; seed?: number | null; restarts?: number }): BuildGameResult {
  const mode = options.mode;
  const players = options.players;
  const seed = options.seed ?? null;
  const restarts = options.restarts ?? 500;
  validateModePlayers(mode, players);
  const setupName = resolveSetupName(mode, players, options.setup);
  const rulesByMode = setupRulesForMode(mode);
  const rules = rulesByMode[players as keyof typeof rulesByMode][setupName as keyof (typeof rulesByMode)[keyof typeof rulesByMode]];
  const pool = poolForMode(mode);
  const bluePool = pool.filter((tile) => tile.board_color === "blue");
  const redPool = pool.filter((tile) => tile.board_color === "red");
  const rng = new SeededRng(seed);
  const shuffledBlue = bluePool.slice();
  const shuffledRed = redPool.slice();
  rng.shuffle(shuffledBlue);
  rng.shuffle(shuffledRed);

  const sharedBlue = shuffledBlue.slice(0, rules.shared.blue);
  const sharedRed = shuffledRed.slice(0, rules.shared.red);
  const playerBluePool = shuffledBlue.slice(rules.shared.blue);
  const playerRedPool = shuffledRed.slice(rules.shared.red);
  const blueResult = dealColorGroup(playerBluePool, players, rules.per_player.blue, seed === null ? null : seed * 2 + 1, restarts);
  const redResult = dealColorGroup(playerRedPool, players, rules.per_player.red, seed === null ? null : seed * 2 + 2, restarts);

  const capacities = Array.from({ length: players }, () => rules.per_player.blue + rules.per_player.red);
  const mergedDecks = Array.from({ length: players }, (_, index) =>
    [...blueResult.decks[index], ...redResult.decks[index]].sort((left, right) => Number(left.tile_id) - Number(right.tile_id))
  );
  const refined = refineDecks(mergedDecks, capacities);
  if (!satisfiesPrimaryConstraint(refined.deckTotals)) {
    throw new Error("Unable to generate decks with resource and influence spread both at 1 or less.");
  }

  const baseSummary = summarizeAssignment(refined.decks, capacities);
  const targets = buildTargets(featureTotals(refined.decks.flat()), capacities);
  const sharedTiles = [...sharedBlue, ...sharedRed].sort((left, right) => Number(left.tile_id) - Number(right.tile_id));
  const unusedTiles = [...blueResult.leftovers, ...redResult.leftovers].sort((left, right) => Number(left.tile_id) - Number(right.tile_id));

  return {
    mode,
    players,
    setup: setupName,
    seed,
    decks: refined.decks,
    summary: {
      ...baseSummary,
      target_totals: targets,
      score: Number(scoreTotals(refined.deckTotals, targets).toFixed(4)),
      setup: setupName,
      per_player: { ...rules.per_player },
      shared_tiles: sharedTiles.map((tile) => ({ id: tile.tile_id, name: tile.name })),
      unused_tiles: unusedTiles.map((tile) => ({ id: tile.tile_id, name: tile.name }))
    }
  };
}
