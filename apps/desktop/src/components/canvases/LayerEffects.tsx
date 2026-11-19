import { ArrowDown, ArrowUp, Eye, EyeOff, Minus, Plus } from "lucide-react";
import { useState } from "react";
import { Choice, Field, ToolButton } from "./EditorControls";
import {
  effectTypes,
  filterDefaults,
  newEffect,
  uid,
  type Effect,
  type Layer,
  type Token,
  type TokenKind,
} from "./document";

type Update = (fn: (layer: Layer) => Layer) => void;
const strokeStyles = ["solid", "dashed", "dotted", "double", "groove", "ridge", "inset", "outset"];

function EffectFields({
  effect: e,
  tokens,
  apply,
  modify,
}: {
  effect: Effect;
  tokens: Token[];
  apply: (values: Record<string, string>) => void;
  modify: (fn: (e: Effect) => Effect) => void;
}) {
  const [error, setError] = useState("");
  const f = e.fields;
  const field = (key: string, label: string, kind?: TokenKind, unit = "", prop?: string) => (
    <Field
      key={key}
      label={label}
      value={f[key] ?? ""}
      tokens={tokens}
      kinds={kind ? [kind] : []}
      unit={unit}
      valid={prop ? (v) => CSS.supports(prop, v) : undefined}
      onChange={(v) => apply({ [key]: v })}
    />
  );
  const color = (key = "color", label = "Color") => field(key, label, "Color", "", "color");
  if (e.kind === "Fill")
    return (
      <>
        <Choice
          label="Fill type"
          value={f.type}
          options={["Solid", "Linear", "Radial", "Conic", "Image"]}
          onChange={(type) => apply({ type })}
        />
        {f.type === "Image" ? (
          <>
            <label className="ce-file">
              {f.image ? "Replace image" : "Choose image"}
              <input
                aria-label="Fill image"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={(ev) => {
                  const file = ev.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => {
                    const image = String(reader.result);
                    if (/^data:image\/(png|jpeg|webp|gif);base64,/.test(image)) {
                      apply({ image });
                      setError("");
                    } else setError("Choose a PNG, JPEG, WebP, or GIF.");
                  };
                  reader.onerror = () => setError("Could not read this image.");
                  reader.readAsDataURL(file);
                }}
              />
            </label>
            {error && <p role="alert">{error}</p>}
            <Choice
              label="Image size"
              value={f.fit}
              options={["cover", "contain", "100% 100%", "auto"]}
              onChange={(fit) => apply({ fit })}
            />
          </>
        ) : (
          <>
            {color()}
            {f.type !== "Solid" && (
              <>
                <Field
                  label="Start position"
                  value={f.startAt ?? "0%"}
                  unit="%"
                  valid={(v) => /^\d+(\.\d+)?%$/.test(v)}
                  onChange={(startAt) => apply({ startAt })}
                />
                {(e.stops ?? []).map((stop) => (
                  <div className="ce-stop" key={stop.id}>
                    <Field
                      label="Stop color"
                      value={stop.color}
                      kinds={["Color"]}
                      tokens={tokens}
                      valid={(v) => CSS.supports("color", v)}
                      onChange={(color) =>
                        modify((f) => ({
                          ...f,
                          stops: f.stops?.map((s) => (s.id === stop.id ? { ...s, color } : s)),
                        }))
                      }
                    />
                    <Field
                      label="Position"
                      value={stop.at}
                      unit="%"
                      valid={(v) => /^\d+(\.\d+)?%$/.test(v)}
                      onChange={(at) =>
                        modify((f) => ({
                          ...f,
                          stops: f.stops
                            ?.map((s) => (s.id === stop.id ? { ...s, at } : s))
                            .sort((a, b) => parseFloat(a.at) - parseFloat(b.at)),
                        }))
                      }
                    />
                    <ToolButton
                      label="Remove gradient stop"
                      onClick={() =>
                        modify((f) => ({ ...f, stops: f.stops?.filter((s) => s.id !== stop.id) }))
                      }
                    >
                      <Minus />
                    </ToolButton>
                  </div>
                ))}
                <button
                  className="ce-file"
                  onClick={() =>
                    modify((f) => ({
                      ...f,
                      stops: [...(f.stops ?? []), { id: uid(), color: "#cccccc", at: "50%" }].sort(
                        (a, b) => parseFloat(a.at) - parseFloat(b.at),
                      ),
                    }))
                  }
                >
                  Add gradient stop
                </button>
                {color("end", "End color")}
                <Field
                  label="End position"
                  value={f.endAt ?? "100%"}
                  unit="%"
                  valid={(v) => /^\d+(\.\d+)?%$/.test(v)}
                  onChange={(endAt) => apply({ endAt })}
                />
              </>
            )}
            {(f.type === "Linear" || f.type === "Conic") &&
              field("angle", "Angle", undefined, "deg", "rotate")}
          </>
        )}
        <Field
          label="Fill opacity"
          value={f.opacity ?? "100%"}
          tokens={tokens}
          kinds={["Opacity"]}
          unit="%"
          valid={(v) => CSS.supports("opacity", v)}
          onChange={(opacity) => apply({ opacity })}
        />
      </>
    );
  if (e.kind === "Filter" || e.kind === "Backdrop filter")
    return (
      <>
        <Choice
          label="Filter type"
          value={f.type}
          options={Object.keys(filterDefaults)}
          onChange={(type) => apply({ type, amount: filterDefaults[type] })}
        />
        <Field
          label="Amount"
          value={f.amount}
          unit={
            f.type === "blur" ? "px" : f.type === "hue-rotate" ? "deg" : f.type === "drop-shadow" ? "" : "%"
          }
          valid={(v) => CSS.supports("filter", f.type + "(" + v + ")")}
          onChange={(amount) => apply({ amount })}
        />
      </>
    );
  if (e.kind === "Shadow" || e.kind === "Inner shadow")
    return (
      <>
        <div className="ce-grid">
          {field("x", "X", undefined, "px", "left")}
          {field("y", "Y", undefined, "px", "top")}
          {field("blur", "Blur", undefined, "px", "width")}
          {field("spread", "Spread", undefined, "px", "left")}
        </div>
        {color()}
      </>
    );
  return (
    <>
      {color()}
      <div className="ce-grid">
        {field("width", "Width", undefined, "px", "border-width")}
        {e.kind !== "Text stroke" && (
          <Choice
            label="Style"
            value={f.style}
            options={strokeStyles}
            onChange={(style) => apply({ style })}
          />
        )}
      </div>
      {e.kind === "Outline" && field("offset", "Offset", undefined, "px", "outline-offset")}
      {e.kind === "Border" && (
        <Choice
          label="Sides"
          value={f.sides ?? "All"}
          options={["All", "Top", "Right", "Bottom", "Left"]}
          onChange={(sides) => apply({ sides })}
        />
      )}
    </>
  );
}

export function LayerEffects({ layer, update, tokens }: { layer: Layer; update: Update; tokens: Token[] }) {
  return (
    <>
      {effectTypes
        .filter((kind) => kind !== "Text stroke" || layer.kind === "Text")
        .map((kind) => {
          const list = layer.effects.filter((e) => e.kind === kind);
          const single = kind === "Outline" || kind === "Text stroke";
          return (
            <section className="ce-section" key={kind}>
              <div className="ce-heading">
                <h3>{kind}</h3>
                {(!single || !list.length) && (
                  <ToolButton
                    label={"Add " + kind.toLowerCase()}
                    onClick={() => update((l) => ({ ...l, effects: [newEffect(kind), ...l.effects] }))}
                  >
                    <Plus />
                  </ToolButton>
                )}
              </div>
              {list.map((e, i) => {
                const modify = (fn: (effect: Effect) => Effect) =>
                  update((l) => ({ ...l, effects: l.effects.map((f) => (f.id === e.id ? fn(f) : f)) }));
                const move = (other: Effect) =>
                  update((l) => ({
                    ...l,
                    effects: l.effects.map((f) => (f.id === e.id ? other : f.id === other.id ? e : f)),
                  }));
                return (
                  <div className="ce-effect" key={e.id}>
                    <div className="ce-effect-tools">
                      <span>
                        {e.fields.type || kind}
                        {list.length > 1 ? " " + (i + 1) : ""}
                      </span>
                      {i > 0 && (
                        <ToolButton label="Move effect up" onClick={() => move(list[i - 1])}>
                          <ArrowUp />
                        </ToolButton>
                      )}
                      {i < list.length - 1 && (
                        <ToolButton label="Move effect down" onClick={() => move(list[i + 1])}>
                          <ArrowDown />
                        </ToolButton>
                      )}
                      <ToolButton
                        label={(e.enabled ? "Hide " : "Show ") + kind.toLowerCase()}
                        onClick={() => modify((f) => ({ ...f, enabled: !f.enabled }))}
                      >
                        {e.enabled ? <Eye /> : <EyeOff />}
                      </ToolButton>
                      <ToolButton
                        label={"Remove " + kind.toLowerCase()}
                        onClick={() =>
                          update((l) => ({ ...l, effects: l.effects.filter((f) => f.id !== e.id) }))
                        }
                      >
                        <Minus />
                      </ToolButton>
                    </div>
                    <EffectFields
                      modify={modify}
                      effect={e}
                      tokens={tokens}
                      apply={(fields) => modify((f) => ({ ...f, fields: { ...f.fields, ...fields } }))}
                    />
                  </div>
                );
              })}
            </section>
          );
        })}
    </>
  );
}
