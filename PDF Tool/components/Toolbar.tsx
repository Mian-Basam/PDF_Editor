"use client";

import {
  Circle,
  Download,
  Eraser,
  FilePlus2,
  FolderOpen,
  Highlighter,
  PencilLine,
  ImagePlus,
  Loader2,
  Minus,
  MousePointer2,
  MoveHorizontal,
  Pencil,
  Redo2,
  Signature,
  Square,
  Type,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEditor } from "@/lib/store";
import type { Annotation, FontFamily, Tool } from "@/lib/types";

interface Props {
  exporting: boolean;
  onOpen: () => void;
  onMerge: () => void;
  onImage: () => void;
  onSignature: () => void;
  onDownload: () => void;
  onFitWidth: () => void;
}

const TOOLS: { id: Tool; label: string; title: string; key: string; icon: ReactNode }[] = [
  { id: "edittext", label: "Edit text", title: "Edit the PDF's existing text", key: "E", icon: <PencilLine size={17} /> },
  { id: "select", label: "Select", title: "Select, move and resize", key: "V", icon: <MousePointer2 size={17} /> },
  { id: "text", label: "Add text", title: "Add new text", key: "T", icon: <Type size={17} /> },
  { id: "draw", label: "Draw", title: "Draw freehand", key: "P", icon: <Pencil size={17} /> },
  { id: "highlight", label: "Highlight", title: "Highlight an area", key: "H", icon: <Highlighter size={17} /> },
  { id: "rect", label: "Rectangle", title: "Rectangle", key: "R", icon: <Square size={17} /> },
  { id: "ellipse", label: "Ellipse", title: "Ellipse", key: "O", icon: <Circle size={17} /> },
  { id: "line", label: "Line", title: "Line", key: "L", icon: <Minus size={17} className="-rotate-45" /> },
  { id: "whiteout", label: "Whiteout", title: "Cover existing content", key: "W", icon: <Eraser size={17} /> },
];

const SWATCHES = ["#111827", "#dc2626", "#2563eb", "#16a34a", "#9333ea", "#ea580c"];
const HIGHLIGHTS = ["#fde047", "#86efac", "#7dd3fc", "#f9a8d4", "#fdba74"];

type Context = Tool | Annotation["type"];

export default function Toolbar(props: Props) {
  const tool = useEditor((s) => s.tool);
  const style = useEditor((s) => s.style);
  const zoom = useEditor((s) => s.zoom);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const fileName = useEditor((s) => s.fileName);
  const loading = useEditor((s) => s.loading);
  const pendingImage = useEditor((s) => s.pendingImage);
  const selectedType = useEditor((s) =>
    s.selected ? s.annots[s.selected.pageId]?.find((a) => a.id === s.selected!.id)?.type : undefined,
  );
  const { setTool, setStyle, setZoom, undo, redo, closeDocument } = useEditor.getState();

  // Style controls follow the selected item, or the active tool.
  const ctx: Context = tool === "select" && selectedType ? selectedType : tool;
  const showColor = ["text", "draw", "ink", "rect", "ellipse", "line"].includes(ctx);
  const showStroke = ["draw", "ink", "rect", "ellipse", "line"].includes(ctx);
  const showFill = ctx === "rect" || ctx === "ellipse";
  const showText = ctx === "text";
  const showHighlight = ctx === "highlight";

  return (
    <header className="flex shrink-0 flex-col border-b border-neutral-200 bg-white">
      <div className="flex flex-wrap items-center gap-1 px-3 py-2">
        <div className="mr-2 flex min-w-0 items-center gap-2">
          <span className="rounded bg-blue-600 px-1.5 py-0.5 text-xs font-bold text-white">PDF</span>
          <span className="max-w-48 truncate text-sm font-medium" title={fileName}>
            {fileName}
          </span>
        </div>

        <IconButton title="Open another PDF" onClick={props.onOpen}>
          <FolderOpen size={18} />
        </IconButton>
        <IconButton title="Merge: add pages from another PDF" onClick={props.onMerge}>
          <FilePlus2 size={18} />
        </IconButton>
        <Divider />

        <IconButton title="Undo (Ctrl/⌘+Z)" disabled={!canUndo} onClick={undo}>
          <Undo2 size={18} />
        </IconButton>
        <IconButton title="Redo (Ctrl/⌘+Shift+Z)" disabled={!canRedo} onClick={redo}>
          <Redo2 size={18} />
        </IconButton>
        <Divider />

        <IconButton title="Zoom out" onClick={() => setZoom(zoom - 0.25)}>
          <ZoomOut size={18} />
        </IconButton>
        <span className="w-12 text-center text-sm tabular-nums text-neutral-600">{Math.round(zoom * 100)}%</span>
        <IconButton title="Zoom in" onClick={() => setZoom(zoom + 0.25)}>
          <ZoomIn size={18} />
        </IconButton>
        <IconButton title="Fit width" onClick={props.onFitWidth}>
          <MoveHorizontal size={18} />
        </IconButton>

        <div className="ml-auto flex items-center gap-2">
          {loading && <Loader2 size={18} className="animate-spin text-neutral-400" />}
          <button
            type="button"
            onClick={props.onDownload}
            disabled={props.exporting}
            className="flex items-center gap-2 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {props.exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            Download
          </button>
          <IconButton title="Close document" onClick={closeDocument}>
            <X size={18} />
          </IconButton>
        </div>
      </div>

      <nav className="flex flex-wrap items-center gap-1 border-t border-neutral-100 px-3 py-1.5">
        {TOOLS.map((t) => (
          <ToolButton
            key={t.id}
            label={t.label}
            title={`${t.title} (${t.key})`}
            active={tool === t.id}
            onClick={() => setTool(t.id)}
          >
            {t.icon}
          </ToolButton>
        ))}
        <ToolButton label="Image" title="Insert an image" active={tool === "image" && !!pendingImage} onClick={props.onImage}>
          <ImagePlus size={17} />
        </ToolButton>
        <ToolButton label="Sign" title="Draw and place a signature" onClick={props.onSignature}>
          <Signature size={17} />
        </ToolButton>
      </nav>

      <div className="flex min-h-11 flex-wrap items-center gap-4 border-t border-neutral-100 bg-neutral-50 px-3 py-1.5 text-sm">
        {showColor && (
          <ColorPicker label="Color" value={style.color} swatches={SWATCHES} onChange={(color) => setStyle({ color })} />
        )}
        {showHighlight && (
          <ColorPicker
            label="Highlight"
            value={style.highlightColor}
            swatches={HIGHLIGHTS}
            onChange={(highlightColor) => setStyle({ highlightColor })}
          />
        )}
        {showStroke && (
          <label className="flex items-center gap-2 text-neutral-600">
            Width
            <input
              type="range"
              min={0.5}
              max={20}
              step={0.5}
              value={style.strokeWidth}
              onChange={(e) => setStyle({ strokeWidth: Number(e.target.value) })}
              className="w-28 accent-blue-600"
            />
            <span className="w-8 tabular-nums">{style.strokeWidth}</span>
          </label>
        )}
        {showFill && (
          <label className="flex items-center gap-2 text-neutral-600">
            <input
              type="checkbox"
              checked={style.fill}
              onChange={(e) => setStyle({ fill: e.target.checked })}
              className="accent-blue-600"
            />
            Fill
          </label>
        )}
        {showText && (
          <>
            <select
              value={style.font}
              onChange={(e) => setStyle({ font: e.target.value as FontFamily })}
              className="rounded border border-neutral-300 bg-white px-2 py-1"
            >
              <option value="Helvetica">Helvetica</option>
              <option value="Times">Times</option>
              <option value="Courier">Courier</option>
            </select>
            <label className="flex items-center gap-2 text-neutral-600">
              Size
              <input
                type="number"
                min={4}
                max={144}
                value={style.fontSize}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (n >= 4 && n <= 144) setStyle({ fontSize: n });
                }}
                className="w-16 rounded border border-neutral-300 bg-white px-2 py-1"
              />
            </label>
            <button
              type="button"
              onClick={() => setStyle({ bold: !style.bold })}
              className={`h-7 w-7 rounded font-bold ${style.bold ? "bg-blue-100 text-blue-700" : "hover:bg-neutral-200"}`}
              title="Bold"
            >
              B
            </button>
            <button
              type="button"
              onClick={() => setStyle({ italic: !style.italic })}
              className={`h-7 w-7 rounded font-serif italic ${style.italic ? "bg-blue-100 text-blue-700" : "hover:bg-neutral-200"}`}
              title="Italic"
            >
              I
            </button>
          </>
        )}
        <Hint tool={tool} hasImage={!!pendingImage} hasSelection={!!selectedType} />
      </div>
    </header>
  );
}

function Hint({ tool, hasImage, hasSelection }: { tool: Tool; hasImage: boolean; hasSelection: boolean }) {
  const hints: Partial<Record<Tool, string>> = {
    edittext: "Click any outlined text to edit it · clear the box to delete the text · scanned pages have no editable text",
    select: hasSelection
      ? "Drag to move · Delete to remove · Double-click text to edit"
      : "Click an item to select it",
    text: "Click on the page to add text · click existing text to edit it",
    draw: "Drag to draw freehand",
    highlight: "Drag over an area to highlight it",
    rect: "Drag to draw a rectangle",
    ellipse: "Drag to draw an ellipse",
    line: "Drag to draw a line",
    whiteout: "Drag over existing content to cover it, then add text on top",
    image: hasImage ? "Click on a page to place it" : "",
  };
  return <span className="ml-auto text-xs text-neutral-500">{hints[tool]}</span>;
}

function ColorPicker({
  label,
  value,
  swatches,
  onChange,
}: {
  label: string;
  value: string;
  swatches: string[];
  onChange: (c: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 text-neutral-600">
      <span className="mr-1">{label}</span>
      {swatches.map((c) => (
        <button
          key={c}
          type="button"
          title={c}
          onClick={() => onChange(c)}
          className={`h-5 w-5 rounded-full ring-offset-1 ${value.toLowerCase() === c ? "ring-2 ring-blue-500" : "ring-1 ring-neutral-300"}`}
          style={{ background: c }}
        />
      ))}
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-6 w-7 cursor-pointer rounded border border-neutral-300 bg-white p-0"
        title="Custom color"
      />
    </div>
  );
}

function IconButton({
  children,
  active,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      className={`rounded-md p-2 transition disabled:opacity-30 ${
        active ? "bg-blue-100 text-blue-700" : "text-neutral-700 hover:bg-neutral-100"
      }`}
    >
      {children}
    </button>
  );
}

function ToolButton({
  children,
  label,
  active,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition ${
        active ? "bg-blue-100 font-medium text-blue-700" : "text-neutral-700 hover:bg-neutral-100"
      }`}
    >
      {children}
      {label}
    </button>
  );
}

function Divider() {
  return <div className="mx-1 h-6 w-px bg-neutral-200" />;
}
