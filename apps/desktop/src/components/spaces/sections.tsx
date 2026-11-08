import { Columns3, FileText, Folder, Image, Presentation, Trash2, type LucideIcon } from "lucide-react";
import GoogleDriveIcon from "@/components/GoogleDriveIcon";
import LinearIcon from "@/components/LinearIcon";
import type { Section, SpaceTab } from "@/lib/spaceTabs";
import type { Project } from "@/types/events";

type Icon = LucideIcon | typeof LinearIcon;

/// What the sidebar picks. Slides, Images and Google Drive hold nothing yet and
/// say so; All and Pages are the same list until a second kind exists.
export const SECTIONS: { id: Exclude<Section, "trash">; label: string; Icon: Icon }[] = [
  { id: "all", label: "All", Icon: Columns3 },
  { id: "pages", label: "Pages", Icon: FileText },
  { id: "slides", label: "Slides", Icon: Presentation },
  { id: "images", label: "Images", Icon: Image },
  { id: "drive", label: "Google Drive", Icon: GoogleDriveIcon },
  { id: "linear", label: "Linear", Icon: LinearIcon },
];

export const COMING: Partial<Record<Section, { Icon: Icon; title: string; body: string }>> = {
  slides: { Icon: Presentation, title: "Slides are on the way", body: "Decks you make with your agents will live here, beside your Pages." },
  images: { Icon: Image, title: "Images are on the way", body: "Images you make or upload will gather here." },
  drive: { Icon: GoogleDriveIcon, title: "Google Drive is on the way", body: "Connect Drive to browse its documents and work on them with your agents." },
};

/// What a tab, and the list's own heading, are called: the Page it shows, else
/// the project narrowing it, else its section.
export function spaceTabTitle(tab: SpaceTab, projects: Project[]): string {
  if (tab.page) return tab.page.title || "Untitled";
  const { section, project } = tab.view;
  if (project) return projects.find((p) => p.path === project)?.name ?? project.split("/").pop() ?? project;
  return section === "trash" ? "Trash" : SECTIONS.find((s) => s.id === section)?.label ?? "All";
}

export function spaceTabIcon(tab: SpaceTab): Icon {
  if (tab.page) return FileText;
  if (tab.view.project) return Folder;
  if (tab.view.section === "trash") return Trash2;
  return SECTIONS.find((s) => s.id === tab.view.section)?.Icon ?? Columns3;
}
