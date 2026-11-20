import type { Metadata, Viewport } from "next";
import { SITE } from "@/lib/links";
import { TowerShift } from "./TowerShift";

const title = "Tower Shift · Carbon Arcade";
const description = "Climb a dark server tower with four coding agents. Recruit your crew, repair the machinery, and bring the rooftop antenna back online.";
const url = SITE + "/game";
const image = { url: SITE + "/game/tower-shift.webp", width: 1942, height: 809, alt: "A technician on the sunlit catwalk of a server tower." };

export const viewport: Viewport = { viewportFit: "cover", themeColor: "#18212b" };

export const metadata: Metadata = {
  title, description, alternates: { canonical: url },
  openGraph: { title, description, url, type: "website", siteName: "Carbon Arcade", images: [image] },
  twitter: { card: "summary_large_image", title, description, images: [image] },
};

export default function GamePage() {
  return <TowerShift />;
}
