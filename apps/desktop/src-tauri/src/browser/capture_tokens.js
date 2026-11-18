(document) => {
  const properties = new Map([
    ["background-color", ["background"]], ["color", []], ["fill", []], ["stroke", []],
    ["font-family", ["font"]], ["font-size", ["font"]], ["line-height", ["font"]],
    ["font-weight", ["font"]], ["letter-spacing", []], ["opacity", []],
    ["box-shadow", []], ["row-gap", ["gap"]], ["column-gap", ["gap"]],
  ]);
  for (const name of ["width", "height", "min-width", "min-height", "max-width", "max-height"]) {
    properties.set(name, ["inline", "block"].map(axis => name.replace(/(?:width|height)$/, `${axis}-size`)));
  }
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
  const addRule = (selector, style, layer, certainty, complexLayer) => {
    const declared = new Set(style);
    if ([...declared].some(name => styleHas.has(name))) {
      rules.push({ selector, style, declared, layer, certainty, complexLayer, order: rules.length });
    }
  };
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
          addRule(selector, rule.style, layer, certainty && !!selector, complexLayer);
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
          addRule(parent, rule.style, layer, certainty && !!parent, complexLayer);
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
    try {
      const declarations = sheet.cssRules;
      const defaultNamespace = Array.from(declarations).some(rule => rule.constructor.name === "CSSNamespaceRule" && !rule.prefix);
      walk(declarations, layer, certainty && !defaultNamespace, depth, null, complexLayer);
    } catch { complete = false; }
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
      return [ids, classes, tags].some(count => count >= 1000) ? NaN : ids * 1_000_000 + classes * 1000 + tags;
    }));
  };
  const matchRule = (rule, element, pseudo) => {
    let selector = rule.selector;
    const uncertain = () => [{ ...rule, certainty: false }];
    if (!selector || /:scope\b|:visited\b/i.test(selector)) return uncertain();
    if (pseudo) {
      const suffix = new RegExp(`:{1,2}${pseudo}$`, "i");
      if (!suffix.test(selector) && !selector.toLowerCase().includes(`:${pseudo}`)) return [];
      if (selector.includes(",") && /[\[\]("'\\]/.test(selector)) return uncertain();
      selector = selector.split(",").map(part => part.trim()).filter(part => suffix.test(part))
        .map(part => part.replace(suffix, "") || "*").join(",");
      if (!selector) return uncertain();
    }
    try { return element.matches(selector) ? [{ ...rule, selector }] : []; }
    catch { return uncertain(); }
  };
  const logical = key => /-(?:inline|block|start|end)(?:-|$)|^(?:inline|block)-size$/.test(key);
  const applies = (alias, prop, computed) => {
    if (!logical(alias)) return true;
    if (computed.writingMode !== "horizontal-tb") return true;
    if (alias.endsWith("-size")) return alias.endsWith("inline-size") === prop.endsWith("width");
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
  const singleFunction = value => {
    const start = /^[\w-]+\(/.exec(value)?.[0].length;
    if (!start) return false;
    let depth = 1, quote = "";
    for (let index = start; index < value.length; index++) {
      const char = value[index];
      if (char === "\\") { index++; continue; }
      if (quote) { if (char === quote) quote = ""; continue; }
      if (char === '"' || char === "'") quote = char;
      if (char === "(") depth++;
      if (char === ")" && --depth === 0) return index === value.length - 1;
    }
    return false;
  };
  const candidates = (rule, prop, aliases, computed) => {
    const exact = rule.style.getPropertyValue(prop);
    const list = [];
    if (exact) list.push({ key: prop, value: exact });
    for (const key of aliases) {
      if (exact && !logical(key) || !applies(key, prop, computed)) continue;
      const value = rule.style.getPropertyValue(key);
      const direct = /^(?:padding|margin)-(?:inline|block)-(?:start|end)$|^border-(?:inline|block)-(?:start|end)-(?:width|color)$|^border-(?:start|end)-(?:start|end)-radius$|(?:inline|block)-size$/.test(key);
      const uniform = /^(?:gap|(?:padding|margin)(?:-(?:inline|block))?|border-radius|border(?:-(?:inline|block))?-(?:width|color))$/.test(key);
      if (value) list.push({ key, value: direct || uniform && singleFunction(value) ? value : "" });
    }
    // CSSOM can enumerate a longhand whose pending var() substitution hides its value.
    for (const key of [prop, ...aliases]) {
      if (!rule.declared.has(key) || !applies(key, prop, computed) || rule.style.getPropertyValue(key)) continue;
      const covered = list.some(item => key === prop ? !logical(item.key) : key.startsWith(`${item.key}-`));
      if (!covered) list.push({ key, value: "" });
    }
    const all = rule.style.getPropertyValue("all");
    if (all) list.push({ key: "all", value: all });
    return list.map(({ key, value }) => ({
      ...rule, value, important: rule.style.getPropertyPriority(key) === "important",
      certainty: rule.certainty && (computed.writingMode === "horizontal-tb" || !logical(key)),
    }));
  };

  return (element, computed, styles, pseudo = null) => {
    if (!complete || element.getRootNode() !== document || element.getAnimations().length || pseudo && computed.animationName !== "none") return {};
    comparisons += rules.length;
    if (comparisons > 450_000) return {};
    const matched = rules.flatMap(rule => matchRule(rule, element, pseudo));
    if (!pseudo && element.style?.length) {
      matched.push({ style: element.style, declared: new Set(element.style), selector: null, layer: null, certainty: true, inline: true });
    }
    if (!matched.some(rule => /var\(/i.test(rule.style.cssText))) return {};
    const result = {};
    for (const [prop, aliases] of properties) {
      if (!styles[prop]) continue;
      let possible = matched.flatMap(rule => candidates(rule, prop, aliases, computed));
      if (!possible.some(rule => refs(rule.value).length)) continue;
      const important = possible.some(rule => rule.important && rule.certainty);
      if (important) possible = possible.filter(rule => rule.important);
      const inlineWinner = possible.filter(rule => rule.inline && (rule.important || !possible.some(other => other.important)));
      if (inlineWinner.some(rule => rule.certainty)) possible = inlineWinner;
      else if (possible.every(rule => rule.certainty) && (important || !possible.some(rule => rule.important))) {
        const layerRank = rule => rule.layer === null ? (important ? -Infinity : Infinity) : (important ? -rule.layer : rule.layer);
        const best = Math.max(...possible.map(layerRank));
        possible = possible.filter(rule => layerRank(rule) === best);
        const scores = possible.map(rule => specificity(rule.selector, element));
        if (possible.every(rule => !rule.complexLayer) && scores.every(Number.isFinite)) {
          const best = Math.max(...scores);
          possible = possible.filter((_, index) => scores[index] === best);
          const last = Math.max(...possible.map(rule => rule.order));
          possible = possible.filter(rule => rule.order === last);
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
