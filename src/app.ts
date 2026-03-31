import "./styles.css";
import {
  buildGame,
  getSetupOptions,
  resolveSetupName,
  type BuildGameResult,
  type Mode,
} from "./deckBuilder";
import layoutsJson from "./layouts.json";

const modes: Mode[] = ["base", "pok", "thunders_edge"];
const RANDOM_RETRY_LIMIT = 40;
const SQRT3 = Math.sqrt(3);

export function describeSetupVariant(
  mode: Mode,
  players: number,
  setup: string,
): string {
  if (setup === "standard") {
    if (mode === "base" && players === 5) {
      return "Base-game 5-player setup uses one shared faceup red tile adjacent to Mecatol Rex.";
    }
    return "Standard uses the official default board setup for this player count.";
  }
  if (setup === "hyperlanes") {
    if (players === 4)
      return "The Thunder's Edge 4-player expansion setup uses two hyperlane fans.";
    if (players === 5)
      return "The official 5-player expansion setup uses a hyperlane fan below the board and no shared center tiles.";
    if (players === 7)
      return "The official 7-player expansion setup uses a hyperlane fan and no shared center tiles.";
    return "Hyperlane layouts use the official expansion board templates for larger player counts.";
  }
  return "This setup changes how many blue and red tiles each player drafts and whether shared center tiles are used.";
}

export type BoardTileKind =
  | "blue"
  | "blue1"
  | "blue2"
  | "blue3"
  | "blue4"
  | "green"
  | "red"
  | "hyperlane";

export type BoardTile = {
  q: number;
  r: number;
  kind: BoardTileKind;
  label?: string;
  hyperlaneId?: string;
  rotation?: number;
  connections?: number[][];
};

export type LayoutDefinition = {
  key: string;
  title: string;
  notes?: string;
  tiles?: BoardTile[];
  ref?: string;
};

export type LayoutFile = {
  layouts: LayoutDefinition[];
};

const layoutFile = layoutsJson as LayoutFile;

export function getLayoutDefinition(
  mode: Mode,
  players: number,
  setup: string,
  layouts: LayoutFile = layoutFile,
): LayoutDefinition | null {
  const key = `${mode}:${players}:${setup}`;
  const index = new Map(layouts.layouts.map((layout) => [layout.key, layout]));
  const visited = new Set<string>();
  let layout = index.get(key) ?? null;
  while (layout?.ref) {
    if (visited.has(layout.key)) {
      throw new Error(
        `Circular layout reference detected for '${layout.key}'.`,
      );
    }
    visited.add(layout.key);
    const target = index.get(layout.ref);
    if (!target) {
      throw new Error(
        `Layout '${layout.key}' references missing key '${layout.ref}'.`,
      );
    }
    layout = {
      ...target,
      key: layout.key,
      title: layout.title ?? target.title,
      notes: layout.notes ?? target.notes,
    };
  }
  return layout;
}

export function rotationTransform(
  cx: number,
  cy: number,
  rotation: number | undefined,
): string {
  const normalized = (((rotation ?? 0) % 6) + 6) % 6;
  return normalized === 0
    ? ""
    : ` transform="rotate(${normalized * 60} ${cx} ${cy})"`;
}

export function renderHyperlaneGlyph(
  tile: BoardTile,
  cx: number,
  cy: number,
  labelTransform = "",
): string {
  const pairs = tile.connections ?? [
    [0, 3],
    [1, 4],
  ];
  const edgeRadius = 22;
  const edgePoint = (edge: number) => {
    const theta = (Math.PI / 180) * (60 * edge);
    return {
      x: cx + edgeRadius * Math.cos(theta),
      y: cy + edgeRadius * Math.sin(theta),
    };
  };

  const paths = pairs
    .map(([from, to]) => {
      const start = edgePoint(from);
      const end = edgePoint(to);
      return `<line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" stroke="#f5efe0" stroke-width="3" stroke-linecap="round" />`;
    })
    .join("");

  const label = tile.hyperlaneId
    ? `<text x="${cx}" y="${cy + 18}" text-anchor="middle" font-size="8" font-weight="700" fill="#ffcf70" stroke="#09111d" stroke-width="0.8" paint-order="stroke fill"${labelTransform}>${tile.hyperlaneId}</text>`
    : "";
  return `<g${rotationTransform(cx, cy, tile.rotation)}>${paths}${label}</g>`;
}

export function renderBoardPreview(
  mode: Mode,
  players: number,
  setup: string,
  layouts: LayoutFile = layoutFile,
  boardRotation = 0,
): string {
  const layout = getLayoutDefinition(mode, players, setup, layouts);
  const captions = [`${mode} mode`, `${players} players`, `${setup} layout`];
  const boardRotationDegrees = boardRotation * 30;
  const rotationOptions = Array.from({ length: 12 }, (_, step) => {
    const degrees = step * 30;
    return `<option value="${step}"${step === boardRotation ? " selected" : ""}>${degrees}&deg;</option>`;
  }).join("");
  if (!layout) {
    return `
      <section class="preview-card">
        <div class="preview-copy">
          <p class="eyebrow">Board Layout Preview</p>
          <h3>No JSON layout configured yet</h3>
          <p>Add this configuration to <code>src/layouts.json</code> to draw the board for this selection.</p>
          <label class="preview-control">
            <span>Board Rotation</span>
            <select id="board-rotation">${rotationOptions}</select>
          </label>
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
  const minX = positioned.length
    ? Math.min(...positioned.map((tile) => tile.x))
    : 0;
  const maxX = positioned.length
    ? Math.max(...positioned.map((tile) => tile.x))
    : 0;
  const minY = positioned.length
    ? Math.min(...positioned.map((tile) => tile.y))
    : 0;
  const maxY = positioned.length
    ? Math.max(...positioned.map((tile) => tile.y))
    : 0;
  const boardCenterX = (minX + maxX) / 2;
  const boardCenterY = (minY + maxY) / 2;
  const halfSpanX = (maxX - minX) / 2 + size + margin;
  const halfSpanY = (maxY - minY) / 2 + size + margin;
  const halfSpan = Math.max(halfSpanX, halfSpanY, size + margin);
  const width = halfSpan * 2;
  const height = halfSpan * 2;

  const points = (cx: number, cy: number) =>
    Array.from({ length: 6 }, (_, index) => {
      const theta = (Math.PI / 180) * (60 * index - 30);
      return `${cx + size * Math.cos(theta)},${cy + size * Math.sin(theta)}`;
    }).join(" ");

  const fills: Record<BoardTileKind, string> = {
    red: "#ff8d86",
    blue: "#88b6ff",
    blue1: "#cfe1ff",
    blue2: "#88b6ff",
    blue3: "#4e86df",
    blue4: "#204b93",
    green: "#59c17d",
    hyperlane: "#2d3b59",
  };
  const textTransform = (cx: number, cy: number) =>
    boardRotationDegrees === 0
      ? ""
      : ` transform="rotate(${-boardRotationDegrees} ${cx} ${cy})"`;

  return `
    <section class="preview-card">
      <div class="preview-copy">
        <p class="eyebrow">Board Layout Preview</p>
        <h3>${layout.title}</h3>
        <p>${describeSetupVariant(mode, players, setup)}</p>
        <label class="preview-control">
          <span>Board Rotation</span>
          <select id="board-rotation">${rotationOptions}</select>
        </label>
        <div class="preview-tags">${captions.map((caption) => `<span>${caption}</span>`).join("")}</div>
        <div class="preview-legend">
          <span><i class="legend-swatch green"></i>Green: home system</span>
          <span><i class="legend-swatch red"></i>Red: Mecatol Rex</span>
          <span><i class="legend-swatch blue"></i>Blue: normal system</span>
          <span><i class="legend-swatch hyperlane"></i>Black: hyperlane tile</span>
        </div>
      </div>
      <svg class="board-preview" viewBox="0 0 ${width} ${height}" role="img" aria-label="Board layout preview for ${players} player ${setup} configuration">
        <rect x="0" y="0" width="${width}" height="${height}" rx="24" fill="rgba(255,255,255,0.03)" />
        <g transform="rotate(${boardRotationDegrees} ${width / 2} ${height / 2})">
          ${positioned
            .map((tile) => {
              const cx = tile.x - boardCenterX + width / 2;
              const cy = tile.y - boardCenterY + height / 2;
              const textColor = tile.kind === "red" ? "#09111d" : "#f5efe0";
              const primaryLabel = tile.label
                ? `<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="10" font-weight="700" fill="${textColor}"${textTransform(cx, cy)}>${tile.label}</text>`
                : "";
              const secondaryLabel =
                tile.kind === "hyperlane" && tile.label
                  ? `<text x="${cx}" y="${cy - 8}" text-anchor="middle" font-size="7" font-weight="700" fill="#f5efe0"${textTransform(cx, cy)}>${tile.label}</text>`
                  : "";
              const hyperlaneGlyph =
                tile.kind === "hyperlane"
                  ? renderHyperlaneGlyph(tile, cx, cy, textTransform(cx, cy))
                  : "";
              return `
                <g>
                  <polygon points="${points(cx, cy)}" fill="${fills[tile.kind]}" stroke="rgba(255,255,255,0.2)" stroke-width="2" />
                  ${hyperlaneGlyph}
                  ${tile.kind === "hyperlane" ? secondaryLabel : primaryLabel}
                </g>
              `;
            })
            .join("")}
        </g>
      </svg>
    </section>
  `;
}

export function renderResult(result: BuildGameResult): string {
  const players = result.summary.players
    .map((player) => {
      const tiles = player.tiles
        .map((tile) => `<li><strong>${tile.id}</strong> ${tile.name}</li>`)
        .join("");
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

  const allocationRows = [
    ...result.summary.players.flatMap((player) =>
      player.tiles.map((tile) => ({
        id: tile.id,
        name: tile.name,
        owner: player.player,
        ownerClass: `owner-${player.player.toLowerCase().replace(/\s+/g, "-")}`,
      })),
    ),
    ...result.summary.shared_tiles.map((tile) => ({
      id: tile.id,
      name: tile.name,
      owner: "Shared",
      ownerClass: "owner-shared",
    })),
  ]
    .sort((left, right) => Number(left.id) - Number(right.id))
    .map(
      (entry) => `
        <tr class="${entry.ownerClass}">
          <td>${entry.id}</td>
          <td>${entry.owner}</td>
          <td>${entry.name}</td>
        </tr>
      `,
    )
    .join("");

  const shared = result.summary.shared_tiles.length
    ? result.summary.shared_tiles
        .map((tile) => `<strong>${tile.id}</strong> ${tile.name}`)
        .join(", ")
    : "None for this setup.";

  const unused = result.summary.unused_tiles.length
    ? result.summary.unused_tiles
        .map((tile) => `<strong>${tile.id}</strong> ${tile.name}`)
        .join(", ")
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
      <div class="results-tabs" role="tablist" aria-label="Result views">
        <button type="button" class="results-tab is-active" data-tab-target="cards" aria-selected="true">Player view</button>
        <button type="button" class="results-tab" data-tab-target="allocation" aria-selected="false">Numerical view</button>
      </div>
      <section class="results-pane is-active" data-tab-panel="cards">
        <section class="player-grid">${players}</section>
        <section class="detail-panels">
          <article class="detail-card"><h3>Shared Setup Tiles</h3><p>${shared}</p></article>
          <article class="detail-card"><h3>Unused Tiles</h3><p>${unused}</p></article>
        </section>
      </section>
      <section class="results-pane" data-tab-panel="allocation" hidden>
        <article class="detail-card">
          <h3>Tile Allocation By Number</h3>
          <div class="allocation-table-wrap">
            <table class="allocation-table">
              <thead>
                <tr>
                  <th>Tile</th>
                  <th>Allocated To</th>
                  <th>Name</th>
                </tr>
              </thead>
              <tbody>${allocationRows}</tbody>
            </table>
          </div>
        </article>
      </section>
    </section>
  `;
}

export function bindResultTabs(resultsView: HTMLElement): void {
  const tabButtons =
    resultsView.querySelectorAll<HTMLButtonElement>(".results-tab");
  const panes = resultsView.querySelectorAll<HTMLElement>(".results-pane");
  if (!tabButtons.length || !panes.length) return;

  for (const button of tabButtons) {
    button.addEventListener("click", () => {
      const target = button.dataset.tabTarget;
      for (const tabButton of tabButtons) {
        const active = tabButton === button;
        tabButton.classList.toggle("is-active", active);
        tabButton.setAttribute("aria-selected", active ? "true" : "false");
      }
      for (const pane of panes) {
        const active = pane.dataset.tabPanel === target;
        pane.classList.toggle("is-active", active);
        pane.hidden = !active;
      }
    });
  }
}

export type AppDependencies = {
  buildGame: typeof buildGame;
  getSetupOptions: typeof getSetupOptions;
  resolveSetupName: typeof resolveSetupName;
};

export type InitializedApp = {
  refreshSetups: () => void;
  generate: () => void;
  renderPreview: () => void;
  resultsView: HTMLElement;
  layoutPreviewView: HTMLElement;
};

const defaultAppDependencies: AppDependencies = {
  buildGame,
  getSetupOptions,
  resolveSetupName,
};

export function initializeApp(
  appRoot: HTMLDivElement | null = document.querySelector<HTMLDivElement>(
    "#app",
  ),
  dependencies: AppDependencies = defaultAppDependencies,
): InitializedApp {
  if (!appRoot) throw new Error("App root not found.");

  appRoot.innerHTML = `
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
          <p class="lede">Setup variants change the shape of the final map. Expansion games at 4, 5, and 7 players can use hyperlane layouts, while 8-player expansion uses the standard shared-center setup.</p>
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

  const playersInput = appRoot.querySelector<HTMLInputElement>("#players");
  const setupSelect = appRoot.querySelector<HTMLSelectElement>("#setup");
  const modeSelect = appRoot.querySelector<HTMLSelectElement>("#mode");
  const seedInput = appRoot.querySelector<HTMLInputElement>("#seed");
  const restartInput = appRoot.querySelector<HTMLInputElement>("#restarts");
  const form = appRoot.querySelector<HTMLFormElement>("#deck-form");
  const results = appRoot.querySelector<HTMLElement>("#results");
  const layoutPreview = appRoot.querySelector<HTMLElement>("#layout-preview");

  if (
    !playersInput ||
    !setupSelect ||
    !modeSelect ||
    !seedInput ||
    !restartInput ||
    !form ||
    !results ||
    !layoutPreview
  ) {
    throw new Error("UI failed to initialize.");
  }

  const playersField = playersInput;
  const setupField = setupSelect;
  const modeField = modeSelect;
  const seedField = seedInput;
  const restartField = restartInput;
  const deckForm = form;
  const resultsView = results;
  const layoutPreviewView = layoutPreview;
  let boardRotation = 0;

  function bindPreviewRotationControl(): void {
    const rotationField =
      layoutPreviewView.querySelector<HTMLSelectElement>("#board-rotation");
    if (!rotationField) return;
    rotationField.addEventListener("change", () => {
      boardRotation = Number.parseInt(rotationField.value, 10) || 0;
      renderPreview();
    });
  }

  function renderPreview(): void {
    layoutPreviewView.innerHTML = renderBoardPreview(
      modeField.value as Mode,
      Number.parseInt(playersField.value, 10),
      setupField.value,
      layoutFile,
      boardRotation,
    );
    bindPreviewRotationControl();
  }

  function refreshSetups(): void {
    const players = Number.parseInt(playersField.value, 10);
    const mode = modeField.value as Mode;
    const options = dependencies.getSetupOptions(mode, players);
    const fallback = dependencies.resolveSetupName(mode, players, null);
    setupField.innerHTML = options
      .map((option) => `<option value="${option}">${option}</option>`)
      .join("");
    setupField.value = options.includes(fallback) ? fallback : options[0];
    renderPreview();
  }

  function generate(): void {
    try {
      const baseOptions = {
        mode: modeField.value as Mode,
        players: Number.parseInt(playersField.value, 10),
        setup: setupField.value,
        restarts: Number.parseInt(restartField.value, 10),
      };
      const explicitSeed =
        seedField.value === "" ? null : Number.parseInt(seedField.value, 10);
      let result: BuildGameResult | null = null;
      let lastError: unknown = null;

      if (explicitSeed !== null) {
        result = dependencies.buildGame({ ...baseOptions, seed: explicitSeed });
      } else {
        for (let attempt = 0; attempt < RANDOM_RETRY_LIMIT; attempt += 1) {
          try {
            result = dependencies.buildGame({ ...baseOptions, seed: null });
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
        throw new Error(
          "Unable to generate a balanced deck after multiple random attempts.",
        );
      }

      renderPreview();
      resultsView.innerHTML = renderResult(result);
      bindResultTabs(resultsView);
    } catch (error) {
      renderPreview();
      resultsView.innerHTML = `<p class="error-card">${error instanceof Error ? error.message : String(error)}</p>`;
    }
  }

  playersField.addEventListener("change", () => {
    refreshSetups();
    generate();
  });
  modeField.addEventListener("change", () => {
    refreshSetups();
    generate();
  });
  setupField.addEventListener("change", generate);
  deckForm.addEventListener("submit", (event) => {
    event.preventDefault();
    generate();
  });

  refreshSetups();
  generate();

  return {
    refreshSetups,
    generate,
    renderPreview,
    resultsView,
    layoutPreviewView,
  };
}

if (typeof document !== "undefined" && document.querySelector("#app")) {
  initializeApp();
}
