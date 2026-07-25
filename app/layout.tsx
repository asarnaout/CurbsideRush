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
  const imageUrl = new URL("/og.jpg", origin).toString();

  return {
    title: "Curbside Rush",
    description:
      "A low-poly open-world 3D driving game — run deliveries and passenger fares across five world cities, each with its own currency and side of the road.",
    applicationName: "Curbside Rush",
    // The Fullscreen API reclaims the browser chrome mid-drive, but only while
    // the tab is open. Added to the Home Screen there is no chrome to reclaim —
    // which on iOS is the only way to get a genuinely full screen for the whole
    // session, since Safari ties its own toolbar hiding to scrolling and the
    // drive screen is deliberately unscrollable.
    manifest: "/manifest.webmanifest",
    appleWebApp: {
      // Deliberately no `capable` here: vinext's shim renders only `title` and
      // `statusBarStyle` from this block and drops the rest, so declaring it
      // would look right and do nothing. It goes through `other` below, which
      // the shim does emit verbatim.
      title: "Curbside Rush",
      statusBarStyle: "black-translucent",
    },
    // Only the apple- form: the shim already emits `mobile-web-app-capable`
    // itself, and declaring it here too just duplicates the tag.
    other: {
      "apple-mobile-web-app-capable": "yes",
    },
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
          // 1200x630 is the card size every platform lays out for; the file is
          // a ~181 KB JPEG because WhatsApp drops preview images past ~300 KB.
          url: imageUrl,
          width: 1200,
          height: 630,
          alt: "Curbside Rush key art: a bicycle, motorbike and blue sedan on a New York street under the title Rise and Grind",
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
