(selector, path, timeOrigin) => {
  if (performance.timeOrigin !== timeOrigin || location.pathname !== path) return null;
  try {
    let el = document.body;
    if (selector) {
      const parts = selector.split(" >>> ");
      let root = document;
      for (const [index, part] of parts.entries()) {
        el = root?.querySelector(part);
        root = index + 1 < parts.length ? el?.shadowRoot : null;
      }
    }
    if (!el) return null;
    const hint = (framework, file, line, confidence = "approximate") => typeof file === "string" && file
      ? { framework, file: file.split(/[?#]/)[0].slice(0, 1024), line: Number.isInteger(line) && line > 0 && line <= 0xffffffff ? line : null, confidence }
      : null;
    const reactKey = Object.keys(el).find(key => key.startsWith("__reactFiber$"));
    for (let fiber = el[reactKey], depth = 0; fiber && depth < 32; fiber = fiber.return, depth++) {
      const source = fiber._debugSource;
      if (source?.fileName) return hint("React", source.fileName, source.lineNumber, depth === 0 ? "exact" : "approximate");
      const stack = fiber._debugStack?.stack;
      const match = typeof stack === "string" && stack.match(/(?:\(|at )((?:file:\/\/|https?:\/\/|\/).*?):(\d+):\d+\)?/);
      if (match) return hint("React", match[1], Number(match[2]));
    }
    const svelte = el.__svelte_meta?.loc;
    if (svelte?.file) return hint("Svelte", svelte.file, svelte.line, "exact");
    return hint("Vue", el.__vueParentComponent?.type?.__file);
  } catch { return null; }
}
