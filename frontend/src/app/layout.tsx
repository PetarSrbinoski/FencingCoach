import "../styles/globals.css";
import "../styles/motion.css";
import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import { SidebarLayout } from "@/components/sidebar-layout";
import { AppMotion } from "@/components/app-motion";
import { ThemeProvider } from "@/components/theme-provider";
import { ToastProvider } from "@/components/ui/toast";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "FencingCoach",
  description: "Elite epee performance platform",
  icons: {
    icon: "/CoachIcon2.png",
    apple: "/CoachIcon2.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={manrope.variable} suppressHydrationWarning>
      <body className="min-h-screen font-sans antialiased">
        <ThemeProvider>
          <ToastProvider>
            <AppMotion>
              <SidebarLayout>{children}</SidebarLayout>
            </AppMotion>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
