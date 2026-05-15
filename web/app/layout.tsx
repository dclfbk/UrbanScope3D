import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Script from "next/script";

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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
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