"use client";

import { useEffect, useRef, useState } from "react";
import { SLButton } from "@/components/sl-button";
import { Avatar } from "@/components/avatar";

type Props = {
  onChange: (file: File | null) => void;
  size?: number;
  // When the user hasn't chosen a new file yet, the built-in preview shows
  // the current avatar instead of the person-silhouette placeholder — this
  // is what gets displayed today, not a "before/after" pair. Pass the same
  // fields the Avatar component takes.
  currentPath?: string | null;
  currentName?: string | null;
  currentEmail?: string | null;
};

export function AvatarPicker({
  onChange,
  size = 96,
  currentPath = null,
  currentName = null,
  currentEmail = null,
}: Props) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [mode, setMode] = useState<"idle" | "camera">("idle");
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      // Cleanup camera when unmounted
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [stream]);

  useEffect(() => {
    if (mode === "camera" && stream && videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [mode, stream]);

  const setFile = (file: File | null) => {
    onChange(file);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(file ? URL.createObjectURL(file) : null);
  };

  const openCamera = async () => {
    setError(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });
      setStream(s);
      setMode("camera");
    } catch {
      setError(
        "Camera access was blocked. Grant permission in your browser, or upload a file instead.",
      );
    }
  };

  const closeCamera = () => {
    stream?.getTracks().forEach((t) => t.stop());
    setStream(null);
    setMode("idle");
  };

  const snap = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `camera-${Date.now()}.jpg`, {
          type: "image/jpeg",
        });
        setFile(file);
        closeCamera();
      },
      "image/jpeg",
      0.9,
    );
  };

  const onUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Image must be under 5 MB.");
      return;
    }
    setError(null);
    setFile(file);
  };

  const clear = () => {
    setFile(null);
    if (uploadInputRef.current) uploadInputRef.current.value = "";
  };

  if (mode === "camera") {
    return (
      <div className="rounded-2xl border border-line bg-paper p-3">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full max-w-sm rounded-xl bg-black"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <SLButton type="button" variant="primary" onClick={snap}>
            Snap photo
          </SLButton>
          <button
            type="button"
            onClick={closeCamera}
            className="btn-sl btn-sl-ghost"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4">
      {previewUrl ? (
        // A file is selected — show the new photo as an inline preview.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={previewUrl}
          alt="Selected avatar"
          className="shrink-0 rounded-full border border-line object-cover"
          style={{ width: size, height: size }}
        />
      ) : (
        // No new file yet — render the current avatar (photo or initials).
        <Avatar
          path={currentPath}
          name={currentName}
          email={currentEmail}
          size={size}
        />
      )}
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap gap-2">
          <SLButton type="button" variant="outline" onClick={openCamera}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M23 19V8a2 2 0 0 0-2-2h-3.17L16 4H8L6.17 6H3a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            Take photo
          </SLButton>
          <SLButton
            type="button"
            variant="outline"
            onClick={() => uploadInputRef.current?.click()}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Upload
          </SLButton>
          {previewUrl ? (
            <button
              type="button"
              onClick={clear}
              className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate hover:text-red-600"
            >
              Remove
            </button>
          ) : null}
        </div>
        <input
          ref={uploadInputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={onUpload}
        />
        {error ? (
          <p className="text-xs font-medium text-red-700">{error}</p>
        ) : null}
      </div>
    </div>
  );
}
