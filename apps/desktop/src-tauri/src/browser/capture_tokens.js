(document) => {
  const properties = new Map([
    ["background-color", ["background"]], ["color", []], ["fill", []], ["stroke", []],
    ["font-family", ["font"]], ["font-size", ["font"]], ["line-height", ["font"]],
    ["font-weight", ["font"]], ["letter-spacing", []], ["opacity", []],
    ["box-shadow", []], ["row-gap", ["gap"]], ["column-gap", ["gap"]],
  ]);
  const sides = ["top", "right", "bottom", "left"];
  const axes = ["inline", "block"];
  for (const side of sides) {
    for (const part of ["color", "width"]) {
      const logical = axes.flatMap(axis => [`border-${axis}`, `border-${axis}-${part}`, ...["start", "end"].flatMap(edge => [`border-${axis}-${edge}`, `border-${axis}-${edge}-${part}`])]);
      properties.set(`border-${side}-${part}`, [`border-${side}`, `border-${part}`, "border", ...logical]);
    }
    for (const kind of ["padding", "margin"]) properties.set(`${kind}-${side}`, [kind, ...axes.flatMap(axis => [`${kind}-${axis}`, `${kind}-${axis}-start`, `${kind}-${axis}-end`])]);
  }
  for (const corner of ["top-left", "top-right", "bottom-right", "bottom-left"]) {
    properties.set(`border-${corner}-radius`, ["border-radius", "border-start-start-radius", "border-start-end-radius", "border-end-start-radius", "border-end-end-radius"]);
  }

  const layers = new Map();
  const rankLayer = name => {
    if (!layers.has(name)) layers.set(name, layers.size);
    return layers.get(name);
  };
  const rules = [];
  let complete = true, scanned = 0, comparisons = 0;
  const styleHas = new Set(["all", ...properties.keys(), ...[...properties.values()].flat()]);
  const nestedSelector = (selector, parent) => {
    if (parent === null) return selector;
    if (!parent || parent.length > 1024 || /[,\[\]"'\\]/.test(selector)) return "";
    const anchor = `:is(${parent})`;
    return selector.includes("&") ? selector.replaceAll("&", anchor) : `${anchor} ${selector}`;
  };
  const walk = (list, layer, certainty, depth, parent = null, complexLayer = false) => {
    if (depth > 12) { complete = false; return; }
    for (const rule of list) {
      if (++scanned > 4500) { complete = false; return; }
      switch (rule.constructor.name) {
        case "CSSStyleRule": {
          const selector = nestedSelector(rule.selectorText, parent);
          if (Array.from(rule.style).some(name => styleHas.has(name))) {
            rules.push({ selector, style: rule.style, layer, certainty: certainty && !!selector, complexLayer });
          }
          if (rule.cssRules?.length) walk(rule.cssRules, layer, certainty && !!selector, depth + 1, selector, complexLayer);
          break;
        }
        case "CSSLayerStatementRule":
          if (layer === null) for (const name of rule.nameList) rankLayer(name.split(".")[0]);
          break;
        case "CSSLayerBlockRule":
          walk(rule.cssRules, layer ?? rankLayer(rule.name ? rule.name.split(".")[0] : Symbol()), certainty, depth + 1, parent, layer !== null || rule.name.includes("."));
          break;
        case "CSSMediaRule":
          if (matchMedia(rule.conditionText).matches) walk(rule.cssRules, layer, certainty, depth + 1, parent, complexLayer);
          break;
        case "CSSSupportsRule":
          if (CSS.supports(rule.conditionText)) walk(rule.cssRules, layer, certainty, depth + 1, parent, complexLayer);
          break;
        case "CSSImportRule": {
          if (rule.supportsText != null && !CSS.supports(rule.supportsText)) break;
          const imported = rule.layerName == null ? layer : layer ?? rankLayer(rule.layerName ? rule.layerName.split(".")[0] : Symbol());
          sheet(rule.styleSheet, imported, certainty, depth + 1, rule.media, complexLayer || rule.layerName?.includes("."));
          break;
        }
        case "CSSNestedDeclarations":
          if (Array.from(rule.style).some(name => styleHas.has(name))) {
            rules.push({ selector: parent, style: rule.style, layer, certainty: certainty && !!parent, complexLayer });
          }
          break;
        case "CSSKeyframesRule":
          break;
        default:
          if (rule.cssRules?.length) walk(rule.cssRules, layer, false, depth + 1, parent, complexLayer);
      }
      if (!complete) return;
    }
  };
  const sheet = (sheet, layer, certainty, depth, media = sheet?.media, complexLayer = false) => {
    if (sheet?.disabled || media?.mediaText && !matchMedia(media.mediaText).matches) return;
    try { walk(sheet.cssRules, layer, certainty, depth, null, complexLayer); } catch { complete = false; }
  };
  for (const stylesheet of [...document.styleSheets, ...(document.adoptedStyleSheets ?? [])]) {
    sheet(stylesheet, null, true, 0);
    if (!complete) break;
  }

  const refs = value => [...new Set([...value.matchAll(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\*[\s\S]*?\*\/|(?<![\w\u0080-\u{10FFFF}-])var\(\s*(--[\w\u0080-\u{10FFFF}-]{1,128})\s*(?=[,)])/giu)].flatMap(match => match[1] ?? []))].sort();
  const specificity = (selector, element) => {
    if (!selector) return null;
    const parts = selector.split(",");
    if (!parts.every(part => /^[\w\s.*#>+~-]+$/.test(part))) return null;
    return Math.max(...parts.filter(part => element.matches(part)).map(part => {
      const ids = part.match(/#[\w-]+/g)?.length ?? 0;
      const classes = part.match(/\.[\w-]+/g)?.length ?? 0;
      const tags = part.match(/(^|[\s>+~])[a-z][\w-]*/gi)?.length ?? 0;
      return ids * 1_000_000 + classes * 1000 + tags;
    }));
  };
  const matches = (rule, element) => {
    if (!rule.selector) return !rule.certainty;
    try { return element.matches(rule.selector); } catch { return !rule.certainty; }
  };
  const applies = (alias, prop, computed) => {
    if (!/-(?:inline|block|start|end)(?:-|$)/.test(alias)) return true;
    if (computed.writingMode !== "horizontal-tb") return true;
    const start = computed.direction === "rtl" ? "right" : "left";
    const end = start === "left" ? "right" : "left";
    if (alias.endsWith("-radius")) {
      const [, block, inline] = alias.split("-");
      return prop === `border-${block === "start" ? "top" : "bottom"}-${inline === "start" ? start : end}-radius`;
    }
    const [, axis, qualifier] = alias.split("-");
    const pair = axis === "inline" ? [start, end] : ["top", "bottom"];
    const side = prop.split("-")[1];
    if (qualifier === "start" || qualifier === "end") return side === pair[qualifier === "start" ? 0 : 1];
    return pair.includes(side);
  };
  const candidates = (rule, prop, aliases, computed) => {
    const exact = rule.style.getPropertyValue(prop);
    const list = [];
    if (exact) list.push({ key: prop, value: exact });
    for (const key of aliases) {
      if (!applies(key, prop, computed)) continue;
      const value = rule.style.getPropertyValue(key);
      if (value && (!exact || /-(?:inline|block|start|end)(?:-|$)/.test(key))) list.push({ key, value });
    }
    const all = rule.style.getPropertyValue("all");
    if (all) list.push({ key: "all", value: all });
    return list.map(({ key, value }) => ({
      ...rule, value, important: rule.style.getPropertyPriority(key) === "important",
      certainty: rule.certainty && (computed.writingMode === "horizontal-tb" || !/-(?:inline|block|start|end)(?:-|$)/.test(key)),
    }));
  };

  return (element, computed, styles) => {
    if (!complete || element.getRootNode() !== document || element.getAnimations().length) return {};
    comparisons += rules.length;
    if (comparisons > 450_000) return {};
    const matched = rules.filter(rule => matches(rule, element));
    const inline = { style: element.style, selector: null, layer: null, certainty: true, inline: true };
    if (inline.style?.length) matched.push(inline);
    if (!matched.some(rule => /var\(/i.test(rule.style.cssText))) return {};
    const result = {};
    for (const [prop, aliases] of properties) {
      if (!styles[prop]) continue;
      let possible = matched.flatMap(rule => candidates(rule, prop, aliases, computed));
      if (!possible.some(rule => refs(rule.value).length)) continue;
      const important = possible.some(rule => rule.important && rule.certainty);
      if (important) possible = possible.filter(rule => rule.important);
      const inlineWinner = possible.filter(rule => rule.inline && (rule.important || !possible.some(other => other.important)));
      if (inlineWinner.length) possible = inlineWinner;
      else if (possible.every(rule => rule.certainty) && (important || !possible.some(rule => rule.important))) {
        const layerRank = rule => rule.layer === null ? (important ? -Infinity : Infinity) : (important ? -rule.layer : rule.layer);
        const best = Math.max(...possible.map(layerRank));
        possible = possible.filter(rule => layerRank(rule) === best);
        const scores = possible.map(rule => specificity(rule.selector, element));
        if (possible.every(rule => !rule.complexLayer) && scores.every(score => score !== null)) {
          const best = Math.max(...scores);
          possible = possible.filter((_, index) => scores[index] === best);
        }
      }
      // A computed value cannot identify the source when different declarations might win.
      if (!possible.some(rule => rule.certainty)) continue;
      const names = refs(possible[0].value);
      if (names.length && names.length <= 8 && possible.every(rule => rule.value === possible[0].value)) result[prop] = names;
    }
    return result;
  };
}
