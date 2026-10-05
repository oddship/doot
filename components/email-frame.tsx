"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";

const frameCss = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fffdf8; color: #202624; }
  body { font: 14px/1.55 Arial, Helvetica, sans-serif; overflow-wrap: break-word; }
  img { max-width: 100% !important; height: auto !important; }
  table { max-width: 100% !important; border-spacing: 0; }
  td, th { word-break: normal !important; overflow-wrap: break-word; }
  pre { max-width: 100%; overflow: auto; white-space: pre-wrap; }
  blockquote { margin-left: 0; padding-left: 14px; border-left: 3px solid #ded7c9; color: #6e746e; }
  a { color: #006d77; text-decoration-thickness: 1px; text-underline-offset: 2px; }
  .remote-image-placeholder { display: inline-flex; align-items: center; min-height: 22px; max-width: 120px; padding: 3px 7px; border: 1px solid #ded7c9; background: #f5f1e8; color: #6e746e; font: 10px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; text-align: center; }
`;

function documentHtml(body: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${frameCss}</style></head><body>${body}</body></html>`;
}

export const EmailFrame = memo(function EmailFrame({ html }: { html: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const resizeFrame = useRef<number | null>(null);
  const [height, setHeight] = useState(420);
  const sourceDocument = useMemo(() => documentHtml(html), [html]);

  useEffect(() => {
    setHeight(420);
    return () => {
      observer.current?.disconnect();
      if (resizeFrame.current !== null) cancelAnimationFrame(resizeFrame.current);
      resizeFrame.current = null;
    };
  }, [html]);

  const prepare = () => {
    const document = frame.current?.contentDocument;
    if (!document) return;
    document.querySelectorAll("tr").forEach((row) => {
      const cells = Array.from(row.children).filter((element) => /^(TD|TH)$/.test(element.tagName)) as HTMLElement[];
      if (cells.length > 1)
        cells.forEach((cell) => {
          if (cell.style.width === "100%") cell.style.setProperty("width", "auto", "important");
        });
      const labels = cells.map((cell) => cell.textContent?.trim().toLowerCase());
      if (cells.length === 3 && labels[0] === "status" && labels[2] === "annotations") {
        cells[0].style.setProperty("width", "22%", "important");
        cells[1].style.setProperty("width", "56%", "important");
        cells[2].style.setProperty("width", "22%", "important");
      }
    });
    const resize = () => {
      if (resizeFrame.current !== null) return;
      resizeFrame.current = requestAnimationFrame(() => {
        resizeFrame.current = null;
        const next = Math.max(420, Math.ceil(document.documentElement.scrollHeight));
        setHeight((current) => (current === next ? current : next));
      });
    };
    observer.current?.disconnect();
    observer.current = new ResizeObserver(resize);
    observer.current.observe(document.body);
    resize();
  };

  return (
    <iframe
      ref={frame}
      className="email-frame"
      title="Email message content"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={sourceDocument}
      style={{ height }}
      onLoad={prepare}
    />
  );
});
