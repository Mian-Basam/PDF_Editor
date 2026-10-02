import type { PDFDocumentProxy } from "pdfjs-dist";

export type FontFamily = "Helvetica" | "Times" | "Courier";

export type Tool =
  | "select"
  | "edittext"
  | "text"
  | "draw"
  | "highlight"
  | "rect"
  | "ellipse"
  | "line"
  | "whiteout"
  | "image";

/** A loaded PDF file. Pages from several sources can be mixed (merge). */
export interface Source {
  id: string;
  name: string;
  /** Original bytes, used by pdf-lib on export. */
  bytes: Uint8Array;
  /** pdf.js document, used for rendering. */
  doc: PDFDocumentProxy;
}

export interface PageInfo {
  id: string;
  srcId: string;
  /** 0-based page index inside the source document. */
  srcIndex: number;
  /** pdf.js page.view: [x0, y0, x1, y1] in PDF user space. */
  view: [number, number, number, number];
  /** /Rotate already set in the source PDF. */
  baseRotation: number;
  /** Extra rotation applied in the editor (multiple of 90). */
  rotation: number;
}

interface Base {
  id: string;
}

/*
 * All annotation coordinates are in PDF points, relative to the page's
 * unrotated top-left corner, with y pointing down.
 */

export interface TextAnnot extends Base {
  type: "text";
  x: number;
  y: number;
  /** Counter-rotation so text added on a rotated page reads upright. */
  rot: number;
  text: string;
  size: number;
  color: string;
  font: FontFamily;
  bold: boolean;
  italic?: boolean;
  /** Set when this replaces a line of the PDF's own text (see textLines.ts). */
  origin?: string;
}

export interface ImageAnnot extends Base {
  type: "image";
  x: number;
  y: number;
  rot: number;
  w: number;
  h: number;
  /** PNG or JPEG data URL. */
  src: string;
}

export interface BoxAnnot extends Base {
  type: "rect" | "ellipse" | "highlight" | "whiteout";
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  width: number;
  fill: boolean;
  /** Set on the cover box hiding a line of original text that was edited. */
  origin?: string;
}

export interface LineAnnot extends Base {
  type: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
}

export interface InkAnnot extends Base {
  type: "ink";
  points: [number, number][];
  color: string;
  width: number;
}

export type Annotation = TextAnnot | ImageAnnot | BoxAnnot | LineAnnot | InkAnnot;

export interface Style {
  color: string;
  highlightColor: string;
  strokeWidth: number;
  fontSize: number;
  font: FontFamily;
  bold: boolean;
  italic: boolean;
  fill: boolean;
}

export interface PendingImage {
  src: string;
  width: number;
  height: number;
}
