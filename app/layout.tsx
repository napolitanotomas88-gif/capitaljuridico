import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Despacho · Capital Jurídico",
  description: "Despacho de Capital Jurídico",
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
