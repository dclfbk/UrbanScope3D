import type { Metadata } from "next";
import { Geist, Geist_Mono, Hanken_Grotesk } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import Script from "next/script";

// Font di brand Talea: Calibre Semibold (Klim), licenza Talea. Il .woff2 sta in
// web/public/fonts ed e' committato nel repo. E' l'unico peso fornito: lo usiamo
// come font primario dell'intera UI. Hanken Grotesk resta come fallback vicino.
const calibre = localFont({
  src: "../public/fonts/calibre-semibold.woff2",
  variable: "--font-calibre",
  weight: "600",
  display: "swap",
});

const hankenGrotesk = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "UrbanScope3D",
  description: "3D Urban Analysis Platform - Bologna",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="it"
      className={`${calibre.variable} ${hankenGrotesk.variable} ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <link
          rel="stylesheet"
          href="https://cesium.com/downloads/cesiumjs/releases/1.122/Build/Cesium/Widgets/widgets.css"
        />
      </head>
      <body className="min-h-full flex flex-col">
        <Script
          src="https://cesium.com/downloads/cesiumjs/releases/1.122/Build/Cesium/Cesium.js"
          strategy="beforeInteractive"
        />
        {children}
      </body>
    </html>
  );
}