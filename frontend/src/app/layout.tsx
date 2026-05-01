import "../styles/globals.css";
import type { Metadata } from "next";
import { Outfit, JetBrains_Mono } from "next/font/google";
import { SidebarLayout } from "@/components/sidebar-layout";
import { ThemeProvider } from "@/components/theme-provider";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  display: "swap",
  weight: ["400", "500", "700", "900"],
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "FencingCoach AI",
  description: "Elite epee performance platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${outfit.variable} ${jetbrains.variable}`} suppressHydrationWarning>
      <body className="min-h-screen font-sans antialiased">
        <ThemeProvider>
          <SidebarLayout>{children}</SidebarLayout>
        </ThemeProvider>
      </body>
    </html>
  );
}
