"use client";

import { randomUUID } from "@/lib/uuid";

import { useEffect, useRef } from "react";

const EVENT = "agent-action-changed";
const STORAGE_KEY = "coachapp:workflow-change";

export function announceWorkflowChange() {
  try { localStorage.setItem(STORAGE_KEY, randomUUID()); } catch { /* Focus also refreshes affected views. */ }
  window.dispatchEvent(new Event(EVENT));
}

export function useWorkflowRefresh(onRefresh: () => void) {
  const callback = useRef(onRefresh);
  callback.current = onRefresh;
  useEffect(() => {
    const refresh = () => callback.current();
    const storage = (event: StorageEvent) => { if (event.key === STORAGE_KEY) refresh(); };
    window.addEventListener(EVENT, refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", storage);
    return () => {
      window.removeEventListener(EVENT, refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", storage);
    };
  }, []);
}
