"use client";

// Phase I progress-bar context for the accountant workspace. Mirrors
// src/app/client/cases/[id]/pch/intake-progress-context.tsx but the
// state is server-sourced (pch_cases columns + cases.status) rather
// than form-input-sourced. The orchestrator seeds the provider from
// server-rendered props; later, the live-row subscription in
// pch-accountant-view.tsx will call setCompletion() when any of the
// watched pch_cases columns change so the chips flip to green the
// instant the DB does.
//
// highlighted + highlightPending / clearHighlight mirror the client
// behaviour: on a stale-state "Send for client confirmation" click,
// the orchestrator highlights the pending steps and scrolls back to
// the bar.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import {
  ACCOUNTANT_STEP_KEYS,
  emptyAccountantCompletion,
  type AccountantStepCompletion,
  type AccountantStepKey,
} from "./accountant-progress";

type AccountantProgressContextValue = {
  completion: AccountantStepCompletion;
  pendingKeys: AccountantStepKey[];
  highlighted: Set<AccountantStepKey>;
  setCompletion: (next: AccountantStepCompletion) => void;
  setStepDone: (key: AccountantStepKey, done: boolean) => void;
  highlightPending: () => void;
  clearHighlight: () => void;
};

const Ctx = createContext<AccountantProgressContextValue | null>(null);

export function AccountantProgressProvider({
  initial,
  children,
}: {
  initial: AccountantStepCompletion;
  children: React.ReactNode;
}) {
  const [completion, setCompletionState] = useState<AccountantStepCompletion>(initial);
  const [highlighted, setHighlighted] = useState<Set<AccountantStepKey>>(() => new Set());

  const setCompletion = useCallback((next: AccountantStepCompletion) => {
    setCompletionState(next);
    setHighlighted((prev) => {
      // Any step that just flipped green gets its amber pulse cleared
      // without the caller having to track that separately.
      let changed = false;
      const nextSet = new Set(prev);
      for (const k of ACCOUNTANT_STEP_KEYS) {
        if (next[k] && nextSet.has(k)) {
          nextSet.delete(k);
          changed = true;
        }
      }
      return changed ? nextSet : prev;
    });
  }, []);

  const setStepDone = useCallback((key: AccountantStepKey, done: boolean) => {
    setCompletionState((prev) =>
      prev[key] === done ? prev : { ...prev, [key]: done },
    );
    if (done) {
      setHighlighted((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, []);

  const pendingKeys = useMemo(
    () => ACCOUNTANT_STEP_KEYS.filter((k) => !completion[k]),
    [completion],
  );

  const highlightPending = useCallback(() => {
    setHighlighted(new Set(ACCOUNTANT_STEP_KEYS.filter((k) => !completion[k])));
  }, [completion]);

  const clearHighlight = useCallback(() => {
    setHighlighted((prev) => (prev.size === 0 ? prev : new Set()));
  }, []);

  const value: AccountantProgressContextValue = useMemo(
    () => ({
      completion,
      pendingKeys,
      highlighted,
      setCompletion,
      setStepDone,
      highlightPending,
      clearHighlight,
    }),
    [
      completion,
      pendingKeys,
      highlighted,
      setCompletion,
      setStepDone,
      highlightPending,
      clearHighlight,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAccountantProgress(): AccountantProgressContextValue {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error("useAccountantProgress called outside AccountantProgressProvider");
  }
  return v;
}

export function useOptionalAccountantProgress(): AccountantProgressContextValue {
  const v = useContext(Ctx);
  if (v) return v;
  return {
    completion: emptyAccountantCompletion(),
    pendingKeys: [...ACCOUNTANT_STEP_KEYS],
    highlighted: new Set(),
    setCompletion: () => {},
    setStepDone: () => {},
    highlightPending: () => {},
    clearHighlight: () => {},
  };
}
