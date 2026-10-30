"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

type ToastKind = "success" | "error" | "info";
type ToastItem = { id: number; kind: ToastKind; message: string };

export type ToastApi = {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

// How long a toast stays up before it auto-dismisses. Errors get longer,
// there's often more to read (a server action's error message) and the
// person may be mid-task and not looking at the corner of the screen yet.
const DURATION_MS: Record<ToastKind, number> = {
  success: 3500,
  info: 4000,
  error: 6000,
};

/**
 * App-wide toast notifications (C2 in the UX scoping report). Mounted once
 * in the root layout so every page in all three portals (client,
 * accountant, admin) can call useToast() without its own provider.
 *
 * This exists alongside, and is unrelated to, the realtime notification
 * toasts in notification-bell.tsx (those are server-pushed "someone
 * messaged you" alerts). This one is for immediate feedback on an action
 * the person just took in this tab: "Saved", "Upload failed", etc.
 *
 * Usage: const toast = useToast(); toast.success("Saved your changes.");
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  // SSR-safe portal gate, same pattern as camera-capture-modal.tsx /
  // notification-bell.tsx: createPortal needs `document`, client-only.
  const [portalMounted, setPortalMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPortalMounted(true);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = ++idRef.current;
      setToasts((prev) => [...prev, { id, kind, message }]);
      window.setTimeout(() => dismiss(id), DURATION_MS[kind]);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (m: string) => push("success", m),
      error: (m: string) => push("error", m),
      info: (m: string) => push("info", m),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {portalMounted
        ? createPortal(
            <div
              aria-live="polite"
              aria-atomic="true"
              className="fixed inset-x-0 bottom-0 z-[95] flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:items-end"
            >
              {toasts.map((t) => (
                <div
                  key={t.id}
                  role="status"
                  className="flex w-full max-w-sm items-start gap-3 rounded-xl border px-4 py-3 shadow-2xl"
                  style={{
                    background:
                      t.kind === "success"
                        ? "var(--color-success-bg)"
                        : t.kind === "error"
                          ? "var(--color-danger-bg)"
                          : "var(--color-info-bg)",
                    borderColor:
                      t.kind === "success"
                        ? "var(--color-success-border)"
                        : t.kind === "error"
                          ? "var(--color-danger-border)"
                          : "var(--color-info-border)",
                    backdropFilter: "blur(6px)",
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                    style={{
                      background:
                        t.kind === "success"
                          ? "var(--color-success)"
                          : t.kind === "error"
                            ? "var(--color-danger)"
                            : "var(--color-info)",
                      color: "#fff",
                    }}
                  >
                    {t.kind === "success" ? "✓" : t.kind === "error" ? "!" : "i"}
                  </span>
                  <p
                    className="flex-1 text-sm font-medium"
                    style={{
                      color:
                        t.kind === "success"
                          ? "#0d7a5a"
                          : t.kind === "error"
                            ? "#a11c1c"
                            : "var(--navy-deep)",
                    }}
                  >
                    {t.message}
                  </p>
                  <button
                    type="button"
                    onClick={() => dismiss(t.id)}
                    aria-label="Dismiss"
                    className="shrink-0 text-slate hover:text-navy-deep"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </ToastContext.Provider>
  );
}

// Falls back to a no-op API outside the provider instead of throwing, so a
// page rendered in isolation (a test, a future Storybook entry) doesn't
// crash just for calling toast.success() without a provider mounted.
const noopApi: ToastApi = { success: () => {}, error: () => {}, info: () => {} };

export function useToast(): ToastApi {
  return useContext(ToastContext) ?? noopApi;
}
