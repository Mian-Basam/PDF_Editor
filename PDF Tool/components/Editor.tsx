"use client";

import { FileUp, Loader2, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { exportPdf } from "@/lib/exportPdf";
import { displaySize, translateAnnot } from "@/lib/geometry";
import { useEditor } from "@/lib/store";
import type { PageInfo, PendingImage, Tool } from "@/lib/types";
import AnnotationLayer from "./AnnotationLayer";
import PdfCanvas from "./PdfCanvas";
import SignatureModal from "./SignatureModal";
import Thumbnails from "./Thumbnails";
import Toolbar from "./Toolbar";

const TOOL_KEYS: Record<string, Tool> = {
  v: "select",
  e: "edittext",
  t: "text",
  p: "draw",
  h: "highlight",
  r: "rect",
  o: "ellipse",
  l: "line",
  w: "whiteout",
};

const isPdf = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);

/** Reads an image file as a PNG/JPEG data URL (other formats are converted). */
async function readImage(file: File): Promise<PendingImage> {
  const url = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  const img = new Image();
  img.src = url;
  await img.decode();
  let src = url;
  if (!/^data:image\/(png|jpe?g);/.test(url)) {
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext("2d")!.drawImage(img, 0, 0);
    src = c.toDataURL("image/png");
  }
  return { src, width: img.naturalWidth, height: img.naturalHeight };
}

function reportError(err: unknown) {
  console.error(err);
  const msg = err instanceof Error ? err.message : String(err);
  const hint = /password/i.test(msg) ? "Password-protected PDFs aren't supported." : msg;
  alert(`Could not open the file.\n\n${hint}`);
}

export default function Editor() {
  const pages = useEditor((s) => s.pages);
  const zoom = useEditor((s) => s.zoom);
  const hasEdits = useEditor((s) => s.past.length > 0);

  const mainRef = useRef<HTMLElement>(null);
  const openInput = useRef<HTMLInputElement>(null);
  const mergeInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [signing, setSigning] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const fitWidth = useCallback((max = 4) => {
    const { pages, setZoom } = useEditor.getState();
    const el = mainRef.current;
    if (!el || !pages.length) return;
    const widest = Math.max(...pages.map((p) => displaySize(p).w));
    setZoom(Math.min(max, (el.clientWidth - 64) / widest));
  }, []);

  // Fit the page width when a new document is opened.
  const firstPageId = pages[0]?.id;
  useEffect(() => {
    if (firstPageId) fitWidth(1.5);
  }, [firstPageId, fitWidth]);

  useEffect(() => {
    if (!hasEdits) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasEdits]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable]")) return;
      const s = useEditor.getState();
      if (!s.pages.length) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (mod && key === "z") {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (mod && key === "y") {
        e.preventDefault();
        s.redo();
      } else if ((e.key === "Delete" || e.key === "Backspace") && s.selected) {
        e.preventDefault();
        s.deleteAnnot(s.selected.pageId, s.selected.id);
      } else if (e.key === "Escape") {
        s.setTool("select");
      } else if (e.key.startsWith("Arrow") && s.selected) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[
          e.key
        ];
        const a = s.annots[s.selected.pageId]?.find((x) => x.id === s.selected!.id);
        if (!d || !a) return;
        s.checkpoint();
        s.replaceAnnot(s.selected.pageId, translateAnnot(a, d[0], d[1]));
      } else if (!mod && !e.altKey && TOOL_KEYS[key]) {
        s.setTool(TOOL_KEYS[key]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const openFile = async (file?: File) => {
    if (!file) return;
    try {
      await useEditor.getState().openFile(file);
    } catch (err) {
      reportError(err);
    }
  };

  const mergeFiles = async (files: File[]) => {
    const pdfs = files.filter(isPdf);
    if (!pdfs.length) return;
    try {
      await useEditor.getState().appendFiles(pdfs);
    } catch (err) {
      reportError(err);
    }
  };

  const download = async () => {
    const s = useEditor.getState();
    s.finishEditing();
    setExporting(true);
    try {
      const bytes = await exportPdf(s.pages, useEditor.getState().annots, s.sources);
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${s.fileName || "document"}-edited.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      console.error(err);
      alert(`Export failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setExporting(false);
    }
  };

  const fileInputs = (
    <>
      <input
        ref={openInput}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(e) => {
          void openFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={mergeInput}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        hidden
        onChange={(e) => {
          void mergeFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <input
        ref={imageInput}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          try {
            useEditor.getState().setPendingImage(await readImage(file));
          } catch {
            alert("Could not read that image.");
          }
        }}
      />
    </>
  );

  if (!pages.length) {
    return (
      <>
        {fileInputs}
        <StartScreen onPick={() => openInput.current?.click()} onDropFile={openFile} />
      </>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      {fileInputs}
      <Toolbar
        exporting={exporting}
        onOpen={() => openInput.current?.click()}
        onMerge={() => mergeInput.current?.click()}
        onImage={() => imageInput.current?.click()}
        onSignature={() => setSigning(true)}
        onDownload={download}
        onFitWidth={() => fitWidth()}
      />
      <div className="flex min-h-0 flex-1">
        <Thumbnails />
        <main
          ref={mainRef}
          className={`relative flex-1 overflow-auto bg-neutral-200 ${dragOver ? "ring-4 ring-inset ring-blue-400" : ""}`}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            if (!e.dataTransfer.files.length) return;
            e.preventDefault();
            setDragOver(false);
            void mergeFiles(Array.from(e.dataTransfer.files));
          }}
        >
          <div className="flex min-w-fit flex-col items-center gap-6 p-8">
            {pages.map((p, i) => (
              <PageView key={p.id} page={p} index={i} zoom={zoom} />
            ))}
          </div>
        </main>
      </div>
      {signing && (
        <SignatureModal
          color={useEditor.getState().style.color}
          onClose={() => setSigning(false)}
          onDone={(img) => {
            setSigning(false);
            useEditor.getState().setPendingImage(img);
          }}
        />
      )}
    </div>
  );
}

function PageView({ page, index, zoom }: { page: PageInfo; index: number; zoom: number }) {
  return (
    <div id={`page-${page.id}`} className="flex scroll-mt-6 flex-col items-center gap-1.5">
      <div className="relative shadow-md ring-1 ring-black/5">
        <PdfCanvas page={page} scale={zoom} id={`canvas-${page.id}`} />
        <AnnotationLayer page={page} zoom={zoom} />
      </div>
      <span className="text-xs text-neutral-500">Page {index + 1}</span>
    </div>
  );
}

function StartScreen({ onPick, onDropFile }: { onPick: () => void; onDropFile: (f?: File) => void }) {
  const loading = useEditor((s) => s.loading);
  const [over, setOver] = useState(false);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-neutral-100 p-6">
      <h1 className="mb-2 text-3xl font-bold tracking-tight">PDF Editor</h1>
      <p className="mb-8 text-neutral-500">Add text, draw, highlight, sign and rearrange pages — right in your browser.</p>
      <button
        type="button"
        onClick={onPick}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          onDropFile(Array.from(e.dataTransfer.files).find(isPdf));
        }}
        className={`flex w-full max-w-xl flex-col items-center gap-4 rounded-2xl border-2 border-dashed bg-white px-8 py-16 transition ${
          over ? "border-blue-500 bg-blue-50" : "border-neutral-300 hover:border-blue-400"
        }`}
      >
        {loading ? (
          <Loader2 size={40} className="animate-spin text-blue-600" />
        ) : (
          <FileUp size={40} className="text-blue-600" />
        )}
        <span className="text-lg font-medium">{loading ? "Opening…" : "Drop a PDF here or click to choose"}</span>
        <span className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white">Choose PDF</span>
      </button>
      <p className="mt-6 flex items-center gap-1.5 text-sm text-neutral-500">
        <ShieldCheck size={16} /> Your files stay on your device — nothing is uploaded.
      </p>
    </div>
  );
}
