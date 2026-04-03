import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyTrackerSharedState,
  bindAppTabs,
  bindResultTabs,
  bindTurnTracker,
  buildTrackerExportPayload,
  createPartySocketConnection,
  generateTrackerRoomCode,
  describeSetupVariant,
  getLayoutDefinition,
  getTrackerSharedState,
  initializeApp,
  parseTrackerImportPayload,
  renderBoardPreview,
  renderHyperlaneGlyph,
  renderResult,
  renderTurnTracker,
  resolvePartyKitHost,
  rotationTransform,
  type TrackerSocketLike,
  type AppDependencies,
  type BoardTile,
  type LayoutFile,
} from "../src/app";
import type { BuildGameResult, Mode } from "../src/deckBuilder";

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

class FakeTrackerSocket implements TrackerSocketLike {
  listeners = new Map<
    string,
    Array<(event: Event | MessageEvent<string>) => void>
  >();

  sent: string[] = [];

  closed = false;

  addEventListener(
    type: string,
    listener: (event: Event | MessageEvent<string>) => void,
  ) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  close() {
    this.closed = true;
    this.emit("close", new Event("close"));
  }

  send(message: string) {
    this.sent.push(message);
  }

  emit(type: string, event: Event | MessageEvent<string>) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

beforeEach(() => {
  document.body.innerHTML = "";
  window.history.replaceState({}, "", window.location.pathname);
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
    expect(html).toContain("Shared Room");
    expect(html).toContain("Tracker Introduction");
    expect(html).toContain('class="tracker-accordion" open');
    expect(html).toContain('id="tracker-room-code"');
    expect(html).toContain('id="tracker-expansion"');
    expect(html).toContain('id="tracker-player-count"');
    expect(html).toContain("Faction Setup");
    expect(html).toContain('id="tracker-speaker"');
    expect(html).toContain("Import / Export");
    expect(html).toContain('id="tracker-transfer-json"');
    expect(html).toContain("Select race");
    expect(html).toContain("Strategy Board");
    expect(html).toContain("Naalu Token");
    expect(html).toContain("Leadership");
    expect(html).toContain("Imperial");
    expect(html).toContain("Unassigned Factions");
  });

  it("serializes and reapplies shared tracker state", () => {
    const state = {
      expansion: "pok" as Mode,
      playerCount: 3,
      selectedFactions: [
        "The Federation of Sol",
        "",
        "The Naalu Collective",
      ] as string[],
      assignments: {
        "The Federation of Sol": { slot: 1, passed: false },
      },
      draggingFaction: null,
      speakerSeat: 2,
    };
    const snapshot = getTrackerSharedState(state);
    expect(snapshot.playerCount).toBe(3);

    const target = {
      expansion: "base" as Mode,
      playerCount: 6,
      selectedFactions: ["", "", "", "", "", ""],
      assignments: {} as Record<string, { slot: number; passed: boolean }>,
      draggingFaction: null,
      speakerSeat: 0,
    };
    applyTrackerSharedState(target, snapshot);
    expect(target.expansion).toBe("pok");
    expect(target.speakerSeat).toBe(2);
    expect(target.assignments["The Federation of Sol"]?.slot).toBe(1);

    applyTrackerSharedState(target, {
      expansion: "base",
      playerCount: 3,
      selectedFactions: ["The Federation of Sol"],
      assignments: {},
      speakerSeat: 0,
    });
    expect(target.selectedFactions).toEqual(["The Federation of Sol", "", ""]);
  });

  it("builds and parses export payloads", () => {
    const payload = buildTrackerExportPayload({
      expansion: "pok",
      playerCount: 3,
      selectedFactions: ["The Federation of Sol", "The Arborec", ""],
      assignments: { "The Federation of Sol": { slot: 1, passed: true } },
      draggingFaction: null,
      speakerSeat: 1,
    });
    expect(payload.version).toBe(1);
    expect(parseTrackerImportPayload(JSON.stringify(payload)).speakerSeat).toBe(
      1,
    );
    expect(
      parseTrackerImportPayload(
        JSON.stringify({
          expansion: "base",
          playerCount: 3,
          selectedFactions: ["The Federation of Sol", "", ""],
          assignments: {},
          speakerSeat: 0,
        }),
      ).expansion,
    ).toBe("base");
  });

  it("exposes default room helpers", () => {
    expect(generateTrackerRoomCode()).toHaveLength(8);
    expect(resolvePartyKitHost()).toBe("localhost:1999");
  });

  it("falls back to Math.random when crypto.randomUUID is unavailable", () => {
    const originalCrypto = globalThis.crypto;
    const mathSpy = vi.spyOn(Math, "random").mockReturnValue(0.123456789);
    Object.defineProperty(globalThis, "crypto", {
      value: {},
      configurable: true,
    });

    expect(generateTrackerRoomCode()).toHaveLength(8);

    Object.defineProperty(globalThis, "crypto", {
      value: originalCrypto,
      configurable: true,
    });
    mathSpy.mockRestore();
  });

  it("creates a PartySocket connection using the configured host", async () => {
    const PartySocketMock = vi.fn().mockImplementation((options) => options);
    vi.doMock("partysocket", () => ({
      default: PartySocketMock,
    }));
    vi.stubEnv("VITE_PARTYKIT_HOST", "example.partykit.dev");

    const socket = await createPartySocketConnection("room42");

    expect(PartySocketMock).toHaveBeenCalledWith({
      host: "example.partykit.dev",
      room: "room42",
    });
    expect(socket).toEqual({
      host: "example.partykit.dev",
      room: "room42",
    });

    vi.unstubAllEnvs();
    vi.doUnmock("partysocket");
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

  it("gracefully skips app tab binding when no tabs are present", () => {
    expect(() => bindAppTabs(document.createElement("div"))).not.toThrow();
  });

  it("binds turn tracker controls", () => {
    const host = document.createElement("div");
    host.innerHTML = renderTurnTracker(4);
    bindTurnTracker(host);

    const playerCount = host.querySelector<HTMLSelectElement>(
      "#tracker-player-count",
    );
    const expansion =
      host.querySelector<HTMLSelectElement>("#tracker-expansion");
    const firstFaction = host.querySelector<HTMLSelectElement>(
      '[data-faction-index="0"]',
    );

    expect(firstFaction?.textContent).toContain("The Arborec");
    firstFaction!.value = "The Federation of Sol";
    firstFaction!.dispatchEvent(new Event("change", { bubbles: true }));

    const secondFaction = host.querySelector<HTMLSelectElement>(
      '[data-faction-index="1"]',
    );
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

    const trackerTabs =
      host.querySelectorAll<HTMLButtonElement>(".tracker-tab");
    trackerTabs[1].click();
    expect(trackerTabs[1].classList.contains("is-active")).toBe(true);
    expect(
      host.querySelector<HTMLElement>('[data-tracker-tab-panel="factions"]')
        ?.hidden,
    ).toBe(true);
  });

  it("auto-switches to the strategy tab on small screens once factions are fully selected", () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      value: 480,
      configurable: true,
    });

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
      )!;
      select.value = faction;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }

    const strategyTab = Array.from(
      host.querySelectorAll<HTMLButtonElement>(".tracker-tab"),
    ).find((button) => button.dataset.trackerTabTarget === "strategy");
    expect(strategyTab?.classList.contains("is-active")).toBe(true);
    expect(
      host.querySelector<HTMLElement>('[data-tracker-tab-panel="strategy"]')
        ?.hidden,
    ).toBe(false);

    Object.defineProperty(window, "innerWidth", {
      value: originalInnerWidth,
      configurable: true,
    });
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

    const speaker = host.querySelector<HTMLSelectElement>("#tracker-speaker");
    speaker!.value = "1";
    speaker!.dispatchEvent(new Event("change", { bubbles: true }));

    const poolChipsBefore = Array.from(
      host.querySelectorAll<HTMLElement>("#tracker-pool .tracker-chip"),
    );
    expect(poolChipsBefore[0]?.dataset.factionName).toBe("The Arborec");
    expect(poolChipsBefore[0]?.classList.contains("is-speaker")).toBe(true);

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
    dragToSlot("The Federation of Sol", 1);

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

    const occupiedValidDrop = new Event("drop", { bubbles: true }) as Event & {
      dataTransfer: ReturnType<typeof makeDataTransfer>;
    };
    occupiedValidDrop.dataTransfer = invalidDrag.dataTransfer;
    host
      .querySelector<HTMLElement>('.strategy-lane-active[data-drop-slot="1"]')!
      .dispatchEvent(occupiedValidDrop);
    expect(
      host.querySelector(
        '.strategy-lane-active[data-drop-slot="1"] [data-faction-name="The Federation of Sol"]',
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
    expect(host.querySelectorAll("#tracker-pool .tracker-chip")).toHaveLength(
      3,
    );
    const poolChipsAfter = Array.from(
      host.querySelectorAll<HTMLElement>("#tracker-pool .tracker-chip"),
    );
    expect(poolChipsAfter.map((chip) => chip.dataset.factionName)).toEqual([
      "The Arborec",
      "The Naalu Collective",
      "The Federation of Sol",
    ]);
    expect(poolChipsAfter[0]?.classList.contains("is-speaker")).toBe(true);
    expect(host.textContent).toContain("Drop faction here");
  });

  it("joins a shared room and applies remote snapshots", async () => {
    const host = document.createElement("div");
    host.innerHTML = renderTurnTracker(3);
    const socket = new FakeTrackerSocket();
    const socketFactory = vi.fn(async () => socket);
    bindTurnTracker(host, socketFactory);

    const roomCode = host.querySelector<HTMLInputElement>("#tracker-room-code");
    roomCode!.value = "table42";
    host
      .querySelector<HTMLButtonElement>("#tracker-join-room")!
      .dispatchEvent(new Event("click", { bubbles: true }));

    await Promise.resolve();
    expect(socketFactory).toHaveBeenCalledWith("table42");

    socket.emit("open", new Event("open"));
    expect(socket.sent[0]).toContain('"type":"hello"');

    socket.emit(
      "message",
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "snapshot",
          state: {
            expansion: "pok",
            playerCount: 3,
            selectedFactions: [
              "The Federation of Sol",
              "The Arborec",
              "The Naalu Collective",
            ],
            assignments: {
              "The Federation of Sol": { slot: 1, passed: false },
            },
            speakerSeat: 1,
          },
        }),
      }),
    );
    socket.emit(
      "message",
      new MessageEvent("message", {
        data: JSON.stringify({ type: "presence", connections: 3 }),
      }),
    );

    expect(host.textContent).toContain("Shared room TABLE42");
    expect(host.textContent).toContain("3 connected");
    expect(
      host.querySelector<HTMLSelectElement>('[data-faction-index="0"]')?.value,
    ).toBe("The Federation of Sol");
    expect(
      host.querySelector(
        '.strategy-lane-active[data-drop-slot="1"] [data-faction-name="The Federation of Sol"]',
      ),
    ).not.toBeNull();
    expect(
      host.querySelector("#tracker-pool .tracker-chip.is-speaker"),
    ).not.toBeNull();
  });

  it("handles shared room create, copy, leave, and local updates", async () => {
    const host = document.createElement("div");
    host.innerHTML = renderTurnTracker(3);
    const socket = new FakeTrackerSocket();
    const socketFactory = vi.fn(async () => socket);
    const clipboardWriteText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: clipboardWriteText,
      },
      configurable: true,
    });
    const randomUuidSpy = vi
      .spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValue("f00dbabe-0000-0000-0000-000000000000");

    bindTurnTracker(host, socketFactory);

    host
      .querySelector<HTMLButtonElement>("#tracker-create-room")!
      .dispatchEvent(new Event("click", { bubbles: true }));
    await Promise.resolve();

    expect(socketFactory).toHaveBeenCalledWith("f00dbabe");
    socket.emit("open", new Event("open"));
    expect(host.textContent).toContain("Shared room F00DBABE");

    const firstFaction = host.querySelector<HTMLSelectElement>(
      '[data-faction-index="0"]',
    )!;
    firstFaction.value = "The Federation of Sol";
    firstFaction.dispatchEvent(new Event("change", { bubbles: true }));
    expect(socket.sent.at(-1)).toContain('"type":"replace_state"');

    const dragEvent = new Event("dragstart", { bubbles: true }) as Event & {
      dataTransfer: ReturnType<typeof makeDataTransfer>;
    };
    dragEvent.dataTransfer = makeDataTransfer();
    host
      .querySelector<HTMLElement>(
        '#tracker-pool .tracker-chip[data-faction-name="The Federation of Sol"]',
      )!
      .dispatchEvent(dragEvent);
    host
      .querySelector<HTMLElement>(
        '#tracker-pool .tracker-chip[data-faction-name="The Federation of Sol"]',
      )!
      .dispatchEvent(new Event("dragend", { bubbles: true }));
    const dropEvent = new Event("drop", { bubbles: true }) as Event & {
      dataTransfer: ReturnType<typeof makeDataTransfer>;
    };
    dropEvent.dataTransfer = dragEvent.dataTransfer;
    host
      .querySelector<HTMLElement>('.strategy-lane-active[data-drop-slot="1"]')!
      .dispatchEvent(dropEvent);

    firstFaction.value = "The Arborec";
    firstFaction.dispatchEvent(new Event("change", { bubbles: true }));
    expect(
      host.querySelector(
        '.strategy-lane-active[data-drop-slot="1"] [data-faction-name="The Federation of Sol"]',
      ),
    ).toBeNull();

    host
      .querySelector<HTMLButtonElement>("#tracker-copy-room")!
      .dispatchEvent(new Event("click", { bubbles: true }));
    await Promise.resolve();
    expect(clipboardWriteText).toHaveBeenCalledWith(
      expect.stringContaining("trackerRoom=f00dbabe"),
    );
    expect(host.textContent).toContain("Invite link copied");

    host
      .querySelector<HTMLButtonElement>("#tracker-leave-room")!
      .dispatchEvent(new Event("click", { bubbles: true }));
    expect(socket.closed).toBe(true);
    expect(host.textContent).toContain("Local only");
    expect(
      host.querySelector<HTMLInputElement>("#tracker-room-code")?.value,
    ).toBe("");

    socket.emit("open", new Event("open"));
    expect(host.textContent).toContain("Shared room");

    randomUuidSpy.mockRestore();
  });

  it("reports join, socket, copy, and import errors", async () => {
    const host = document.createElement("div");
    host.innerHTML = renderTurnTracker(3);
    const socket = new FakeTrackerSocket();
    const socketFactory = vi
      .fn()
      .mockResolvedValueOnce(socket)
      .mockRejectedValueOnce(new Error("factory failed"));
    bindTurnTracker(host, socketFactory);

    host
      .querySelector<HTMLButtonElement>("#tracker-join-room")!
      .dispatchEvent(new Event("click", { bubbles: true }));
    expect(host.textContent).toContain("Enter a room code first");

    const roomCode =
      host.querySelector<HTMLInputElement>("#tracker-room-code")!;
    roomCode.value = "err42";
    host
      .querySelector<HTMLButtonElement>("#tracker-join-room")!
      .dispatchEvent(new Event("click", { bubbles: true }));
    await Promise.resolve();
    socket.emit("error", new Event("error"));
    expect(host.textContent).toContain("Unable to connect");
    socket.emit("close", new Event("close"));
    expect(host.textContent).toContain("Connection issue");

    socket.emit(
      "message",
      new MessageEvent("message", {
        data: JSON.stringify({ type: "error", message: "Server unhappy" }),
      }),
    );
    expect(host.textContent).toContain("Server unhappy");

    roomCode.value = "err43";
    host
      .querySelector<HTMLButtonElement>("#tracker-join-room")!
      .dispatchEvent(new Event("click", { bubbles: true }));
    await Promise.resolve();
    expect(host.textContent).toContain("factory failed");

    roomCode.value = "err44";
    socketFactory.mockRejectedValueOnce("plain factory failure");
    host
      .querySelector<HTMLButtonElement>("#tracker-join-room")!
      .dispatchEvent(new Event("click", { bubbles: true }));
    await Promise.resolve();
    expect(host.textContent).toContain("plain factory failure");

    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
    host
      .querySelector<HTMLButtonElement>("#tracker-copy-room")!
      .dispatchEvent(new Event("click", { bubbles: true }));
    expect(host.textContent).toContain("Join a room before copying");

    host
      .querySelector<HTMLButtonElement>("#tracker-import-state")!
      .dispatchEvent(new Event("click", { bubbles: true }));
    await Promise.resolve();
    expect(host.textContent).toContain(
      "Paste exported tracker JSON before importing.",
    );

    const transferField = host.querySelector<HTMLTextAreaElement>(
      "#tracker-transfer-json",
    )!;
    transferField.value = "{ bad json";
    host
      .querySelector<HTMLButtonElement>("#tracker-import-state")!
      .dispatchEvent(new Event("click", { bubbles: true }));
    await Promise.resolve();
    expect(host.textContent).toContain("Import failed");

    const parseSpy = vi.spyOn(JSON, "parse").mockImplementation(() => {
      throw "plain failure";
    });
    transferField.value = '{"ignored":true}';
    host
      .querySelector<HTMLButtonElement>("#tracker-import-state")!
      .dispatchEvent(new Event("click", { bubbles: true }));
    await Promise.resolve();
    expect(host.textContent).toContain("Import failed: plain failure");
    parseSpy.mockRestore();
  });

  it("auto-joins from the trackerRoom query param", async () => {
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}?trackerRoom=autojoin`,
    );
    const host = document.createElement("div");
    host.innerHTML = renderTurnTracker(3);
    const socket = new FakeTrackerSocket();
    const socketFactory = vi.fn(async () => socket);

    bindTurnTracker(host, socketFactory);
    await Promise.resolve();

    expect(socketFactory).toHaveBeenCalledWith("autojoin");
    socket.emit("open", new Event("open"));
    expect(host.textContent).toContain("Shared room AUTOJOIN");
  });

  it("exports and reimports tracker state into a fresh shared room", async () => {
    const host = document.createElement("div");
    host.innerHTML = renderTurnTracker(3);
    const sockets: FakeTrackerSocket[] = [];
    const socketFactory = vi.fn(async () => {
      const socket = new FakeTrackerSocket();
      sockets.push(socket);
      return socket;
    });
    bindTurnTracker(host, socketFactory);

    const selects = [
      "The Federation of Sol",
      "The Arborec",
      "The Naalu Collective",
    ];
    for (const [index, faction] of selects.entries()) {
      const select = host.querySelector<HTMLSelectElement>(
        `[data-faction-index="${index}"]`,
      );
      select!.value = faction;
      select!.dispatchEvent(new Event("change", { bubbles: true }));
    }
    host.querySelector<HTMLSelectElement>("#tracker-speaker")!.value = "2";
    host
      .querySelector<HTMLSelectElement>("#tracker-speaker")!
      .dispatchEvent(new Event("change", { bubbles: true }));

    host
      .querySelector<HTMLButtonElement>("#tracker-export-state")!
      .dispatchEvent(new Event("click", { bubbles: true }));
    const transferField = host.querySelector<HTMLTextAreaElement>(
      "#tracker-transfer-json",
    )!;
    expect(transferField.value).toContain('"version": 1');
    expect(transferField.value).toContain("The Naalu Collective");

    const randomUuidSpy = vi
      .spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValue("abcd1234-0000-0000-0000-000000000000");

    host
      .querySelector<HTMLButtonElement>("#tracker-import-state")!
      .dispatchEvent(new Event("click", { bubbles: true }));

    await Promise.resolve();
    await Promise.resolve();
    expect(socketFactory).toHaveBeenCalledWith("abcd1234");
    sockets[0].emit("open", new Event("open"));
    await Promise.resolve();
    expect(host.textContent).toContain(
      "Tracker state imported and shared as room ABCD1234.",
    );
    expect(
      host.querySelector<HTMLSelectElement>('[data-faction-index="2"]')?.value,
    ).toBe("The Naalu Collective");
    expect(
      host.querySelector<HTMLInputElement>("#tracker-room-code")?.value,
    ).toBe("abcd1234");
    randomUuidSpy.mockRestore();
  });

  it("imports locally when a fresh room code cannot be generated", async () => {
    const host = document.createElement("div");
    host.innerHTML = renderTurnTracker(3);
    bindTurnTracker(host, vi.fn());

    const transferField = host.querySelector<HTMLTextAreaElement>(
      "#tracker-transfer-json",
    )!;
    transferField.value = JSON.stringify({
      version: 1,
      tracker: {
        expansion: "base",
        playerCount: 3,
        selectedFactions: ["The Federation of Sol", "", ""],
        assignments: {},
        speakerSeat: 0,
      },
    });

    const randomUuidSpy = vi
      .spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValue(
        "        -0000-0000-0000-000000000000" as unknown as `${string}-${string}-${string}-${string}-${string}`,
      );
    host
      .querySelector<HTMLButtonElement>("#tracker-import-state")!
      .dispatchEvent(new Event("click", { bubbles: true }));
    await Promise.resolve();
    expect(host.textContent).toContain("Tracker state imported locally.");
    randomUuidSpy.mockRestore();
  });

  it("handles speaker fallback, drag hover states, and invalid drops", () => {
    const host = document.createElement("div");
    host.innerHTML = renderTurnTracker(3);
    bindTurnTracker(host);

    const expansion =
      host.querySelector<HTMLSelectElement>("#tracker-expansion")!;
    expansion.value = "pok";
    expansion.dispatchEvent(new Event("change", { bubbles: true }));

    const firstFaction = host.querySelector<HTMLSelectElement>(
      '[data-faction-index="0"]',
    )!;
    firstFaction.value = "The Nomad";
    firstFaction.dispatchEvent(new Event("change", { bubbles: true }));
    expansion.value = "base";
    expansion.dispatchEvent(new Event("change", { bubbles: true }));
    expect(
      host.querySelector<HTMLSelectElement>('[data-faction-index="0"]')?.value,
    ).toBe("");

    const secondFaction = host.querySelector<HTMLSelectElement>(
      '[data-faction-index="1"]',
    )!;
    secondFaction.value = "The Arborec";
    secondFaction.dispatchEvent(new Event("change", { bubbles: true }));
    const speaker = host.querySelector<HTMLSelectElement>("#tracker-speaker")!;
    speaker.value = "2";
    speaker.dispatchEvent(new Event("change", { bubbles: true }));
    expect(speaker.value).toBe("1");

    const dropTarget = host.querySelector<HTMLElement>(
      '.strategy-lane-active[data-drop-slot="1"]',
    )!;
    const dragOver = new Event("dragover", { bubbles: true }) as Event & {
      dataTransfer: ReturnType<typeof makeDataTransfer>;
    };
    dragOver.dataTransfer = makeDataTransfer();
    dropTarget.dispatchEvent(dragOver);
    expect(dropTarget.classList.contains("is-over")).toBe(true);
    dropTarget.dispatchEvent(new Event("dragleave", { bubbles: true }));
    expect(dropTarget.classList.contains("is-over")).toBe(false);

    const emptyDrop = new Event("drop", { bubbles: true }) as Event & {
      dataTransfer: ReturnType<typeof makeDataTransfer>;
    };
    emptyDrop.dataTransfer = makeDataTransfer();
    dropTarget.dispatchEvent(emptyDrop);
    expect(
      host.querySelector(
        '.strategy-lane-active[data-drop-slot="1"] .tracker-chip',
      ),
    ).toBeNull();
  });

  it("renders configured short faction names inside tracker chips", () => {
    const host = document.createElement("div");
    host.innerHTML = renderTurnTracker(3);
    bindTurnTracker(host);

    const firstFaction = host.querySelector<HTMLSelectElement>(
      '[data-faction-index="0"]',
    )!;
    firstFaction.value = "The Barony of Letnev";
    firstFaction.dispatchEvent(new Event("change", { bubbles: true }));

    expect(host.innerHTML).toContain("tracker-chip-label-full");
    expect(host.innerHTML).toContain("The Barony of Letnev");
    expect(host.innerHTML).toContain("tracker-chip-label-short");
    expect(host.innerHTML).toContain(">Letnev<");
  });

  it("falls back to the full faction name when no short name is configured", async () => {
    const host = document.createElement("div");
    host.innerHTML = renderTurnTracker(3);
    const socket = new FakeTrackerSocket();
    bindTurnTracker(
      host,
      vi.fn(async () => socket),
    );

    host.querySelector<HTMLInputElement>("#tracker-room-code")!.value =
      "custom1";
    host
      .querySelector<HTMLButtonElement>("#tracker-join-room")!
      .dispatchEvent(new Event("click", { bubbles: true }));
    await Promise.resolve();
    socket.emit("open", new Event("open"));
    socket.emit(
      "message",
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "snapshot",
          state: {
            expansion: "base",
            playerCount: 3,
            selectedFactions: ["Custom Faction", "", ""],
            assignments: {},
            speakerSeat: 0,
          },
        }),
      }),
    );

    expect(host.innerHTML).toContain(">Custom Faction<");
  });

  it("falls back to the factions tab if a tracker tab button has no target", () => {
    const host = document.createElement("div");
    host.innerHTML = renderTurnTracker(3);
    bindTurnTracker(host);

    const strategyTab = Array.from(
      host.querySelectorAll<HTMLButtonElement>(".tracker-tab"),
    ).find((button) => button.dataset.trackerTabTarget === "strategy")!;
    strategyTab.click();
    expect(
      host.querySelector<HTMLElement>('[data-tracker-tab-panel="strategy"]')
        ?.hidden,
    ).toBe(false);

    const malformedTab =
      host.querySelectorAll<HTMLButtonElement>(".tracker-tab")[0]!;
    delete malformedTab.dataset.trackerTabTarget;
    malformedTab.click();

    expect(
      host.querySelector<HTMLElement>('[data-tracker-tab-panel="factions"]')
        ?.hidden,
    ).toBe(false);
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
