"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useTheme } from "next-themes";
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
  Menu,
  X,
  User,
  Sun,
  Moon,
} from "lucide-react";
import { cn } from "@/lib/utils";

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

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { theme, setTheme } = useTheme();

  function toggleTheme() {
    setTheme(theme === "dark" ? "light" : "dark");
  }

  return (
    <>
      {/* Mobile top bar */}
      <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between border-b border-border bg-background px-6 py-4 md:hidden">
        <button
          className="h-10 w-10 inline-flex items-center justify-center text-foreground"
          onClick={() => setMobileOpen(true)}
        >
          <Menu className="h-5 w-5" strokeWidth={1.5} />
        </button>
        <span className="font-semibold uppercase tracking-widest text-xs text-foreground">Coach</span>
        <button
          className="h-10 w-10 inline-flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors duration-150"
          onClick={toggleTheme}
        >
          <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
        </button>
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-72 transform border-r border-border bg-background transition-transform duration-200 md:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-border">
          <span className="font-semibold uppercase tracking-widest text-sm">FencingCoach</span>
          <button
            className="h-10 w-10 inline-flex items-center justify-center text-muted-foreground hover:text-foreground"
            onClick={() => setMobileOpen(false)}
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>
        <nav className="flex flex-col py-4">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  "relative flex items-center gap-3 px-6 py-3.5 text-sm font-medium uppercase tracking-wider transition-colors duration-150",
                  active
                    ? "text-accent"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {active && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-accent" />
                )}
                <item.icon className="h-4 w-4" strokeWidth={1.5} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="absolute bottom-0 left-0 right-0 border-t border-border px-6 py-4">
          <div className="space-y-3">
            <button
              onClick={toggleTheme}
              className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors duration-150"
            >
              <Sun className="h-3.5 w-3.5 dark:hidden" />
              <Moon className="h-3.5 w-3.5 hidden dark:block" />
              <span>{theme === "dark" ? "Dark" : "Light"}</span>
            </button>
          </div>
        </div>
      </aside>

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
                className={cn(
                  "group relative flex items-center text-xs font-medium uppercase tracking-wider transition-colors duration-150",
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

        {/* Bottom: theme toggle + collapse */}
        <div className="border-t border-border p-3 shrink-0 space-y-3">
          <div className="flex items-center justify-between">
            <button
              className="h-8 w-8 inline-flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors duration-150"
              onClick={toggleTheme}
              title="Toggle theme"
            >
              <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
              <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
            </button>
            <button
              className="h-8 w-8 inline-flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors duration-150"
              onClick={() => setCollapsed(!collapsed)}
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
