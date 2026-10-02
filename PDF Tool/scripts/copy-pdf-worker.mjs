// Copies the pdf.js worker into /public so it is served as a static file.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve("pdfjs-dist/package.json"));
mkdirSync("public", { recursive: true });
copyFileSync(join(pkgDir, "build/pdf.worker.min.mjs"), "public/pdf.worker.min.mjs");
console.log("Copied pdf.worker.min.mjs to public/");
