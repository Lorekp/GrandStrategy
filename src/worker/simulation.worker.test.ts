import { afterEach, describe, expect, it, vi } from "vitest";

const step = vi.fn();

vi.mock("../core/GameSimulation", () => ({
  GameSimulation: class {
    public tick = 0;

    public step(input: unknown): void {
      step(input);
      this.tick += 1;
    }

    public playerSnapshot() {
      return {
        seed: 1,
        tick: this.tick,
        viewerPlayerId: 1,
        tribes: [],
        settlements: [],
        units: [],
        relations: [],
        visibility: {
          width: 1,
          height: 1,
          revision: 0,
          visibleCells: new Uint32Array(1),
          exploredCells: new Uint32Array(1),
        },
      };
    }
  },
}));

function message(data: unknown): Event {
  const event = new Event("message");
  Object.defineProperty(event, "data", { value: data });
  return event;
}

describe("simulation worker clock boundary", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
    step.mockReset();
  });

  it("queues commands without advancing a paused simulation", async () => {
    vi.useFakeTimers();
    const workerContext = new EventTarget() as EventTarget & {
      postMessage: ReturnType<typeof vi.fn>;
    };
    workerContext.postMessage = vi.fn();
    vi.stubGlobal("self", workerContext);
    await import("./simulation.worker");

    workerContext.dispatchEvent(
      message({ type: "initialize", scenario: {}, viewPlayerId: 1 }),
    );
    workerContext.dispatchEvent(
      message({ type: "set-clock", paused: true, speed: 1 }),
    );
    workerContext.dispatchEvent(
      message({
        type: "submit-command",
        command: {
          kind: "move-unit",
          playerId: 1,
          sequence: 1,
          unitId: 1,
          destination: { longitudeE6: 0, latitudeE6: 0 },
          mode: "replace",
        },
      }),
    );

    expect(step).not.toHaveBeenCalled();
  });

  it("coalesces paused Scout orders to the latest destination", async () => {
    vi.useFakeTimers();
    const workerContext = new EventTarget() as EventTarget & {
      postMessage: ReturnType<typeof vi.fn>;
    };
    workerContext.postMessage = vi.fn();
    vi.stubGlobal("self", workerContext);
    await import("./simulation.worker");

    workerContext.dispatchEvent(
      message({ type: "initialize", scenario: {}, viewPlayerId: 1 }),
    );
    workerContext.dispatchEvent(
      message({ type: "set-clock", paused: true, speed: 1 }),
    );
    for (let sequence = 1; sequence <= 10; sequence += 1) {
      workerContext.dispatchEvent(
        message({
          type: "submit-command",
          command: {
            kind: "move-unit",
            playerId: 1,
            sequence,
            unitId: 1,
            destination: { longitudeE6: sequence, latitudeE6: 0 },
            mode: "replace",
          },
        }),
      );
    }
    workerContext.dispatchEvent(
      message({ type: "set-clock", paused: false, speed: 1 }),
    );
    vi.advanceTimersByTime(120);

    expect(step).toHaveBeenCalledTimes(1);
    const tickInput = step.mock.calls[0]?.[0] as {
      commands: Array<{ destination: { longitudeE6: number } }>;
    };
    expect(tickInput.commands).toHaveLength(1);
    expect(tickInput.commands[0]?.destination.longitudeE6).toBe(10);
  });

  it("preserves appended waypoints after the latest replacement order", async () => {
    vi.useFakeTimers();
    const workerContext = new EventTarget() as EventTarget & {
      postMessage: ReturnType<typeof vi.fn>;
    };
    workerContext.postMessage = vi.fn();
    vi.stubGlobal("self", workerContext);
    await import("./simulation.worker");

    workerContext.dispatchEvent(
      message({ type: "initialize", scenario: {}, viewPlayerId: 1 }),
    );
    for (const command of [
      { kind: "move-unit", playerId: 1, sequence: 1, unitId: 1, destination: { longitudeE6: 1, latitudeE6: 0 }, mode: "replace" },
      { kind: "move-unit", playerId: 1, sequence: 2, unitId: 1, destination: { longitudeE6: 2, latitudeE6: 0 }, mode: "replace" },
      { kind: "move-unit", playerId: 1, sequence: 3, unitId: 1, destination: { longitudeE6: 3, latitudeE6: 0 }, mode: "append" },
      { kind: "move-unit", playerId: 1, sequence: 4, unitId: 1, destination: { longitudeE6: 4, latitudeE6: 0 }, mode: "append" },
    ]) {
      workerContext.dispatchEvent(message({ type: "submit-command", command }));
    }
    workerContext.dispatchEvent(
      message({ type: "set-clock", paused: false, speed: 1 }),
    );
    vi.advanceTimersByTime(120);

    const tickInput = step.mock.calls[0]?.[0] as {
      commands: Array<{ destination: { longitudeE6: number }; mode: string }>;
    };
    expect(tickInput.commands.map((command) => [
      command.mode,
      command.destination.longitudeE6,
    ])).toEqual([
      ["replace", 2],
      ["append", 3],
      ["append", 4],
    ]);
  });
});
