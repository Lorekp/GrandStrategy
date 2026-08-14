import type {
  GameCommand,
  PlayerId,
  PlayerVisibilityGrid,
  PlayerWorldSnapshot,
  ScenarioDefinition,
} from "../core/model";

export interface InitializeSimulationMessage {
  readonly type: "initialize";
  readonly scenario: ScenarioDefinition;
  readonly viewPlayerId: PlayerId;
}

export interface SetClockMessage {
  readonly type: "set-clock";
  readonly paused: boolean;
  readonly speed: number;
}

export interface SubmitCommandMessage {
  readonly type: "submit-command";
  readonly command: GameCommand;
}

export type SimulationWorkerRequest =
  | InitializeSimulationMessage
  | SetClockMessage
  | SubmitCommandMessage;

export type PlayerWorldFrame = Omit<PlayerWorldSnapshot, "visibility"> & {
  readonly visibilityRevision: number;
};

interface SimulationFrameMessage {
  readonly frame: PlayerWorldFrame;
  /** Sent only when its revision changes; the client retains the last grid. */
  readonly visibility?: PlayerVisibilityGrid;
}

export type SimulationWorkerResponse =
  | (SimulationFrameMessage & { readonly type: "ready" })
  | (SimulationFrameMessage & { readonly type: "snapshot" });
