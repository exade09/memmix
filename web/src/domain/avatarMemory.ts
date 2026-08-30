let memoryBlob: Blob | null = null;
let memoryUrl = "";

export function setMemoryAvatar(blob: Blob | null): string {
  if (memoryUrl) URL.revokeObjectURL(memoryUrl);
  memoryBlob = blob;
  memoryUrl = blob ? URL.createObjectURL(blob) : "";
  return memoryUrl;
}

export function getMemoryAvatar(): { blob: Blob | null; url: string } {
  return { blob: memoryBlob, url: memoryUrl };
}

export function hasMemoryAvatar(): boolean {
  return Boolean(memoryBlob);
}
