import "./styles.css";
import { buildGame, resolveSetupName, type BuildGameResult, type Mode } from "./deckBuilder";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) throw new Error("App root not found.");

const modes: Mode[] = ["base", "pok", "thunders_edge"];

function getSetupOptions(players: number): string[] {
  return ["standard", "hyperlanes", "alternate", "large"].filter((setup) => {
    try {
      return resolveSetupName(players, setup) === setup;
    } catch {
      return false;
    }
  });
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
          <h2>${result.mode} • ${result.players} players • ${result.setup}</h2>
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
        <p class="lede">This web version mirrors the Python deck builder, but gives you a tabletop-friendly UI with setup guidance, a shared tile display, and a dramatic galactic briefing screen.</p>
        <ol class="instruction-list">
          <li>Pick your ruleset, player count, and setup map variant.</li>
          <li>Use a seed when you want a deal you can reproduce later.</li>
          <li>Deal the listed stacks, place any shared tiles, and ignore the leftovers.</li>
        </ol>
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
        <label><span>Seed</span><input id="seed" type="number" value="7" /></label>
        <label><span>Restarts</span><input id="restarts" type="number" min="10" max="5000" value="500" /></label>
        <button type="submit">Generate balanced decks</button>
      </form>
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

if (!playersInput || !setupSelect || !modeSelect || !seedInput || !restartInput || !form || !results) {
  throw new Error("UI failed to initialize.");
}

function refreshSetups(): void {
  const players = Number.parseInt(playersInput.value, 10);
  const options = getSetupOptions(players);
  const fallback = resolveSetupName(players, null);
  setupSelect.innerHTML = options.map((option) => `<option value="${option}">${option}</option>`).join("");
  setupSelect.value = options.includes(fallback) ? fallback : options[0];
}

function generate(): void {
  try {
    const result = buildGame({
      mode: modeSelect.value as Mode,
      players: Number.parseInt(playersInput.value, 10),
      setup: setupSelect.value,
      seed: seedInput.value === "" ? null : Number.parseInt(seedInput.value, 10),
      restarts: Number.parseInt(restartInput.value, 10)
    });
    results.innerHTML = renderResult(result);
  } catch (error) {
    results.innerHTML = `<p class="error-card">${error instanceof Error ? error.message : String(error)}</p>`;
  }
}

playersInput.addEventListener("change", () => {
  refreshSetups();
  generate();
});
modeSelect.addEventListener("change", generate);
setupSelect.addEventListener("change", generate);
form.addEventListener("submit", (event) => {
  event.preventDefault();
  generate();
});

refreshSetups();
generate();
