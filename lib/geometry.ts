import type { Annotation, FontFamily, PageInfo, TextAnnot } from "./types";

export const LINE_HEIGHT = 1.2;

/** CSS font stacks; the first entry is available on macOS and Windows. */
export const FONT_STACK: Record<FontFamily, string> = {
  Helvetica: "Arial, Helvetica, sans-serif",
  Times: "'Times New Roman', Times, serif",
  Courier: "'Courier New', Courier, monospace",
};

/**
 * Distance from the top of a line box to its baseline, as a fraction of the
 * font size, for a CSS line-height of 1.2. Used for SVG display and export so
 * the text lands in the same place in the editor, the text box and the PDF.
 */
export const BASELINE: Record<FontFamily, number> = {
  Helvetica: 0.947,
  Times: 0.938,
  Courier: 0.867,
};

export function normRotation(deg: number) {
  return ((deg % 360) + 360) % 360;
}

export function totalRotation(p: PageInfo) {
  return normRotation(p.baseRotation + p.rotation);
}

export function pageSize(p: PageInfo) {
  return { w: p.view[2] - p.view[0], h: p.view[3] - p.view[1] };
}

export function displaySize(p: PageInfo) {
  const { w, h } = pageSize(p);
  return totalRotation(p) % 180 ? { w: h, h: w } : { w, h };
}

/** SVG matrix mapping unrotated page coords to displayed (rotated) coords. */
export function rotationMatrix(rotation: number, w: number, h: number) {
  switch (normRotation(rotation)) {
    case 90:
      return `matrix(0 1 -1 0 ${h} 0)`;
    case 180:
      return `matrix(-1 0 0 -1 ${w} ${h})`;
    case 270:
      return `matrix(0 -1 1 0 0 ${w})`;
    default:
      return "";
  }
}

/** Maps a point in an annotation's local (rotated) frame to page coords. */
export function localToPage(x: number, y: number, rot: number, lx: number, ly: number) {
  const t = (-rot * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return { x: x + lx * c - ly * s, y: y + lx * s + ly * c };
}

/** Inverse of localToPage. */
export function pageToLocal(x: number, y: number, rot: number, px: number, py: number) {
  const t = (-rot * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const dx = px - x;
  const dy = py - y;
  return { x: dx * c + dy * s, y: -dx * s + dy * c };
}

let measureCtx: CanvasRenderingContext2D | null = null;

type FontSpec = Pick<TextAnnot, "size" | "font" | "bold" | "italic">;

export function cssFont(a: FontSpec) {
  return `${a.italic ? "italic " : ""}${a.bold ? "bold " : ""}${a.size}px ${FONT_STACK[a.font]}`;
}

/** Size of a text annotation's box in its local frame. */
export function measureText(a: FontSpec & Pick<TextAnnot, "text">) {
  const lines = a.text.split("\n");
  let width = 0;
  if (typeof document !== "undefined") {
    measureCtx ??= document.createElement("canvas").getContext("2d");
    if (measureCtx) {
      measureCtx.font = cssFont(a);
      for (const line of lines) width = Math.max(width, measureCtx.measureText(line).width);
    }
  }
  return { w: width, h: lines.length * a.size * LINE_HEIGHT };
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Bounding box in page coords for annotations without their own rotation. */
export function annotBox(a: Annotation): Box {
  switch (a.type) {
    case "line": {
      const pad = a.width / 2;
      return {
        x: Math.min(a.x1, a.x2) - pad,
        y: Math.min(a.y1, a.y2) - pad,
        w: Math.abs(a.x2 - a.x1) + pad * 2,
        h: Math.abs(a.y2 - a.y1) + pad * 2,
      };
    }
    case "ink": {
      const xs = a.points.map((p) => p[0]);
      const ys = a.points.map((p) => p[1]);
      const pad = a.width / 2;
      const x = Math.min(...xs) - pad;
      const y = Math.min(...ys) - pad;
      return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y };
    }
    case "text":
      return { x: a.x, y: a.y, ...measureText(a) };
    default:
      return { x: a.x, y: a.y, w: a.w, h: a.h };
  }
}

export function translateAnnot<T extends Annotation>(a: T, dx: number, dy: number): T {
  switch (a.type) {
    case "line":
      return { ...a, x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy };
    case "ink":
      return { ...a, points: a.points.map(([x, y]) => [x + dx, y + dy]) };
    default:
      return { ...a, x: a.x + dx, y: a.y + dy };
  }
}

export function inkPath(points: [number, number][]) {
  if (points.length === 0) return "";
  const [first, ...rest] = points;
  const fmt = (n: number) => Math.round(n * 100) / 100;
  let d = `M${fmt(first[0])} ${fmt(first[1])}`;
  // A single click still draws a dot.
  if (rest.length === 0) d += ` L${fmt(first[0] + 0.01)} ${fmt(first[1])}`;
  for (const [x, y] of rest) d += ` L${fmt(x)} ${fmt(y)}`;
  return d;
}
