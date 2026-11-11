import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "3D Extreme Sky Parkour – AI BOT & YouTube Live",
  description: "A procedural 3D sky parkour game with an autonomous AI bot and a talking character that answers YouTube Live Chat.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-sky-300 text-white antialiased">{children}</body>
    </html>
  );
}
