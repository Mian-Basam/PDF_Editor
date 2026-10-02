"use client";

import { ChevronDown, ChevronUp, RotateCcw, RotateCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { displaySize } from "@/lib/geometry";
import { useEditor } from "@/lib/store";
import type { PageInfo } from "@/lib/types";
import { AnnotationPreview } from "./AnnotationLayer";
import PdfCanvas from "./PdfCanvas";

const THUMB_WIDTH = 120;

const thumbScale = (p: PageInfo) => {
  const { w, h } = displaySize(p);
  return THUMB_WIDTH / Math.max(w, h * 0.75);
};

export function scrollToPage(id: string) {
  document.getElementById(`page-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function Thumbnails() {
  const pages = useEditor((s) => s.pages);
  const { rotatePage, deletePage, movePage } = useEditor.getState();
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);

  return (
    <aside className="w-48 shrink-0 overflow-y-auto border-r border-neutral-200 bg-neutral-50 p-3">
      <ol className="flex flex-col items-center gap-4">
        {pages.map((p, i) => (
          <li
            key={p.id}
            draggable
            onDragStart={(e) => {
              setDragFrom(i);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDropAt(i);
            }}
            onDragLeave={() => setDropAt(null)}
            onDrop={(e) => {
              e.preventDefault();
              if (dragFrom !== null) movePage(dragFrom, i);
              setDragFrom(null);
              setDropAt(null);
            }}
            onDragEnd={() => {
              setDragFrom(null);
              setDropAt(null);
            }}
            className={`group relative flex flex-col items-center gap-1 rounded-md p-1.5 transition ${
              dropAt === i && dragFrom !== i ? "bg-blue-100 ring-2 ring-blue-400" : ""
            } ${dragFrom === i ? "opacity-40" : ""}`}
          >
            <button
              type="button"
              onClick={() => scrollToPage(p.id)}
              className="relative overflow-hidden rounded shadow ring-1 ring-neutral-300 hover:ring-2 hover:ring-blue-500"
              title={`Go to page ${i + 1}`}
            >
              <PdfCanvas page={p} scale={thumbScale(p)} />
              <AnnotationPreview page={p} zoom={thumbScale(p)} />
            </button>
            <span className="text-xs text-neutral-500">{i + 1}</span>

            <div className="absolute right-0 top-0 hidden flex-col gap-0.5 rounded bg-white/95 p-0.5 shadow ring-1 ring-neutral-200 group-hover:flex">
              <ThumbButton title="Rotate left" onClick={() => rotatePage(p.id, -90)}>
                <RotateCcw size={14} />
              </ThumbButton>
              <ThumbButton title="Rotate right" onClick={() => rotatePage(p.id, 90)}>
                <RotateCw size={14} />
              </ThumbButton>
              <ThumbButton title="Move up" disabled={i === 0} onClick={() => movePage(i, i - 1)}>
                <ChevronUp size={14} />
              </ThumbButton>
              <ThumbButton title="Move down" disabled={i === pages.length - 1} onClick={() => movePage(i, i + 1)}>
                <ChevronDown size={14} />
              </ThumbButton>
              <ThumbButton
                title="Delete page"
                danger
                disabled={pages.length <= 1}
                onClick={() => deletePage(p.id)}
              >
                <Trash2 size={14} />
              </ThumbButton>
            </div>
          </li>
        ))}
      </ol>
    </aside>
  );
}

function ThumbButton({
  children,
  danger,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      className={`rounded p-1 text-neutral-600 hover:bg-neutral-100 disabled:opacity-30 ${
        danger ? "hover:text-red-600" : "hover:text-neutral-900"
      }`}
    >
      {children}
    </button>
  );
}
