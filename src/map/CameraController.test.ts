import { Container } from "pixi.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CameraController } from "./CameraController";

class TestCanvas extends EventTarget {
  public readonly style = { touchAction: "" };
  private readonly capturedPointers = new Set<number>();

  public getBoundingClientRect(): DOMRect {
    return {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      toJSON: () => ({}),
    };
  }

  public setPointerCapture(pointerId: number): void {
    this.capturedPointers.add(pointerId);
  }

  public hasPointerCapture(pointerId: number): boolean {
    return this.capturedPointers.has(pointerId);
  }

  public releasePointerCapture(pointerId: number): void {
    this.capturedPointers.delete(pointerId);
  }
}

describe("regional theater camera panning", () => {
  let originalWindow: typeof globalThis.window | undefined;
  let testWindow: EventTarget;

  beforeEach(() => {
    originalWindow = globalThis.window;
    testWindow = new EventTarget();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: testWindow,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  });

  it("allows a theater edge to move past the viewport edge", () => {
    const canvas = new TestCanvas();
    const world = new Container();
    const camera = new CameraController(
      canvas as unknown as HTMLCanvasElement,
      world,
      { width: 400, height: 400 },
      () => undefined,
      () => true,
      "edge-to-center",
    );

    canvas.dispatchEvent(
      Object.assign(new Event("wheel"), {
        clientX: 400,
        clientY: 300,
        deltaY: -1_000,
      }),
    );
    canvas.dispatchEvent(
      Object.assign(new Event("pointerdown"), {
        button: 1,
        pointerId: 7,
        clientX: 400,
        clientY: 300,
      }),
    );
    testWindow.dispatchEvent(
      Object.assign(new Event("pointermove"), {
        pointerId: 7,
        clientX: 5_000,
        clientY: 300,
      }),
    );

    expect(world.position.x).toBe(400);
    camera.destroy();
  });

  it("keeps a contained atlas inside the viewport", () => {
    const canvas = new TestCanvas();
    const world = new Container();
    const camera = new CameraController(
      canvas as unknown as HTMLCanvasElement,
      world,
      { width: 400, height: 400 },
      () => undefined,
      () => true,
      "contain",
    );

    canvas.dispatchEvent(
      Object.assign(new Event("wheel"), {
        clientX: 400,
        clientY: 300,
        deltaY: -1_000,
      }),
    );
    canvas.dispatchEvent(
      Object.assign(new Event("pointerdown"), {
        button: 1,
        pointerId: 8,
        clientX: 400,
        clientY: 300,
      }),
    );
    testWindow.dispatchEvent(
      Object.assign(new Event("pointermove"), {
        pointerId: 8,
        clientX: 5_000,
        clientY: 300,
      }),
    );

    expect(world.position.x).toBe(0);
    camera.destroy();
  });
});
