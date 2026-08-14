import type { Container } from "pixi.js";
import type { TheaterPoint } from "./RegionalTheater";
import { PRESENTATION_CONFIG } from "../config/GameConfig";

const { maximumRelativeZoom: MAXIMUM_RELATIVE_ZOOM, fitMarginPixels } =
  PRESENTATION_CONFIG.camera;

export interface MapBounds {
  readonly width: number;
  readonly height: number;
}

export type CameraPanBoundary = "contain" | "edge-to-center";

export interface CameraState {
  readonly scale: number;
  readonly relativeZoom: number;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export function isPanButton(button: number): boolean {
  return button === 1;
}

export class CameraController {
  private scale = 1;
  private minimumScale = 0.01;
  private dragging = false;
  private previousPointerX = 0;
  private previousPointerY = 0;
  private draggingPointerId: number | undefined;

  public constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly world: Container,
    private readonly mapBounds: MapBounds,
    private readonly onChange: (state: CameraState) => void,
    private readonly canInteract: (clientX: number, clientY: number) => boolean,
    private readonly panBoundary: CameraPanBoundary,
  ) {
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", this.handlePointerDown);
    window.addEventListener("pointermove", this.handlePointerMove);
    window.addEventListener("pointerup", this.handlePointerUp);
    canvas.addEventListener("wheel", this.handleWheel, { passive: false });
    canvas.addEventListener("auxclick", this.handleAuxClick);
    this.fitWorld();
  }

  public fitWorld(): void {
    const bounds = this.canvas.getBoundingClientRect();
    const availableWidth = Math.max(bounds.width - fitMarginPixels, 1);
    const availableHeight = Math.max(bounds.height - fitMarginPixels, 1);
    this.minimumScale = Math.min(
      availableWidth / this.mapBounds.width,
      availableHeight / this.mapBounds.height,
    );
    this.scale = this.minimumScale;
    this.world.scale.set(this.scale);
    this.world.position.set(
      (bounds.width - this.mapBounds.width * this.scale) / 2,
      (bounds.height - this.mapBounds.height * this.scale) / 2,
    );
    this.emitChange();
  }

  public handleResize(): void {
    const previousMinimum = this.minimumScale;
    const bounds = this.canvas.getBoundingClientRect();
    this.minimumScale = Math.min(
      Math.max(bounds.width - 48, 1) / this.mapBounds.width,
      Math.max(bounds.height - 48, 1) / this.mapBounds.height,
    );
    if (this.scale <= previousMinimum * 1.01) {
      this.fitWorld();
      return;
    }
    this.scale = Math.max(this.scale, this.minimumScale);
    this.world.scale.set(this.scale);
    this.clampPosition();
    this.emitChange();
  }

  public toWorldPoint(clientX: number, clientY: number): TheaterPoint {
    const bounds = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - bounds.left - this.world.position.x) / this.scale,
      y: (clientY - bounds.top - this.world.position.y) / this.scale,
    };
  }

  public destroy(): void {
    this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
    window.removeEventListener("pointermove", this.handlePointerMove);
    window.removeEventListener("pointerup", this.handlePointerUp);
    this.canvas.removeEventListener("wheel", this.handleWheel);
    this.canvas.removeEventListener("auxclick", this.handleAuxClick);
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (
      !this.canInteract(event.clientX, event.clientY) ||
      !isPanButton(event.button) ||
      this.draggingPointerId !== undefined
    ) {
      return;
    }
    if (event.button === 1) {
      event.preventDefault();
    }
    this.dragging = true;
    this.draggingPointerId = event.pointerId;
    this.previousPointerX = event.clientX;
    this.previousPointerY = event.clientY;
    this.canvas.setPointerCapture(event.pointerId);
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (!this.dragging || event.pointerId !== this.draggingPointerId) {
      return;
    }
    const deltaX = event.clientX - this.previousPointerX;
    const deltaY = event.clientY - this.previousPointerY;
    this.previousPointerX = event.clientX;
    this.previousPointerY = event.clientY;
    this.world.position.x += deltaX;
    this.world.position.y += deltaY;
    this.clampPosition();
    this.emitChange();
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (!this.dragging || event.pointerId !== this.draggingPointerId) {
      return;
    }
    this.dragging = false;
    this.draggingPointerId = undefined;
    if (this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
  };

  private readonly handleAuxClick = (event: MouseEvent): void => {
    if (event.button === 1) {
      event.preventDefault();
    }
  };

  private readonly handleWheel = (event: WheelEvent): void => {
    if (!this.canInteract(event.clientX, event.clientY)) {
      return;
    }
    event.preventDefault();
    const bounds = this.canvas.getBoundingClientRect();
    const pointerX = event.clientX - bounds.left;
    const pointerY = event.clientY - bounds.top;
    const worldX = (pointerX - this.world.position.x) / this.scale;
    const worldY = (pointerY - this.world.position.y) / this.scale;

    const maximumScale = this.minimumScale * MAXIMUM_RELATIVE_ZOOM;
    const zoomFactor = Math.exp(-event.deltaY * 0.0015);
    this.scale = Math.min(
      maximumScale,
      Math.max(this.minimumScale, this.scale * zoomFactor),
    );
    this.world.scale.set(this.scale);
    this.world.position.set(
      pointerX - worldX * this.scale,
      pointerY - worldY * this.scale,
    );
    this.clampPosition();
    this.emitChange();
  };

  private clampPosition(): void {
    const bounds = this.canvas.getBoundingClientRect();
    const scaledWidth = this.mapBounds.width * this.scale;
    const scaledHeight = this.mapBounds.height * this.scale;

    if (this.panBoundary === "edge-to-center") {
      this.world.position.x = Math.min(
        bounds.width / 2,
        Math.max(bounds.width / 2 - scaledWidth, this.world.position.x),
      );
      this.world.position.y = Math.min(
        bounds.height / 2,
        Math.max(bounds.height / 2 - scaledHeight, this.world.position.y),
      );
      return;
    }

    this.world.position.x =
      scaledWidth <= bounds.width
        ? (bounds.width - scaledWidth) / 2
        : Math.min(0, Math.max(bounds.width - scaledWidth, this.world.position.x));
    this.world.position.y =
      scaledHeight <= bounds.height
        ? (bounds.height - scaledHeight) / 2
        : Math.min(0, Math.max(bounds.height - scaledHeight, this.world.position.y));
  }

  private emitChange(): void {
    const bounds = this.canvas.getBoundingClientRect();
    this.onChange({
      scale: this.scale,
      relativeZoom: this.scale / this.minimumScale,
      left: -this.world.position.x / this.scale,
      top: -this.world.position.y / this.scale,
      right: (bounds.width - this.world.position.x) / this.scale,
      bottom: (bounds.height - this.world.position.y) / this.scale,
    });
  }
}
