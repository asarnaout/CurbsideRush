import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host?.startsWith("localhost") ? "http" : "https");
  const origin = host ? `${protocol}://${host}` : "http://localhost:3000";
  const imageUrl = new URL("/og.png", origin).toString();

  return {
    title: "Curbside Rush",
    description:
      "A low-poly open-world 3D driving game — run deliveries and passenger fares across five world cities, each with its own currency and side of the road.",
    applicationName: "Curbside Rush",
    icons: {
      // Versioned deliberately. favicon.svg was byte-identical from the repo's
      // first commit until the mark finally replaced the pre-rebrand SideSwap
      // icon, so every returning visitor has the old one cached — and browsers
      // cache favicons far more stubbornly than pages, past a hard reload and
      // often past an incognito window. A changed URL is the only bust they
      // cannot ignore. Bump this whenever the icon's artwork changes.
      icon: "/favicon.svg?v=2",
    },
    keywords: [
      "driving game",
      "delivery game",
      "gig economy game",
      "open world driving",
      "3D web game",
      "low poly",
    ],
    openGraph: {
      title: "Curbside Rush",
      description:
        "Rise and grind — run gig deliveries and fares across low-poly cities from London to Tokyo.",
      type: "website",
      siteName: "Curbside Rush",
      url: origin,
      images: [
        {
          url: imageUrl,
          width: 1568,
          height: 1003,
          alt: "Curbside Rush low-poly London driving scene in South Kensington",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "Curbside Rush",
      description:
        "Rise and grind — run gig deliveries and fares across low-poly cities from London to Tokyo.",
      images: [imageUrl],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
