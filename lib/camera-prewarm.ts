"use client";

/**
 * Open the webcam as early as possible (before React / face-api).
 * Guard embed: call this FIRST so "Starting camera…" is not waiting on TF.js.
 */

const GLOBAL_KEY = "__hrmCameraPrewarm";

type PrewarmState = {
  promise: Promise<MediaStream | null>;
  stream: MediaStream | null;
};

function getState(): PrewarmState | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as Record<string, PrewarmState | undefined>)[GLOBAL_KEY] ?? null;
}

function setState(state: PrewarmState) {
  (window as unknown as Record<string, PrewarmState>)[GLOBAL_KEY] = state;
}

async function openCameraFast(): Promise<MediaStream | null> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return null;
  }
  // Bare `video: true` is the fastest path in Chrome/WebView2 (no device enum / facingMode).
  try {
    return await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  } catch {
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });
    } catch {
      return null;
    }
  }
}

/** Fire-and-forget; safe to call multiple times. */
export function startCameraPrewarm(): void {
  if (typeof window === "undefined") return;
  if (getState()) return;
  const promise = openCameraFast().then((stream) => {
    const s = getState();
    if (s) s.stream = stream;
    return stream;
  });
  setState({ promise, stream: null });
}

/** Take ownership of the prewarmed stream (caller must stop tracks when done). */
export async function takePrewarmedCamera(): Promise<MediaStream | null> {
  startCameraPrewarm();
  const state = getState();
  if (!state) return openCameraFast();
  const stream = await state.promise;
  // Clear so a later session starts fresh; caller owns this stream.
  (window as unknown as Record<string, PrewarmState | undefined>)[GLOBAL_KEY] = undefined;
  if (stream && stream.getTracks().some((t) => t.readyState === "live")) {
    return stream;
  }
  return openCameraFast();
}
