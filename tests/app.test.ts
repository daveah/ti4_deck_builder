import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  bindAppTabs,
  bindResultTabs,
  bindTurnTracker,
  describeSetupVariant,
  getLayoutDefinition,
  initializeApp,
  renderBoardPreview,
  renderHyperlaneGlyph,
  renderResult,
  renderTurnTracker,
  rotationTransform,
  type AppDependencies,
  type BoardTile,
  type LayoutFile,
} from "../src/app";
import type { BuildGameResult } from "../src/deckBuilder";

function sampleResult(): BuildGameResult {
  return {
    mode: "base",
    players: 6,
    setup: "standard",
    seed: 7,
    decks: [],
    summary: {
      players: [
        {
          player: "Player 1",
          tile_count: 2,
          target_tile_count: 2,
          tile_ids: ["2", "1"],
          tiles: [
            { id: "2", name: "Lodor" },
            { id: "1", name: "Jord" },
          ],
          totals: {
            resources: 5,
            influence: 4,
            planets: 2,
            traits: 2,
            tech_skips: 1,
            wormholes: 1,
            legendary: 0,
          },
        },
      ],
      target_totals: [
        {
          resources: 5,
          influence: 4,
          planets: 2,
          traits: 2,
          tech_skips: 1,
          wormholes: 1,
          legendary: 0,
        },
      ],
      max_spread: {
        resources: 1,
        influence: 1,
        planets: 0,
        traits: 0,
        tech_skips: 0,
        wormholes: 0,
        legendary: 0,
      },
      score: 0.5,
      setup: "standard",
      per_player: { blue: 3, red: 2 },
      shared_tiles: [{ id: "18", name: "Mecatol Rex" }],
      unused_tiles: [{ id: "99", name: "Unused" }],
    },
  };
}

function sampleLayoutFile(): LayoutFile {
  const hyperlaneTile: BoardTile = {
    q: 1,
    r: 0,
    kind: "hyperlane",
    label: "HL",
    hyperlaneId: "83A",
    rotation: 1,
    connections: [
      [0, 3],
      [1, 4],
    ],
  };
  return {
    layouts: [
      {
        key: "base:6:standard",
        title: "Base standard",
        tiles: [
          { q: 0, r: 0, kind: "red", label: "MR" },
          { q: -1, r: 0, kind: "green", label: "H1" },
          { q: 0, r: -1, kind: "blue4", label: "B1" },
          hyperlaneTile,
        ],
      },
      {
        key: "pok:6:standard",
        title: "Expansion alias",
        ref: "base:6:standard",
      },
    ],
  };
}

function makeDataTransfer() {
  const store = new Map<string, string>();
  return {
    effectAllowed: "move",
    dropEffect: "move",
    setData(type: string, value: string) {
      store.set(type, value);
    },
    getData(type: string) {
      return store.get(type) ?? "";
    },
  };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("app helpers", () => {
  it("describes setup variants across the different branches", () => {
    expect(describeSetupVariant("base", 5, "standard")).toContain(
      "one shared faceup red tile",
    );
    expect(describeSetupVariant("pok", 4, "hyperlanes")).toContain(
      "two hyperlane fans",
    );
    expect(describeSetupVariant("pok", 5, "hyperlanes")).toContain(
      "5-player expansion setup",
    );
    expect(describeSetupVariant("pok", 7, "hyperlanes")).toContain(
      "7-player expansion setup",
    );
    expect(describeSetupVariant("thunders_edge", 8, "hyperlanes")).toContain(
      "Hyperlane layouts use the official expansion board templates",
    );
    expect(describeSetupVariant("pok", 6, "large")).toContain(
      "This setup changes how many blue and red tiles each player drafts",
    );
  });

  it("resolves layout references and rejects bad references", () => {
    const layouts = sampleLayoutFile();
    expect(
      getLayoutDefinition("pok", 6, "standard", layouts)?.tiles,
    ).toHaveLength(4);
    expect(
      getLayoutDefinition("pok", 6, "standard", {
        layouts: [
          layouts.layouts[0],
          {
            key: "pok:6:standard",
            ref: "base:6:standard",
          } as unknown as (typeof layouts.layouts)[number],
        ],
      })?.title,
    ).toBe("Base standard");

    expect(() =>
      getLayoutDefinition("base", 6, "standard", {
        layouts: [
          {
            key: "base:6:standard",
            title: "Broken",
            ref: "missing:key",
          },
        ],
      }),
    ).toThrow("references missing key");

    expect(() =>
      getLayoutDefinition("base", 6, "standard", {
        layouts: [
          { key: "base:6:standard", title: "A", ref: "base:6:alt" },
          { key: "base:6:alt", title: "B", ref: "base:6:standard" },
        ],
      }),
    ).toThrow("Circular layout reference detected");

    expect(
      getLayoutDefinition("base", 3, "standard", { layouts: [] }),
    ).toBeNull();
  });

  it("renders rotation and hyperlane glyph details", () => {
    expect(rotationTransform(10, 20, 0)).toBe("");
    expect(rotationTransform(10, 20, 7)).toContain("rotate(60 10 20)");
    expect(rotationTransform(10, 20, -1)).toContain("rotate(300 10 20)");

    const glyph = renderHyperlaneGlyph(
      {
        q: 0,
        r: 0,
        kind: "hyperlane",
        hyperlaneId: "83A",
        rotation: 1,
        connections: [[0, 3]],
      },
      100,
      200,
    );
    expect(glyph).toContain('x1="122"');
    expect(glyph).toContain('y1="200"');
    expect(glyph).toContain(">83A<");
    expect(glyph).toContain('fill="#ffcf70"');
    expect(glyph).toContain('paint-order="stroke fill"');
    expect(
      renderHyperlaneGlyph({ q: 0, r: 0, kind: "hyperlane" }, 10, 20),
    ).toContain("<line");
  });

  it("renders board previews with and without configured layouts", () => {
    const emptyPreview = renderBoardPreview("base", 3, "standard", {
      layouts: [],
    });
    expect(emptyPreview).toContain("No JSON layout configured yet");

    const previewWithoutTiles = renderBoardPreview("base", 6, "standard", {
      layouts: [
        {
          key: "base:6:standard",
          title: "No tiles yet",
        } as unknown as LayoutFile["layouts"][number],
      ],
    });
    expect(previewWithoutTiles).toContain("No tiles yet");

    const preview = renderBoardPreview(
      "base",
      6,
      "standard",
      sampleLayoutFile(),
    );
    expect(preview).toContain("Board Layout Preview");
    expect(preview).toContain("Base standard");
    expect(preview).toContain("Board Rotation");
    expect(preview).toContain('<option value="0" selected>0&deg;</option>');
    expect(preview).toContain('<option value="1">30&deg;</option>');
    expect(preview).toContain("Green: home system");
    expect(preview).toContain(
      'aria-label="Board layout preview for 6 player standard configuration"',
    );
    expect(preview).toContain("83A");
    expect(preview).toContain('transform="rotate(0 ');
    const rotatedPreview = renderBoardPreview(
      "base",
      6,
      "standard",
      sampleLayoutFile(),
      2,
    );
    expect(rotatedPreview).toContain('transform="rotate(60 ');
    expect(rotatedPreview).toContain('transform="rotate(-60 ');
  });

  it("renders results and toggles result tabs", () => {
    const host = document.createElement("div");
    host.innerHTML = renderResult(sampleResult());
    bindResultTabs(host);

    expect(host.innerHTML).toContain("Tile Allocation By Number");
    expect(host.innerHTML).toContain('class="owner-player-1"');
    expect(host.innerHTML).toContain("<td>18</td>");

    const tabs = host.querySelectorAll<HTMLButtonElement>(".results-tab");
    const panes = host.querySelectorAll<HTMLElement>(".results-pane");
    tabs[1].click();
    expect(tabs[1].classList.contains("is-active")).toBe(true);
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(panes[0].hidden).toBe(true);
    expect(panes[1].hidden).toBe(false);

    expect(() => bindResultTabs(document.createElement("div"))).not.toThrow();
  });

  it("renders empty shared and unused sections as None", () => {
    const result = sampleResult();
    result.summary.shared_tiles = [];
    result.summary.unused_tiles = [];
    const html = renderResult(result);
    expect(html).toContain("None for this setup.");
    expect(html).toContain("None.");
  });

  it("renders a turn tracker shell", () => {
    const html = renderTurnTracker(4);
    expect(html).toContain("Turn Order Tracker");
    expect(html).toContain('id="tracker-expansion"');
    expect(html).toContain('id="tracker-player-count"');
    expect(html).toContain("Select race");
    expect(html).toContain("Strategy Board");
    expect(html).toContain("Naalu Token");
    expect(html).toContain("Leadership");
    expect(html).toContain("Imperial");
    expect(html).toContain("Unassigned Factions");
  });

  it("switches the top-level app tabs", () => {
    const host = document.createElement("div");
    host.innerHTML = `
      <div>
        <button type="button" class="app-tab is-active" data-app-tab-target="builder" aria-selected="true">Galaxy Builder</button>
        <button type="button" class="app-tab" data-app-tab-target="tracker" aria-selected="false">Turn Tracker</button>
        <section class="app-pane is-active" data-app-tab-panel="builder"></section>
        <section class="app-pane" data-app-tab-panel="tracker" hidden></section>
      </div>
    `;
    bindAppTabs(host);

    const tabs = host.querySelectorAll<HTMLButtonElement>(".app-tab");
    const panes = host.querySelectorAll<HTMLElement>(".app-pane");
    tabs[1].click();

    expect(tabs[1].classList.contains("is-active")).toBe(true);
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(panes[0].hidden).toBe(true);
    expect(panes[1].hidden).toBe(false);
  });

  it("binds turn tracker controls", () => {
    const host = document.createElement("div");
    host.innerHTML = renderTurnTracker(4);
    bindTurnTracker(host);

    const playerCount =
      host.querySelector<HTMLSelectElement>("#tracker-player-count");
    const expansion = host.querySelector<HTMLSelectElement>("#tracker-expansion");
    const firstFaction =
      host.querySelector<HTMLSelectElement>('[data-faction-index="0"]');

    expect(firstFaction?.textContent).toContain("The Arborec");
    firstFaction!.value = "The Federation of Sol";
    firstFaction!.dispatchEvent(new Event("change", { bubbles: true }));

    const secondFaction =
      host.querySelector<HTMLSelectElement>('[data-faction-index="1"]');
    expect(secondFaction?.innerHTML).toContain("The Federation of Sol");
    expect(secondFaction?.innerHTML).toContain("disabled");

    expansion!.value = "pok";
    expansion!.dispatchEvent(new Event("change", { bubbles: true }));
    expect(
      host.querySelector<HTMLSelectElement>('[data-faction-index="0"]')
        ?.textContent,
    ).toContain("The Nomad");

    playerCount!.value = "3";
    playerCount!.dispatchEvent(new Event("change", { bubbles: true }));
    expect(host.querySelectorAll(".tracker-row")).toHaveLength(3);
    expect(host.querySelectorAll(".strategy-slot")).toHaveLength(9);
  });

  it("drags factions onto the strategy board, passes them, and resets the round", () => {
    const host = document.createElement("div");
    host.innerHTML = renderTurnTracker(3);
    bindTurnTracker(host);

    const selections = [
      "The Federation of Sol",
      "The Arborec",
      "The Naalu Collective",
    ];
    for (const [index, faction] of selections.entries()) {
      const select = host.querySelector<HTMLSelectElement>(
        `[data-faction-index="${index}"]`,
      );
      select!.value = faction;
      select!.dispatchEvent(new Event("change", { bubbles: true }));
    }

    const dragToSlot = (faction: string, slot: number) => {
      const chip = Array.from(
        host.querySelectorAll<HTMLElement>(".tracker-chip"),
      ).find((element) => element.dataset.factionName === faction);
      const dragEvent = new Event("dragstart", { bubbles: true }) as Event & {
        dataTransfer: ReturnType<typeof makeDataTransfer>;
      };
      dragEvent.dataTransfer = makeDataTransfer();
      chip!.dispatchEvent(dragEvent);

      const dropTarget = host.querySelector<HTMLElement>(
        `.strategy-lane-active[data-drop-slot="${slot}"]`,
      );
      const dropEvent = new Event("drop", { bubbles: true }) as Event & {
        dataTransfer: ReturnType<typeof makeDataTransfer>;
      };
      dropEvent.dataTransfer = dragEvent.dataTransfer;
      dropTarget!.dispatchEvent(dropEvent);
    };

    dragToSlot("The Federation of Sol", 1);
    dragToSlot("The Arborec", 2);
    dragToSlot("The Naalu Collective", 0);

    expect(
      host.querySelector(
        '.strategy-lane-active[data-drop-slot="1"] [data-faction-name="The Federation of Sol"]',
      ),
    ).not.toBeNull();
    expect(
      host.querySelector(
        '.strategy-lane-active[data-drop-slot="0"] [data-faction-name="The Naalu Collective"]',
      ),
    ).not.toBeNull();

    const invalidDropChip = host.querySelector(
      '.strategy-lane-active[data-drop-slot="2"] [data-faction-name="The Arborec"]',
    ) as HTMLElement;
    const invalidDrag = new Event("dragstart", { bubbles: true }) as Event & {
      dataTransfer: ReturnType<typeof makeDataTransfer>;
    };
    invalidDrag.dataTransfer = makeDataTransfer();
    invalidDropChip.dispatchEvent(invalidDrag);
    const invalidDropTarget = host.querySelector<HTMLElement>(
      '.strategy-lane-active[data-drop-slot="0"]',
    );
    const invalidDrop = new Event("drop", { bubbles: true }) as Event & {
      dataTransfer: ReturnType<typeof makeDataTransfer>;
    };
    invalidDrop.dataTransfer = invalidDrag.dataTransfer;
    invalidDropTarget!.dispatchEvent(invalidDrop);
    expect(
      host.querySelector(
        '.strategy-lane-active[data-drop-slot="2"] [data-faction-name="The Arborec"]',
      ),
    ).not.toBeNull();

    for (const faction of selections) {
      const button = Array.from(
        host.querySelectorAll<HTMLButtonElement>(".tracker-chip-action"),
      ).find((element) => element.dataset.passFaction === faction);
      button!.click();
    }

    expect(
      host.querySelector(
        '.strategy-lane-passed [data-faction-name="The Federation of Sol"]',
      ),
    ).not.toBeNull();
    expect(host.textContent).toContain("Reset for Next Round");

    host
      .querySelector<HTMLButtonElement>("#tracker-reset-round")!
      .dispatchEvent(new Event("click", { bubbles: true }));

    expect(host.querySelector("#tracker-reset-round")).toBeNull();
    expect(host.querySelectorAll("#tracker-pool .tracker-chip")).toHaveLength(3);
    expect(host.textContent).toContain("Drop faction here");
  });

  it("gracefully skips turn tracker binding if controls are missing", () => {
    expect(() => bindTurnTracker(document.createElement("div"))).not.toThrow();
  });
});

describe("initializeApp", () => {
  function makeDependencies(
    buildGameImpl?: AppDependencies["buildGame"],
  ): AppDependencies {
    return {
      buildGame:
        buildGameImpl ??
        vi.fn(() => {
          return sampleResult();
        }),
      getSetupOptions: vi.fn(() => ["standard", "hyperlanes"]),
      resolveSetupName: vi.fn(() => "standard"),
    };
  }

  it("throws if the app root is missing", () => {
    expect(() => initializeApp(null)).toThrow("App root not found.");
  });

  it("throws if a required UI element cannot be found after rendering", () => {
    const root = document.createElement("div");
    root.id = "app";
    const originalQuerySelector = root.querySelector.bind(root);
    vi.spyOn(root, "querySelector").mockImplementation((selector) => {
      if (selector === "#results") {
        return null;
      }
      return originalQuerySelector(selector);
    });

    expect(() => initializeApp(root, makeDependencies())).toThrow(
      "UI failed to initialize.",
    );
  });

  it("initializes the page and keeps the first option if fallback is unavailable", () => {
    const root = document.createElement("div");
    root.id = "app";
    document.body.append(root);
    const deps = {
      ...makeDependencies(),
      getSetupOptions: vi.fn(() => ["hyperlanes"]),
      resolveSetupName: vi.fn(() => "standard"),
    };

    const app = initializeApp(root, deps);
    const setup = root.querySelector<HTMLSelectElement>("#setup");
    expect(setup?.value).toBe("hyperlanes");
    expect(app.layoutPreviewView.innerHTML).toContain("Board Layout Preview");
    expect(app.trackerView.innerHTML).toContain("Turn Order Tracker");
  });

  it("re-renders the board preview when rotation changes", () => {
    const root = document.createElement("div");
    root.id = "app";
    document.body.append(root);

    const app = initializeApp(root, makeDependencies());
    const rotation = root.querySelector<HTMLSelectElement>("#board-rotation");
    expect(rotation?.value).toBe("0");

    rotation!.value = "2";
    rotation!.dispatchEvent(new Event("change", { bubbles: true }));

    const updatedRotation =
      root.querySelector<HTMLSelectElement>("#board-rotation");
    expect(updatedRotation?.value).toBe("2");
    expect(app.layoutPreviewView.innerHTML).toContain('transform="rotate(60 ');
  });

  it("falls back to zero rotation if the dropdown value is invalid", () => {
    const root = document.createElement("div");
    root.id = "app";
    document.body.append(root);

    const app = initializeApp(root, makeDependencies());
    const rotation = root.querySelector<HTMLSelectElement>("#board-rotation");
    rotation!.value = "not-a-number";
    rotation!.dispatchEvent(new Event("change", { bubbles: true }));

    const updatedRotation =
      root.querySelector<HTMLSelectElement>("#board-rotation");
    expect(updatedRotation?.value).toBe("0");
    expect(app.layoutPreviewView.innerHTML).toContain('transform="rotate(0 ');
  });

  it("gracefully skips binding if the rotation control cannot be found", () => {
    const root = document.createElement("div");
    root.id = "app";
    document.body.append(root);

    const app = initializeApp(root, makeDependencies());
    const originalQuerySelector = app.layoutPreviewView.querySelector.bind(
      app.layoutPreviewView,
    );
    vi.spyOn(app.layoutPreviewView, "querySelector").mockImplementation(
      (selector) => {
        if (selector === "#board-rotation") {
          return null;
        }
        return originalQuerySelector(selector);
      },
    );

    expect(() => app.renderPreview()).not.toThrow();
  });

  it("renders a successful explicit-seed generation from submit", () => {
    const root = document.createElement("div");
    root.id = "app";
    document.body.append(root);
    const buildGameMock = vi.fn(() => sampleResult());
    initializeApp(root, makeDependencies(buildGameMock));

    const seed = root.querySelector<HTMLInputElement>("#seed");
    const form = root.querySelector<HTMLFormElement>("#deck-form");
    seed!.value = "99";
    form!.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );

    expect(buildGameMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ seed: 99 }),
    );
    expect(root.textContent).toContain("Balance report");
  });

  it("retries random generation until it succeeds", () => {
    const root = document.createElement("div");
    root.id = "app";
    document.body.append(root);
    const buildGameMock = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("try again");
      })
      .mockImplementationOnce(() => {
        throw new Error("still no");
      })
      .mockImplementation(() => sampleResult());

    initializeApp(root, makeDependencies(buildGameMock));

    expect(buildGameMock).toHaveBeenCalledTimes(3);
    expect(root.textContent).toContain("Player view");
  });

  it("shows the explicit-seed error without retrying", () => {
    const root = document.createElement("div");
    root.id = "app";
    document.body.append(root);
    const buildGameMock = vi
      .fn()
      .mockImplementation(() => sampleResult())
      .mockImplementationOnce(() => sampleResult())
      .mockImplementationOnce(() => {
        throw new Error("seeded failure");
      });

    initializeApp(root, makeDependencies(buildGameMock));
    const seed = root.querySelector<HTMLInputElement>("#seed");
    const form = root.querySelector<HTMLFormElement>("#deck-form");
    seed!.value = "12";
    form!.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );

    expect(root.textContent).toContain("seeded failure");
  });

  it("shows the generic failure if random generation never returns a result", () => {
    const root = document.createElement("div");
    root.id = "app";
    document.body.append(root);
    initializeApp(
      root,
      makeDependencies(vi.fn(() => null as unknown as BuildGameResult)),
    );

    expect(root.textContent).toContain(
      "Unable to generate a balanced deck after multiple random attempts.",
    );
  });

  it("surfaces the last random-generation error after retry exhaustion", () => {
    const root = document.createElement("div");
    root.id = "app";
    document.body.append(root);
    initializeApp(
      root,
      makeDependencies(
        vi.fn(() => {
          throw new Error("retry exhausted");
        }),
      ),
    );

    expect(root.textContent).toContain("retry exhausted");
  });

  it("renders non-Error thrown values as strings", () => {
    const root = document.createElement("div");
    root.id = "app";
    document.body.append(root);
    const buildGameMock = vi
      .fn()
      .mockImplementation(() => sampleResult())
      .mockImplementationOnce(() => sampleResult())
      .mockImplementationOnce(() => {
        throw "plain failure";
      });

    initializeApp(root, makeDependencies(buildGameMock));
    const seed = root.querySelector<HTMLInputElement>("#seed");
    const form = root.querySelector<HTMLFormElement>("#deck-form");
    seed!.value = "101";
    form!.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );

    expect(root.textContent).toContain("plain failure");
  });

  it("reacts to player, mode, and setup changes", () => {
    const root = document.createElement("div");
    root.id = "app";
    document.body.append(root);
    const buildGameMock = vi.fn(() => sampleResult());
    const deps = {
      buildGame: buildGameMock,
      getSetupOptions: vi.fn((mode: string, players: number) =>
        mode === "thunders_edge"
          ? ["hyperlanes"]
          : players === 5
            ? ["standard"]
            : ["standard", "hyperlanes"],
      ),
      resolveSetupName: vi.fn(() => "standard"),
    };
    initializeApp(root, deps);

    const players = root.querySelector<HTMLInputElement>("#players");
    const mode = root.querySelector<HTMLSelectElement>("#mode");
    const setup = root.querySelector<HTMLSelectElement>("#setup");

    players!.value = "5";
    players!.dispatchEvent(new Event("change", { bubbles: true }));
    mode!.value = "thunders_edge";
    mode!.dispatchEvent(new Event("change", { bubbles: true }));
    setup!.value = "hyperlanes";
    setup!.dispatchEvent(new Event("change", { bubbles: true }));

    expect(deps.getSetupOptions).toHaveBeenCalledWith("base", 5);
    expect(deps.getSetupOptions).toHaveBeenCalledWith("thunders_edge", 5);
    expect(buildGameMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: "thunders_edge",
        players: 5,
        setup: "hyperlanes",
      }),
    );
  });

  it("auto-initializes when a #app root already exists at import time", async () => {
    document.body.innerHTML = '<div id="app"></div>';
    vi.resetModules();
    await import("../src/app");
    expect(document.body.textContent).toContain(
      "Build a galaxy draft that feels fair before the first ship moves.",
    );
  });
});
