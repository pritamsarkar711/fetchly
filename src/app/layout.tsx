import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fetchly - Fetch Videos from Any URL",
  description: "Paste any video URL and instantly get download links. Supports MixDrop and more.",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Work+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body className="min-h-full font-sans antialiased bg-white text-[#171717]">
        {children}
      </body>
    </html>
  );
}
