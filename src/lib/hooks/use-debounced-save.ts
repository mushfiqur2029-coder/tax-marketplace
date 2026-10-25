"use client";

// Shared live-save hook for the rebuilt PCH intake. Every input in
// sections 1-15 calls one of these per field: the user types, the
// value lands in local state immediately so the input never feels
// laggy, and the server-side save fires after a short quiet period
// so we don't DDoS pch_cases on every keystroke. The hook tracks
// its own "idle | saving | saved | error" status so the field can
// render a tiny tick / spinner / retry line without each caller
// having to wire that up.

import { useCallback, useEffect, useRef, useState } from "react";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

type Options<T> = {
  // Starts as whatever the server rendered. Changing this prop later
  // (e.g. a live-merge pushes a fresh row in from the accountant side)
  // syncs the local value only when the user isn't actively typing;
  // we never fight the client's own in-flight edit.
  initial: T;
  // The save function. Return nothing on success, throw / reject on
  // failure. Called at most once per debounce window.
  save: (value: T) => Promise<void>;
  // Milliseconds of quiet keystrokes before the save fires.
  debounceMs?: number;
  // How long the "Saved" state lingers before fading back to idle.
  savedForMs?: number;
};

export function useDebouncedSave<T>({
  initial,
  save,
  debounceMs = 500,
  savedForMs = 1500,
}: Options<T>) {
  const [value, setValue] = useState<T>(initial);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  // Latest in-flight value, so a save callback that's still running
  // when the user types again doesn't overwrite the newer local state
  // after the fact.
  const latest = useRef<T>(initial);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef<boolean>(false);
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  // Sync server-pushed updates (useLiveRow) when the user isn't typing.
  // Shallow equality is fine because every live-saved field in this
  // intake is a primitive or a null; a repeat value doesn't bump state.
  useEffect(() => {
    if (!isTypingRef.current && initial !== latest.current) {
      latest.current = initial;
      setValue(initial);
    }
  }, [initial]);

  const flush = useCallback(async () => {
    const toSave = latest.current;
    setStatus("saving");
    setError(null);
    try {
      await saveRef.current(toSave);
      // Guard: if the user kept typing while we were saving, the newer
      // value is already queued on a later timer and will re-flush;
      // don't flip to "saved" over the top of a pending edit.
      if (latest.current === toSave) {
        setStatus("saved");
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
        savedTimerRef.current = setTimeout(() => setStatus("idle"), savedForMs);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      setStatus("error");
    }
  }, [savedForMs]);

  const onChange = useCallback(
    (next: T) => {
      isTypingRef.current = true;
      latest.current = next;
      setValue(next);
      setStatus("idle");
      setError(null);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        isTypingRef.current = false;
        void flush();
      }, debounceMs);
    },
    [debounceMs, flush],
  );

  // Fire a pending save immediately on unmount so navigating away mid-
  // typing-pause doesn't lose the last keystroke.
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        isTypingRef.current = false;
        void flush();
      }
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, [flush]);

  return { value, onChange, status, error };
}
