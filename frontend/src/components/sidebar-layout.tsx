"use client";

import { Sidebar } from "@/components/sidebar";

export function SidebarLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen relative">
      <Sidebar />
      {/* Main content area — generous spacing, editorial feel */}
      <main className="md:pl-56 pt-16 md:pt-0 min-h-screen">
        <div className="max-w-5xl mx-auto px-6 md:px-12 lg:px-16 py-8 md:py-12">
          {children}
        </div>
      </main>
    </div>
  );
}
