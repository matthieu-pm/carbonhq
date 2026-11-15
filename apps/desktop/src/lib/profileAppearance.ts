export const PROFILE_APPEARANCE_KEY = "ade.profileAppearance";

export const PROFILE_ICONS = [
  "squares", "briefcase", "home", "user", "users", "folder", "code", "command",
  "trophy", "flag", "star", "heart", "fire", "moon", "sun", "globe",
  "rocket", "beaker", "academic", "book", "bookmark", "building", "camera", "chart",
  "cloud", "cube", "gift", "map", "music", "film", "lightbulb", "shield",
] as const;

export const PROFILE_COLORS = [
  { id: "gray", label: "Graphite" },
  { id: "red", label: "Red" },
  { id: "orange", label: "Orange" },
  { id: "green", label: "Green" },
  { id: "teal", label: "Teal" },
  { id: "blue", label: "Blue" },
  { id: "purple", label: "Violet" },
  { id: "pink", label: "Pink" },
] as const;

export const PROFILE_ICON_LABELS: Record<(typeof PROFILE_ICONS)[number], string> = {
  squares: "Grid", briefcase: "Briefcase", home: "Home", user: "Person", users: "Team",
  folder: "Folder", code: "Code", command: "Terminal", trophy: "Trophy", flag: "Flag",
  star: "Star", heart: "Heart", fire: "Fire", moon: "Moon", sun: "Sun", globe: "Globe",
  rocket: "Rocket", beaker: "Beaker", academic: "Academic cap", book: "Book",
  bookmark: "Bookmark", building: "Office", camera: "Camera", chart: "Bar chart",
  cloud: "Cloud", cube: "Cube", gift: "Gift", map: "Map", music: "Music",
  film: "Film", lightbulb: "Light bulb", shield: "Shield",
};

export type ProfileAppearance = {
  icon: (typeof PROFILE_ICONS)[number];
  color: (typeof PROFILE_COLORS)[number]["id"];
};

export type ProfileAppearances = Record<string, ProfileAppearance>;

export const DEFAULT_PROFILE_APPEARANCE: ProfileAppearance = { icon: "folder", color: "gray" };

/// Invalid or older stored values fall back without hiding a profile.
export function profileAppearance(appearances: unknown, name: string): ProfileAppearance {
  const value = appearances && typeof appearances === "object" && Object.hasOwn(appearances, name)
    ? (appearances as Record<string, unknown>)[name] : null;
  if (!value || typeof value !== "object") return DEFAULT_PROFILE_APPEARANCE;
  const { icon, color } = value as ProfileAppearance;
  return {
    icon: PROFILE_ICONS.includes(icon) ? icon : DEFAULT_PROFILE_APPEARANCE.icon,
    color: PROFILE_COLORS.some((entry) => entry.id === color) ? color : DEFAULT_PROFILE_APPEARANCE.color,
  };
}

/// A renamed profile keeps its mark; removal leaves no mark for a later namesake.
export function moveProfileAppearance(appearances: ProfileAppearances, from: string, to: string | null): ProfileAppearances {
  const next = { ...appearances };
  delete next[from];
  return to === null ? next : { ...next, [to]: profileAppearance(appearances, from) };
}

/// New profiles start with a color the reader has not used yet, while any remain.
export function newProfileAppearance(appearances: ProfileAppearances, names: string[]): ProfileAppearance {
  const used = new Set(names.map((name) => profileAppearance(appearances, name).color));
  const color = PROFILE_COLORS.find((entry) => entry.id !== "gray" && !used.has(entry.id))?.id ?? "blue";
  return { icon: "folder", color };
}
