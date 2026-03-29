import "./styles.css";
import { buildGame, getSetupOptions, resolveSetupName, type BuildGameResult, type Mode } from "./deckBuilder";
import layoutsJson from "./layouts.json";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) throw new Error("App root not found.");

const modes: Mode[] = ["base", "pok", "thunders_edge"];
const RANDOM_RETRY_LIMIT = 40;
const SQRT3 = Math.sqrt(3);

function describeSetupVariant(mode: Mode, players: number, setup: string): string {
  if (setup === "standard") {
    if (mode === "base" && players === 5) {
      return "Base-game 5-player setup uses one shared faceup red tile adjacent to Mecatol Rex.";
    }
    return "Standard uses the official default board setup for this player count.";
  }
  if (setup === "hyperlanes") {
    if (players === 4) return "The Thunder's Edge 4-player expansion setup uses two hyperlane fans.";
    if (players === 5) return "The official 5-player expansion setup uses a hyperlane fan below the board and no shared center tiles.";
    if (players === 7) return "The official 7-player expansion setup uses a hyperlane fan and no shared center tiles.";
    return "Hyperlane layouts use the official expansion board templates for larger player counts.";
  }
  return "This setup changes how many blue and red tiles each player drafts and whether shared center tiles are used.";
}

type BoardTileKind = "blue" | "blue1" | "blue2" | "blue3" | "blue4" | "green" | "red" | "hyperlane";

type BoardTile = {
  q: number;
  r: number;
  kind: BoardTileKind;
  label?: string;
  hyperlaneId?: string;
  rotation?: number;
  connections?: number[][];
};

type LayoutDefinition = {
  key: string;
  title: string;
  notes?: string;
  tiles?: BoardTile[];
  ref?: string;
};

type LayoutFile = {
  layouts: LayoutDefinition[];
};

const layoutFile = layoutsJson as LayoutFile;

function getLayoutDefinition(mode: Mode, players: number, setup: string): LayoutDefinition | null {
  const key = `${mode}:${players}:${setup}`;
  const index = new Map(layoutFile.layouts.map((layout) => [layout.key, layout]));
  const visited = new Set<string>();
  let layout = index.get(key) ?? null;
  while (layout?.ref) {
    if (visited.has(layout.key)) {
      throw new Error(`Circular layout reference detected for '${layout.key}'.`);
    }
    visited.add(layout.key);
    const target = index.get(layout.ref);
    if (!target) {
      throw new Error(`Layout '${layout.key}' references missing key '${layout.ref}'.`);
    }
    layout = {
      ...target,
      key: layout.key,
      title: layout.title ?? target.title,
      notes: layout.notes ?? target.notes
    };
  }
  return layout;
}

function rotationTransform(cx: number, cy: number, rotation: number | undefined): string {
  const normalized = ((rotation ?? 0) % 6 + 6) % 6;
  return normalized === 0 ? "" : ` transform="rotate(${normalized * 60} ${cx} ${cy})"`;
}

function renderHyperlaneGlyph(tile: BoardTile, cx: number, cy: number): string {
  const pairs = tile.connections ?? [
    [0, 3],
    [1, 4]
  ];
  const edgeRadius = 22;
  const edgePoint = (edge: number) => {
    const theta = (Math.PI / 180) * (60 * edge);
    return {
      x: cx + edgeRadius * Math.cos(theta),
      y: cy + edgeRadius * Math.sin(theta)
    };
  };

  const paths = pairs
    .map(([from, to]) => {
      const start = edgePoint(from);
      const end = edgePoint(to);
      return `<line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" stroke="#f5efe0" stroke-width="3" stroke-linecap="round" />`;
    })
    .join("");

  const label = tile.hyperlaneId ? `<text x="${cx}" y="${cy + 18}" text-anchor="middle" font-size="8" font-weight="700" fill="#f5efe0">${tile.hyperlaneId}</text>` : "";
  return `<g${rotationTransform(cx, cy, tile.rotation)}>${paths}${label}</g>`;
}

function renderBoardPreview(mode: Mode, players: number, setup: string): string {
  const layout = getLayoutDefinition(mode, players, setup);
  const captions = [`${mode} mode`, `${players} players`, `${setup} layout`];
  if (!layout) {
    return `
      <section class="preview-card">
        <div class="preview-copy">
          <p class="eyebrow">Board Layout Preview</p>
          <h3>No JSON layout configured yet</h3>
          <p>Add this configuration to <code>src/layouts.json</code> to draw the board for this selection.</p>
          <div class="preview-tags">${captions.map((caption) => `<span>${caption}</span>`).join("")}</div>
        </div>
      </section>
    `;
  }

  const size = 26;
  const margin = 34;
  const tiles = layout.tiles ?? [];
  const positioned = tiles.map((tile) => {
    const x = size * SQRT3 * (tile.q + tile.r / 2);
    const y = size * 1.5 * tile.r;
    return { ...tile, x, y };
  });
  const minX = Math.min(...positioned.map((tile) => tile.x));
  const maxX = Math.max(...positioned.map((tile) => tile.x));
  const minY = Math.min(...positioned.map((tile) => tile.y));
  const maxY = Math.max(...positioned.map((tile) => tile.y));
  const width = maxX - minX + margin * 2;
  const height = maxY - minY + margin * 2;

  const points = (cx: number, cy: number) =>
    Array.from({ length: 6 }, (_, index) => {
      const theta = (Math.PI / 180) * (60 * index - 30);
      return `${cx + size * Math.cos(theta)},${cy + size * Math.sin(theta)}`;
    }).join(" ");

  const fills: Record<BoardTileKind, string> = {
    red: "#ffcf70",
    blue: "#88b6ff",
    blue1: "#cfe1ff",
    blue2: "#88b6ff",
    blue3: "#4e86df",
    blue4: "#204b93",
    green: "#59c17d",
    hyperlane: "#2d3b59"
  };

  return `
    <section class="preview-card">
      <div class="preview-copy">
        <p class="eyebrow">Board Layout Preview</p>
        <h3>${layout.title}</h3>
        <p>${describeSetupVariant(mode, players, setup)}</p>
        ${layout.notes ? `<p>${layout.notes}</p>` : ""}
        <div class="preview-tags">${captions.map((caption) => `<span>${caption}</span>`).join("")}</div>
      </div>
      <svg class="board-preview" viewBox="0 0 ${width} ${height}" role="img" aria-label="Board layout preview for ${players} player ${setup} configuration">
        <rect x="0" y="0" width="${width}" height="${height}" rx="24" fill="rgba(255,255,255,0.03)" />
        ${positioned
          .map((tile) => {
            const cx = tile.x - minX + margin;
            const cy = tile.y - minY + margin;
            const textColor = tile.kind === "red" ? "#09111d" : "#f5efe0";
            const primaryLabel = tile.label ? `<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="10" font-weight="700" fill="${textColor}">${tile.label}</text>` : "";
            const secondaryLabel =
              tile.kind === "hyperlane" && tile.label
                ? `<text x="${cx}" y="${cy - 8}" text-anchor="middle" font-size="7" font-weight="700" fill="#f5efe0">${tile.label}</text>`
                : "";
            return `
              <g>
                <polygon points="${points(cx, cy)}" fill="${fills[tile.kind]}" stroke="rgba(255,255,255,0.2)" stroke-width="2" />
                ${tile.kind === "hyperlane" ? renderHyperlaneGlyph(tile, cx, cy) : ""}
                ${tile.kind === "hyperlane" ? secondaryLabel : primaryLabel}
              </g>
            `;
          })
          .join("")}
      </svg>
      <div class="preview-legend">
        <span><i class="legend-swatch red"></i>Red: Mecatol Rex / special center</span>
        <span><i class="legend-swatch blue1"></i><i class="legend-swatch blue2"></i><i class="legend-swatch blue3"></i><i class="legend-swatch blue4"></i>Blue ring shades: use <code>blue1</code> through <code>blue4</code> for outer-to-inner or any ring scheme you want.</span>
        <span><i class="legend-swatch blue"></i><code>blue</code> still works as the default mid-blue system slot.</span>
        <span><i class="legend-swatch green"></i>Green: home system slot</span>
        <span><i class="legend-swatch hyperlane"></i>Hyperlane: variant + optional rotation/connections</span>
        <span>Coordinates come from <code>src/layouts.json</code>.</span>
        <span>Axial neighbors: <code>(q,r-1)</code>, <code>(q+1,r-1)</code>, <code>(q+1,r)</code>, <code>(q,r+1)</code>, <code>(q-1,r+1)</code>, <code>(q-1,r)</code>.</span>
        <span>Hyperlane edge numbers run clockwise as <code>0,1,2,3,4,5</code>, starting at the upper-right edge.</span>
      </div>
    </section>
  `;
}

function renderResult(result: BuildGameResult): string {
  const players = result.summary.players
    .map((player) => {
      const tiles = player.tiles.map((tile) => `<li><strong>${tile.id}</strong> ${tile.name}</li>`).join("");
      return `
        <article class="player-card">
          <header>
            <h3>${player.player}</h3>
            <p>${player.tile_count} tiles</p>
          </header>
          <div class="metric-strip">
            <span>R ${player.totals.resources}</span>
            <span>I ${player.totals.influence}</span>
            <span>Traits ${player.totals.traits}</span>
            <span>Skips ${player.totals.tech_skips}</span>
            <span>Wormholes ${player.totals.wormholes}</span>
          </div>
          <ul class="tile-list">${tiles}</ul>
        </article>
      `;
    })
    .join("");

  const shared = result.summary.shared_tiles.length
    ? result.summary.shared_tiles.map((tile) => `<strong>${tile.id}</strong> ${tile.name}`).join(", ")
    : "None for this setup.";

  const unused = result.summary.unused_tiles.length
    ? result.summary.unused_tiles.map((tile) => `<strong>${tile.id}</strong> ${tile.name}`).join(", ")
    : "None.";

  return `
    <section class="results-shell">
      <div class="results-topline">
        <div>
          <p class="eyebrow">Balance report</p>
          <h2>${result.mode} - ${result.players} players - ${result.setup}</h2>
        </div>
        <div class="balance-badges">
          <span>Score ${result.summary.score}</span>
          <span>Spread R ${result.summary.max_spread.resources}</span>
          <span>Spread I ${result.summary.max_spread.influence}</span>
        </div>
      </div>
      <div class="info-grid">
        <div class="info-panel">
          <h3>How To Use It</h3>
          <p>Deal each player their listed tiles, place any shared setup tiles near Mecatol Rex, and leave the rest out of the game.</p>
        </div>
        <div class="info-panel">
          <h3>Setup Variant</h3>
          <p>${describeSetupVariant(result.mode, result.players, result.setup)}</p>
        </div>
        <div class="info-panel">
          <h3>What Gets Balanced</h3>
          <p>Resources and influence are locked to a max spread of 1. Traits, tech skips, wormholes, planets, and legendary planets act as secondary balance signals.</p>
        </div>
      </div>
      <section class="player-grid">${players}</section>
      <section class="detail-panels">
        <article class="detail-card"><h3>Shared Setup Tiles</h3><p>${shared}</p></article>
        <article class="detail-card"><h3>Unused Tiles</h3><p>${unused}</p></article>
      </section>
    </section>
  `;
}

app.innerHTML = `
  <main class="page-shell">
    <section class="hero">
      <div class="hero-copy">
        <p class="eyebrow">Twilight Imperium 4</p>
        <h1>Build a galaxy draft that feels fair before the first ship moves.</h1>
        <p class="lede">Generate balanced system-tile draft stacks for your table, using the official setup rules for the base game, Prophecy of Kings, and Thunder's Edge, with clear callouts for shared center tiles and leftovers.</p>
        <ol class="instruction-list">
          <li>Pick your ruleset, player count, and the official setup map variant available for that configuration.</li>
          <li>Leave the seed blank for a fresh random result, or enter a seed when you want a deal you can reproduce exactly.</li>
          <li>Deal the listed stacks, place any shared tiles, and ignore the leftovers.</li>
        </ol>
        <p class="lede">Setup variants change the shape of the final map. Expansion games at 5, 7, and 8 players use official hyperlane layouts, while the other supported counts use the official standard layouts for that ruleset.</p>
      </div>
      <div class="hero-art" aria-hidden="true">
        <svg viewBox="0 0 520 420">
          <defs>
            <linearGradient id="nebula" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#ffcf70" />
              <stop offset="55%" stop-color="#f06767" />
              <stop offset="100%" stop-color="#243b6b" />
            </linearGradient>
          </defs>
          <rect width="520" height="420" rx="36" fill="#10192a" />
          <circle cx="384" cy="108" r="88" fill="url(#nebula)" opacity="0.82" />
          <circle cx="154" cy="136" r="56" fill="#6ea0ff" opacity="0.34" />
          <g fill="none" stroke="#f5efe0" stroke-width="6" opacity="0.9">
            <path d="M112 258 162 228 212 258 212 316 162 346 112 316Z" />
            <path d="M205 196 255 166 305 196 305 254 255 284 205 254Z" />
            <path d="M298 258 348 228 398 258 398 316 348 346 298 316Z" />
          </g>
          <g fill="#f5efe0">
            <circle cx="94" cy="92" r="4" />
            <circle cx="432" cy="60" r="3" />
            <circle cx="446" cy="246" r="5" />
            <circle cx="128" cy="364" r="3" />
          </g>
        </svg>
      </div>
    </section>
    <section class="control-panel">
      <form id="deck-form" class="deck-form">
        <label><span>Mode</span><select id="mode">${modes.map((mode) => `<option value="${mode}">${mode}</option>`).join("")}</select></label>
        <label><span>Players</span><input id="players" type="number" min="3" max="8" value="6" /></label>
        <label><span>Setup</span><select id="setup"></select></label>
        <label><span>Seed</span><input id="seed" type="number" placeholder="Random" /></label>
        <label><span>Restarts</span><input id="restarts" type="number" min="10" max="5000" value="500" /></label>
        <button type="submit">Generate balanced decks</button>
      </form>
      <div id="layout-preview"></div>
    </section>
    <section id="results"></section>
  </main>
`;

const playersInput = document.querySelector<HTMLInputElement>("#players");
const setupSelect = document.querySelector<HTMLSelectElement>("#setup");
const modeSelect = document.querySelector<HTMLSelectElement>("#mode");
const seedInput = document.querySelector<HTMLInputElement>("#seed");
const restartInput = document.querySelector<HTMLInputElement>("#restarts");
const form = document.querySelector<HTMLFormElement>("#deck-form");
const results = document.querySelector<HTMLElement>("#results");
const layoutPreview = document.querySelector<HTMLElement>("#layout-preview");

if (!playersInput || !setupSelect || !modeSelect || !seedInput || !restartInput || !form || !results || !layoutPreview) {
  throw new Error("UI failed to initialize.");
}

function refreshSetups(): void {
  const players = Number.parseInt(playersInput.value, 10);
  const mode = modeSelect.value as Mode;
  const options = getSetupOptions(mode, players);
  const fallback = resolveSetupName(mode, players, null);
  setupSelect.innerHTML = options.map((option) => `<option value="${option}">${option}</option>`).join("");
  setupSelect.value = options.includes(fallback) ? fallback : options[0];
  layoutPreview.innerHTML = renderBoardPreview(mode, players, setupSelect.value);
}

function generate(): void {
  try {
    const baseOptions = {
      mode: modeSelect.value as Mode,
      players: Number.parseInt(playersInput.value, 10),
      setup: setupSelect.value,
      restarts: Number.parseInt(restartInput.value, 10)
    };
    const explicitSeed = seedInput.value === "" ? null : Number.parseInt(seedInput.value, 10);
    let result: BuildGameResult | null = null;
    let lastError: unknown = null;

    if (explicitSeed !== null) {
      result = buildGame({ ...baseOptions, seed: explicitSeed });
    } else {
      for (let attempt = 0; attempt < RANDOM_RETRY_LIMIT; attempt += 1) {
        try {
          result = buildGame({ ...baseOptions, seed: null });
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (!result && lastError) {
        throw lastError;
      }
    }

    if (!result) {
      throw new Error("Unable to generate a balanced deck after multiple random attempts.");
    }

    layoutPreview.innerHTML = renderBoardPreview(modeSelect.value as Mode, baseOptions.players, baseOptions.setup);
    results.innerHTML = renderResult(result);
  } catch (error) {
    layoutPreview.innerHTML = renderBoardPreview(
      modeSelect.value as Mode,
      Number.parseInt(playersInput.value, 10),
      setupSelect.value
    );
    results.innerHTML = `<p class="error-card">${error instanceof Error ? error.message : String(error)}</p>`;
  }
}

playersInput.addEventListener("change", () => {
  refreshSetups();
  generate();
});
modeSelect.addEventListener("change", () => {
  refreshSetups();
  generate();
});
setupSelect.addEventListener("change", generate);
form.addEventListener("submit", (event) => {
  event.preventDefault();
  generate();
});

refreshSetups();
generate();
