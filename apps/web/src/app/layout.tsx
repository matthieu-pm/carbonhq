import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import Script from "next/script";
import { SCHEME_SCRIPT } from "@/components/home/scheme";
import { SITE } from "@/lib/links";
import "./globals.css";

// The app loads these through fontsource; here they come from next/font so the
// site self-hosts them and ships only the subset it uses.
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// The homepage's face, as drawn in Paper. Variable, so one file covers the
// light headlines and the regular body.
const inter = Inter({ variable: "--font-inter-sans", subsets: ["latin"] });

const title = "Carbon - Run every coding agent in one app.";
const description =
  "Supports Claude Code, Codex, Grok, pi and fx. Free and open source, runs on the subscriptions you already have.";

// Share images must use the public domain, even on a Vercel deployment URL.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || SITE;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  openGraph: { title, description, type: "website", siteName: "Carbon" },
  twitter: { card: "summary_large_image", title, description },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // The font variables go on <html>, not <body>: `@theme` resolves
    // `--font-sans: var(--font-geist-sans)` at `:root`, so a variable defined
    // one level down resolves to nothing and every utility silently falls back
    // to the system stack. `data-scroll-behavior` keeps a route change jumping
    // to the top rather than gliding there: Next 16 no longer overrides the
    // smooth scroll `globals.css` sets for anchor links unless asked.
    // `data-scheme` is set by the script below before paint, so it differs
    // from the server's HTML by design.
    <html
      lang="en"
      data-theme="dark"
      suppressHydrationWarning
      data-scroll-behavior="smooth"
      className={`${geistSans.variable} ${geistMono.variable} ${inter.variable}`}
    >
      {/* Nothing analytics-shaped mounts here: PostHog starts from
          `src/instrumentation-client.ts`, which Next runs before hydration. */}
      <body className="font-sans">
        <Script id="scheme" strategy="beforeInteractive">
          {SCHEME_SCRIPT}
        </Script>
        {children}
      </body>
    </html>
  );
}
