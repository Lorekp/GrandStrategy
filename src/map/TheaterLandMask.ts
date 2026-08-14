import type { RegionalTheaterManifest, TheaterPoint } from "./RegionalTheater";

export function semanticCellIndex(
  point: TheaterPoint,
  renderWidth: number,
  renderHeight: number,
  semanticWidth: number,
  semanticHeight: number,
): number | undefined {
  if (
    point.x < 0 ||
    point.y < 0 ||
    point.x >= renderWidth ||
    point.y >= renderHeight
  ) {
    return undefined;
  }
  const column = Math.floor((point.x / renderWidth) * semanticWidth);
  const row = Math.floor((point.y / renderHeight) * semanticHeight);
  return row * semanticWidth + column;
}

/** CPU-side semantic lookup used to validate authoritative Site placement input. */
export class TheaterLandMask {
  private constructor(
    private readonly theater: RegionalTheaterManifest,
    private readonly pixels: Uint8ClampedArray,
  ) {}

  public static async load(theater: RegionalTheaterManifest): Promise<TheaterLandMask> {
    const image = new Image();
    image.src = `/maps/theaters/${theater.id}/${theater.semantic.landMaskPath}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = theater.semantic.width;
    canvas.height = theater.semantic.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      throw new Error("Theater land-mask canvas is unavailable");
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return new TheaterLandMask(
      theater,
      context.getImageData(0, 0, canvas.width, canvas.height).data,
    );
  }

  public isLand(point: TheaterPoint): boolean {
    const cell = semanticCellIndex(
      point,
      this.theater.render.width,
      this.theater.render.height,
      this.theater.semantic.width,
      this.theater.semantic.height,
    );
    return cell !== undefined && this.pixels[cell * 4]! >= 128;
  }
}
