import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { Providers } from "@/components/providers";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "PERSIS — Tender Analysis & Pricing Intelligence",
  description:
    "Upload a tender once. PERSIS structures the requirements, generates a BOQ, analyses pricing, and gives Malaysian contractors a transparent commercial starting point.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} antialiased`}>
        <Providers><ThemeProvider>{children}</ThemeProvider></Providers>
      </body>
    </html>
  );
}
