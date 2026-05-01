import "../styles/globals.css";
import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Playfair_Display } from "next/font/google";
import { SidebarLayout } from "@/components/sidebar-layout";
import { ThemeProvider } from "@/components/theme-provider";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
  display: "swap",
  weight: ["400", "700"],
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "FencingCoach",
  description: "Elite epee performance platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${playfair.variable} ${jetbrains.variable} dark`} suppressHydrationWarning>
      <body className="min-h-screen font-sans antialiased">
        <ThemeProvider>
          <SidebarLayout>{children}</SidebarLayout>
        </ThemeProvider>
      </body>
    </html>
  );
}
