import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { Button } from "../ui/Button";

const VIEW = 280;
const OUTPUT = 1024;

type AvatarCropperProps = {
  file: File;
  onConfirm: (blob: Blob) => void;
  onCancel: () => void;
};

export function AvatarCropper({ file, onConfirm, onCancel }: AvatarCropperProps) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [error, setError] = useState("");
  const dragging = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const src = useMemo(() => URL.createObjectURL(file), [file]);
  const confirmRef = useRef<() => void>(() => undefined);

  useEffect(() => () => URL.revokeObjectURL(src), [src]);

  function metrics() {
    const image = imageRef.current;
    if (!image || !image.naturalWidth) return null;
    const cover = Math.max(VIEW / image.naturalWidth, VIEW / image.naturalHeight);
    const drawW = image.naturalWidth * cover * zoom;
    const drawH = image.naturalHeight * cover * zoom;
    return { image, cover, drawW, drawH };
  }

  function clampOffset(next: { x: number; y: number }, nextZoom: number) {
    const image = imageRef.current;
    if (!image || !image.naturalWidth) return next;
    const cover = Math.max(VIEW / image.naturalWidth, VIEW / image.naturalHeight);
    const drawW = image.naturalWidth * cover * nextZoom;
    const drawH = image.naturalHeight * cover * nextZoom;
    const maxX = Math.max(0, (drawW - VIEW) / 2);
    const maxY = Math.max(0, (drawH - VIEW) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, next.x)),
      y: Math.min(maxY, Math.max(-maxY, next.y)),
    };
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    dragging.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    const dx = event.clientX - dragging.current.x;
    const dy = event.clientY - dragging.current.y;
    setOffset(clampOffset({ x: dragging.current.ox + dx, y: dragging.current.oy + dy }, zoom));
  }

  function onPointerUp() {
    dragging.current = null;
  }

  async function confirmCrop() {
    const sized = metrics();
    if (!sized) {
      setError("Could not crop that image.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT;
    canvas.height = OUTPUT;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setError("Could not crop that image.");
      return;
    }
    const left = (VIEW - sized.drawW) / 2 + offset.x;
    const top = (VIEW - sized.drawH) / 2 + offset.y;
    const scale = sized.cover * zoom;
    const sx = (0 - left) / scale;
    const sy = (0 - top) / scale;
    const sw = VIEW / scale;
    const sh = VIEW / scale;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(sized.image, sx, sy, sw, sh, 0, 0, OUTPUT, OUTPUT);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) {
      setError("Could not crop that image.");
      return;
    }
    onConfirm(blob);
  }

  confirmRef.current = () => {
    void confirmCrop();
  };

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
      if (event.key === "Enter") {
        event.preventDefault();
        confirmRef.current();
      }
      const step = 12;
      if (event.key === "ArrowLeft") setOffset((current) => clampOffset({ ...current, x: current.x - step }, zoom));
      if (event.key === "ArrowRight") setOffset((current) => clampOffset({ ...current, x: current.x + step }, zoom));
      if (event.key === "ArrowUp") setOffset((current) => clampOffset({ ...current, y: current.y - step }, zoom));
      if (event.key === "ArrowDown") setOffset((current) => clampOffset({ ...current, y: current.y + step }, zoom));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, zoom]);

  const sized = metrics();
  const left = sized ? (VIEW - sized.drawW) / 2 + offset.x : 0;
  const top = sized ? (VIEW - sized.drawH) / 2 + offset.y : 0;

  return (
    <div className="overlay center" role="dialog" aria-modal="true" aria-labelledby="cropper-title">
      <div className="dialog cropper-card">
        <p className="eyebrow">Crop avatar</p>
        <h2 id="cropper-title">Square crop, zoom only.</h2>
        <div
          className="cropper-viewport"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <img
            ref={imageRef}
            src={src}
            alt=""
            draggable={false}
            onLoad={() => setOffset((current) => clampOffset(current, zoom))}
            style={{
              width: sized ? sized.drawW : "auto",
              height: sized ? sized.drawH : "auto",
              transform: `translate(${left}px, ${top}px)`,
            }}
          />
        </div>
        <label className="field">
          <span>Zoom</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(event) => {
              const next = Number(event.target.value);
              setZoom(next);
              setOffset((current) => clampOffset(current, next));
            }}
          />
        </label>
        {error ? <p className="note error">{error}</p> : null}
        <div className="cropper-actions">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={() => void confirmCrop()}>
            Confirm crop
          </Button>
        </div>
        <p className="metric-label">Output is 1024×1024 PNG. The original file is discarded after confirm.</p>
      </div>
    </div>
  );
}
