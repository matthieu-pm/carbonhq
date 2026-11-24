import type { Metadata } from "next";
import { Presentation } from "./Presentation";

export const metadata: Metadata = {
  title: "Carbon presentation",
  description: "Explore Carbon’s agents, coding workspace, and canvas in an interactive presentation.",
  robots: { index: false, follow: false },
};

export default function PresentationPage() {
  return <Presentation />;
}
