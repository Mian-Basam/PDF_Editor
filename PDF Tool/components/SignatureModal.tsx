"use client";

import { useEffect, useRef, useState } from "react";
import type { PendingImage } from "@/lib/types";

interface Props {
  color: string;
  onClose: () => void;
  onDone: (img: PendingImage) => void;
}

const W = 560;
const H = 200;

/** Crops a canvas to its non-transparent pixels and returns it as PNG. */
function trimmed(canvas: HTMLCanvasElement): PendingImage | null {
  const ctx = canvas.getContext("2d")!;
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const pad = 4;
  const out = document.createElement("canvas");
  out.width = maxX - minX + 1 + pad * 2;
  out.height = maxY - minY + 1 + pad * 2;
  out.getContext("2d")!.drawImage(canvas, minX - pad, minY - pad, out.width, out.height, 0, 0, out.width, out.height);
  const dpr = canvas.width / W;
  return { src: out.toDataURL("image/png"), width: out.width / dpr, height: out.height / dpr };
}

export default function SignatureModal({ color, onClose, onDone }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 2.5;
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pos = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const clear = () => {
    const c = canvasRef.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setEmpty(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onPointerDown={onClose}>
      <div className="w-full max-w-[600px] rounded-xl bg-white p-5 shadow-xl" onPointerDown={(e) => e.stopPropagation()}>
        <h2 className="mb-1 text-lg font-semibold">Draw your signature</h2>
        <p className="mb-3 text-sm text-neutral-500">Then click on a page to place it.</p>
        <canvas
          ref={canvasRef}
          className="w-full touch-none rounded-lg border border-dashed border-neutral-300 bg-neutral-50"
          style={{ aspectRatio: `${W} / ${H}`, cursor: "crosshair" }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            last.current = pos(e);
            const ctx = canvasRef.current!.getContext("2d")!;
            ctx.strokeStyle = color;
            ctx.beginPath();
            ctx.arc(last.current.x * (W / e.currentTarget.clientWidth), last.current.y * (W / e.currentTarget.clientWidth), 1.2, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
            setEmpty(false);
          }}
          onPointerMove={(e) => {
            if (!last.current) return;
            const p = pos(e);
            const k = W / e.currentTarget.clientWidth;
            const ctx = canvasRef.current!.getContext("2d")!;
            ctx.beginPath();
            ctx.moveTo(last.current.x * k, last.current.y * k);
            ctx.lineTo(p.x * k, p.y * k);
            ctx.stroke();
            last.current = p;
          }}
          onPointerUp={() => (last.current = null)}
        />
        <div className="mt-4 flex justify-between gap-2">
          <button type="button" onClick={clear} className="rounded-md px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100">
            Clear
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm hover:bg-neutral-100">
              Cancel
            </button>
            <button
              type="button"
              disabled={empty}
              onClick={() => {
                const img = trimmed(canvasRef.current!);
                if (img) onDone(img);
              }}
              className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
            >
              Use signature
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
