"use client";

import { Sidebar } from "@/components/sidebar";
import { cn } from "@/lib/utils";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export function SidebarLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const chat = pathname === "/chat";
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      const height = viewport?.height ?? window.innerHeight;
      const editing = document.activeElement?.matches(
        "input, textarea, [contenteditable=true]",
      );
      const keyboard = Boolean(editing && window.innerHeight - height > 120);
      document.documentElement.style.setProperty("--app-height", `${height}px`);
      document.documentElement.style.setProperty(
        "--viewport-top",
        `${viewport?.offsetTop ?? 0}px`,
      );
      document.documentElement.style.setProperty(
        "--keyboard-inset",
        `${keyboard ? Math.max(0, window.innerHeight - height - (viewport?.offsetTop ?? 0)) : 0}px`,
      );
      document.documentElement.dataset.keyboard = String(keyboard);
    };
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
    };
  }, []);
  return (
    <div className="min-h-dvh relative">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[200] focus:rounded-xl focus:bg-card focus:p-3"
      >
        Skip to main content
      </a>
      <Sidebar collapsed={collapsed} onCollapsedChange={setCollapsed} />
      <main
        id="main-content"
        tabIndex={-1}
        className={cn(
          "min-w-0 min-h-dvh",
          collapsed ? "lg:pl-[4.5rem]" : "lg:pl-56",
        )}
      >
        <div
          className={cn(
            "mx-auto min-w-0 max-w-5xl px-4 lg:px-8",
            chat
              ? "pt-[calc(0.75rem+env(safe-area-inset-top))] pb-0"
              : "pt-[calc(1.5rem+env(safe-area-inset-top))] pb-[calc(var(--dock-space)+1rem)] lg:pt-8",
          )}
        >
          {children}
        </div>
      </main>
    </div>
  );
}
