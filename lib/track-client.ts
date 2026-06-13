"use client";

/**
 * Lichtgewicht client-tracker (geen externe scripts, geen PII). Genereert een
 * anonieme session-id in localStorage, batcht events en stuurt ze naar
 * /api/track — met sendBeacon bij het verlaten van de pagina.
 */

const SID_KEY = "gents-sid";
type Ev = { type: string; path?: string; handle?: string; query?: string; valueCents?: number; props?: Record<string, unknown> };

let queue: Ev[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function sessionId(): string {
  if (typeof window === "undefined") return "";
  try {
    let sid = localStorage.getItem(SID_KEY);
    if (!sid) {
      sid = (crypto.randomUUID?.() || String(Date.now()) + Math.round(Math.random() * 1e9).toString(36));
      localStorage.setItem(SID_KEY, sid);
    }
    return sid;
  } catch {
    return "";
  }
}

function flush(useBeacon = false) {
  if (!queue.length) return;
  const sid = sessionId();
  const payload = JSON.stringify({ events: queue.map((e) => ({ ...e, sessionId: sid })) });
  queue = [];
  try {
    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon("/api/track", new Blob([payload], { type: "application/json" }));
    } else {
      fetch("/api/track", { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true }).catch(() => {});
    }
  } catch {
    /* stil */
  }
}

export function track(type: string, props: Omit<Ev, "type"> = {}) {
  if (typeof window === "undefined") return;
  queue.push({ type, ...props });
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => flush(false), 2500);
  if (queue.length >= 12) flush(false);
}

let bound = false;
export function bindFlushHandlers() {
  if (bound || typeof window === "undefined") return;
  bound = true;
  const onLeave = () => flush(true);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") onLeave();
  });
  window.addEventListener("pagehide", onLeave);
}
