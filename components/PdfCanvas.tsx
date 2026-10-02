"use client";

import type { RenderTask } from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";
import { displaySize, totalRotation } from "@/lib/geometry";
import { useEditor } from "@/lib/store";
import type { PageInfo } from "@/lib/types";

interface Props {
  page: PageInfo;
  /** CSS pixels per PDF point. */
  scale: number;
  id?: string;
}

/** Renders one PDF page with pdf.js, lazily once it scrolls near the viewport. */
export default function PdfCanvas({ page, scale, id }: Props) {
  const source = useEditor((s) => s.sources[page.srcId]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const taskRef = useRef<RenderTask | null>(null);
  const [visible, setVisible] = useState(false);
  const rotation = totalRotation(page);
  const { w, h } = displaySize(page);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "800px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !source) return;
    let cancelled = false;

    (async () => {
      // A canvas can only run one render at a time; wait for the previous one.
      const prev = taskRef.current;
      prev?.cancel();
      await prev?.promise.catch(() => {});
      if (cancelled) return;

      const pdfPage = await source.doc.getPage(page.srcIndex + 1);
      const canvas = canvasRef.current;
      if (cancelled || !canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const viewport = pdfPage.getViewport({ scale: scale * dpr, rotation });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const task = pdfPage.render({ canvasContext: canvas.getContext("2d")!, viewport });
      taskRef.current = task;
      await task.promise.catch(() => {});
    })();

    return () => {
      cancelled = true;
      taskRef.current?.cancel();
    };
  }, [visible, source, page.srcIndex, scale, rotation]);

  return (
    <canvas
      ref={canvasRef}
      id={id}
      className="block bg-white"
      style={{ width: w * scale, height: h * scale }}
    />
  );
}
