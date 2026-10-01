/**
 * Sizing for the wall snapshot (#45): Excalidraw's export at scale 1, shrunk
 * so its longest side is at most `max` pixels (and never enlarged past 2x for
 * a tiny sketch), plus a blank PNG for a board that was wiped clean.
 */
export interface SnapshotDimensions {
  width: number;
  height: number;
  scale: number;
}

export function snapshotSize(width: number, height: number, max: number): SnapshotDimensions {
  const longest = Math.max(width, height, 1);
  const scale = Math.min(2, max / longest);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

/** A small white PNG: what the wall shows once every stroke is erased. */
export function blankPng(): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 10;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))),
      "image/png",
    ),
  );
}
