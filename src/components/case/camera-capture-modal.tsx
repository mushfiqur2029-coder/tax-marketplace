"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

type Props = {
  open: boolean;
  onClose: () => void;
  /**
   * Fires with the captured frame as a File. The parent wires this
   * into the same upload path a file-picker pick would go through,
   * so a photo from the webcam and a photo picked from disk hit the
   * same server action and the same UI feedback.
   */
  onCapture: (file: File) => void;
};

type Phase =
  | { kind: "idle" }
  | { kind: "requesting" }
  | { kind: "live"; stream: MediaStream }
  | { kind: "preview"; blobUrl: string; blob: Blob }
  | { kind: "error"; message: string };

// Modal that opens a live webcam preview via getUserMedia, snaps a
// still frame to a canvas on Capture, and hands the result to the
// parent as a File. This is the desktop counterpart to the
// capture="environment" file input, which only reliably opens a real
// camera on mobile. Desktop with capture="environment" falls back to
// the OS photo picker, so without this modal there's no path to grab
// a photo from a laptop webcam.
//
// Lifecycle: on open we request a MediaStream, show it in a <video>,
// and keep a ref to the stream so we can stop every track on close
// (closing a webcam cleanly matters — a lingering tab-level stream
// shows the browser's "camera in use" indicator and freaks users
// out). Capture draws the current frame to a canvas, converts to a
// blob, and switches to a "preview" phase so the user can retake
// before committing. "Use photo" fires onCapture + onClose; "Retake"
// disposes the blob URL and re-enters the live phase without a new
// permission prompt (the stream is already open).
//
// Facing-mode preference: environment first (rear camera on phones
// that have both), falling back to user (front) if environment isn't
// available. Laptops only ever have one camera and will hit the
// fallback automatically.
export function CameraCaptureModal({ open, onClose, onCapture }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  // SSR-safe portal gate. Mirrors notification-bell.tsx's pattern:
  // portals need `document`, which is only present on the client.
  const [portalMounted, setPortalMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPortalMounted(true);
  }, []);

  // Stop every track on the current stream (if any). Called on
  // close, on unmount, and when switching from live -> preview (we
  // keep the stream for retake, actually — so this is only used for
  // the final cleanup).
  const stopStream = useCallback((stream: MediaStream | null | undefined) => {
    if (!stream) return;
    for (const t of stream.getTracks()) t.stop();
  }, []);

  // Request camera access when the modal opens. Not run on close.
  useEffect(() => {
    if (!open) return;
    if (phase.kind !== "idle") return;

    let cancelled = false;
    setPhase({ kind: "requesting" });

    (async () => {
      // getUserMedia requires a secure context (https / localhost).
      // If called over plain http on a non-local host, the Promise
      // rejects with a NotAllowedError and we surface a clearer
      // message than the browser's default.
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        if (!cancelled) {
          setPhase({
            kind: "error",
            message: "Your browser doesn't support camera capture here.",
          });
        }
        return;
      }

      try {
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: "environment" } },
            audio: false,
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        }
        if (cancelled) {
          stopStream(stream);
          return;
        }
        setPhase({ kind: "live", stream });
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof DOMException && err.name === "NotAllowedError"
            ? "Camera access was blocked. Allow camera in your browser's address bar and try again."
            : err instanceof DOMException && err.name === "NotFoundError"
              ? "No camera found on this device. Use Choose file instead."
              : "Couldn't open the camera. Try again, or use Choose file.";
        setPhase({ kind: "error", message });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, phase.kind, stopStream]);

  // Attach the MediaStream to the <video> element whenever we enter
  // the live phase. React doesn't manage srcObject (not a serialisable
  // prop) so we do it in an effect keyed on the stream.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (phase.kind === "live") {
      el.srcObject = phase.stream;
      // play() can reject on some browsers if the user navigated
      // away before autoplay kicked in. Swallow — the UI already
      // shows "Open camera" and the user can retry.
      void el.play().catch(() => {});
    } else {
      el.srcObject = null;
    }
  }, [phase]);

  // Full cleanup when the modal closes OR unmounts. We reach into
  // the current stream via a ref so the latest state is used (the
  // state value closed over in the previous render would be stale).
  const streamRef = useRef<MediaStream | null>(null);
  useEffect(() => {
    if (phase.kind === "live") streamRef.current = phase.stream;
  }, [phase]);

  useEffect(() => {
    if (!open) {
      stopStream(streamRef.current);
      streamRef.current = null;
      setPhase({ kind: "idle" });
    }
  }, [open, stopStream]);

  useEffect(() => {
    return () => {
      stopStream(streamRef.current);
      streamRef.current = null;
    };
  }, [stopStream]);

  // ESC-to-close. Added separately from the backdrop click so a user
  // navigating by keyboard can bail out of the camera prompt the way
  // every other modal in the app lets them.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const handleCapture = useCallback(() => {
    if (phase.kind !== "live") return;
    const video = videoRef.current;
    if (!video) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const blobUrl = URL.createObjectURL(blob);
        setPhase({ kind: "preview", blobUrl, blob });
      },
      "image/jpeg",
      0.92,
    );
  }, [phase]);

  const handleUsePhoto = useCallback(() => {
    if (phase.kind !== "preview") return;
    const file = new File(
      [phase.blob],
      `photo-${Date.now()}.jpg`,
      { type: "image/jpeg" },
    );
    URL.revokeObjectURL(phase.blobUrl);
    stopStream(streamRef.current);
    streamRef.current = null;
    onCapture(file);
    onClose();
  }, [phase, onCapture, onClose, stopStream]);

  const handleRetake = useCallback(() => {
    if (phase.kind !== "preview") return;
    URL.revokeObjectURL(phase.blobUrl);
    // Jump back to the open stream rather than re-requesting — the
    // tracks are still live. If somehow the stream has died (user
    // navigated and came back) we'll fall through to the live-phase
    // effect's srcObject attach which will show a frozen last frame
    // until the user closes and reopens.
    const stream = streamRef.current;
    if (stream && stream.active) {
      setPhase({ kind: "live", stream });
    } else {
      setPhase({ kind: "idle" });
    }
  }, [phase]);

  if (!open || !portalMounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      style={{ background: "rgba(15,30,77,0.60)" }}
      role="dialog"
      aria-modal="true"
      aria-label="Take a photo"
      onClick={(e) => {
        // Backdrop click closes the modal. Preserve clicks inside the
        // panel so the user can type/click without accidentally
        // dismissing.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="relative w-full max-w-xl overflow-hidden rounded-2xl bg-paper shadow-2xl"
        style={{ maxHeight: "calc(100vh - 2rem)" }}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div
            className="text-xs font-semibold uppercase tracking-wider text-slate"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Take a photo
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close camera"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate hover:bg-slate/10 hover:text-navy-deep"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="bg-black" style={{ aspectRatio: "4 / 3" }}>
          {phase.kind === "preview" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={phase.blobUrl}
              alt="Captured frame preview"
              className="h-full w-full object-contain"
            />
          ) : (
            <video
              ref={videoRef}
              className="h-full w-full object-contain"
              playsInline
              muted
              aria-label="Camera preview"
            />
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
          {phase.kind === "requesting" ? (
            <p className="text-xs text-slate">Opening camera. Allow access when prompted.</p>
          ) : phase.kind === "error" ? (
            <p className="text-xs font-medium text-red-700" role="alert">
              {phase.message}
            </p>
          ) : phase.kind === "preview" ? (
            <p className="text-xs text-slate">Looks good? Use it below, or retake.</p>
          ) : (
            <p className="text-xs text-slate">Line the document up and tap Capture.</p>
          )}
          <div className="flex gap-2">
            {phase.kind === "preview" ? (
              <>
                <button
                  type="button"
                  onClick={handleRetake}
                  className="btn-sl btn-sl-outline"
                >
                  Retake
                </button>
                <button
                  type="button"
                  onClick={handleUsePhoto}
                  className="btn-sl btn-sl-primary"
                >
                  Use photo
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  className="btn-sl btn-sl-outline"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCapture}
                  disabled={phase.kind !== "live"}
                  className="btn-sl btn-sl-primary"
                >
                  Capture
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
