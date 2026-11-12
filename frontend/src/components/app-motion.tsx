"use client";

import { KineticBackground } from "@/components/kinetic-background";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext, useContext, useEffect, useLayoutEffect, useRef, useState,
  type MouseEvent, type ReactNode,
} from "react";

const ROUTES = ["/", "/weekly", "/training", "/nutrition", "/competitions", "/chat", "/chat/memory", "/garmin", "/profile"];
const MotionContext = createContext({ enabled: true, reduced: false, toggle: () => {} });
export const useAppMotion = () => useContext(MotionContext);

export function AppMotion({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  const previousPath = useRef(pathname);
  const sequence = useRef(0);
  const pending = useRef<{ pathname: string; release: () => void } | null>(null);
  const transition = useRef<ViewTransition | null>(null);
  const animations = useRef<Animation[]>([]);
  const enabled = !paused && !reduced;

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(preference.matches);
    update();
    preference.addEventListener("change", update);
    try { setPaused(localStorage.getItem("coach-motion") === "paused"); } catch { /* Storage may be blocked. */ }
    return () => preference.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.motion = enabled ? "on" : "off";
    if (!enabled) {
      transition.current?.skipTransition();
      animations.current.forEach((animation) => animation.cancel());
    }
    return () => { delete document.documentElement.dataset.motion; };
  }, [enabled]);

  useEffect(() => () => {
    pending.current?.release();
    transition.current?.skipTransition();
    animations.current.forEach((animation) => animation.cancel());
  }, []);

  useLayoutEffect(() => {
    const native = pending.current?.pathname === pathname;
    if (native) {
      pending.current?.release();
      pending.current = null;
    } else {
      // Back/Forward or programmatic navigation must not leave an older route's
      // snapshot above the newly committed page.
      transition.current?.skipTransition();
    }
    const backwards = ROUTES.indexOf(pathname) < ROUTES.indexOf(previousPath.current);
    document.documentElement.dataset.navDirection = backwards ? "backward" : "forward";
    previousPath.current = pathname;
    window.dispatchEvent(new Event("coach:navigate"));
    animations.current.forEach((animation) => animation.cancel());
    animations.current = [];
    if (native || !enabled || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // History, programmatic navigation, and browsers without View Transitions use
    // a clipped reveal on the real DOM: no clones or duplicated form state.
    // Keep real form geometry fixed; reserve perspective for inert snapshots.
    const page = document.querySelector<HTMLElement>("[data-motion-page]");
    if (!page || !page.animate) return;
    animations.current.push(page.animate([
      { opacity: 0, clipPath: backwards ? "inset(0 8% 0 0)" : "inset(0 0 0 8%)" },
      { opacity: 1, clipPath: "inset(0 0 0 0)" },
    ], { duration: 680, easing: "cubic-bezier(.16,1,.3,1)" }));
    const sections = Array.from(page.firstElementChild?.children ?? [])
      .filter((node): node is HTMLElement => node instanceof HTMLElement && node.getBoundingClientRect().top < window.innerHeight)
      .slice(0, 8);
    sections.forEach((section, index) => {
      animations.current.push(section.animate([
        { opacity: 0 },
        { opacity: 1 },
      ], { duration: 560, delay: 60 + index * 42, easing: "cubic-bezier(.16,1,.3,1)", fill: "backwards" }));
    });
  }, [pathname, enabled]);

  function navigate(event: MouseEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
    if (!link || (link.target && link.target !== "_self") || link.hasAttribute("download") || link.getAttribute("href")?.startsWith("#")) return;
    const destination = new URL(link.href, window.location.href);
    if (destination.origin !== window.location.origin || destination.pathname === pathname) return;
    // React's delegated capture can precede native document listeners. Defer to
    // the existing dirty-form guard instead of consuming its navigation event.
    if (document.querySelector('[data-navigation-guard="dirty"]')) return;
    // Modified clicks, query-only changes and hash links retain normal behavior.
    event.preventDefault();
    const href = destination.pathname + destination.search + destination.hash;
    pending.current?.release();
    pending.current = null;
    transition.current?.skipTransition();
    const id = ++sequence.current;
    document.documentElement.dataset.navDirection = ROUTES.indexOf(destination.pathname) < ROUTES.indexOf(pathname) ? "backward" : "forward";
    window.dispatchEvent(new Event("coach:navigate"));
    if (!enabled || !document.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      router.push(href);
      return;
    }
    const next = document.startViewTransition(() => new Promise<void>((resolve) => {
      if (id !== sequence.current) { resolve(); return; }
      // Never freeze the UI indefinitely if a route fails or takes a long time.
      const timer = window.setTimeout(() => {
        if (pending.current?.release === release) pending.current = null;
        resolve();
      }, 1600);
      const release = () => { window.clearTimeout(timer); resolve(); };
      pending.current = { pathname: destination.pathname, release };
      router.push(href);
    }));
    transition.current = next;
    void next.finished.catch(() => { /* Superseded transitions are expected. */ }).finally(() => {
      if (transition.current === next) transition.current = null;
    });
  }

  function toggle() {
    const next = !paused;
    setPaused(next);
    try { localStorage.setItem("coach-motion", next ? "paused" : "on"); } catch { /* Motion still works without persistence. */ }
  }

  return (
    <MotionContext.Provider value={{ enabled, reduced, toggle }}>
      <div className="motion-shell" onClickCapture={navigate}>
        <KineticBackground enabled={enabled} />
        {children}
        {enabled && <div key={pathname} className="route-wake" aria-hidden="true"><span /></div>}
      </div>
    </MotionContext.Provider>
  );
}
