import { useState, type ReactNode } from "react";
import { Link2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { resolve, type Token, type TokenKind } from "./document";

export function ToolButton({
  label,
  children,
  onClick,
  active,
  disabled,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          className="ce-icon"
          onClick={onClick}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="ce-field">
      <span>{label}</span>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}

export function Field({
  label,
  value,
  onChange,
  tokens = [],
  kinds = [],
  unit = "",
  valid,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  tokens?: Token[];
  kinds?: TokenKind[];
  unit?: string;
  valid?: (value: string) => boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const bound = tokens.find((t) => "@" + t.id === value);
  const eligible = tokens.filter((t) => kinds.includes(t.kind));
  const color = kinds.includes("Color");
  const actual = resolve(value, tokens);
  return (
    <div className="ce-field">
      <span>{label}</span>
      {color && (
        <label className="ce-swatch" style={{ backgroundColor: actual }}>
          <input
            type="color"
            aria-label={label + " picker"}
            value={/^#[\da-f]{6}$/i.test(actual) ? actual : "#000000"}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      )}
      <input
        aria-label={label}
        value={draft ?? (bound ? bound.name : value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft === null) return;
          let v = draft.trim();
          if (unit && /^-?(?:\d+\.?\d*|\.\d+)$/.test(v)) v += unit;
          if (color && /^[0-9a-f]{3,4}$|^[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(v)) v = "#" + v;
          if (v && (!valid || valid(v))) onChange(v);
          setDraft(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            e.stopPropagation();
            setDraft(null);
            e.currentTarget.select();
          }
        }}
      />
      {!!eligible.length && (
        <label className="ce-binding" data-bound={!!bound}>
          <Link2 size={13} />
          <select
            aria-label={"Bind " + label + " to token"}
            value={bound?.id ?? ""}
            onChange={(e) => {
              setDraft(null);
              onChange(e.target.value ? "@" + e.target.value : actual);
            }}
          >
            <option value="">Literal value</option>
            {eligible.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
