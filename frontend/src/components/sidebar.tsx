"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Home,
  CalendarDays,
  Dumbbell,
  Utensils,
  Trophy,
  MessageCircle,
  Watch,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  X,
  User,
  Sun,
  Moon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LlmProviderToggle } from "@/components/llm-provider-toggle";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: Home },
  { href: "/weekly", label: "Weekly", icon: CalendarDays },
  { href: "/training", label: "Training", icon: Dumbbell },
  { href: "/nutrition", label: "Nutrition", icon: Utensils },
  { href: "/competitions", label: "Competitions", icon: Trophy },
  { href: "/chat", label: "Coach Chat", icon: MessageCircle },
  { href: "/garmin", label: "Garmin", icon: Watch },
  { href: "/profile", label: "Profile", icon: User },
];

const DOCK_ITEMS = [
  { ...NAV_ITEMS[0], label: "Home" },
  NAV_ITEMS[2],
  NAV_ITEMS[3],
  { ...NAV_ITEMS[5], label: "Coach" },
];
const MORE_ITEMS = NAV_ITEMS.filter(
  (item) => !DOCK_ITEMS.some((dockItem) => dockItem.href === item.href)
);

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 768px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setMobileOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  useEffect(() => setMobileOpen(false), [pathname]);

  function toggleTheme() {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  }

  return (
    <>
      <Dialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <nav
          aria-label="Mobile navigation"
          className="fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-40 mx-auto grid max-w-md grid-cols-5 gap-1 rounded-[1.25rem] border border-border bg-card/95 p-1.5 shadow-[0_8px_32px_rgba(0,0,0,0.18)] backdrop-blur-xl md:hidden"
        >
          {DOCK_ITEMS.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-[0.875rem] text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  active ? "bg-accent/10 text-accent" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <item.icon aria-hidden="true" className="h-5 w-5" strokeWidth={active ? 2 : 1.5} />
                {item.label}
              </Link>
            );
          })}
          <Dialog.Trigger asChild>
            <button
              aria-label="More navigation and settings"
              className={cn(
                "flex min-h-14 flex-col items-center justify-center gap-1 rounded-[0.875rem] text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                mobileOpen || MORE_ITEMS.some((item) => pathname === item.href)
                  ? "bg-accent/10 text-accent"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <MoreHorizontal aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
              More
            </button>
          </Dialog.Trigger>
        </nav>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm md:hidden" />
          <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[85dvh] max-w-lg overflow-y-auto overscroll-contain rounded-t-3xl border border-border bg-card px-5 pt-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-xl focus:outline-none md:hidden">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <Dialog.Title className="text-lg font-semibold">More from Coach</Dialog.Title>
                <Dialog.Description className="mt-1 text-sm text-muted-foreground">Plan your week and manage your settings.</Dialog.Description>
              </div>
              <Dialog.Close className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" aria-label="Close navigation">
                <X aria-hidden="true" className="h-5 w-5" />
              </Dialog.Close>
            </div>
            <nav aria-label="More navigation" className="grid grid-cols-2 gap-2">
              {MORE_ITEMS.map((item) => {
                const active = pathname === item.href;
                return (
                  <Dialog.Close asChild key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex min-h-16 items-center gap-3 rounded-[0.875rem] px-3 py-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                        active ? "bg-accent/10 text-accent" : "bg-muted/60 text-foreground hover:bg-muted"
                      )}
                    >
                      <item.icon aria-hidden="true" className="h-5 w-5 shrink-0" strokeWidth={1.5} />
                      {item.label}
                    </Link>
                  </Dialog.Close>
                );
              })}
            </nav>
            <div className="mt-5 space-y-4 border-t border-border pt-4">
              <button
                onClick={toggleTheme}
                className="flex min-h-11 w-full items-center gap-3 rounded-[0.875rem] px-3 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <Sun aria-hidden="true" className="h-5 w-5 dark:hidden" />
                <Moon aria-hidden="true" className="hidden h-5 w-5 dark:block" />
                Toggle color theme
              </button>
              <div className="px-3 [&_button]:min-h-11">
                <LlmProviderToggle />
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden md:flex flex-col fixed inset-y-0 left-0 z-40 border-r border-border bg-background transition-all duration-200",
          collapsed ? "w-[4.5rem]" : "w-56"
        )}
      >
        {/* Logo */}
        <div
          className={cn(
            "flex items-center h-16 shrink-0 border-b border-border",
            collapsed ? "justify-center px-2" : "px-5 gap-2"
          )}
        >
          {/* Accent mark */}
          <span className="h-4 w-1 bg-accent shrink-0" />
          {!collapsed && (
            <span className="font-semibold uppercase tracking-widest text-xs">
              Coach
            </span>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 flex flex-col py-4 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href;

            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group relative flex items-center text-xs font-medium uppercase tracking-wider transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
                  collapsed ? "justify-center px-2 py-3.5" : "gap-3 px-5 py-2.5",
                  active
                    ? "text-accent"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {active && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-accent" />
                )}
                <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                {!collapsed && item.label}
              </Link>
            );
          })}
        </nav>

        {/* Bottom: LLM provider toggle + theme toggle + collapse */}
        <div className="border-t border-border p-3 shrink-0 space-y-3">
          {!collapsed && <LlmProviderToggle />}
          <div className={cn("flex items-center", collapsed ? "flex-col gap-2" : "justify-between")}>
            {collapsed && <LlmProviderToggle collapsed />}
            <button
              className="h-8 w-8 inline-flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              onClick={toggleTheme}
              title="Toggle theme"
              aria-label="Toggle color theme"
            >
              <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
              <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
            </button>
            <button
              className="h-8 w-8 inline-flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              onClick={() => setCollapsed(!collapsed)}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? (
                <ChevronRight className="h-4 w-4" strokeWidth={1.5} />
              ) : (
                <ChevronLeft className="h-4 w-4" strokeWidth={1.5} />
              )}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
