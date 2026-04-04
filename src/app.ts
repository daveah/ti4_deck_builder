import "./styles.css";
import {
  buildGame,
  getSetupOptions,
  resolveSetupName,
  type BuildGameResult,
  type Mode,
} from "./deckBuilder";
import factionsJson from "../data/factions.json";
import factionShortNamesJson from "../data/faction_short_names.json";
import strategyCardsJson from "../data/strategy_cards.json";
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
const factionsByMode = factionsJson as Record<Mode, string[]>;
const factionShortNames = factionShortNamesJson as Record<string, string>;
const strategyCards = strategyCardsJson as Array<{
  initiative: number;
  name: string;
}>;

type TrackerAssignment = {
  slot: number;
  passed: boolean;
};

type TrackerState = {
  expansion: Mode;
  playerCount: number;
  selectedFactions: string[];
  assignments: Record<string, TrackerAssignment>;
  draggingFaction: string | null;
  speakerSeat: number;
};

type TrackerSharedState = {
  expansion: Mode;
  playerCount: number;
  selectedFactions: string[];
  assignments: Record<string, TrackerAssignment>;
  speakerSeat: number;
};

type CollaborationStatus = "local" | "connecting" | "connected" | "error";

type TrackerClientMessage =
  | {
      type: "hello";
      state: TrackerSharedState | null;
    }
  | {
      type: "replace_state";
      state: TrackerSharedState;
    };

type TrackerServerMessage =
  | {
      type: "snapshot";
      state: TrackerSharedState;
    }
  | {
      type: "presence";
      connections: number;
    }
  | {
      type: "error";
      message: string;
    };

type TrackerExportPayload = {
  version: 1;
  tracker: TrackerSharedState;
};

export type TrackerSocketLike = {
  addEventListener: (
    type: string,
    listener: (event: Event | MessageEvent<string>) => void,
  ) => void;
  close: () => void;
  send: (message: string) => void;
};

export type TrackerSocketFactory = (
  roomId: string,
) => Promise<TrackerSocketLike>;

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

export function renderTurnTracker(playerCount = 6): string {
  const expansionOptions = modes
    .map(
      (mode) =>
        `<option value="${mode}">${mode === "pok" ? "Prophecy of Kings" : mode === "thunders_edge" ? "Thunder's Edge" : "Base Game"}</option>`,
    )
    .join("");
  const rows = Array.from({ length: playerCount }, (_, index) => {
    const playerNumber = index + 1;
    return `
      <div class="tracker-row" data-player-index="${index}">
        <div class="tracker-row-main">
          <span class="tracker-seat">P${playerNumber}</span>
          <select class="tracker-faction-select" data-faction-index="${index}" aria-label="Player ${playerNumber} faction">
            <option value="">Select race</option>
          </select>
        </div>
      </div>
    `;
  }).join("");

  const strategySlots = Array.from({ length: 9 }, (_, index) => {
    const value = index;
    const card = strategyCards.find((entry) => entry.initiative === value);
    const label = value === 0 ? "Naalu Token" : card!.name;
    return `
      <article class="strategy-slot" data-strategy-slot="${value}">
        <div class="strategy-number">${value}</div>
        <div class="strategy-copy">
          <h3>${label}</h3>
        </div>
      </article>
    `;
  }).join("");

  return `
    <section class="tracker-shell">
      <details class="tracker-accordion" open>
        <summary class="tracker-accordion-summary">Tracker Introduction</summary>
        <div class="tracker-accordion-content tracker-topline">
          <div>
            <p class="eyebrow">Turn Order Tracker</p>
            <h2>Set the factions at the table, then track strategy cards in initiative order.</h2>
            <p class="lede">Choose the expansion, assign each player a unique faction, then switch to the strategy board to manage initiative, passing, and round resets.</p>
          </div>
        </div>
      </details>
      <details class="tracker-accordion" open>
        <summary class="tracker-accordion-summary">Shared Room</summary>
        <div class="tracker-accordion-content">
          <section class="tracker-collab-shell">
            <div class="tracker-collab-copy">
              <h3>Shared Room</h3>
              <p>Create a room code for the table, then have everyone else join with the same code to keep the tracker in sync live.</p>
            </div>
            <div class="tracker-collab-controls">
              <label class="tracker-collab-field">
                <span>Room Code</span>
                <input id="tracker-room-code" type="text" placeholder="Create or paste a code" />
              </label>
              <div class="tracker-collab-buttons">
                <button type="button" id="tracker-create-room">Create Shared Room</button>
                <button type="button" id="tracker-join-room">Join Room</button>
                <button type="button" id="tracker-copy-room" class="tracker-secondary-button">Copy Link</button>
                <button type="button" id="tracker-leave-room" class="tracker-secondary-button">Leave Room</button>
              </div>
            </div>
            <div id="tracker-collab-status" class="tracker-collab-status">
              <span class="tracker-status-pill">Local only</span>
              <span id="tracker-presence-count">Not shared</span>
            </div>
          </section>
        </div>
      </details>
      <div class="tracker-layout-toggle">
        <label class="tracker-layout-checkbox" for="tracker-compact-layout">
          <input id="tracker-compact-layout" type="checkbox" />
          <span>Use compact layout</span>
        </label>
      </div>
      <div class="tracker-tabs" role="tablist" aria-label="Tracker views">
        <button type="button" class="tracker-tab is-active" data-tracker-tab-target="factions" aria-selected="true">Faction Setup</button>
        <button type="button" class="tracker-tab" data-tracker-tab-target="strategy" aria-selected="false">Strategy Board</button>
        <button type="button" class="tracker-tab" data-tracker-tab-target="transfer" aria-selected="false">Import / Export</button>
      </div>
      <section class="tracker-pane is-active" data-tracker-tab-panel="factions">
        <div class="tracker-controls">
          <label>
            <span>Expansion</span>
            <select id="tracker-expansion">${expansionOptions}</select>
          </label>
          <label>
            <span>Players</span>
            <select id="tracker-player-count">
              ${Array.from({ length: 6 }, (_, index) => index + 3)
                .map(
                  (count) =>
                    `<option value="${count}"${count === playerCount ? " selected" : ""}>${count}</option>`,
                )
                .join("")}
            </select>
          </label>
        </div>
        <div id="tracker-list" class="tracker-list">${rows}</div>
      </section>
      <section class="tracker-pane" data-tracker-tab-panel="strategy" hidden>
        <section class="strategy-board-shell">
          <div class="strategy-board-header">
            <p class="eyebrow">Strategy Board</p>
            <h3>Initiative Order</h3>
          </div>
          <p class="strategy-board-intro">Drag selected factions onto the initiative board. Active factions stay in the left lane; click <strong>Pass</strong> to move them to the right lane.</p>
          <div class="strategy-toolbar">
            <label class="strategy-toolbar-field">
              <span>Speaker</span>
              <select id="tracker-speaker"></select>
            </label>
          </div>
          <section class="tracker-pool-shell">
            <div class="tracker-pool-head">
              <h4>Unassigned Factions</h4>
              <p>Unassigned factions are shown in player order, starting with the speaker. Speaker is highlighted.</p>
            </div>
            <div id="tracker-pool" class="tracker-pool"></div>
          </section>
          <div class="strategy-board-columns" aria-hidden="true">
            <span class="strategy-board-column-label strategy-board-column-label-card">Card</span>
            <span class="strategy-board-column-label">Active</span>
            <span class="strategy-board-column-label">Passed</span>
          </div>
          <div id="strategy-board" class="strategy-board">${strategySlots}</div>
          <div id="tracker-round-actions" class="tracker-round-actions"></div>
        </section>
      </section>
      <section class="tracker-pane" data-tracker-tab-panel="transfer" hidden>
        <section class="tracker-transfer-shell">
          <div class="tracker-transfer-copy">
            <p class="eyebrow">Import / Export</p>
            <h3>Save or restore the full tracker</h3>
            <p>Export the current faction setup and strategy board into JSON, or import a saved snapshot and start a fresh shared room from it.</p>
          </div>
          <div class="tracker-transfer-actions">
            <button type="button" id="tracker-export-state">Export Current State</button>
            <button type="button" id="tracker-import-state" class="tracker-secondary-button">Import And Start New Room</button>
          </div>
          <label class="tracker-transfer-field">
            <span>Tracker JSON</span>
            <textarea id="tracker-transfer-json" rows="16" spellcheck="false" placeholder="Exported tracker JSON will appear here. You can also paste a saved tracker JSON snapshot and import it."></textarea>
          </label>
          <p id="tracker-transfer-status" class="tracker-transfer-status">Export creates a portable snapshot. Import applies that snapshot locally and creates a fresh shared room.</p>
        </section>
      </section>
    </section>
  `;
}

export function bindAppTabs(appRoot: HTMLElement): void {
  const tabButtons = appRoot.querySelectorAll<HTMLButtonElement>(".app-tab");
  const panes = appRoot.querySelectorAll<HTMLElement>(".app-pane");
  if (!tabButtons.length || !panes.length) return;

  for (const button of tabButtons) {
    button.addEventListener("click", () => {
      const target = button.dataset.appTabTarget;
      for (const tabButton of tabButtons) {
        const active = tabButton === button;
        tabButton.classList.toggle("is-active", active);
        tabButton.setAttribute("aria-selected", active ? "true" : "false");
      }
      for (const pane of panes) {
        const active = pane.dataset.appTabPanel === target;
        pane.hidden = !active;
        pane.classList.toggle("is-active", active);
      }
    });
  }
}

export function generateTrackerRoomCode(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().slice(0, 8);
  }
  return Math.random().toString(36).slice(2, 10);
}

export function resolvePartyKitHost(): string {
  return import.meta.env.VITE_PARTYKIT_HOST || "localhost:1999";
}

export function getTrackerSharedState(state: TrackerState): TrackerSharedState {
  return {
    expansion: state.expansion,
    playerCount: state.playerCount,
    selectedFactions: [...state.selectedFactions],
    assignments: Object.fromEntries(
      Object.entries(state.assignments).map(([faction, assignment]) => [
        faction,
        { ...assignment },
      ]),
    ),
    speakerSeat: state.speakerSeat,
  };
}

export function applyTrackerSharedState(
  state: TrackerState,
  snapshot: TrackerSharedState,
): void {
  state.expansion = snapshot.expansion;
  state.playerCount = snapshot.playerCount;
  state.selectedFactions = Array.from(
    { length: snapshot.playerCount },
    (_, index) => snapshot.selectedFactions[index] ?? "",
  );
  state.assignments = Object.fromEntries(
    Object.entries(snapshot.assignments).map(([faction, assignment]) => [
      faction,
      { ...assignment },
    ]),
  );
  state.speakerSeat = snapshot.speakerSeat;
}

export function buildTrackerExportPayload(
  state: TrackerState,
): TrackerExportPayload {
  return {
    version: 1,
    tracker: getTrackerSharedState(state),
  };
}

export function parseTrackerImportPayload(
  rawPayload: string,
): TrackerSharedState {
  const parsed = JSON.parse(rawPayload) as
    | TrackerExportPayload
    | TrackerSharedState;
  if (
    parsed &&
    typeof parsed === "object" &&
    "version" in parsed &&
    "tracker" in parsed
  ) {
    return parsed.tracker;
  }
  return parsed as TrackerSharedState;
}

export async function createPartySocketConnection(
  roomId: string,
): Promise<TrackerSocketLike> {
  const module = await import("partysocket");
  const PartySocket = module.default;
  return new PartySocket({
    host: resolvePartyKitHost(),
    room: roomId,
  });
}

export function bindTurnTracker(
  trackerRoot: HTMLElement,
  socketFactory: TrackerSocketFactory = createPartySocketConnection,
): void {
  const trackerShell = trackerRoot.querySelector<HTMLElement>(".tracker-shell");
  const trackerTabs =
    trackerRoot.querySelectorAll<HTMLButtonElement>(".tracker-tab");
  const trackerPanes =
    trackerRoot.querySelectorAll<HTMLElement>(".tracker-pane");
  const expansionField =
    trackerRoot.querySelector<HTMLSelectElement>("#tracker-expansion");
  const playerCountField = trackerRoot.querySelector<HTMLSelectElement>(
    "#tracker-player-count",
  );
  const speakerField =
    trackerRoot.querySelector<HTMLSelectElement>("#tracker-speaker");
  const trackerList = trackerRoot.querySelector<HTMLElement>("#tracker-list");
  const trackerPool = trackerRoot.querySelector<HTMLElement>("#tracker-pool");
  const strategyBoard =
    trackerRoot.querySelector<HTMLElement>("#strategy-board");
  const roundActions = trackerRoot.querySelector<HTMLElement>(
    "#tracker-round-actions",
  );
  const roomCodeField =
    trackerRoot.querySelector<HTMLInputElement>("#tracker-room-code");
  const createRoomButton = trackerRoot.querySelector<HTMLButtonElement>(
    "#tracker-create-room",
  );
  const joinRoomButton =
    trackerRoot.querySelector<HTMLButtonElement>("#tracker-join-room");
  const copyRoomButton =
    trackerRoot.querySelector<HTMLButtonElement>("#tracker-copy-room");
  const leaveRoomButton = trackerRoot.querySelector<HTMLButtonElement>(
    "#tracker-leave-room",
  );
  const collabStatus = trackerRoot.querySelector<HTMLElement>(
    "#tracker-collab-status",
  );
  const exportStateButton = trackerRoot.querySelector<HTMLButtonElement>(
    "#tracker-export-state",
  );
  const importStateButton = trackerRoot.querySelector<HTMLButtonElement>(
    "#tracker-import-state",
  );
  const transferJsonField = trackerRoot.querySelector<HTMLTextAreaElement>(
    "#tracker-transfer-json",
  );
  const transferStatus = trackerRoot.querySelector<HTMLElement>(
    "#tracker-transfer-status",
  );
  const compactLayoutField = trackerRoot.querySelector<HTMLInputElement>(
    "#tracker-compact-layout",
  );

  if (
    !trackerShell ||
    !expansionField ||
    !playerCountField ||
    !speakerField ||
    !trackerList ||
    !trackerPool ||
    !strategyBoard ||
    !roundActions ||
    !roomCodeField ||
    !createRoomButton ||
    !joinRoomButton ||
    !copyRoomButton ||
    !leaveRoomButton ||
    !collabStatus ||
    !exportStateButton ||
    !importStateButton ||
    !transferJsonField ||
    !transferStatus ||
    !compactLayoutField
  ) {
    return;
  }

  const initialPlayerCount = Number.parseInt(playerCountField.value, 10);

  const state: TrackerState = {
    expansion: expansionField.value as Mode,
    playerCount: initialPlayerCount,
    selectedFactions: Array.from({ length: initialPlayerCount }, () => ""),
    assignments: {},
    draggingFaction: null,
    speakerSeat: 0,
  };

  let collaborationStatus: CollaborationStatus = "local";
  let roomId = "";
  let connectionCount = 0;
  let socket: TrackerSocketLike | null = null;
  let applyingRemoteState = false;
  let activeTrackerTab = "factions";
  let compactLayoutManuallySet = false;
  let transferMessage =
    "Export creates a portable snapshot. Import applies that snapshot locally and creates a fresh shared room.";

  const updateUrlRoom = (nextRoomId: string) => {
    const url = new URL(window.location.href);
    if (nextRoomId) {
      url.searchParams.set("trackerRoom", nextRoomId);
    } else {
      url.searchParams.delete("trackerRoom");
    }
    window.history.replaceState({}, "", url);
  };

  const getSelectedFactions = () => state.selectedFactions.filter(Boolean);
  const allSeatsAssigned = () =>
    state.selectedFactions.length > 0 &&
    state.selectedFactions.every((faction) => Boolean(faction));
  const shouldUseCompactTrackerByViewport = () =>
    typeof window !== "undefined" && window.innerWidth <= 720;
  const isCompactTrackerLayout = () => compactLayoutField.checked;
  const getSpeakerFaction = () => state.selectedFactions[state.speakerSeat];
  const getFactionSeat = (faction: string) =>
    state.selectedFactions.indexOf(faction);
  const getSpeakerOrderedFactions = () =>
    state.selectedFactions
      .map((faction, index) => ({ faction, index }))
      .filter((entry) => entry.faction)
      .sort((left, right) => {
        const leftOffset =
          (left.index - state.speakerSeat + state.playerCount) %
          state.playerCount;
        const rightOffset =
          (right.index - state.speakerSeat + state.playerCount) %
          state.playerCount;
        return leftOffset - rightOffset;
      })
      .map((entry) => entry.faction);
  const isNaaluInPlay = () =>
    state.selectedFactions.includes("The Naalu Collective");
  const canAssignFactionToSlot = (_faction: string, slot: number) =>
    slot >= 0 && slot <= 8;
  const clearFactionAssignment = (faction: string) => {
    delete state.assignments[faction];
  };
  const syncAssignmentsToSelections = () => {
    const validSelections = new Set(getSelectedFactions());
    state.assignments = Object.fromEntries(
      Object.entries(state.assignments).filter(([faction]) =>
        validSelections.has(faction),
      ),
    );
  };
  const normalizeStrategyAssignments = () => {
    if (!isNaaluInPlay()) {
      state.assignments = Object.fromEntries(
        Object.entries(state.assignments).filter(
          ([, assignment]) => assignment.slot !== 0,
        ),
      );
      return;
    }
    if (!state.assignments["The Naalu Collective"]) {
      const occupiedFaction = getFactionAtSlot(0);
      if (!occupiedFaction) {
        state.assignments["The Naalu Collective"] = {
          slot: 0,
          passed: false,
        };
      }
    }
  };
  const getFactionAtSlot = (slot: number) =>
    Object.entries(state.assignments).find(
      ([, assignment]) => assignment.slot === slot,
    )?.[0];
  const assignFactionToSlot = (faction: string, slot: number) => {
    /* v8 ignore next -- rendered drop targets only emit slots 0 through 8 */
    if (!canAssignFactionToSlot(faction, slot)) return;
    const occupiedFaction = getFactionAtSlot(slot);
    if (occupiedFaction && occupiedFaction !== faction) return;
    clearFactionAssignment(faction);
    state.assignments[faction] = { slot, passed: false };
  };
  const publishState = () => {
    if (applyingRemoteState || !socket || collaborationStatus !== "connected") {
      return;
    }
    const message: TrackerClientMessage = {
      type: "replace_state",
      state: getTrackerSharedState(state),
    };
    socket.send(JSON.stringify(message));
  };
  const syncCompactLayout = () => {
    trackerShell.classList.toggle(
      "is-compact-layout",
      compactLayoutField.checked,
    );
  };

  const renderDraggableFaction = (
    faction: string,
    assignment: TrackerAssignment | null = null,
  ) => {
    const passed = assignment?.passed ?? false;
    const speaker = faction === getSpeakerFaction();
    const seat = getFactionSeat(faction);
    const shortFactionName = factionShortNames[faction] ?? faction;
    return `
      <div class="tracker-chip${passed ? " is-passed" : ""}${speaker ? " is-speaker" : ""}" draggable="true" data-faction-name="${faction}" title="${faction}">
        <span class="tracker-chip-label">
          <span class="tracker-chip-label-full">${faction}</span>
          <span class="tracker-chip-label-short">${shortFactionName}</span>
        </span>
        <span class="tracker-chip-seat">P${seat + 1}</span>
        ${
          assignment
            ? `<button type="button" class="tracker-chip-action" data-pass-faction="${faction}">${passed ? "Unpass" : "Pass"}</button>`
            : ""
        }
      </div>
    `;
  };

  const updateCollaborationStatus = (message?: string) => {
    const label =
      collaborationStatus === "connected"
        ? roomId
          ? `Shared room ${roomId.toUpperCase()}`
          : "Shared room"
        : collaborationStatus === "connecting"
          ? "Connecting..."
          : collaborationStatus === "error"
            ? "Connection issue"
            : "Local only";
    const statusClass =
      collaborationStatus === "connected"
        ? "is-connected"
        : collaborationStatus === "connecting"
          ? "is-connecting"
          : collaborationStatus === "error"
            ? "is-error"
            : "";
    collabStatus.innerHTML = `
      <span class="tracker-status-pill ${statusClass}">${label}</span>
      <span id="tracker-presence-count">${message ?? (collaborationStatus === "connected" ? `${connectionCount} connected` : "Not shared")}</span>
    `;
  };

  const updateTransferStatus = (
    message = transferMessage,
    statusClass = "",
  ) => {
    transferMessage = message;
    transferStatus.className = `tracker-transfer-status${statusClass ? ` ${statusClass}` : ""}`;
    transferStatus.textContent = message;
  };

  const bindDragSource = (element: HTMLElement, faction: string) => {
    element.addEventListener("dragstart", (event) => {
      state.draggingFaction = faction;
      event.dataTransfer?.setData("text/plain", faction);
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
      }
    });
    element.addEventListener("dragend", () => {
      state.draggingFaction = null;
    });
  };

  const renderSpeakerOptions = () => {
    speakerField.innerHTML = state.selectedFactions
      .map((faction, index) => ({ faction, index }))
      .filter((entry) => entry.faction)
      .map(
        (entry) =>
          `<option value="${entry.index}"${entry.index === state.speakerSeat ? " selected" : ""}>P${entry.index + 1} - ${entry.faction}</option>`,
      )
      .join("");
    if (!speakerField.innerHTML) {
      speakerField.innerHTML = `<option value="0">Select factions first</option>`;
      speakerField.disabled = true;
      state.speakerSeat = 0;
      return;
    }
    if (!state.selectedFactions[state.speakerSeat]) {
      const fallbackSpeaker = state.selectedFactions.findIndex((faction) =>
        Boolean(faction),
      );
      state.speakerSeat = Math.max(fallbackSpeaker, 0);
    }
    speakerField.disabled = false;
    speakerField.value = String(state.speakerSeat);
  };

  const bindDropTarget = (element: HTMLElement, slot: number) => {
    element.addEventListener("dragover", (event) => {
      event.preventDefault();
      element.classList.add("is-over");
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
    });
    element.addEventListener("dragleave", () => {
      element.classList.remove("is-over");
    });
    element.addEventListener("drop", (event) => {
      event.preventDefault();
      element.classList.remove("is-over");
      const faction =
        event.dataTransfer?.getData("text/plain") || state.draggingFaction;
      if (!faction) return;
      assignFactionToSlot(faction, slot);
      renderBoard();
      publishState();
    });
  };

  const renderRows = () => {
    expansionField.value = state.expansion;
    playerCountField.value = String(state.playerCount);
    const availableFactions = factionsByMode[state.expansion];
    trackerList.innerHTML = Array.from(
      { length: state.playerCount },
      (_, index) => {
        const playerNumber = index + 1;
        const selectedFaction = state.selectedFactions[index]!;
        const selectedByOthers = new Set(
          state.selectedFactions.filter(
            (faction, factionIndex) => factionIndex !== index && faction,
          ),
        );
        const factionOptions = [
          `<option value="">Select race</option>`,
          ...availableFactions.map((faction) => {
            const disabled =
              selectedByOthers.has(faction) && faction !== selectedFaction;
            return `<option value="${faction}"${faction === selectedFaction ? " selected" : ""}${disabled ? " disabled" : ""}>${faction}</option>`;
          }),
        ].join("");
        return `
          <div class="tracker-row" data-player-index="${index}">
            <div class="tracker-row-main">
              <span class="tracker-seat">P${playerNumber}</span>
              <select class="tracker-faction-select" data-faction-index="${index}" aria-label="Player ${playerNumber} faction">
                ${factionOptions}
              </select>
            </div>
          </div>
        `;
      },
    ).join("");
    for (const select of trackerList.querySelectorAll<HTMLSelectElement>(
      ".tracker-faction-select",
    )) {
      select.addEventListener("change", () => {
        const index = Number.parseInt(select.dataset.factionIndex!, 10);
        const previousFaction = state.selectedFactions[index];
        state.selectedFactions[index] = select.value;
        if (previousFaction && previousFaction !== select.value) {
          clearFactionAssignment(previousFaction);
        }
        syncAssignmentsToSelections();
        normalizeStrategyAssignments();
        renderAll();
        publishState();
      });
    }
  };

  const renderBoard = () => {
    roomCodeField.value = roomId;
    renderSpeakerOptions();
    const selectedFactions = getSelectedFactions();
    const visibleSlots = isNaaluInPlay()
      ? Array.from({ length: 9 }, (_, index) => index)
      : Array.from({ length: 8 }, (_, index) => index + 1);
    const unassignedFactions = getSpeakerOrderedFactions().filter(
      (faction) => !state.assignments[faction],
    );
    trackerPool.innerHTML = unassignedFactions.length
      ? unassignedFactions
          .map((faction) => renderDraggableFaction(faction))
          .join("")
      : `<p class="tracker-pool-empty">All selected factions are assigned to the board.</p>`;
    for (const chip of trackerPool.querySelectorAll<HTMLElement>(
      ".tracker-chip",
    )) {
      bindDragSource(chip, chip.dataset.factionName!);
    }

    strategyBoard.innerHTML = visibleSlots
      .map((slot) => {
        const card = strategyCards.find((entry) => entry.initiative === slot);
        const title = slot === 0 ? "Naalu Token" : card!.name;
        const activeFaction =
          Object.entries(state.assignments).find(
            ([, assignment]) => assignment.slot === slot && !assignment.passed,
          )?.[0] ?? null;
        const passedFaction =
          Object.entries(state.assignments).find(
            ([, assignment]) => assignment.slot === slot && assignment.passed,
          )?.[0] ?? null;
        return `
        <article class="strategy-slot strategy-slot-row" data-strategy-slot="${slot}">
          <div class="strategy-number">${slot}</div>
          <div class="strategy-copy">
            <h3>${title}</h3>
          </div>
          <section class="strategy-lane strategy-lane-active" data-drop-slot="${slot}">
            <div class="strategy-lane-body">
              ${
                activeFaction
                  ? renderDraggableFaction(
                      activeFaction,
                      state.assignments[activeFaction]!,
                    )
                  : `<p class="strategy-placeholder">Drop faction here</p>`
              }
            </div>
          </section>
          <section class="strategy-lane strategy-lane-passed">
            <div class="strategy-lane-body">
              ${
                passedFaction
                  ? renderDraggableFaction(
                      passedFaction,
                      state.assignments[passedFaction]!,
                    )
                  : `<p class="strategy-placeholder">None</p>`
              }
            </div>
          </section>
        </article>
      `;
      })
      .join("");
    for (const dropTarget of strategyBoard.querySelectorAll<HTMLElement>(
      ".strategy-lane-active",
    )) {
      bindDropTarget(
        dropTarget,
        Number.parseInt(dropTarget.dataset.dropSlot!, 10),
      );
    }
    for (const chip of strategyBoard.querySelectorAll<HTMLElement>(
      ".tracker-chip",
    )) {
      bindDragSource(chip, chip.dataset.factionName!);
    }
    for (const button of strategyBoard.querySelectorAll<HTMLButtonElement>(
      ".tracker-chip-action",
    )) {
      button.addEventListener("click", () => {
        const faction = button.dataset.passFaction!;
        const assignment = state.assignments[faction]!;
        assignment.passed = !assignment.passed;
        renderBoard();
        publishState();
      });
    }
    const everyonePassed =
      selectedFactions.length > 0 &&
      selectedFactions.every((faction) => state.assignments[faction]?.passed);
    roundActions.innerHTML = everyonePassed
      ? `<button type="button" id="tracker-reset-round" class="tracker-reset-button">Reset for Next Round</button>`
      : "";
    roundActions
      .querySelector<HTMLButtonElement>("#tracker-reset-round")
      ?.addEventListener("click", () => {
        state.assignments = {};
        normalizeStrategyAssignments();
        renderBoard();
        publishState();
      });
  };

  const renderAll = () => {
    if (!compactLayoutManuallySet) {
      compactLayoutField.checked = shouldUseCompactTrackerByViewport();
    }
    normalizeStrategyAssignments();
    syncCompactLayout();
    renderRows();
    renderBoard();
    updateCollaborationStatus();
    if (
      activeTrackerTab === "factions" &&
      isCompactTrackerLayout() &&
      allSeatsAssigned()
    ) {
      activateTrackerTab("strategy");
    }
  };

  const activateTrackerTab = (target: string) => {
    activeTrackerTab = target;
    for (const tabButton of trackerTabs) {
      const active = tabButton.dataset.trackerTabTarget === target;
      tabButton.classList.toggle("is-active", active);
      tabButton.setAttribute("aria-selected", active ? "true" : "false");
    }
    for (const pane of trackerPanes) {
      const active = pane.dataset.trackerTabPanel === target;
      pane.hidden = !active;
      pane.classList.toggle("is-active", active);
    }
  };

  const handleServerMessage = (rawMessage: string) => {
    const message = JSON.parse(rawMessage) as TrackerServerMessage;
    if (message.type === "snapshot") {
      applyingRemoteState = true;
      applyTrackerSharedState(state, message.state);
      syncAssignmentsToSelections();
      renderAll();
      applyingRemoteState = false;
      return;
    }
    if (message.type === "presence") {
      connectionCount = message.connections;
      updateCollaborationStatus();
      return;
    }
    collaborationStatus = "error";
    updateCollaborationStatus(message.message);
  };

  const leaveRoom = () => {
    socket?.close();
    socket = null;
    roomId = "";
    connectionCount = 0;
    collaborationStatus = "local";
    updateUrlRoom("");
    renderAll();
  };

  const joinRoom = async (requestedRoomId: string) => {
    const normalizedRoomId = requestedRoomId.trim().toLowerCase();
    if (!normalizedRoomId) {
      collaborationStatus = "error";
      updateCollaborationStatus("Enter a room code first");
      return;
    }
    socket?.close();
    roomId = normalizedRoomId;
    roomCodeField.value = roomId;
    updateUrlRoom(roomId);
    collaborationStatus = "connecting";
    updateCollaborationStatus("Connecting to shared room");
    try {
      socket = await socketFactory(roomId);
      socket.addEventListener("open", () => {
        collaborationStatus = "connected";
        updateCollaborationStatus();
        const helloMessage: TrackerClientMessage = {
          type: "hello",
          state: getTrackerSharedState(state),
        };
        socket?.send(JSON.stringify(helloMessage));
      });
      socket.addEventListener("message", (event) => {
        if ("data" in event && typeof event.data === "string") {
          handleServerMessage(event.data);
        }
      });
      socket.addEventListener("close", () => {
        if (collaborationStatus === "connected") {
          collaborationStatus = "local";
          connectionCount = 0;
          updateCollaborationStatus("Disconnected");
        }
      });
      socket.addEventListener("error", () => {
        collaborationStatus = "error";
        updateCollaborationStatus("Unable to connect");
      });
    } catch (error) {
      collaborationStatus = "error";
      updateCollaborationStatus(
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  const exportTrackerState = () => {
    transferJsonField.value = JSON.stringify(
      buildTrackerExportPayload(state),
      null,
      2,
    );
    updateTransferStatus("Tracker state exported to the text box.");
  };

  const importTrackerState = async () => {
    const rawPayload = transferJsonField.value.trim();
    if (!rawPayload) {
      updateTransferStatus(
        "Paste exported tracker JSON before importing.",
        "is-error",
      );
      return;
    }
    try {
      const nextState = parseTrackerImportPayload(rawPayload);
      leaveRoom();
      applyingRemoteState = true;
      applyTrackerSharedState(state, nextState);
      syncAssignmentsToSelections();
      renderAll();
      applyingRemoteState = false;
      updateTransferStatus(
        "Tracker state imported. Creating a fresh shared room...",
      );
      await joinRoom(generateTrackerRoomCode());
      updateTransferStatus(
        roomId
          ? `Tracker state imported and shared as room ${roomId.toUpperCase()}.`
          : "Tracker state imported locally.",
      );
    } catch (error) {
      applyingRemoteState = false;
      updateTransferStatus(
        error instanceof Error
          ? `Import failed: ${error.message}`
          : `Import failed: ${String(error)}`,
        "is-error",
      );
    }
  };

  for (const button of trackerTabs) {
    button.addEventListener("click", () => {
      activateTrackerTab(button.dataset.trackerTabTarget ?? "factions");
    });
  }
  compactLayoutField.addEventListener("change", () => {
    compactLayoutManuallySet = true;
    syncCompactLayout();
  });

  expansionField.addEventListener("change", () => {
    state.expansion = expansionField.value as Mode;
    state.selectedFactions = Array.from(
      { length: state.playerCount },
      (_, index) => {
        const selectedFaction = state.selectedFactions[index];
        return selectedFaction &&
          factionsByMode[state.expansion].includes(selectedFaction)
          ? selectedFaction
          : "";
      },
    );
    syncAssignmentsToSelections();
    renderAll();
    publishState();
  });
  playerCountField.addEventListener("change", () => {
    state.playerCount = Number.parseInt(playerCountField.value, 10);
    state.selectedFactions = Array.from(
      { length: state.playerCount },
      (_, index) => state.selectedFactions[index] || "",
    );
    syncAssignmentsToSelections();
    renderAll();
    publishState();
  });
  speakerField.addEventListener("change", () => {
    state.speakerSeat = Number.parseInt(speakerField.value, 10);
    renderBoard();
    publishState();
  });
  createRoomButton.addEventListener("click", () => {
    void joinRoom(generateTrackerRoomCode());
  });
  joinRoomButton.addEventListener("click", () => {
    void joinRoom(roomCodeField.value);
  });
  leaveRoomButton.addEventListener("click", leaveRoom);
  copyRoomButton.addEventListener("click", async () => {
    if (!roomId || typeof navigator === "undefined" || !navigator.clipboard) {
      updateCollaborationStatus("Join a room before copying");
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set("trackerRoom", roomId);
    await navigator.clipboard.writeText(url.toString());
    updateCollaborationStatus("Invite link copied");
  });
  exportStateButton.addEventListener("click", exportTrackerState);
  importStateButton.addEventListener("click", () => {
    void importTrackerState();
  });

  renderAll();
  updateTransferStatus();
  if (typeof window !== "undefined") {
    window.addEventListener("resize", () => {
      if (!compactLayoutManuallySet) {
        compactLayoutField.checked = shouldUseCompactTrackerByViewport();
        syncCompactLayout();
      }
    });
    const requestedRoomId =
      new URL(window.location.href).searchParams.get("trackerRoom") ?? "";
    if (requestedRoomId) {
      roomCodeField.value = requestedRoomId;
      void joinRoom(requestedRoomId);
    }
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
  trackerView: HTMLElement;
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
      <div class="app-tabs" role="tablist" aria-label="App views">
        <button type="button" class="app-tab is-active" data-app-tab-target="builder" aria-selected="true">Galaxy Builder</button>
        <button type="button" class="app-tab" data-app-tab-target="tracker" aria-selected="false">Turn Order Tracker</button>
      </div>
      <section class="app-pane is-active" data-app-tab-panel="builder">
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
      </section>
      <section class="app-pane" data-app-tab-panel="tracker" hidden>
        <section id="turn-tracker-view">${renderTurnTracker()}</section>
      </section>
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
  const trackerView = appRoot.querySelector<HTMLElement>("#turn-tracker-view");

  if (
    !playersInput ||
    !setupSelect ||
    !modeSelect ||
    !seedInput ||
    !restartInput ||
    !form ||
    !results ||
    !layoutPreview ||
    !trackerView
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
  const turnTrackerView = trackerView;
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

  bindAppTabs(appRoot);
  bindTurnTracker(turnTrackerView);
  refreshSetups();
  generate();

  return {
    refreshSetups,
    generate,
    renderPreview,
    resultsView,
    layoutPreviewView,
    trackerView: turnTrackerView,
  };
}

if (typeof document !== "undefined" && document.querySelector("#app")) {
  initializeApp();
}
