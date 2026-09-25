"use client";

import { Sidebar } from "@/components/sidebar";

export function SidebarLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen relative">
      <Sidebar />
      {/* Main content area — generous spacing, editorial feel */}
      <main className="md:pl-56 min-h-screen">
        <div className="max-w-5xl mx-auto px-4 md:px-12 lg:px-16 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-[calc(7rem+env(safe-area-inset-bottom))] md:py-12">
          {children}
        </div>
      </main>
    </div>
  );
}
