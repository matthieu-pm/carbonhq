import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { Monitor, Ruler, Smartphone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import Spinner from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

const MIN_SIDE = 1;
const MAX_SIDE = 10000;

type Preset = { id: "desktop" | "mobile"; label: string; width: number; height: number; icon: ReactNode };
const PRESETS: Preset[] = [
  { id: "desktop", label: "Desktop", width: 1440, height: 900, icon: <Monitor /> },
  { id: "mobile", label: "Mobile", width: 390, height: 844, icon: <Smartphone /> },
];
type PresetId = Preset["id"] | "custom";

/// Names a new canvas file or renames the open one. The submit button says
/// which: Create with no name to start from, Rename with one.
export function CanvasFileDialog({
  open,
  onOpenChange,
  initialName,
  title,
  busy,
  error,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName: string;
  title: string;
  busy: boolean;
  error: string | null;
  onSubmit: (name: string) => void;
}) {
  const id = useId();
  const [name, setName] = useState(initialName);
  // Each opening starts from the caller's name, not from what was typed last time.
  useEffect(() => { if (open) setName(initialName); }, [open, initialName]);

  const trimmed = name.trim();
  const renaming = initialName.trim() !== "";
  const unchanged = renaming && trimmed === initialName.trim();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!busy && trimmed && !unchanged) onSubmit(trimmed);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent dismissible={!busy} showClose={!busy}>
        <form onSubmit={submit} className="grid gap-4" aria-busy={busy || undefined}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="sr-only">Name the canvas file.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <label htmlFor={`${id}-name`} className="text-xs text-muted-foreground">Name</label>
            <Input
              id={`${id}-name`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              placeholder="Checkout redesign"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              maxLength={200}
              disabled={busy}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-error` : undefined}
            />
            {error && <p id={`${id}-error`} role="alert" className="text-xs text-destructive">{error}</p>}
          </div>
          <Footer busy={busy} disabled={!trimmed || unchanged} label={renaming ? "Rename" : "Create"} onCancel={() => onOpenChange(false)} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/// Adds a blank frame at a preset or custom size. The size fields always show,
/// so a preset is a shortcut into them; typing a size that matches no preset
/// is what Custom means. The name follows the preset until the reader types one.
export function CanvasFrameDialog({
  open,
  onOpenChange,
  title = "New frame",
  busy,
  error,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  busy: boolean;
  error: string | null;
  onSubmit: (name: string, width: number, height: number) => void;
}) {
  const id = useId();
  const [name, setName] = useState("");
  const [width, setWidth] = useState(String(PRESETS[0].width));
  const [height, setHeight] = useState(String(PRESETS[0].height));
  // Custom chosen outright, even while the fields still match a preset.
  const [custom, setCustom] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName("");
    setCustom(false);
    setWidth(String(PRESETS[0].width));
    setHeight(String(PRESETS[0].height));
  }, [open]);

  const w = side(width);
  const h = side(height);
  const preset: PresetId = custom ? "custom" : PRESETS.find((p) => p.width === w && p.height === h)?.id ?? "custom";
  const fallbackName = PRESETS.find((p) => p.id === preset)?.label ?? "Frame";
  const invalid = w === null || h === null;

  const pick = (next: PresetId) => {
    const found = PRESETS.find((p) => p.id === next);
    if (!found) return;
    setCustom(false);
    setWidth(String(found.width));
    setHeight(String(found.height));
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy || w === null || h === null) return;
    onSubmit(name.trim() || fallbackName, w, h);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent dismissible={!busy} showClose={!busy}>
        <form onSubmit={submit} className="grid gap-4" aria-busy={busy || undefined}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>A blank frame on the canvas, at the size its page lays out at.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-1.5">
            <label htmlFor={`${id}-name`} className="text-xs text-muted-foreground">Name</label>
            <Input
              id={`${id}-name`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={fallbackName}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              maxLength={200}
              disabled={busy}
            />
          </div>

          <fieldset className="grid gap-1.5" disabled={busy}>
            <legend className="mb-1.5 text-xs text-muted-foreground">Size</legend>
            <div className="grid grid-cols-3 gap-1.5">
              {PRESETS.map((p) => (
                <PresetOption key={p.id} name={`${id}-preset`} checked={preset === p.id} onChange={() => pick(p.id)} icon={p.icon} label={p.label} detail={`${p.width} × ${p.height}`} />
              ))}
              <PresetOption
                name={`${id}-preset`}
                checked={preset === "custom"}
                // Custom keeps whatever is typed; choosing it moves to the fields.
                onChange={() => { setCustom(true); document.getElementById(`${id}-width`)?.focus(); }}
                icon={<Ruler />}
                label="Custom"
                detail={preset === "custom" && !invalid ? `${w} × ${h}` : "Any size"}
              />
            </div>
            <div className="mt-1.5 flex items-end gap-2">
              <SideField id={`${id}-width`} label="Width" value={width} onChange={setWidth} invalid={w === null} describedBy={invalid ? `${id}-bounds` : undefined} />
              <span aria-hidden className="pb-1.5 text-xs text-muted-foreground">×</span>
              <SideField id={`${id}-height`} label="Height" value={height} onChange={setHeight} invalid={h === null} describedBy={invalid ? `${id}-bounds` : undefined} />
            </div>
            {invalid && (
              <p id={`${id}-bounds`} className="text-xs text-destructive">
                Width and height must be whole pixels from {MIN_SIDE} to {MAX_SIDE.toLocaleString()}.
              </p>
            )}
          </fieldset>

          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          <Footer busy={busy} disabled={invalid} label="Add frame" onCancel={() => onOpenChange(false)} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/// A whole number of pixels inside the bounds, or null.
function side(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const n = Number(value);
  return n >= MIN_SIDE && n <= MAX_SIDE ? n : null;
}

/// A native radio under the tile, so arrow keys, focus and the checked state
/// come from the browser.
function PresetOption({
  name, checked, onChange, icon, label, detail,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  icon: ReactNode;
  label: string;
  detail: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer flex-col gap-0.5 rounded-lg border border-border px-2.5 py-2 transition-colors",
        "hover:bg-muted/70 has-checked:border-ring has-checked:bg-muted",
        "has-focus-visible:ring-3 has-focus-visible:ring-ring/50 has-disabled:pointer-events-none has-disabled:opacity-50",
      )}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} className="sr-only" />
      <span className="flex items-center gap-1.5 text-ui font-medium [&_svg]:size-3.5 [&_svg]:text-muted-foreground">{icon}{label}</span>
      <span className="text-xs text-muted-foreground tabular-nums">{detail}</span>
    </label>
  );
}

function SideField({
  id, label, value, onChange, invalid, describedBy,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  invalid: boolean;
  describedBy?: string;
}) {
  return (
    <div className="grid flex-1 gap-1">
      <label htmlFor={id} className="text-xs text-muted-foreground">{label}</label>
      <div className="relative">
        <Input
          id={id}
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          autoComplete="off"
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className="pr-8 tabular-nums"
        />
        <span aria-hidden className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-muted-foreground">px</span>
      </div>
    </div>
  );
}

function Footer({ busy, disabled, label, onCancel }: { busy: boolean; disabled: boolean; label: string; onCancel: () => void }) {
  return (
    <div className="flex justify-end gap-2">
      <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
      <Button type="submit" disabled={busy || disabled}>
        {busy && <Spinner className="size-3.5" />}
        {label}
      </Button>
    </div>
  );
}
