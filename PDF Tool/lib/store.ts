import { nanoid } from "nanoid";
import { create } from "zustand";
import { readPdf } from "./pdfjs";
import type { Annotation, PageInfo, PendingImage, Source, Style, Tool } from "./types";

interface Snapshot {
  pages: PageInfo[];
  annots: Record<string, Annotation[]>;
}

export interface Selection {
  pageId: string;
  id: string;
}

interface EditorState extends Snapshot {
  sources: Record<string, Source>;
  fileName: string;
  loading: boolean;
  past: Snapshot[];
  future: Snapshot[];
  tool: Tool;
  style: Style;
  zoom: number;
  selected: Selection | null;
  editingId: string | null;
  /** True while editing a text box that was just created. */
  editingNew: boolean;
  pendingImage: PendingImage | null;

  openFile: (file: File) => Promise<void>;
  appendFiles: (files: File[]) => Promise<void>;
  closeDocument: () => void;

  setTool: (tool: Tool) => void;
  setStyle: (patch: Partial<Style>) => void;
  setZoom: (zoom: number) => void;
  setPendingImage: (img: PendingImage | null) => void;

  /** Saves the current state to the undo stack. Call before a change. */
  checkpoint: () => void;
  /** Drops the latest undo entry (used when a new text box is left empty). */
  dropCheckpoint: () => void;
  undo: () => void;
  redo: () => void;

  addAnnot: (pageId: string, a: Annotation) => void;
  /** Adds several annotations as one undo step. */
  addAnnots: (pageId: string, list: Annotation[]) => void;
  updateAnnot: (pageId: string, id: string, patch: Partial<Annotation>, commit?: boolean) => void;
  replaceAnnot: (pageId: string, a: Annotation) => void;
  deleteAnnot: (pageId: string, id: string, commit?: boolean) => void;
  select: (sel: Selection | null) => void;
  setEditing: (id: string | null, isNew?: boolean) => void;
  /** Ends text editing; removes the text box if it was left empty. */
  finishEditing: () => void;

  rotatePage: (pageId: string, delta: number) => void;
  deletePage: (pageId: string) => void;
  movePage: (from: number, to: number) => void;
}

const HISTORY_LIMIT = 100;

const DEFAULT_STYLE: Style = {
  color: "#111827",
  highlightColor: "#fde047",
  strokeWidth: 2,
  fontSize: 14,
  font: "Helvetica",
  bold: false,
  italic: false,
  fill: false,
};

let lastStyleEdit: { id: string; t: number } | null = null;

const snapshot = (s: Snapshot): Snapshot => ({ pages: s.pages, annots: s.annots });

/** Copies the toolbar style onto an annotation where it applies. */
function applyStyle(a: Annotation, patch: Partial<Style>): Annotation {
  switch (a.type) {
    case "text":
      return {
        ...a,
        color: patch.color ?? a.color,
        size: patch.fontSize ?? a.size,
        font: patch.font ?? a.font,
        bold: patch.bold ?? a.bold,
        italic: patch.italic ?? a.italic,
      };
    case "highlight":
      return { ...a, color: patch.highlightColor ?? a.color };
    case "rect":
    case "ellipse":
      return {
        ...a,
        color: patch.color ?? a.color,
        width: patch.strokeWidth ?? a.width,
        fill: patch.fill ?? a.fill,
      };
    case "line":
    case "ink":
      return { ...a, color: patch.color ?? a.color, width: patch.strokeWidth ?? a.width };
    default:
      return a;
  }
}

/** The toolbar style that matches an annotation, so the controls show its values. */
function styleFrom(a: Annotation): Partial<Style> {
  switch (a.type) {
    case "text":
      return { color: a.color, fontSize: a.size, font: a.font, bold: a.bold, italic: !!a.italic };
    case "highlight":
      return { highlightColor: a.color };
    case "rect":
    case "ellipse":
      return { color: a.color, strokeWidth: a.width, fill: a.fill };
    case "line":
    case "ink":
      return { color: a.color, strokeWidth: a.width };
    default:
      return {};
  }
}

export const useEditor = create<EditorState>((set, get) => {
  const mapPage = (pageId: string, fn: (list: Annotation[]) => Annotation[]) =>
    set((s) => ({ annots: { ...s.annots, [pageId]: fn(s.annots[pageId] ?? []) } }));

  return {
    sources: {},
    pages: [],
    annots: {},
    fileName: "",
    loading: false,
    past: [],
    future: [],
    tool: "select",
    style: DEFAULT_STYLE,
    zoom: 1.25,
    selected: null,
    editingId: null,
    editingNew: false,
    pendingImage: null,

    async openFile(file) {
      set({ loading: true });
      try {
        const { source, pages } = await readPdf(file, nanoid(), nanoid);
        for (const s of Object.values(get().sources)) void s.doc.destroy();
        set({
          sources: { [source.id]: source },
          pages,
          annots: {},
          past: [],
          future: [],
          selected: null,
          editingId: null,
          fileName: file.name.replace(/\.pdf$/i, ""),
        });
      } finally {
        set({ loading: false });
      }
    },

    async appendFiles(files) {
      set({ loading: true });
      try {
        for (const file of files) {
          const { source, pages } = await readPdf(file, nanoid(), nanoid);
          get().checkpoint();
          set((s) => ({
            sources: { ...s.sources, [source.id]: source },
            pages: [...s.pages, ...pages],
          }));
        }
      } finally {
        set({ loading: false });
      }
    },

    closeDocument() {
      for (const s of Object.values(get().sources)) void s.doc.destroy();
      set({
        sources: {},
        pages: [],
        annots: {},
        past: [],
        future: [],
        selected: null,
        editingId: null,
        pendingImage: null,
        tool: "select",
        fileName: "",
      });
    },

    setTool(tool) {
      set({ tool, selected: null, editingId: null });
      if (tool !== "image") set({ pendingImage: null });
    },

    setStyle(patch) {
      const { selected, annots } = get();
      set((s) => ({ style: { ...s.style, ...patch } }));
      if (!selected) return;
      const a = annots[selected.pageId]?.find((x) => x.id === selected.id);
      if (!a) return;
      const next = applyStyle(a, patch);
      if (next !== a) {
        // Dragging a slider or color picker fires many changes; keep one undo step.
        const now = Date.now();
        if (lastStyleEdit?.id !== a.id || now - lastStyleEdit.t > 800) get().checkpoint();
        lastStyleEdit = { id: a.id, t: now };
        get().replaceAnnot(selected.pageId, next);
      }
    },

    setZoom(zoom) {
      set({ zoom: Math.min(4, Math.max(0.25, Math.round(zoom * 100) / 100)) });
    },

    setPendingImage(pendingImage) {
      set({ pendingImage, tool: pendingImage ? "image" : get().tool, selected: null });
    },

    checkpoint() {
      set((s) => ({ past: [...s.past, snapshot(s)].slice(-HISTORY_LIMIT), future: [] }));
    },

    dropCheckpoint() {
      set((s) => ({ past: s.past.slice(0, -1) }));
    },

    undo() {
      const { past } = get();
      if (!past.length) return;
      set((s) => ({
        ...past[past.length - 1],
        past: past.slice(0, -1),
        future: [snapshot(s), ...s.future],
        selected: null,
        editingId: null,
      }));
    },

    redo() {
      const { future } = get();
      if (!future.length) return;
      set((s) => ({
        ...future[0],
        future: future.slice(1),
        past: [...s.past, snapshot(s)],
        selected: null,
        editingId: null,
      }));
    },

    addAnnot(pageId, a) {
      get().checkpoint();
      mapPage(pageId, (list) => [...list, a]);
    },

    addAnnots(pageId, added) {
      get().checkpoint();
      mapPage(pageId, (list) => [...list, ...added]);
    },

    updateAnnot(pageId, id, patch, commit = false) {
      if (commit) get().checkpoint();
      mapPage(pageId, (list) =>
        list.map((a) => (a.id === id ? ({ ...a, ...patch } as Annotation) : a)),
      );
    },

    replaceAnnot(pageId, next) {
      mapPage(pageId, (list) => list.map((a) => (a.id === next.id ? next : a)));
    },

    deleteAnnot(pageId, id, commit = true) {
      if (commit) get().checkpoint();
      mapPage(pageId, (list) => list.filter((a) => a.id !== id));
      const { selected, editingId } = get();
      if (selected?.id === id) set({ selected: null });
      if (editingId === id) set({ editingId: null });
    },

    select(sel) {
      set({ selected: sel });
      if (!sel) return;
      const a = get().annots[sel.pageId]?.find((x) => x.id === sel.id);
      if (a) set((s) => ({ style: { ...s.style, ...styleFrom(a) } }));
    },

    setEditing(editingId, isNew = false) {
      set({ editingId, editingNew: isNew });
    },

    finishEditing() {
      const { editingId, editingNew, annots, selected } = get();
      if (!editingId) return;
      set({ editingId: null, editingNew: false });
      const pageId = Object.keys(annots).find((k) => annots[k].some((a) => a.id === editingId));
      if (!pageId) return;
      const a = annots[pageId].find((x) => x.id === editingId);
      if (a?.type === "text" && !a.text.trim()) {
        get().deleteAnnot(pageId, editingId, false);
        if (editingNew) get().dropCheckpoint();
        if (selected?.id === editingId) set({ selected: null });
      }
    },

    rotatePage(pageId, delta) {
      get().checkpoint();
      set((s) => ({
        pages: s.pages.map((p) => (p.id === pageId ? { ...p, rotation: p.rotation + delta } : p)),
      }));
    },

    deletePage(pageId) {
      if (get().pages.length <= 1) return;
      get().checkpoint();
      set((s) => ({
        pages: s.pages.filter((p) => p.id !== pageId),
        selected: s.selected?.pageId === pageId ? null : s.selected,
      }));
    },

    movePage(from, to) {
      const { pages } = get();
      if (from === to || to < 0 || to >= pages.length) return;
      get().checkpoint();
      const next = [...pages];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      set({ pages: next });
    },
  };
});

export const newId = () => nanoid(10);
