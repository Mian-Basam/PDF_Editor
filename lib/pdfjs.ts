import type { PageInfo, Source } from "./types";

type PdfJs = typeof import("pdfjs-dist");

let pdfjsPromise: Promise<PdfJs> | null = null;

/** Loads pdf.js on the client only (it needs browser APIs). */
export function getPdfjs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    // pdf.js 4 relies on Promise.withResolvers (Safari < 17.4 lacks it).
    if (!("withResolvers" in Promise)) {
      Object.assign(Promise, {
        withResolvers() {
          let resolve!: (v: unknown) => void;
          let reject!: (e: unknown) => void;
          const promise = new Promise((res, rej) => {
            resolve = res;
            reject = rej;
          });
          return { promise, resolve, reject };
        },
      });
    }
    pdfjsPromise = import("pdfjs-dist").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

export async function readPdf(file: File, srcId: string, makeId: () => string) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdfjs = await getPdfjs();
  // pdf.js transfers the buffer to its worker, so give it a copy.
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;

  const pages: PageInfo[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    pages.push({
      id: makeId(),
      srcId,
      srcIndex: i - 1,
      view: page.view as PageInfo["view"],
      baseRotation: page.rotate,
      rotation: 0,
    });
  }
  const source: Source = { id: srcId, name: file.name, bytes, doc };
  return { source, pages };
}
