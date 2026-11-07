import { useId, useState } from "react";
import { RotateCcw } from "lucide-react";

import SettingRow from "@/components/settings/SettingRow";
import { Button } from "@/components/ui/button";
import { inputClassName } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DEFAULT_FONT_SIZES,
  FONT_MAX,
  FONT_MIN,
  FONT_SLOTS,
  setFontSize,
  useFontSizes,
} from "@/lib/fontSize";
import { cn } from "@/lib/utils";

/// One px field for a text size, with a reset beside it once it moved off the default.
///
/// The field keeps its own text while focused: a value in range applies on
/// every keystroke so the page answers as the reader types, one outside it
/// waits for blur, where it is clamped. Clamping on change is the trap — a
/// controlled field snapping `1` to `10` turns a typed `15` into `105`.
///
/// Not `type="number"`: its spinner arrows are the one thing it adds and they
/// are not wanted, so ↑/↓ step by hand. The box is the outer label drawn with
/// the input's classes and the field inside it is bare, or a unit placed over
/// a padded input collides with the number once the size grows.
export default function FontSizeRow({ slot }: { slot: (typeof FONT_SLOTS)[number] }) {
  const id = useId();
  const value = useFontSizes()[slot.id];
  const [draft, setDraft] = useState<string | null>(null);
  const fallback = DEFAULT_FONT_SIZES[slot.id];
  const step = (delta: number) => {
    setFontSize(slot.id, value + delta);
    setDraft(null);
  };

  return (
    <SettingRow id={id} label={slot.label} description={slot.description}>
      <div className="flex items-center gap-1.5">
        {value !== fallback && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Reset to ${fallback}px`}
                onClick={() => {
                  setFontSize(slot.id, fallback);
                  setDraft(null);
                }}
              >
                <RotateCcw />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Reset to {fallback}px</TooltipContent>
          </Tooltip>
        )}
        <label
          htmlFor={id}
          className={cn(
            inputClassName,
            "flex h-7 w-fit cursor-text items-center gap-1 px-2.5 text-ui focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
          )}
        >
          <input
            id={id}
            inputMode="numeric"
            value={draft ?? value}
            onChange={(e) => {
              setDraft(e.target.value);
              const px = Number(e.target.value);
              if (Number.isInteger(px) && px >= FONT_MIN && px <= FONT_MAX) setFontSize(slot.id, px);
            }}
            onBlur={(e) => {
              const px = Number(e.target.value);
              if (e.target.value.trim() && Number.isFinite(px)) setFontSize(slot.id, px);
              setDraft(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp") (e.preventDefault(), step(1));
              if (e.key === "ArrowDown") (e.preventDefault(), step(-1));
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            className="w-[2.5ch] bg-transparent text-right outline-none"
          />
          <span className="text-muted-foreground select-none">px</span>
        </label>
      </div>
    </SettingRow>
  );
}
