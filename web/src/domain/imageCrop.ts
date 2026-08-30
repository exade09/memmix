export async function fileToSquarePng(file: File, size = 1024): Promise<Blob> {
  if (file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg")) {
    throw new Error("SVG images are not accepted.");
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error("Image is too large. Maximum is 5 MB.");
  }
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  if (side < 128) {
    bitmap.close();
    throw new Error("Image is too small. Use at least 128×128.");
  }
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("Could not crop that image.");
  }
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Could not crop that image.");
  return blob;
}
