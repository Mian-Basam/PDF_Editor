"use client";

import dynamic from "next/dynamic";

// The editor uses pdf.js and canvas APIs, so it only renders in the browser.
const Editor = dynamic(() => import("@/components/Editor"), { ssr: false });

export default function Home() {
  return <Editor />;
}
