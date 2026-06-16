import type { Metadata } from "next";
import { Geist, Geist_Mono, Hanken_Grotesk } from "next/font/google";
import "./globals.css";
import Script from "next/script";

// Font di brand Talea. Il manuale indica "Calibre Semibold", che e' un font
// commerciale (Klim) non distribuibile liberamente: usiamo Hanken Grotesk,
// grottesco geometrico-umanista molto vicino a Calibre. Se in futuro si
// avranno i .woff2 di Calibre con licenza, sostituire con next/font/local
// senza toccare il resto della UI: la variabile --font-hanken resta il nome
// usato da globals.css.
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
      className={`${hankenGrotesk.variable} ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
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