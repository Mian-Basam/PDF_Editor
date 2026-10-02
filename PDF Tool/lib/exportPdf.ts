import type { PDFDocument, PDFFont, PDFImage, PDFPage } from "pdf-lib";
import { BASELINE, LINE_HEIGHT, inkPath, localToPage, totalRotation } from "./geometry";
import type { Annotation, FontFamily, PageInfo, Source } from "./types";

type PdfLib = typeof import("pdf-lib");

function hexToRgb(lib: PdfLib, hex: string) {
  const n = parseInt(hex.replace("#", ""), 16);
  return lib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function dataUrlBytes(url: string) {
  const bin = atob(url.slice(url.indexOf(",") + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Standard PDF fonts only cover WinAnsi; replace anything else with "?". */
function encodable(font: PDFFont, text: string) {
  let out = "";
  for (const ch of text) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += "?";
    }
  }
  return out;
}

export async function exportPdf(
  pages: PageInfo[],
  annots: Record<string, Annotation[]>,
  sources: Record<string, Source>,
): Promise<Uint8Array> {
  const lib = await import("pdf-lib");
  const { PDFDocument, StandardFonts, degrees, BlendMode, LineCapStyle } = lib;
  const out = await PDFDocument.create();

  // Copy pages per source in one call so shared resources are copied once.
  const copied = new Map<string, PDFPage>();
  const bySource = new Map<string, PageInfo[]>();
  for (const p of pages) bySource.set(p.srcId, [...(bySource.get(p.srcId) ?? []), p]);
  for (const [srcId, list] of bySource) {
    const src: PDFDocument = await PDFDocument.load(sources[srcId].bytes, { ignoreEncryption: true });
    const result = await out.copyPages(src, list.map((p) => p.srcIndex));
    list.forEach((p, i) => copied.set(p.id, result[i]));
  }

  // [regular, bold, italic, bold italic]
  const fontNames: Record<FontFamily, string[]> = {
    Helvetica: [
      StandardFonts.Helvetica,
      StandardFonts.HelveticaBold,
      StandardFonts.HelveticaOblique,
      StandardFonts.HelveticaBoldOblique,
    ],
    Times: [
      StandardFonts.TimesRoman,
      StandardFonts.TimesRomanBold,
      StandardFonts.TimesRomanItalic,
      StandardFonts.TimesRomanBoldItalic,
    ],
    Courier: [StandardFonts.Courier, StandardFonts.CourierBold, StandardFonts.CourierOblique, StandardFonts.CourierBoldOblique],
  };
  const fonts = new Map<string, PDFFont>();
  const getFont = async (family: FontFamily, bold: boolean, italic = false) => {
    const name = fontNames[family][(bold ? 1 : 0) + (italic ? 2 : 0)];
    if (!fonts.has(name)) fonts.set(name, await out.embedFont(name));
    return fonts.get(name)!;
  };
  const images = new Map<string, PDFImage>();
  const getImage = async (src: string) => {
    if (!images.has(src)) {
      const bytes = dataUrlBytes(src);
      images.set(src, src.startsWith("data:image/png") ? await out.embedPng(bytes) : await out.embedJpg(bytes));
    }
    return images.get(src)!;
  };

  for (const info of pages) {
    const page = copied.get(info.id)!;
    out.addPage(page);
    page.setRotation(degrees(totalRotation(info)));

    const list = annots[info.id] ?? [];
    if (!list.length) continue;

    // Isolate the original content's graphics state so ours starts clean.
    page.translateContent(0, 0);

    const [x0, , , y1] = info.view;
    const X = (x: number) => x0 + x;
    const Y = (y: number) => y1 - y;

    for (const a of list) {
      switch (a.type) {
        case "text": {
          const font = await getFont(a.font, a.bold, a.italic);
          const lines = a.text.split("\n");
          for (let i = 0; i < lines.length; i++) {
            const p = localToPage(a.x, a.y, a.rot, 0, a.size * (BASELINE[a.font] + i * LINE_HEIGHT));
            page.drawText(encodable(font, lines[i]), {
              x: X(p.x),
              y: Y(p.y),
              size: a.size,
              font,
              color: hexToRgb(lib, a.color),
              rotate: degrees(a.rot),
            });
          }
          break;
        }
        case "image": {
          const p = localToPage(a.x, a.y, a.rot, 0, a.h);
          page.drawImage(await getImage(a.src), {
            x: X(p.x),
            y: Y(p.y),
            width: a.w,
            height: a.h,
            rotate: degrees(a.rot),
          });
          break;
        }
        case "rect":
        case "whiteout":
        case "highlight": {
          const base = { x: X(a.x), y: Y(a.y + a.h), width: a.w, height: a.h };
          if (a.type === "whiteout") {
            page.drawRectangle({ ...base, color: hexToRgb(lib, a.color) });
          } else if (a.type === "highlight") {
            page.drawRectangle({
              ...base,
              color: hexToRgb(lib, a.color),
              opacity: 0.4,
              blendMode: BlendMode.Multiply,
            });
          } else {
            page.drawRectangle({
              ...base,
              borderColor: hexToRgb(lib, a.color),
              borderWidth: a.width,
              ...(a.fill ? { color: hexToRgb(lib, a.color), opacity: 0.25 } : {}),
            });
          }
          break;
        }
        case "ellipse":
          page.drawEllipse({
            x: X(a.x + a.w / 2),
            y: Y(a.y + a.h / 2),
            xScale: a.w / 2,
            yScale: a.h / 2,
            borderColor: hexToRgb(lib, a.color),
            borderWidth: a.width,
            ...(a.fill ? { color: hexToRgb(lib, a.color), opacity: 0.25 } : {}),
          });
          break;
        case "line":
          page.drawLine({
            start: { x: X(a.x1), y: Y(a.y1) },
            end: { x: X(a.x2), y: Y(a.y2) },
            thickness: a.width,
            color: hexToRgb(lib, a.color),
            lineCap: LineCapStyle.Round,
          });
          break;
        case "ink":
          // drawSvgPath uses SVG (y-down) coordinates from the given origin.
          page.drawSvgPath(inkPath(a.points), {
            x: x0,
            y: y1,
            borderColor: hexToRgb(lib, a.color),
            borderWidth: a.width,
            borderLineCap: LineCapStyle.Round,
          });
          break;
      }
    }
  }

  return out.save();
}
