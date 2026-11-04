import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Popover } from "radix-ui";

import SettingRow from "@/components/settings/SettingRow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fontStack, refreshFonts, setMainFont, useMainFont } from "@/lib/fonts";
import { IS_MAC } from "@/lib/platform";
import { cn } from "@/lib/utils";

const DEFAULT_FONT_LABEL = "Carbon default (Geist)";

/// Keeps the catalog on this device and leaves code typography independent.
export default function MainFontRow() {
  const id = useId();
  const { selected, families, error } = useMainFont();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const activeRow = useRef<HTMLDivElement>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const search = query.trim().toLocaleLowerCase();
  const choices = [null, ...(error ? [] : families ?? [])].filter((font) =>
    (font ?? DEFAULT_FONT_LABEL).toLocaleLowerCase().includes(search),
  );
  const activeIndex = Math.min(active, choices.length - 1);
  const unavailable = selected !== null && families !== null && !families.includes(selected);
  const effective = unavailable || error ? null : selected;
  const pick = (font: string | null) => {
    setMainFont(font);
    setOpen(false);
  };

  useEffect(() => {
    const container = list.current;
    const row = activeRow.current;
    if (!open || !container || !row) return;
    const bounds = container.getBoundingClientRect();
    const item = row.getBoundingClientRect();
    if (item.top < bounds.top) container.scrollTop -= bounds.top - item.top;
    else if (item.bottom > bounds.bottom) container.scrollTop += item.bottom - bounds.bottom;
  }, [open, activeIndex, choices.length]);

  return (
    <SettingRow
      id={id}
      stacked
      label="Main font"
      description={
        !IS_MAC
          ? "Installed fonts are available in the macOS app."
          : error ?? (unavailable
              ? `${selected} is unavailable. Carbon is using Geist.`
              : "For interface and chat text. Code, diffs and terminals keep Geist Mono.")
      }
    >
      <Popover.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) {
            setQuery("");
            setActive(Math.max(0, [null, ...(families ?? [])].indexOf(selected)));
            void refreshFonts();
          }
        }}
      >
        <Popover.Trigger asChild>
          <Button id={id} variant="outline" size="sm" disabled={!IS_MAC} className="w-full justify-between font-normal">
            <span className="truncate">{selected && !unavailable && !error ? selected : DEFAULT_FONT_LABEL}</span>
            <ChevronDown className="size-3 shrink-0 opacity-60" />
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={6}
            className="z-50 flex w-(--radix-popover-trigger-width) max-h-(--radix-popover-content-available-height) flex-col overflow-hidden rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-lg backdrop-blur-xl"
          >
            <Input
              role="combobox"
              aria-label="Search installed fonts"
              aria-expanded={open}
              aria-controls={`${id}-list`}
              aria-autocomplete="list"
              aria-activedescendant={activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
              placeholder="Search installed fonts…"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={(event) => {
                // WebKit clears isComposing before the Enter that commits an IME candidate.
                if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || !choices.length) return;
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  setActive((index) => (Math.min(index, choices.length - 1) + (event.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length);
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  pick(choices[activeIndex]);
                }
              }}
              className="mb-1.5 shrink-0 text-ui"
            />
            <div ref={list} id={`${id}-list`} role="listbox" aria-label="Main font" className="min-h-0 max-h-64 overflow-y-auto overscroll-contain">
              {choices.map((font, index) => (
                <div
                  key={font === null ? "default" : `font:${font}`}
                  id={`${id}-option-${index}`}
                  ref={activeIndex === index ? activeRow : undefined}
                  role="option"
                  aria-selected={effective === font}
                  onMouseMove={(event) => {
                    const { clientX: x, clientY: y } = event;
                    if (pointer.current.x === x && pointer.current.y === y) return;
                    pointer.current = { x, y };
                    setActive(index);
                  }}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pick(font)}
                  className={cn("flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-ui", activeIndex === index && "bg-accent text-accent-foreground")}
                >
                  <span className="min-w-0 flex-1 truncate" style={{ fontFamily: font ? fontStack(font) : "'Geist Variable', sans-serif" }}>
                    {font ?? DEFAULT_FONT_LABEL}
                  </span>
                  {effective === font && <Check className="size-3.5 shrink-0" />}
                </div>
              ))}
            </div>
            <p role="status" className="shrink-0 px-2 py-1.5 text-ui text-muted-foreground">
              {error ? "Close and reopen to try again." : families === null ? "Loading installed fonts…" : !choices.length ? "No matching fonts." : `${families.length} installed font families`}
            </p>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </SettingRow>
  );
}
