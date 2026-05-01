"use client";

import { Sidebar } from "@/components/sidebar";

export function SidebarLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen relative">
      <Sidebar />
      {/* Main content area — offset by sidebar width on desktop, top bar on mobile */}
      <main className="md:pl-56 pt-16 md:pt-0 min-h-screen">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-8">
          {children}
        </div>
      </main>
    </div>
  );
}
