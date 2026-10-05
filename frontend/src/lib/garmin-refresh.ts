"use client";

import { useEffect, useRef } from "react";
import { api } from "@/lib/api";

const EVENT = "coachapp:garmin-sync-complete";
const STORAGE_KEY = "coachapp:garmin-sync-complete";

export function announceGarminSync() {
  localStorage.setItem(STORAGE_KEY, String(Date.now()));
  window.dispatchEvent(new Event(EVENT));
}

export function useGarminSyncObserver(onRefresh: () => void) {
  const callback = useRef(onRefresh);
  callback.current = onRefresh;

  useEffect(() => {
    let lastToken: string | null | undefined;
    let active = true;
    let polling = false;
    const check = async () => {
      if (polling) return;
      polling = true;
      try {
        const status = await api.garmin.status();
        if (!active) return;
        if (lastToken !== undefined && status.last_sync_at !== lastToken) callback.current();
        lastToken = status.last_sync_at;
      } catch { /* The next bounded poll retries. */ }
      finally { polling = false; }
    };
    const onEvent = () => { lastToken = undefined; callback.current(); void check(); };
    const onFocus = () => { lastToken = undefined; callback.current(); void check(); };
    void check();
    const timer = window.setInterval(check, 15_000);
    window.addEventListener(EVENT, onEvent);
    window.addEventListener("storage", onEvent);
    window.addEventListener("focus", onFocus);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener(EVENT, onEvent);
      window.removeEventListener("storage", onEvent);
      window.removeEventListener("focus", onFocus);
    };
  }, []);
}
