import { describe, expect, it } from "vitest";
import { WaterwayIndex } from "./WaterwayIndex";

function geometryFixture(): ArrayBuffer {
  const name = new TextEncoder().encode("Test Creek");
  const buffer = new ArrayBuffer(16 + 22 + name.length + 4 * 4);
  const view = new DataView(buffer);
  for (const [index, character] of [..."GSHY"].entries()) {
    view.setUint8(index, character.charCodeAt(0));
  }
  view.setUint16(4, 1, true);
  view.setUint32(8, 1, true);
  view.setUint32(12, 2, true);
  view.setBigUint64(16, 42n, true);
  view.setUint8(24, 1);
  view.setUint8(25, 2);
  view.setUint8(26, 2);
  view.setFloat32(28, 3.5, true);
  view.setUint32(32, 2, true);
  view.setUint16(36, name.length, true);
  new Uint8Array(buffer, 38, name.length).set(name);
  const pointOffset = 38 + name.length;
  view.setFloat32(pointOffset, -100, true);
  view.setFloat32(pointOffset + 4, 0, true);
  view.setFloat32(pointOffset + 8, 100, true);
  view.setFloat32(pointOffset + 12, 0, true);
  return buffer;
}

describe("WaterwayIndex", () => {
  it("preserves sub-cell stream geometry and finds it spatially", () => {
    const index = WaterwayIndex.decode(geometryFixture());

    expect(index.featureAt(0, 2, 1)).toMatchObject({
      sourceId: 42n,
      riverClass: "minor",
      regime: "intermittent",
      kind: "stream",
      widthMeters: 3.5,
      name: "Test Creek",
    });
    expect(index.featureAt(0, 10, 1)).toBeUndefined();
  });

  it("rejects truncated geometry", () => {
    expect(() => WaterwayIndex.decode(geometryFixture().slice(0, -1))).toThrow(
      /invalid|truncated/,
    );
  });
});
