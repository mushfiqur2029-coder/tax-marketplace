"use client";

// Shared completion state for the PCH intake workspace. Each section
// reports its own done/not-done boolean here as its local state
// evolves; the progress bar at the top of the page, the Submit for
// review button at the bottom, and the amber ring that pulses on a
// stale/incomplete submit all read from the same source.
//
// Why a context instead of lifting all intake state into the
// workspace: each section already owns a lot of debounced local
// state (useDebouncedSave hooks on every input). Lifting that would
// break the stable-identity assumptions those hooks make. The
// context only tracks the aggregated completion booleans + a transient
// "highlight these pending sections" set.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import {
  INTAKE_SECTION_KEYS,
  emptyCompletion,
  pendingKeys as computePending,
  type IntakeCompletion,
  type IntakeSectionKey,
} from "./intake-completion";

type IntakeProgressContextValue = {
  completion: IntakeCompletion;
  pendingKeys: IntakeSectionKey[];
  highlighted: Set<IntakeSectionKey>;
  setSectionDone: (key: IntakeSectionKey, done: boolean) => void;
  highlightPending: () => void;
  clearHighlight: () => void;
};

const Ctx = createContext<IntakeProgressContextValue | null>(null);

export function IntakeProgressProvider({
  initial,
  children,
}: {
  initial: IntakeCompletion;
  children: React.ReactNode;
}) {
  const [completion, setCompletion] = useState<IntakeCompletion>(initial);
  const [highlighted, setHighlighted] = useState<Set<IntakeSectionKey>>(() => new Set());

  const setSectionDone = useCallback((key: IntakeSectionKey, done: boolean) => {
    setCompletion((prev) => (prev[key] === done ? prev : { ...prev, [key]: done }));
    // Clear the amber ring on any key the user resolves after a
    // rejected submit, so the pulse quietens as they fix things.
    if (done) {
      setHighlighted((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, []);

  const pendingKeys = useMemo(() => computePending(completion), [completion]);

  const highlightPending = useCallback(() => {
    setHighlighted(new Set(computePending(completion)));
  }, [completion]);

  const clearHighlight = useCallback(() => {
    setHighlighted((prev) => (prev.size === 0 ? prev : new Set()));
  }, []);

  const value: IntakeProgressContextValue = useMemo(
    () => ({
      completion,
      pendingKeys,
      highlighted,
      setSectionDone,
      highlightPending,
      clearHighlight,
    }),
    [completion, pendingKeys, highlighted, setSectionDone, highlightPending, clearHighlight],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useIntakeProgress(): IntakeProgressContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useIntakeProgress called outside IntakeProgressProvider");
  return v;
}

// Convenience helper: safe to call when the component may render
// outside a provider (e.g. accountant-side reuse). Returns a no-op
// value in that case so sections stay drop-in reusable.
export function useOptionalIntakeProgress(): IntakeProgressContextValue {
  const v = useContext(Ctx);
  if (v) return v;
  return {
    completion: emptyCompletion(),
    pendingKeys: [...INTAKE_SECTION_KEYS],
    highlighted: new Set(),
    setSectionDone: () => {},
    highlightPending: () => {},
    clearHighlight: () => {},
  };
}
