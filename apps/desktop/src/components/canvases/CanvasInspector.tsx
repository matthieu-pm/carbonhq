import { editLayer } from "./layerEdit";
import { memo, useMemo, useState } from "react";
import {
  blendModes,
  resolve,
  type Document,
  type Effect,
  type Layer,
  type Page,
  type TokenKind,
} from "./document";
import { Choice, Field } from "./EditorControls";
import { LayerEffects } from "./LayerEffects";
import type { Change } from "./CanvasTheme";

import type { PageLayers } from "./graphicsScene";
import { presets } from "./model.js";

export const CanvasInspector = memo(function CanvasInspector({
  tree,
  doc,
  page,
  layer,
  change,
}: {
  tree: PageLayers;
  doc: Document;
  page: Page;
  layer?: Layer;
  change: Change;
}) {
  const [corners, setCorners] = useState(false);
  const update = (fn: (l: Layer) => Layer) =>
    layer && change(d => editLayer(d, layer, fn));
  if (!layer)
    return (
      <section className="ce-section">
        <h3>Page</h3>
        <Field
          label="Background"
          value={page.background}
          tokens={doc.tokens}
          kinds={["Color"]}
          valid={(v) => CSS.supports("color", v)}
          onChange={(background) =>
            change((d) => ({
              ...d,
              pages: d.pages.map((p) => (p.id === page.id ? { ...p, background } : p)),
            }))
          }
        />
        <Field
          label="Background opacity"
          unit="%"
          kinds={["Opacity"]}
          tokens={doc.tokens}
          value={page.opacity ?? "100%"}
          valid={(v) => CSS.supports("opacity", v)}
          onChange={(opacity) =>
            change((d) => ({ ...d, pages: d.pages.map((p) => (p.id === page.id ? { ...p, opacity } : p)) }))
          }
        />
      </section>
    );
  const style = (key: string, value: string) =>
    update((l) => ({ ...l, style: { ...l.style, [key]: value } }));
  const field = (key: string, label: string, kinds: TokenKind[] = [], unit = "", defaultValue = "") => (
    <Field
      key={key}
      label={label}
      value={layer.style[key] ?? defaultValue}
      tokens={doc.tokens}
      kinds={kinds}
      unit={unit}
      valid={(v) =>
        CSS.supports(
          key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()),
          v,
        )
      }
      onChange={(v) => style(key, v)}
    />
  );
  const choice = (key: string, label: string, options: string[]) => (
    <Choice
      label={label}
      value={layer.style[key] ?? options[0]}
      options={options}
      onChange={(v) => style(key, v)}
    />
  );
  const flexParent = layer.parent && tree.byId.get(layer.parent)?.style.display === "flex";
  return (
    <>
      <section className="ce-section">
        <h3>{layer.kind}</h3>
        <Field label="Name" value={layer.name} onChange={(name) => update((l) => ({ ...l, name }))} />
      </section>
      <section className="ce-section">
        <h3>Layout</h3>
        {layer.kind === "Frame" && (
          <label className="ce-field">
            Preset
            <select
              aria-label="Frame preset"
              value=""
              onChange={(e) => {
                const [w, h] = e.target.value.split("x");
                if (w && h)
                  update((l) => ({ ...l, style: { ...l.style, width: w + "px", height: h + "px" } }));
              }}
            >
              <option value="">Custom size</option>
              {Object.entries(presets).map(([group, items]) => (
                <optgroup key={group} label={group}>
                  {Object.entries(items).map(([name, wh]) => (
                    <option key={name} value={wh.join("x")}>
                      {name} · {wh.join(" × ")}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        )}
        <div className="ce-grid">
          {!flexParent &&
            (["x", "y"] as const).map((key) => (
              <Field
                key={key}
                label={key.toUpperCase()}
                value={String(layer[key])}
                valid={(v) => Number.isFinite(Number(v))}
                onChange={(v) => update((l) => ({ ...l, [key]: Number(v) }))}
              />
            ))}
          {field("width", "W", ["Container", "Breakpoint", "Spacing"], "px")}
          {field("height", "H", ["Container", "Spacing"], "px")}
          <Field
            label="Rotation"
            value={layer.style.rotate ?? "0deg"}
            unit="deg"
            valid={(v) => /^[-+]?(?:\d+\.?\d*|\.\d+)(deg|grad|rad|turn)$/.test(v)}
            onChange={(v) => style("rotate", v)}
          />
        </div>
        {layer.kind === "Frame" && (
          <label className="ce-check">
            <input
              type="checkbox"
              checked={layer.style.overflow === "hidden"}
              onChange={(e) => style("overflow", e.target.checked ? "hidden" : "visible")}
            />
            Clip content
          </label>
        )}
      </section>
      {layer.kind === "Frame" && (
        <section className="ce-section">
          <h3>Flex</h3>
          <Choice
            label="Layout mode"
            value={layer.style.display === "flex" ? "Flex" : "Free"}
            options={["Free", "Flex"]}
            onChange={(v) => style("display", v === "Flex" ? "flex" : "block")}
          />
          {layer.style.display === "flex" && (
            <>
              {choice("flexDirection", "Direction", ["row", "column", "row-reverse", "column-reverse"])}
              {choice("alignItems", "Align", ["flex-start", "center", "flex-end", "stretch", "baseline"])}
              {choice("justifyContent", "Justify", [
                "flex-start",
                "center",
                "flex-end",
                "space-between",
                "space-around",
                "space-evenly",
              ])}
              {choice("flexWrap", "Wrap", ["nowrap", "wrap", "wrap-reverse"])}
              <div className="ce-grid">
                {field("gap", "Gap", ["Spacing"], "px")}
                {field("padding", "Padding", ["Spacing"], "px")}
              </div>
            </>
          )}
        </section>
      )}
      {layer.kind === "Text" && (
        <section className="ce-section">
          <h3>Typography</h3>
          <textarea
            aria-label="Text content"
            value={layer.text}
            onChange={(e) => update((l) => ({ ...l, text: e.target.value }))}
          />
          {field("fontFamily", "Family", ["Font family"])}
          <div className="ce-grid">
            {field("fontSize", "Size", ["Font size"], "px")}
            {field("fontWeight", "Weight", ["Font weight"])}
            {field("lineHeight", "Line height", ["Line height"])}
            {field("letterSpacing", "Tracking", ["Letter spacing"], "px")}
          </div>
          {choice("textAlign", "Align", ["left", "center", "right", "justify"])}
          {choice("fontStyle", "Style", ["normal", "italic", "oblique"])}
          {choice("textDecoration", "Decoration", ["none", "underline", "line-through", "overline"])}
          {choice("textTransform", "Case", ["none", "uppercase", "lowercase", "capitalize"])}
        </section>
      )}
      <section className="ce-section">
        <h3>Radius</h3>
        {field("borderRadius", "Radius", ["Radius"], "px")}
        <details open={corners} onToggle={(e) => setCorners(e.currentTarget.open)}>
          <summary>Individual corners</summary>
          <div className="ce-grid">
            {["TopLeft", "TopRight", "BottomLeft", "BottomRight"].map((k) =>
              field(
                "border" + k + "Radius",
                k.replace(/(Left|Right)/, " $1"),
                ["Radius"],
                "px",
                resolve(layer.style.borderRadius, doc.tokens),
              ),
            )}
          </div>
        </details>
      </section>
      <section className="ce-section">
        <h3>Blending</h3>
        {field("opacity", "Opacity", ["Opacity"], "%")}
        {choice("mixBlendMode", "Blend mode", blendModes)}
      </section>
      <LayerEffects layer={layer} update={update} tokens={doc.tokens} />
      <SelectionColors tree={tree} doc={doc} layer={layer} change={change} />
    </>
  );
});

function paintKeys(effect: Effect) {
  if (!effect.enabled || !effect.fields.color) return [];
  if (effect.kind !== "Fill" || effect.fields.type === "Solid") return ["color"];
  if (effect.fields.type === "Image") return [];
  return ["color", "end"];
}

function SelectionColors({ tree, doc, layer, change }: { tree: PageLayers; doc: Document; layer: Layer; change: Change }) {
  const { ids, colors } = useMemo(() => {
    const ids = new Set<string>(), colors = new Set<string>();
    const pending = [layer];
    while (pending.length) {
      const item = pending.pop()!;
      ids.add(item.id);
      for (const child of tree.children.get(item.id) ?? []) pending.push(child);
      for (const e of item.effects) {
        const keys = paintKeys(e);
        for (const key of keys) if (e.fields[key]) colors.add(e.fields[key]);
        if (keys.includes("end")) e.stops?.forEach(s => colors.add(s.color));
      }
    }
    return { ids, colors };
  }, [tree, layer]);
  if (!colors.size) return null;
  return (
    <section className="ce-section">
      <h3>Selection colors</h3>
      {Array.from(colors).map((value) => (
        <Field
          key={value}
          label="Color"
          value={value}
          kinds={["Color"]}
          tokens={doc.tokens}
          valid={(v) => CSS.supports("color", v)}
          onChange={(next) =>
            change((d) => ({
              ...d,
              elements: d.elements.map((l) =>
                !ids.has(l.id)
                  ? l
                  : {
                      ...l,
                      effects: l.effects.map((e) => {
                        const keys = paintKeys(e);
                        if (!keys.length) return e;
                        const fields = { ...e.fields };
                        for (const key of keys) if (fields[key] === value) fields[key] = next;
                        return {
                          ...e,
                          fields,
                          stops: keys.includes("end")
                            ? e.stops?.map((s) => (s.color === value ? { ...s, color: next } : s))
                            : e.stops,
                        };
                      }),
                    },
              ),
            }))
          }
        />
      ))}
    </section>
  );
}
