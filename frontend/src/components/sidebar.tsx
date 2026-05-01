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
  Circle,
  Square,
  Triangle,
  Sun,
  Moon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

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
      <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between border-b-2 border-foreground bg-card px-4 py-3 md:hidden">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          onClick={() => setMobileOpen(true)}
        >
          <Menu className="h-5 w-5" strokeWidth={2.5} />
        </Button>
        {/* Geometric logo */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <Circle className="h-3 w-3 fill-bauhaus-red text-bauhaus-red" />
            <Square className="h-3 w-3 fill-bauhaus-blue text-bauhaus-blue" />
            <Triangle className="h-3 w-3 fill-bauhaus-yellow text-bauhaus-yellow" />
          </div>
          <span className="font-black uppercase tracking-tighter text-sm">Coach</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          onClick={toggleTheme}
        >
          <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
        </Button>
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-50 bg-foreground/60 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 transform border-r-2 border-foreground bg-card transition-transform duration-200 ease-out md:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex items-center justify-between p-4 border-b-2 border-foreground">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <Circle className="h-3 w-3 fill-bauhaus-red text-bauhaus-red" />
              <Square className="h-3 w-3 fill-bauhaus-blue text-bauhaus-blue" />
              <Triangle className="h-3 w-3 fill-bauhaus-yellow text-bauhaus-yellow" />
            </div>
            <span className="font-black uppercase tracking-tighter">FencingCoach</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setMobileOpen(false)}
          >
            <X className="h-4 w-4" strokeWidth={2.5} />
          </Button>
        </div>
        <nav className="flex flex-col gap-0 p-0 flex-1">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  "flex items-center gap-3 px-5 py-3.5 text-sm font-bold uppercase tracking-wider border-b border-foreground/10 transition-all duration-100",
                  active
                    ? "bg-bauhaus-yellow text-foreground"
                    : "text-foreground hover:bg-muted"
                )}
              >
                <item.icon className="h-4 w-4" strokeWidth={2} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        {/* Mobile theme toggle at bottom of drawer */}
        <div className="border-t-2 border-foreground p-3 flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Theme</span>
          <Button variant="outline" size="sm" onClick={toggleTheme} className="h-8 gap-2">
            <Sun className="h-3.5 w-3.5 dark:hidden" />
            <Moon className="h-3.5 w-3.5 hidden dark:block" />
            <span className="text-xs font-bold uppercase">{theme === "dark" ? "Dark" : "Light"}</span>
          </Button>
        </div>
      </aside>

      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden md:flex flex-col fixed inset-y-0 left-0 z-40 border-r-2 border-foreground bg-card transition-all duration-200 ease-out",
          collapsed ? "w-[4.5rem]" : "w-56"
        )}
      >
        {/* Logo */}
        <div
          className={cn(
            "flex items-center border-b-2 border-foreground h-14 shrink-0",
            collapsed ? "justify-center px-2" : "px-4 gap-2"
          )}
        >
          <div className="flex items-center gap-1 shrink-0">
            <Circle className="h-3 w-3 fill-bauhaus-red text-bauhaus-red" />
            <Square className="h-3 w-3 fill-bauhaus-blue text-bauhaus-blue" />
            <Triangle className="h-3 w-3 fill-bauhaus-yellow text-bauhaus-yellow" />
          </div>
          {!collapsed && (
            <span className="font-black uppercase tracking-tighter text-sm">
              FencingCoach
            </span>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 flex flex-col gap-0 overflow-y-auto">
          {NAV_ITEMS.map((item, idx) => {
            const active = pathname === item.href;
            const accentColors = ["bg-bauhaus-red", "bg-bauhaus-blue", "bg-bauhaus-yellow"];
            const accentColor = accentColors[idx % 3];

            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                className={cn(
                  "group relative flex items-center text-xs font-bold uppercase tracking-wider border-b border-foreground/10 transition-all duration-100",
                  collapsed ? "justify-center px-2 py-3.5" : "gap-3 px-4 py-2.5",
                  active
                    ? "bg-bauhaus-yellow text-foreground"
                    : "text-foreground hover:bg-muted"
                )}
              >
                {active && (
                  <div className={cn("absolute left-0 top-0 bottom-0 w-1", accentColor)} />
                )}
                <item.icon className="h-4 w-4 shrink-0" strokeWidth={2} />
                {!collapsed && item.label}
              </Link>
            );
          })}
        </nav>

        {/* Bottom: theme toggle + collapse */}
        <div className="border-t-2 border-foreground p-2 flex items-center justify-between shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={toggleTheme}
            title="Toggle theme"
          >
            <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" strokeWidth={2.5} />
            ) : (
              <ChevronLeft className="h-4 w-4" strokeWidth={2.5} />
            )}
          </Button>
        </div>
      </aside>
    </>
  );
}
