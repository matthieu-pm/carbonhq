import {
  AcademicCapIcon, BeakerIcon, TrophyIcon, BookOpenIcon, BookmarkIcon, BriefcaseIcon,
  BuildingOffice2Icon, CameraIcon, ChartBarIcon, CloudIcon, CodeBracketIcon,
  CommandLineIcon, CubeIcon, FireIcon, FolderIcon, GiftIcon, GlobeAltIcon, HeartIcon,
  HomeIcon, MusicalNoteIcon, FilmIcon, LightBulbIcon, RocketLaunchIcon,
  ShieldCheckIcon, FlagIcon, Squares2X2Icon, StarIcon, SunIcon, MoonIcon,
  UserIcon, UsersIcon, MapIcon,
} from "@heroicons/react/20/solid";
import type { ProfileAppearance } from "@/lib/profileAppearance";
import { cn } from "@/lib/utils";

const PROFILE_ICON_COMPONENTS = {
  squares: Squares2X2Icon, briefcase: BriefcaseIcon, home: HomeIcon, user: UserIcon,
  users: UsersIcon, folder: FolderIcon, code: CodeBracketIcon, command: CommandLineIcon,
  trophy: TrophyIcon, flag: FlagIcon, star: StarIcon, heart: HeartIcon, fire: FireIcon,
  moon: MoonIcon, sun: SunIcon, globe: GlobeAltIcon, rocket: RocketLaunchIcon,
  beaker: BeakerIcon, academic: AcademicCapIcon, book: BookOpenIcon, bookmark: BookmarkIcon,
  building: BuildingOffice2Icon, camera: CameraIcon, chart: ChartBarIcon, cloud: CloudIcon,
  cube: CubeIcon, gift: GiftIcon, map: MapIcon, music: MusicalNoteIcon,
  film: FilmIcon, lightbulb: LightBulbIcon, shield: ShieldCheckIcon,
};

export default function ProfileIcon({ appearance, className }: { appearance: ProfileAppearance; className?: string }) {
  const Icon = PROFILE_ICON_COMPONENTS[appearance.icon];
  return <Icon aria-hidden="true" style={{ color: `var(--profile-${appearance.color})` }} className={cn("size-5 shrink-0", className)} />;
}
