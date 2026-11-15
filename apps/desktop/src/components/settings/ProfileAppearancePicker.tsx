import { Popover } from "radix-ui";
import ProfileIcon from "@/components/ProfileIcon";
import { useRovingGroup } from "@/components/ThemeSwatches";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PROFILE_COLORS, PROFILE_ICONS, PROFILE_ICON_LABELS, type ProfileAppearance } from "@/lib/profileAppearance";
import { cn } from "@/lib/utils";

export default function ProfileAppearancePicker({ value, label, onChange }: {
  value: ProfileAppearance;
  label: string;
  onChange: (value: ProfileAppearance) => void;
}) {
  const colorIndex = PROFILE_COLORS.findIndex((color) => color.id === value.color);
  const iconIndex = PROFILE_ICONS.indexOf(value.icon);
  const colors = useRovingGroup(PROFILE_COLORS.length, colorIndex, (index) => onChange({ ...value, color: PROFILE_COLORS[index].id }));
  const icons = useRovingGroup(PROFILE_ICONS.length, iconIndex, (index) => onChange({ ...value, icon: PROFILE_ICONS[index] }));
  return (
    <Popover.Root>
      <Tooltip>
        <TooltipTrigger asChild>
          <Popover.Trigger asChild>
            <Button variant="ghost" size="icon-sm" className="size-7 shrink-0" aria-label={label}>
              <ProfileIcon appearance={value} className="size-4" />
            </Button>
          </Popover.Trigger>
        </TooltipTrigger>
        <TooltipContent>Change icon and color</TooltipContent>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} collisionPadding={12} aria-label="Profile icon and color"
          onOpenAutoFocus={(event) => { event.preventDefault(); colors.refs.current[colorIndex]?.focus(); }}
          className="z-50 max-h-(--radix-popover-content-available-height) w-72 max-w-[calc(100vw-24px)] overflow-y-auto rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-md outline-none backdrop-blur-xl">
          <div role="radiogroup" aria-label="Profile color" onKeyDown={colors.onKeyDown} className="grid grid-cols-8 gap-1">
            {PROFILE_COLORS.map((color, index) => (
              <button key={color.id} ref={(node) => { colors.refs.current[index] = node; }} type="button" role="radio" aria-label={color.label}
                aria-checked={value.color === color.id} tabIndex={index === colorIndex ? 0 : -1}
                onClick={() => onChange({ ...value, color: color.id })}
                className="flex size-7 cursor-pointer items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span style={{ backgroundColor: `var(--profile-${color.id})` }}
                  className={cn("size-4 rounded-[4px]", value.color === color.id && "outline-2 outline-offset-2 outline-foreground")} />
              </button>
            ))}
          </div>
          <div className="my-3 h-px bg-hairline" />
          <div role="radiogroup" aria-label="Profile icon" className="grid grid-cols-8 gap-1" onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const next = (iconIndex + (event.key === "ArrowDown" ? 8 : -8) + PROFILE_ICONS.length) % PROFILE_ICONS.length;
              onChange({ ...value, icon: PROFILE_ICONS[next] });
              icons.refs.current[next]?.focus();
            } else icons.onKeyDown(event);
          }}>
            {PROFILE_ICONS.map((icon, index) => (
              <button key={icon} ref={(node) => { icons.refs.current[index] = node; }} type="button" role="radio" aria-label={PROFILE_ICON_LABELS[icon]}
                aria-checked={value.icon === icon} tabIndex={index === iconIndex ? 0 : -1}
                onClick={() => onChange({ ...value, icon })}
                className={cn("flex size-7 cursor-pointer items-center justify-center rounded-md outline-none hover:bg-sidebar-accent/50 focus-visible:ring-2 focus-visible:ring-ring",
                  value.icon === icon && "bg-sidebar-accent")}>
                <ProfileIcon appearance={{ ...value, icon }} className="size-5" />
              </button>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
