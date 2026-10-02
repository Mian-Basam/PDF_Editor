import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import { measureText } from "./geometry";
import type { FontFamily, PageInfo } from "./types";

/** A line of the PDF's own text, in unrotated top-left page coordinates. */
export interface TextLine {
  key: string;
  text: string;
  x: number;
  baseline: number;
  /** Top of the line box (baseline minus ascent). */
  top: number;
  w: number;
  h: number;
  size: number;
  fontName: string;
  /** Fallback family reported by pdf.js: "serif", "sans-serif" or "monospace". */
  fontFamily: string;
}

interface PageText {
  pdfPage: PDFPageProxy;
  lines: TextLine[];
}

const cache = new Map<string, Promise<PageText>>();

export function getTextLines(page: PageInfo, doc: PDFDocumentProxy): Promise<PageText> {
  const key = `${page.srcId}:${page.srcIndex}`;
  let entry = cache.get(key);
  if (!entry) {
    entry = extract(page, doc);
    cache.set(key, entry);
    entry.catch(() => cache.delete(key));
  }
  return entry;
}

interface Building extends Omit<TextLine, "key" | "top" | "h"> {
  ascent: number;
  descent: number;
  pendingSpace: boolean;
}

async function extract(page: PageInfo, doc: PDFDocumentProxy): Promise<PageText> {
  const pdfPage = await doc.getPage(page.srcIndex + 1);
  const content = await pdfPage.getTextContent();
  // Runs in different styles (e.g. a bold label then regular text) stay
  // separate so each keeps its own font when edited.
  const styleKeys = new Map<string, string>();
  const styleKey = (fontName: string) => {
    if (!styleKeys.has(fontName)) {
      const info = fontInfo(pdfPage, fontName);
      styleKeys.set(fontName, info.name ? `${info.family}|${info.bold}|${info.italic}` : fontName);
    }
    return styleKeys.get(fontName)!;
  };
  const [x0, , , y1] = page.view;
  const built: Building[] = [];
  let cur: Building | null = null;

  for (const raw of content.items) {
    if (!("str" in raw)) continue;
    const item = raw as TextItem;
    const [a, b, c, d, e, f] = item.transform as number[];

    // Only horizontal, upright text can be edited.
    if (Math.abs(b) > 1e-3 || Math.abs(c) > 1e-3 || a <= 0 || d <= 0) {
      cur = null;
      continue;
    }
    if (!item.str.trim()) {
      if (cur) cur.pendingSpace = true;
      if (item.hasEOL) cur = null;
      continue;
    }

    const size = d;
    const x = e - x0;
    const baseline = y1 - f;
    const style = content.styles[item.fontName];

    if (
      cur &&
      Math.abs(cur.baseline - baseline) < size * 0.3 &&
      Math.abs(cur.size - size) < size * 0.3 &&
      styleKey(cur.fontName) === styleKey(item.fontName)
    ) {
      const gap = x - (cur.x + cur.w);
      if (gap > -size * 0.5 && gap < size * 2) {
        const space =
          cur.pendingSpace || (gap > size * 0.15 && !cur.text.endsWith(" ") && !item.str.startsWith(" "));
        cur.text += (space ? " " : "") + item.str;
        cur.w = Math.max(cur.w, x + item.width - cur.x);
        cur.pendingSpace = false;
        if (item.hasEOL) cur = null;
        continue;
      }
    }

    cur = {
      text: item.str,
      x,
      baseline,
      w: item.width,
      size,
      fontName: item.fontName,
      fontFamily: style?.fontFamily ?? "sans-serif",
      ascent: style?.ascent || 0.8,
      descent: Math.abs(style?.descent || -0.2),
      pendingSpace: false,
    };
    built.push(cur);
    if (item.hasEOL) cur = null;
  }

  const lines = built.map(({ ascent, descent, pendingSpace, ...l }, i) => {
    void pendingSpace;
    // Cover descenders generously; reported metrics are often too tight.
    const top = l.baseline - l.size * Math.max(ascent, 0.75);
    const bottom = l.baseline + l.size * Math.max(descent, 0.22);
    return { ...l, text: l.text.trim(), key: `line:${i}`, top, h: bottom - top };
  });
  return { pdfPage, lines };
}

const MONO = /courier|mono|consol|menlo|typewriter|cmtt|lmtt|inconsolata|code|fixed/;
const SANS =
  /sans|arial|helvetica|verdana|calibri|segoe|roboto|inter|nimbussan|arimo|lato|frutiger|myriad|futura|gill|tahoma|trebuchet|avenir|montserrat|poppins|cmss|lmss|univers|franklin|century ?gothic|aptos/;
const SERIF =
  /times|serif|roman|georgia|garamond|cambria|minion|book|nimbusrom|tinos|palatino|palladio|baskerville|caslon|utopia|charter|libertine|century|bodoni|didot|sabon|merriweather|lora|playfair|^cm[a-z]*\d|^lm/;
const BOLD = /bold|black|heavy|semibold|demi|-medi|medium|cmbx|lmbx|bd$/;
const ITALIC = /italic|oblique|ital|cmti|cmsl|lmti|-it$|-i$/;

/** Classifies an embedded font from its name and flags (once pdf.js has loaded it). */
function fontInfo(pdfPage: PDFPageProxy, fontName: string) {
  let name = "";
  let flagBold = false;
  let flagItalic = false;
  try {
    if (pdfPage.commonObjs.has(fontName)) {
      const f = pdfPage.commonObjs.get(fontName) as {
        name?: string;
        bold?: boolean;
        black?: boolean;
        italic?: boolean;
      };
      // Drop the subset prefix, e.g. "ABCDEF+Arial-BoldMT".
      name = (f.name ?? "").replace(/^[A-Z]{6}\+/, "").toLowerCase();
      flagBold = !!(f.bold || f.black);
      flagItalic = !!f.italic;
    }
  } catch {
    // Font not loaded yet.
  }
  let family: FontFamily | null = null;
  if (MONO.test(name)) family = "Courier";
  else if (SANS.test(name)) family = "Helvetica";
  else if (SERIF.test(name)) family = "Times";
  return { name, family, bold: flagBold || BOLD.test(name), italic: flagItalic || ITALIC.test(name) };
}

/**
 * Picks the closest standard font. The embedded font's name is the best
 * clue; when it gives none, compares the line's width in each candidate.
 */
export function matchFont(
  line: TextLine,
  pdfPage: PDFPageProxy,
): { font: FontFamily; bold: boolean; italic: boolean } {
  const { family, bold, italic } = fontInfo(pdfPage, line.fontName);
  return { font: family ?? closestByWidth(line, bold, italic), bold, italic };
}

function closestByWidth(line: TextLine, bold: boolean, italic: boolean): FontFamily {
  const families: FontFamily[] = ["Helvetica", "Times", "Courier"];
  let best: FontFamily = line.fontFamily === "monospace" ? "Courier" : "Helvetica";
  let bestDiff = Infinity;
  if (line.w <= 0 || line.text.length < 4) return best;
  for (const font of families) {
    const { w } = measureText({ text: line.text, size: line.size, font, bold, italic });
    const diff = Math.abs(w - line.w);
    if (w > 0 && diff < bestDiff) {
      bestDiff = diff;
      best = font;
    }
  }
  return best;
}

/**
 * Reads the rendered canvas to find the background colour around a box and
 * the text colour inside it. `box` is in canvas pixels.
 */
export function sampleColors(
  canvas: HTMLCanvasElement | null,
  box: { x: number; y: number; w: number; h: number },
): { bg: string; fg: string } {
  const fallback = { bg: "#ffffff", fg: "#000000" };
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx || !canvas.width) return fallback;

  const pad = 3;
  const x = Math.max(0, Math.floor(box.x) - pad);
  const y = Math.max(0, Math.floor(box.y) - pad);
  const w = Math.min(canvas.width - x, Math.ceil(box.w) + pad * 2);
  const h = Math.min(canvas.height - y, Math.ceil(box.h) + pad * 2);
  if (w <= 0 || h <= 0) return fallback;
  const data = ctx.getImageData(x, y, w, h).data;
  const px = (i: number, j: number) => {
    const o = (j * w + i) * 4;
    return [data[o], data[o + 1], data[o + 2]] as const;
  };

  // Background: most common colour on the border ring.
  const counts = new Map<number, { n: number; rgb: readonly number[] }>();
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (i >= pad && i < w - pad && j >= pad && j < h - pad) continue;
      const rgb = px(i, j);
      const k = ((rgb[0] >> 3) << 10) | ((rgb[1] >> 3) << 5) | (rgb[2] >> 3);
      const entry = counts.get(k);
      if (entry) entry.n++;
      else counts.set(k, { n: 1, rgb });
    }
  }
  let bg: readonly number[] = [255, 255, 255];
  let best = 0;
  for (const { n, rgb } of counts.values()) {
    if (n > best) {
      best = n;
      bg = rgb;
    }
  }

  // Text: the inner pixel furthest from the background.
  let fg: readonly number[] = [0, 0, 0];
  let far = 0;
  for (let j = pad; j < h - pad; j++) {
    for (let i = pad; i < w - pad; i++) {
      const rgb = px(i, j);
      const dist = Math.abs(rgb[0] - bg[0]) + Math.abs(rgb[1] - bg[1]) + Math.abs(rgb[2] - bg[2]);
      if (dist > far) {
        far = dist;
        fg = rgb;
      }
    }
  }
  const hex = (c: readonly number[]) => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  return { bg: hex(bg), fg: far > 60 ? hex(fg) : "#000000" };
}
