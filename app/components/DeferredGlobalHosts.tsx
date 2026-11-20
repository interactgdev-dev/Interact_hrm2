"use client";

import dynamic from "next/dynamic";
import React from "react";

/** Keep first-paint JS light — probe after idle. */
const AdminActivityProbe = dynamic(
  () =>
    import("./AdminActivityProbe").then((m) => m.AdminActivityProbe),
  { ssr: false, loading: () => null },
);

function runWhenIdle(cb: () => void, timeout = 4000) {
  if (typeof window === "undefined") return () => {};
  const w = window as Window & {
    requestIdleCallback?: (fn: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  const id = w.requestIdleCallback
    ? w.requestIdleCallback(cb, { timeout })
    : window.setTimeout(cb, 800);
  return () => {
    if (w.cancelIdleCallback) w.cancelIdleCallback(id);
    else window.clearTimeout(id as number);
  };
}

export function DeferredGlobalHosts() {
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => runWhenIdle(() => setReady(true), 4500), []);
  if (!ready) return null;
  return <AdminActivityProbe />;
}
