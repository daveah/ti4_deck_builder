import type * as Party from "partykit/server";

type TrackerAssignment = {
  slot: number;
  passed: boolean;
};

type TrackerSharedState = {
  expansion: "base" | "pok" | "thunders_edge";
  playerCount: number;
  selectedFactions: string[];
  assignments: Record<string, TrackerAssignment>;
  speakerSeat: number;
};

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

const defaultState: TrackerSharedState = {
  expansion: "base",
  playerCount: 6,
  selectedFactions: ["", "", "", "", "", ""],
  assignments: {},
  speakerSeat: 0,
};

function isTrackerSharedState(value: unknown): value is TrackerSharedState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<TrackerSharedState>;
  return (
    (state.expansion === "base" ||
      state.expansion === "pok" ||
      state.expansion === "thunders_edge") &&
    typeof state.playerCount === "number" &&
    Array.isArray(state.selectedFactions) &&
    !!state.assignments &&
    typeof state.assignments === "object" &&
    typeof state.speakerSeat === "number"
  );
}

export default class TrackerServer implements Party.Server {
  private sharedState: TrackerSharedState = defaultState;

  constructor(readonly room: Party.Room) {}

  onConnect(connection: Party.Connection): void {
    this.broadcastPresence();
    connection.send(
      JSON.stringify({
        type: "snapshot",
        state: this.sharedState,
      } satisfies TrackerServerMessage),
    );
  }

  onClose(): void {
    this.broadcastPresence();
  }

  onMessage(message: string, sender: Party.Connection): void {
    try {
      const parsed = JSON.parse(message) as TrackerClientMessage;
      if (parsed.type === "hello") {
        if (
          parsed.state &&
          isTrackerSharedState(parsed.state) &&
          this.isDefaultState()
        ) {
          this.sharedState = parsed.state;
          this.broadcastSnapshot();
          return;
        }
        sender.send(
          JSON.stringify({
            type: "snapshot",
            state: this.sharedState,
          } satisfies TrackerServerMessage),
        );
        return;
      }

      if (parsed.type === "replace_state" && isTrackerSharedState(parsed.state)) {
        this.sharedState = parsed.state;
        this.broadcastSnapshot();
        return;
      }

      sender.send(
        JSON.stringify({
          type: "error",
          message: "Invalid tracker message.",
        } satisfies TrackerServerMessage),
      );
    } catch {
      sender.send(
        JSON.stringify({
          type: "error",
          message: "Unable to read tracker message.",
        } satisfies TrackerServerMessage),
      );
    }
  }

  private broadcastSnapshot(): void {
    this.room.broadcast(
      JSON.stringify({
        type: "snapshot",
        state: this.sharedState,
      } satisfies TrackerServerMessage),
    );
  }

  private broadcastPresence(): void {
    this.room.broadcast(
      JSON.stringify({
        type: "presence",
        connections: [...this.room.getConnections()].length,
      } satisfies TrackerServerMessage),
    );
  }

  private isDefaultState(): boolean {
    return JSON.stringify(this.sharedState) === JSON.stringify(defaultState);
  }
}
