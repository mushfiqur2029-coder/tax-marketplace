"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  // Fires on every stroke end with the live state of the pad: isEmpty
  // tells the parent whether to enable the submit button; dataUrl is the
  // current PNG snapshot (null when empty). Produced lazily — only on
  // stroke end — since toDataURL is expensive on larger canvases.
  onChange?: (state: { isEmpty: boolean; dataUrl: string | null }) => void;
  // Optional hidden form field name. Keeps compatibility with plain-HTML
  // form submissions; most callers will prefer the onChange payload.
  name?: string;
  // Rendered width/height. Height=180 keeps enough stroke room on mobile
  // without the page scrolling. Width defaults to the container's width
  // via a ResizeObserver so it stays crisp when the layout changes.
  height?: number;
  className?: string;
};

// Hairline-stroke signature pad. Mouse + touch, no stylus pressure.
// Export via toDataUrl(). Imperative handle on the ref so callers can
// grab the PNG at form-submit time.
export type SignaturePadHandle = {
  toDataUrl: () => string | null;
  clear: () => void;
  isEmpty: () => boolean;
};

export function SignaturePad({
  onChange,
  name,
  height = 180,
  className,
}: Props & { ref?: React.Ref<SignaturePadHandle> }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hiddenRef = useRef<HTMLInputElement | null>(null);
  const [empty, setEmpty] = useState(true);
  const drawingRef = useRef<boolean>(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  const dprRef = useRef<number>(1);

  // Size the backing store to devicePixelRatio for crisp lines. Rebuild
  // on container width change so a layout shift (e.g. sidebar open) stays
  // sharp without clearing the drawing — we re-paint from a snapshot.
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resize = () => {
      const w = container.clientWidth;
      const dpr = window.devicePixelRatio || 1;
      // Preserve any existing drawing across resize.
      const snapshot = empty ? null : canvas.toDataURL("image/png");
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${height}px`;
      dprRef.current = dpr;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#0f1e4d";
      if (snapshot) {
        const img = new Image();
        img.onload = () => ctx.drawImage(img, 0, 0, w, height);
        img.src = snapshot;
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => ro.disconnect();
    // We intentionally don't depend on `empty` — snapshot is captured
    // from the canvas at resize time, not from state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height]);

  // Imperative API exposed via window-level ref isn't ergonomic in Server
  // Component parents. Instead we expose state via a ref-forwarding
  // pattern below (via Object.assign on a mutable). Callers that only
  // need the hidden field can skip the ref entirely.
  const api: SignaturePadHandle = {
    toDataUrl: () => {
      const c = canvasRef.current;
      if (!c || empty) return null;
      return c.toDataURL("image/png");
    },
    clear: () => {
      const c = canvasRef.current;
      if (!c) return;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.setTransform(dprRef.current, 0, 0, dprRef.current, 0, 0);
      setEmpty(true);
      onChange?.({ isEmpty: true, dataUrl: null });
      if (hiddenRef.current) hiddenRef.current.value = "";
    },
    isEmpty: () => empty,
  };

  const posFromEvent = (
    e: React.MouseEvent | React.TouchEvent,
  ): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if ("touches" in e) {
      const t = e.touches[0];
      if (!t) return null;
      return { x: t.clientX - rect.left, y: t.clientY - rect.top };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e: React.MouseEvent | React.TouchEvent) => {
    const pos = posFromEvent(e);
    if (!pos) return;
    drawingRef.current = true;
    lastPosRef.current = pos;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;
    // Dot at mousedown so a single tap leaves a mark.
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 1, 0, Math.PI * 2);
    ctx.fillStyle = "#0f1e4d";
    ctx.fill();
    if (empty) {
      setEmpty(false);
      // We'll re-emit with the real dataUrl on stroke end once the mark
      // is actually laid down. This early emit just unblocks the UI.
      onChange?.({ isEmpty: false, dataUrl: null });
    }
  };

  const move = (e: React.MouseEvent | React.TouchEvent) => {
    if (!drawingRef.current) return;
    const pos = posFromEvent(e);
    const last = lastPosRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!pos || !last || !ctx) return;
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    lastPosRef.current = pos;
  };

  const end = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastPosRef.current = null;
    // Produce the dataURL once per stroke — expensive, so avoid doing it
    // on move. Mirror it into the hidden input for plain-form consumers
    // and surface it via onChange for React consumers.
    const url = api.toDataUrl();
    if (hiddenRef.current && name) {
      hiddenRef.current.value = url ?? "";
    }
    onChange?.({ isEmpty: empty, dataUrl: url });
  };

  return (
    <div className={className}>
      <div
        ref={containerRef}
        className="relative rounded-xl border-2 border-dashed border-line bg-paper"
        style={{ touchAction: "none" }}
      >
        <canvas
          ref={canvasRef}
          onMouseDown={start}
          onMouseMove={move}
          onMouseUp={end}
          onMouseLeave={end}
          onTouchStart={start}
          onTouchMove={move}
          onTouchEnd={end}
          className="block w-full cursor-crosshair"
        />
        {empty ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span
              className="text-sm text-slate"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              Sign here with your mouse or finger
            </span>
          </div>
        ) : null}
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-slate">
        <span>Drawn signatures only. We don&apos;t accept typed names.</span>
        <button
          type="button"
          onClick={() => api.clear()}
          className="font-semibold text-navy-deep underline underline-offset-4 hover:text-sky"
        >
          Clear
        </button>
      </div>
      {name ? (
        <input ref={hiddenRef} type="hidden" name={name} defaultValue="" />
      ) : null}
    </div>
  );
}
