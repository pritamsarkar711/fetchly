import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fetchly - Fetch Videos from Any URL",
  description: "Paste any video URL and instantly get download links. Supports MixDrop, direct video URLs, and more. Fast, free, no sign-up required.",
  keywords: ["video downloader", "mixdrop downloader", "fetch video", "video URL extractor", "download video from url"],
  openGraph: {
    title: "Fetchly - Paste URL, Get Video",
    description: "Instantly fetch video download links from any supported URL. Supports MixDrop and direct video links.",
    type: "website",
    siteName: "Fetchly",
  },
  twitter: {
    card: "summary_large_image",
    title: "Fetchly - Video URL Fetcher",
    description: "Paste any video URL and instantly fetch download links.",
  },
  icons: {
    icon: "/favicon.ico",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full font-sans antialiased bg-white text-[#171717]">
        {children}
      </body>
    </html>
  );
}
