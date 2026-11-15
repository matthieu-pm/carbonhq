import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import ProfileSwitcher from "@/components/ProfileSwitcher";
import SpacesSettings from "@/components/settings/SpacesSettings";
import { TooltipProvider } from "@/components/ui/tooltip";
import DemoThemeBar from "@/demo/ThemeBar";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { moveProfileAppearance, type ProfileAppearance, type ProfileAppearances } from "@/lib/profileAppearance";
import { moveSpace } from "@/lib/space";
import type { Project } from "@/types/events";
import "../App.css";

const INITIAL = ["Work", "Personal", "Research", "Studio", "Learning", "Open source", "Experiments", "Archive"];
const LOOKS: ProfileAppearances = {
  Work: { icon: "briefcase", color: "blue" }, Personal: { icon: "home", color: "pink" },
  Research: { icon: "beaker", color: "teal" }, Studio: { icon: "film", color: "purple" },
  Learning: { icon: "academic", color: "orange" }, "Open source": { icon: "code", color: "green" },
};

function Demo() {
  const [profiles, setProfiles] = useLocalStorage("demo.profiles.names", INITIAL);
  const [looks, setLooks] = useLocalStorage("demo.profiles.appearance", LOOKS);
  const [active, setActive] = useLocalStorage<string | null>("demo.profiles.active", null);
  const [width, setWidth] = useLocalStorage("demo.profiles.width", 260);
  const [projects, setProjects] = useLocalStorage<Project[]>("demo.profiles.projects", [
    { path: "/demo/carbon", name: "Carbon", space: "Work" } as Project,
    { path: "/demo/portfolio", name: "Portfolio", space: "Personal" } as Project,
  ]);
  const setLook = (name: string, appearance: ProfileAppearance) => setLooks((prev) => ({ ...prev, [name]: appearance }));
  return <TooltipProvider><div className="[&>div]:right-4 [&>div]:left-auto"><DemoThemeBar /></div>
    <div className="flex h-screen min-h-0 text-foreground">
      <aside aria-label="Session sidebar" className="flex shrink-0 flex-col border-r border-hairline" style={{ width }}>
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
          <span className="text-ui font-medium">Sessions · {active ?? "All Profiles"}</span>
          {Array.from({ length: 35 }, (_, i) => <div key={i} className="shrink-0 rounded-md px-2 py-2 text-ui text-muted-foreground">{active ?? "Carbon"} session {i + 1}</div>)}
        </div>
        {profiles.length > 0 && <ProfileSwitcher profiles={profiles} appearances={looks} value={active} onChange={setActive} />}
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto px-8 py-7">
        <div className="mx-auto max-w-2xl">
          <div className="mb-6 flex items-center justify-between gap-4"><h1 className="text-lg font-medium">Profiles</h1>
            <label className="text-ui text-muted-foreground">Sidebar width <input aria-label="Sidebar width" type="range" min="240" max="600" value={width} onChange={(event) => setWidth(Number(event.target.value))} /></label></div>
          <SpacesSettings projects={projects} spaces={profiles} appearances={looks} onAppearanceChange={setLook}
            onCreateSpace={(name, appearance) => { if (!profiles.includes(name)) { setProfiles([...profiles, name]); setLook(name, appearance); } }}
            onRenameSpace={(from, to) => { setProfiles((prev) => [...new Set(prev.map((name) => name === from ? to : name))]); setLooks((prev) => moveProfileAppearance(prev, from, to)); setProjects((prev) => prev.map((p) => p.space === from ? { ...p, space: to } : p)); if (active === from) setActive(to); }}
            onRemoveSpace={(name) => { setProfiles((prev) => prev.filter((p) => p !== name)); setLooks((prev) => moveProfileAppearance(prev, name, null)); setProjects((prev) => prev.map((p) => p.space === name ? { ...p, space: null } : p)); if (active === name) setActive(null); }}
            onMoveSpace={(name, delta) => setProfiles(moveSpace(profiles, name, delta))}
            onRemoveProject={(path) => setProjects((prev) => prev.filter((p) => p.path !== path))}
            onSetProjectSpace={(path, space) => setProjects((prev) => prev.map((p) => p.path === path ? { ...p, space } : p))}
            onMoveProject={() => {}} />
        </div>
      </main>
    </div>
  </TooltipProvider>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><Demo /></StrictMode>);
