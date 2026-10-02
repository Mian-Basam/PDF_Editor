"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  BASELINE,
  FONT_STACK,
  cssFont,
  LINE_HEIGHT,
  annotBox,
  displaySize,
  inkPath,
  localToPage,
  measureText,
  pageSize,
  pageToLocal,
  rotationMatrix,
  totalRotation,
  translateAnnot,
} from "@/lib/geometry";
import { newId, useEditor } from "@/lib/store";
import { type TextLine, getTextLines, matchFont, sampleColors } from "@/lib/textLines";
import type { Annotation, BoxAnnot, ImageAnnot, LineAnnot, PageInfo, TextAnnot } from "@/lib/types";

type Pt = { x: number; y: number };

type Drag =
  | { kind: "move"; start: Pt; orig: Annotation; moved: boolean }
  | { kind: "resize"; start: Pt; orig: BoxAnnot | ImageAnnot; moved: boolean }
  | { kind: "endpoint"; which: 1 | 2; orig: LineAnnot; moved: boolean };

type Draft =
  | { kind: "ink"; points: [number, number][] }
  | { kind: BoxAnnot["type"] | "line"; x1: number; y1: number; x2: number; y2: number };

const SELECT_COLOR = "#2563eb";

interface Props {
  page: PageInfo;
  zoom: number;
}

export default function AnnotationLayer({ page, zoom }: Props) {
  const annots = useEditor((s) => s.annots[page.id]);
  const tool = useEditor((s) => s.tool);
  const style = useEditor((s) => s.style);
  const selected = useEditor((s) => s.selected);
  const editingId = useEditor((s) => s.editingId);
  const pendingImage = useEditor((s) => s.pendingImage);
  const source = useEditor((s) => s.sources[page.srcId]);

  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const lastDown = useRef<{ id: string; t: number } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [lines, setLines] = useState<TextLine[]>([]);

  // Load the page's own text lines while the Edit text tool is active.
  useEffect(() => {
    if (tool !== "edittext" || !source) return;
    let alive = true;
    getTextLines(page, source.doc)
      .then(({ lines }) => alive && setLines(lines))
      .catch((err) => console.error("Could not read page text", err));
    return () => {
      alive = false;
    };
  }, [tool, source, page]);

  const rotation = totalRotation(page);
  const { w, h } = pageSize(page);
  const disp = displaySize(page);
  const list = annots ?? [];
  const selectedId = selected?.pageId === page.id ? selected.id : null;

  /** Pointer position in unrotated page coordinates. */
  const toPage = (e: { clientX: number; clientY: number }): Pt => {
    const ctm = gRef.current!.getScreenCTM()!.inverse();
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm);
    return { x: p.x, y: p.y };
  };

  /** Replaces a line of original text with a cover box and an editable copy. */
  const onLineDown = async (e: ReactPointerEvent, line: TextLine) => {
    if (e.button !== 0 || !source) return;
    e.stopPropagation();
    e.preventDefault();
    const s = useEditor.getState();
    s.finishEditing();

    // Sample colours from the rendered canvas under the line.
    const ctm = gRef.current!.getScreenCTM()!;
    const corners = [
      [line.x, line.top],
      [line.x + line.w, line.top + line.h],
      [line.x, line.top + line.h],
      [line.x + line.w, line.top],
    ].map(([x, y]) => new DOMPoint(x, y).matrixTransform(ctm));
    const canvas = document.getElementById(`canvas-${page.id}`) as HTMLCanvasElement | null;
    let colors = { bg: "#ffffff", fg: "#000000" };
    if (canvas) {
      const r = canvas.getBoundingClientRect();
      const k = canvas.width / r.width;
      const xs = corners.map((p) => (p.x - r.left) * k);
      const ys = corners.map((p) => (p.y - r.top) * k);
      colors = sampleColors(canvas, {
        x: Math.min(...xs),
        y: Math.min(...ys),
        w: Math.max(...xs) - Math.min(...xs),
        h: Math.max(...ys) - Math.min(...ys),
      });
    }

    const { pdfPage } = await getTextLines(page, source.doc);
    const { font, bold, italic } = matchFont(line, pdfPage);
    const cover: BoxAnnot = {
      id: newId(),
      type: "whiteout",
      x: line.x - 1,
      y: line.top - 1,
      w: line.w + 2,
      h: line.h + 2,
      color: colors.bg,
      width: 0,
      fill: true,
      origin: line.key,
    };
    const text: TextAnnot = {
      id: newId(),
      type: "text",
      x: line.x,
      y: line.baseline - BASELINE[font] * line.size,
      rot: 0,
      text: line.text,
      size: Math.round(line.size * 10) / 10,
      color: colors.fg,
      font,
      bold,
      italic,
      origin: line.key,
    };
    s.addAnnots(page.id, [cover, text]);
    s.select({ pageId: page.id, id: text.id });
    // Not "new": clearing the text should still delete the original line.
    s.setEditing(text.id);
  };

  const capture = (e: ReactPointerEvent) => svgRef.current?.setPointerCapture(e.pointerId);

  const startEditing = (a: TextAnnot) => {
    const s = useEditor.getState();
    s.finishEditing();
    s.checkpoint();
    s.select({ pageId: page.id, id: a.id });
    s.setEditing(a.id);
  };

  const onBackgroundDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const s = useEditor.getState();
    const wasEditing = !!s.editingId;
    s.finishEditing();
    const pt = toPage(e);

    switch (tool) {
      case "select":
      case "edittext":
        s.select(null);
        return;
      case "text": {
        // The first click outside a text box only ends editing.
        if (wasEditing) return;
        const anchor = localToPage(pt.x, pt.y, rotation, 0, -style.fontSize * 0.6);
        const a: TextAnnot = {
          id: newId(),
          type: "text",
          ...anchor,
          rot: rotation,
          text: "",
          size: style.fontSize,
          color: style.color,
          font: style.font,
          bold: style.bold,
          italic: style.italic,
        };
        s.addAnnot(page.id, a);
        s.select({ pageId: page.id, id: a.id });
        s.setEditing(a.id, true);
        e.preventDefault(); // keep focus on the new text box
        return;
      }
      case "image": {
        if (!pendingImage) return;
        const iw = Math.min(200, pendingImage.width * 0.75, w * 0.8);
        const ih = (iw * pendingImage.height) / pendingImage.width;
        const anchor = localToPage(pt.x, pt.y, rotation, -iw / 2, -ih / 2);
        const a: ImageAnnot = {
          id: newId(),
          type: "image",
          ...anchor,
          rot: rotation,
          w: iw,
          h: ih,
          src: pendingImage.src,
        };
        s.addAnnot(page.id, a);
        s.setTool("select");
        s.select({ pageId: page.id, id: a.id });
        return;
      }
      case "draw":
        setDraft({ kind: "ink", points: [[pt.x, pt.y]] });
        break;
      default:
        setDraft({ kind: tool, x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y });
    }
    capture(e);
  };

  const onAnnotDown = (e: ReactPointerEvent, a: Annotation) => {
    if (e.button !== 0) return;
    if ((tool === "text" || tool === "edittext") && a.type === "text") {
      e.stopPropagation();
      e.preventDefault();
      startEditing(a);
      return;
    }
    if (tool !== "select") return;
    e.stopPropagation();
    if (editingId === a.id) return;

    const now = performance.now();
    const isDouble = lastDown.current?.id === a.id && now - lastDown.current.t < 350;
    lastDown.current = { id: a.id, t: now };
    if (isDouble && a.type === "text") {
      e.preventDefault();
      startEditing(a);
      return;
    }

    const s = useEditor.getState();
    s.finishEditing();
    s.select({ pageId: page.id, id: a.id });
    dragRef.current = { kind: "move", start: toPage(e), orig: a, moved: false };
    capture(e);
  };

  const onHandleDown = (e: ReactPointerEvent, drag: Drag) => {
    e.stopPropagation();
    dragRef.current = drag;
    capture(e);
  };

  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const pt = toPage(e);
    const drag = dragRef.current;
    if (drag) {
      const dx = "start" in drag ? pt.x - drag.start.x : 0;
      const dy = "start" in drag ? pt.y - drag.start.y : 0;
      if (!drag.moved) {
        if (drag.kind === "move" && Math.hypot(dx, dy) * zoom < 3) return;
        useEditor.getState().checkpoint();
        drag.moved = true;
      }
      const { replaceAnnot } = useEditor.getState();
      if (drag.kind === "move") {
        replaceAnnot(page.id, translateAnnot(drag.orig, dx, dy));
      } else if (drag.kind === "resize") {
        const o = drag.orig;
        if (o.type === "image") {
          const local = pageToLocal(o.x, o.y, o.rot, pt.x, pt.y);
          const nw = Math.max(10, local.x);
          replaceAnnot(page.id, { ...o, w: nw, h: (nw * o.h) / o.w });
        } else {
          replaceAnnot(page.id, { ...o, w: Math.max(4, o.w + dx), h: Math.max(4, o.h + dy) });
        }
      } else {
        const o = drag.orig;
        replaceAnnot(
          page.id,
          drag.which === 1 ? { ...o, x1: pt.x, y1: pt.y } : { ...o, x2: pt.x, y2: pt.y },
        );
      }
      return;
    }
    if (!draft) return;
    if (draft.kind === "ink") {
      const last = draft.points[draft.points.length - 1];
      if (Math.hypot(pt.x - last[0], pt.y - last[1]) * zoom < 1.5) return;
      setDraft({ ...draft, points: [...draft.points, [pt.x, pt.y]] });
    } else {
      setDraft({ ...draft, x2: pt.x, y2: pt.y });
    }
  };

  const onUp = () => {
    dragRef.current = null;
    if (!draft) return;
    setDraft(null);
    const s = useEditor.getState();
    const id = newId();

    if (draft.kind === "ink") {
      s.addAnnot(page.id, {
        id,
        type: "ink",
        points: draft.points,
        color: style.color,
        width: style.strokeWidth,
      });
    } else if (draft.kind === "line") {
      if (Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1) < 2) return;
      s.addAnnot(page.id, {
        id,
        type: "line",
        x1: draft.x1,
        y1: draft.y1,
        x2: draft.x2,
        y2: draft.y2,
        color: style.color,
        width: style.strokeWidth,
      });
    } else {
      const box = draftBox(draft);
      if (box.w < 2 || box.h < 2) return;
      s.addAnnot(page.id, {
        id,
        type: draft.kind,
        ...box,
        color:
          draft.kind === "highlight"
            ? style.highlightColor
            : draft.kind === "whiteout"
              ? "#ffffff"
              : style.color,
        width: style.strokeWidth,
        fill: style.fill,
      });
    }
  };

  const interactive = (a: Annotation) =>
    tool === "select" || ((tool === "text" || tool === "edittext") && a.type === "text");

  const edited = new Set(list.map((a) => ("origin" in a ? a.origin : undefined)).filter(Boolean));

  const cursor =
    tool === "select" || tool === "edittext" ? "default" : tool === "text" ? "text" : pendingImage || tool !== "image" ? "crosshair" : "not-allowed";

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 touch-none select-none"
      width={disp.w * zoom}
      height={disp.h * zoom}
      viewBox={`0 0 ${disp.w} ${disp.h}`}
      style={{ cursor }}
      onPointerDown={onBackgroundDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <g ref={gRef} transform={rotationMatrix(rotation, w, h)}>
        <rect width={w} height={h} fill="transparent" />
        {list.map((a) => (
          <g
            key={a.id}
            style={{ pointerEvents: interactive(a) ? "auto" : "none", cursor: tool === "select" ? "move" : undefined }}
            onPointerDown={(e) => onAnnotDown(e, a)}
          >
            <AnnotShape a={a} editing={editingId === a.id} />
          </g>
        ))}
        {tool === "edittext" &&
          lines
            .filter((l) => !edited.has(l.key))
            .map((l) => (
              <rect
                key={l.key}
                x={l.x - 1}
                y={l.top - 1}
                width={l.w + 2}
                height={l.h + 2}
                rx={1.5 / zoom}
                className="cursor-text fill-blue-500/5 stroke-blue-500/60 hover:fill-blue-500/20 hover:stroke-blue-600"
                strokeWidth={1 / zoom}
                onPointerDown={(e) => onLineDown(e, l)}
              >
                <title>Click to edit</title>
              </rect>
            ))}
        {draft && <DraftShape draft={draft} />}
        {list.map((a) =>
          a.id === selectedId && tool === "select" ? (
            <SelectionOverlay key={`sel-${a.id}`} a={a} zoom={zoom} onHandleDown={onHandleDown} />
          ) : null,
        )}
        {list.map((a) =>
          a.id === editingId && a.type === "text" ? (
            <TextEditor key={`edit-${a.id}`} a={a} pageId={page.id} />
          ) : null,
        )}
      </g>
    </svg>
  );
}

function draftBox(d: { x1: number; y1: number; x2: number; y2: number }) {
  return {
    x: Math.min(d.x1, d.x2),
    y: Math.min(d.y1, d.y2),
    w: Math.abs(d.x2 - d.x1),
    h: Math.abs(d.y2 - d.y1),
  };
}

const localTransform = (a: { x: number; y: number; rot: number }) =>
  `translate(${a.x} ${a.y}) rotate(${-a.rot})`;

function TextLines({ a }: { a: TextAnnot }) {
  return (
    <text
      fontFamily={FONT_STACK[a.font]}
      fontSize={a.size}
      fontWeight={a.bold ? "bold" : "normal"}
      fontStyle={a.italic ? "italic" : "normal"}
      fill={a.color}
      xmlSpace="preserve"
    >
      {a.text.split("\n").map((line, i) => (
        <tspan key={i} x={0} y={a.size * (BASELINE[a.font] + i * LINE_HEIGHT)}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

function AnnotShape({ a, editing }: { a: Annotation; editing: boolean }) {
  switch (a.type) {
    case "text": {
      const m = measureText(a);
      return (
        <g transform={localTransform(a)}>
          <rect x={-2} y={0} width={Math.max(m.w, 4) + 4} height={m.h} fill="transparent" />
          {!editing && <TextLines a={a} />}
        </g>
      );
    }
    case "image":
      return (
        <g transform={localTransform(a)}>
          <image href={a.src} width={a.w} height={a.h} preserveAspectRatio="none" />
        </g>
      );
    case "rect":
      return (
        <rect
          x={a.x}
          y={a.y}
          width={a.w}
          height={a.h}
          stroke={a.color}
          strokeWidth={a.width}
          fill={a.fill ? a.color : "transparent"}
          fillOpacity={a.fill ? 0.25 : 0}
        />
      );
    case "ellipse":
      return (
        <ellipse
          cx={a.x + a.w / 2}
          cy={a.y + a.h / 2}
          rx={a.w / 2}
          ry={a.h / 2}
          stroke={a.color}
          strokeWidth={a.width}
          fill={a.fill ? a.color : "transparent"}
          fillOpacity={a.fill ? 0.25 : 0}
        />
      );
    case "highlight":
      return (
        <rect
          x={a.x}
          y={a.y}
          width={a.w}
          height={a.h}
          fill={a.color}
          fillOpacity={0.4}
          style={{ mixBlendMode: "multiply" }}
        />
      );
    case "whiteout":
      return <rect x={a.x} y={a.y} width={a.w} height={a.h} fill={a.color} />;
    case "line":
      return (
        <>
          <line x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} stroke={a.color} strokeWidth={a.width} strokeLinecap="round" />
          <line x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} stroke="transparent" strokeWidth={a.width + 8} />
        </>
      );
    case "ink": {
      const d = inkPath(a.points);
      return (
        <>
          <path d={d} stroke={a.color} strokeWidth={a.width} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <path d={d} stroke="transparent" strokeWidth={a.width + 8} fill="none" strokeLinecap="round" />
        </>
      );
    }
  }
}

function DraftShape({ draft }: { draft: Draft }) {
  const style = useEditor((s) => s.style);
  if (draft.kind === "ink") {
    return (
      <path
        d={inkPath(draft.points)}
        stroke={style.color}
        strokeWidth={style.strokeWidth}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  }
  const preview: Annotation =
    draft.kind === "line"
      ? { id: "draft", type: "line", ...draft, color: style.color, width: style.strokeWidth }
      : {
          id: "draft",
          type: draft.kind,
          ...draftBox(draft),
          color: draft.kind === "highlight" ? style.highlightColor : style.color,
          width: style.strokeWidth,
          fill: style.fill,
        };
  const b = draftBox(draft);
  return (
    <>
      <AnnotShape a={preview} editing={false} />
      {draft.kind === "whiteout" && (
        <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="none" stroke="#9ca3af" strokeDasharray="3" strokeWidth={0.75} />
      )}
    </>
  );
}

function SelectionOverlay({
  a,
  zoom,
  onHandleDown,
}: {
  a: Annotation;
  zoom: number;
  onHandleDown: (e: ReactPointerEvent, drag: Drag) => void;
}) {
  const sw = 1 / zoom;
  const r = 5 / zoom;
  const pad = 3 / zoom;
  const outline = (x: number, y: number, bw: number, bh: number) => (
    <rect
      x={x - pad}
      y={y - pad}
      width={bw + pad * 2}
      height={bh + pad * 2}
      fill="none"
      stroke={SELECT_COLOR}
      strokeWidth={sw}
      strokeDasharray={`${4 * sw} ${3 * sw}`}
      pointerEvents="none"
    />
  );
  const handle = (cx: number, cy: number, drag: Drag, cursor: string) => (
    <circle
      cx={cx}
      cy={cy}
      r={r}
      fill="#fff"
      stroke={SELECT_COLOR}
      strokeWidth={sw * 1.5}
      style={{ cursor }}
      onPointerDown={(e) => onHandleDown(e, drag)}
    />
  );

  if (a.type === "text" || a.type === "image") {
    const size = a.type === "text" ? measureText(a) : { w: a.w, h: a.h };
    return (
      <g transform={localTransform(a)}>
        {outline(0, 0, Math.max(size.w, 4), size.h)}
        {a.type === "image" &&
          handle(a.w, a.h, { kind: "resize", start: { x: 0, y: 0 }, orig: a, moved: false }, "nwse-resize")}
      </g>
    );
  }
  if (a.type === "line") {
    return (
      <>
        {handle(a.x1, a.y1, { kind: "endpoint", which: 1, orig: a, moved: false }, "move")}
        {handle(a.x2, a.y2, { kind: "endpoint", which: 2, orig: a, moved: false }, "move")}
      </>
    );
  }
  const box = annotBox(a);
  return (
    <>
      {outline(box.x, box.y, box.w, box.h)}
      {a.type !== "ink" &&
        handle(a.x + a.w, a.y + a.h, { kind: "resize", start: { x: a.x + a.w, y: a.y + a.h }, orig: a, moved: false }, "nwse-resize")}
    </>
  );
}

function TextEditor({ a, pageId }: { a: TextAnnot; pageId: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const m = measureText({ ...a, text: a.text || " " });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  return (
    <foreignObject
      transform={localTransform(a)}
      x={-2}
      y={0}
      width={Math.max(m.w + a.size * 2, a.size * 6)}
      height={m.h + 4}
      style={{ overflow: "visible" }}
    >
      <textarea
        ref={ref}
        value={a.text}
        placeholder="Type…"
        spellCheck={false}
        onPointerDown={(e) => e.stopPropagation()}
        onChange={(e) => useEditor.getState().updateAnnot(pageId, a.id, { text: e.target.value })}
        onBlur={() => useEditor.getState().finishEditing()}
        onKeyDown={(e) => {
          if (e.key === "Escape") e.currentTarget.blur();
        }}
        style={{
          display: "block",
          width: "100%",
          height: "100%",
          padding: "0 0 0 2px",
          margin: 0,
          border: "none",
          outline: `1px dashed ${SELECT_COLOR}`,
          background: "rgba(255,255,255,0.6)",
          resize: "none",
          overflow: "hidden",
          whiteSpace: "pre",
          font: cssFont(a),
          lineHeight: LINE_HEIGHT,
          color: a.color,
        }}
      />
    </foreignObject>
  );
}

/** Read-only rendering of a page's annotations (used by thumbnails). */
export function AnnotationPreview({ page, zoom }: Props) {
  const annots = useEditor((s) => s.annots[page.id]);
  const { w, h } = pageSize(page);
  const disp = displaySize(page);
  if (!annots?.length) return null;
  return (
    <svg
      className="pointer-events-none absolute inset-0"
      width={disp.w * zoom}
      height={disp.h * zoom}
      viewBox={`0 0 ${disp.w} ${disp.h}`}
    >
      <g transform={rotationMatrix(totalRotation(page), w, h)}>
        {annots.map((a) => (
          <AnnotShape key={a.id} a={a} editing={false} />
        ))}
      </g>
    </svg>
  );
}
