/// <reference lib="webworker" />

import { TICK_DURATION_MS } from "../core/constants";
import { GameSimulation } from "../core/GameSimulation";
import type { GameCommand, PlayerId } from "../core/model";
import type {
  SimulationWorkerRequest,
  SimulationWorkerResponse,
} from "./protocol";

const context: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope;

let simulation: GameSimulation | undefined;
let viewPlayerId: PlayerId | undefined;
let paused = true;
let speed = 1;
let lastPumpTime = performance.now();
let accumulatedTime = 0;
const commandQueue: GameCommand[] = [];
let lastVisibilityRevision = -1;

function enqueueCommand(command: GameCommand): void {
  if (command.kind === "move-unit" && command.mode === "replace") {
    for (let index = commandQueue.length - 1; index >= 0; index -= 1) {
      const queued = commandQueue[index];
      if (
        queued?.kind === "move-unit" &&
        queued.playerId === command.playerId &&
        queued.unitId === command.unitId
      ) {
        commandQueue.splice(index, 1);
      }
    }
  }
  if (command.kind === "select-research") {
    for (let index = commandQueue.length - 1; index >= 0; index -= 1) {
      const queued = commandQueue[index];
      if (
        queued?.kind === "select-research" &&
        queued.playerId === command.playerId &&
        queued.tribeId === command.tribeId
      ) {
        commandQueue.splice(index, 1);
      }
    }
  }
  commandQueue.push(command);
}

function post(message: SimulationWorkerResponse): void {
  context.postMessage(message);
}

function postSnapshot(type: "ready" | "snapshot"): void {
  if (!simulation || viewPlayerId === undefined) {
    throw new Error("Simulation view player is not initialized");
  }
  const view = simulation.playerSnapshot(viewPlayerId);
  const { visibility, ...snapshot } = view;
  const includeVisibility =
    type === "ready" || visibility.revision !== lastVisibilityRevision;
  lastVisibilityRevision = visibility.revision;
  post({
    type,
    frame: { ...snapshot, visibilityRevision: visibility.revision },
    ...(includeVisibility ? { visibility } : {}),
  });
}

function pump(): void {
  const now = performance.now();
  const elapsed = Math.min(now - lastPumpTime, 250);
  lastPumpTime = now;

  if (!simulation || paused) {
    accumulatedTime = 0;
    return;
  }

  accumulatedTime += elapsed * speed;
  let steps = 0;

  // The cap prevents an inactive browser from monopolizing a core while catching up.
  // An authoritative multiplayer server will own catch-up policy for online games.
  while (accumulatedTime >= TICK_DURATION_MS && steps < 20) {
    simulation.step({
      tick: simulation.tick,
      commands: commandQueue.splice(0),
    });
    accumulatedTime -= TICK_DURATION_MS;
    steps += 1;
  }

  if (steps > 0) {
    postSnapshot("snapshot");
  }
}

context.addEventListener("message", (event: MessageEvent<SimulationWorkerRequest>) => {
  const message = event.data;
  switch (message.type) {
    case "initialize":
      simulation = new GameSimulation(message.scenario);
      viewPlayerId = message.viewPlayerId;
      accumulatedTime = 0;
      lastPumpTime = performance.now();
      lastVisibilityRevision = -1;
      postSnapshot("ready");
      return;
    case "set-clock":
      paused = message.paused;
      speed = message.speed;
      accumulatedTime = 0;
      lastPumpTime = performance.now();
      return;
    case "submit-command":
      enqueueCommand(message.command);
      return;
  }
});

setInterval(pump, 16);
