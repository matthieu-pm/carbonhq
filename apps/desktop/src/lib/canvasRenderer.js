const escape = (s) => s.replace(/[&<>"']/g, (c) => ({
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	"\"": "&quot;",
	"'": "&#39;"
})[c]);
const forbidden = new Set([
	"script",
	"style",
	"link",
	"meta",
	"base",
	"iframe",
	"object",
	"embed",
	"applet",
	"frame",
	"frameset",
	"portal",
	"foreignobject",
	"animate",
	"animatetransform",
	"set"
]);
const voids = new Set([
	"area",
	"br",
	"col",
	"hr",
	"img",
	"input",
	"source",
	"track",
	"wbr"
]);
/// Stored markup never receives the app's origin, network access, or executable attributes.
export function frameMarkup(frame, tokens, assets) {
	const resolve = (s) => assets ? s.replace(/carbon-canvas-asset:\/\/([a-zA-Z0-9-]+)/g, (_, id) => assets[id] ?? "data:,") : s;
	const render = (node) => {
		if (node.kind === "text") return `<!--canvas-text:${escape(node.id)}-->${escape(node.text)}`;
		const tag = node.tag;
		if (!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(tag) || forbidden.has(tag.toLowerCase()) || tag.includes("-")) return "";
		const attrs = Object.entries(node.attributes).filter(([key]) => /^[a-zA-Z_:][\w:.-]*$/.test(key) && !/^on|^data-canvas-|^(style|srcdoc|nonce|formaction|action|href|xlink:href|srcset|autofocus|is)$/i.test(key));
		const keys = [...new Set([...(Array.isArray(node.carbonStyleOrder) ? node.carbonStyleOrder.filter(key => typeof key === "string") : []), ...Object.keys(node.styles)])];
		const style = keys.filter(key => Object.hasOwn(node.styles, key) && /^(?:--[\w-]+|-?[a-zA-Z][a-zA-Z-]*)$/.test(key)).map(key => `${key}:${resolve(node.styles[key])}`).join(";");
		return `<${tag} data-canvas-id="${escape(node.id)}"${attrs.map(([key, value]) => ` ${key}="${escape(resolve(value))}"`).join("")} style="${escape(style)}">${voids.has(tag.toLowerCase()) ? "" : node.children.map(render).join("") + `</${tag}>`}`;
	};
	const vars = Object.entries(tokens).filter(([key]) => /^--[\w-]+$/.test(key)).map(([key, value]) => `${key}:${resolve(value)}`).join(";");
	const css = `:root{${vars}}html{width:100%;height:100%}body{margin:0;min-height:100%;font-family:system-ui,sans-serif}*{box-sizing:border-box}\n${resolve(frame.content.css)}`;
	return `<style>${css.replace(/<\/style/gi, "<\\/style")}</style></head><body>${frame.content.nodes.map(render).join("")}</body>`;
}
/// One bounded capture is enough for an overview; zoom never resizes its CSS viewport.
export function frameDocument(markup, token, capture, viewport, point, detail) {
	const script = `(${frameBridge.toString()})(${JSON.stringify(token)},${capture},${JSON.stringify(viewport ?? null)},${JSON.stringify(point ?? null)},${JSON.stringify(detail ?? null)})`;
	return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; script-src 'nonce-${token}'; base-uri 'none'; form-action 'none'">${markup}<script nonce="${token}">${script}<\/script></html>`;
}
function frameBridge(token, capture, viewport, point, detail) {
	const send = (value) => parent.postMessage({
		canvasToken: token,
		...value
	}, "*");
	document.addEventListener("submit", (e) => e.preventDefault());
	document.addEventListener("click", (e) => {
		if (e.target.closest("a")) e.preventDefault();
	});
	if (!capture) return;
	const hostReady = new Promise((resolve) => {
		const receive = (event) => {
			if (event.source !== parent || event.data?.canvasRender !== token) return;
			window.removeEventListener("message", receive);
			resolve();
		};
		window.addEventListener("message", receive);
	});
	const freeze = document.createElement("style");
	freeze.textContent = "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}";
	document.head.append(freeze);
	const properties = [
		"display",
		"visibility",
		"position",
		"z-index",
		"flex-direction",
		"align-items",
		"justify-content",
		"gap",
		"padding-top",
		"padding-right",
		"padding-bottom",
		"padding-left",
		"margin-top",
		"margin-right",
		"margin-bottom",
		"margin-left",
		"background-color",
		"background-image",
		"color",
		"border-radius",
		"font-family",
		"font-size",
		"font-weight",
		"line-height",
		"letter-spacing"
	];
	const collect = async () => {
		if (document.readyState !== "complete") await new Promise((resolve) => window.addEventListener("load", resolve, { once: true }));
		await hostReady;
		const ready = () => document.documentElement.clientWidth > 0 && innerHeight > 0 && (!viewport || innerWidth === viewport.width && innerHeight === viewport.height);
		// A new iframe can run its script before its owner has assigned the layout viewport.
		for (let attempt = 0; !ready() && attempt < 100; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
		if (!ready()) throw new Error("Frame layout is not ready. Refresh to try again.");
		await document.fonts.ready;
		await Promise.all([...document.images].map((img) => img.decode().catch(() => {})));
		if (document.querySelectorAll("*").length > 2e3) throw new Error("This frame exceeds the 2,000-element preview limit.");
		if (point) {
			document.querySelectorAll("*").forEach((el) => el.style.setProperty("pointer-events", "auto", "important"));
			const element = document.elementsFromPoint(point.x, point.y).find((el) => {
				for (let ancestor = el; ancestor; ancestor = ancestor.parentElement) if (getComputedStyle(ancestor).opacity === "0") return false;
				return el.hasAttribute("data-canvas-id");
			});
			let hit = element?.getAttribute("data-canvas-id") ?? null;
			if (element) for (const child of element.childNodes) {
				if (child.nodeType !== 8 || !child.textContent?.startsWith("canvas-text:") || child.nextSibling?.nodeType !== 3) continue;
				const range = document.createRange();
				range.selectNode(child.nextSibling);
				if ([...range.getClientRects()].some((r) => point.x >= r.left && point.x <= r.right && point.y >= r.top && point.y <= r.bottom)) {
					hit = child.textContent.slice(12);
					break;
				}
			}
			send({ hit });
			return;
		}
		const boxes = [];
		const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			const element = node.nodeType === 1 ? node : node.parentElement;
			const id = node.nodeType === 1 ? element?.getAttribute("data-canvas-id") : node.textContent?.startsWith("canvas-text:") ? node.textContent.slice(12) : null;
			if (!id || !element) continue;
			let rect = element.getBoundingClientRect();
			if (node.nodeType === 8 && node.nextSibling?.nodeType === 3) {
				const range = document.createRange();
				range.selectNode(node.nextSibling);
				rect = range.getBoundingClientRect();
			}
			const styles = getComputedStyle(element);
			boxes.push({
				id,
				x: rect.x + scrollX,
				y: rect.y + scrollY,
				width: rect.width,
				height: rect.height,
				styles: Object.fromEntries((detail === id ? [...styles] : properties).map((p) => [p, styles.getPropertyValue(p)])),
				text: (node.nodeType === 8 ? node.nextSibling?.textContent : element.textContent)?.slice(0, 4e3) ?? ""
			});
		}
		const html = document.documentElement.cloneNode(true);
		const sources = [document.documentElement, ...document.documentElement.querySelectorAll("*")];
		const targets = [html, ...html.querySelectorAll("*")];
		const inline = (target, styles) => {
			target.removeAttribute("style");
			for (const property of styles) target.style.setProperty(property, styles.getPropertyValue(property), "important");
		};
		// Freeze used styles before rasterizing: SVG image dimensions must not re-evaluate vh or media queries.
		sources.forEach((source, index) => {
			const target = targets[index];
			if (!(target instanceof HTMLElement) && !(target instanceof SVGElement)) return;
			inline(target, getComputedStyle(source));
			for (const pseudo of ["::before", "::after"]) {
				const styles = getComputedStyle(source, pseudo);
				if (!styles.content || [
					"none",
					"normal",
					"\"\""
				].includes(styles.content)) continue;
				const span = document.createElement("span");
				try {
					span.textContent = JSON.parse(styles.content);
				} catch {
					continue;
				}
				inline(span, styles);
				span.style.removeProperty("content");
				if (pseudo === "::before") target.prepend(span);
				else target.append(span);
			}
		});
		html.querySelectorAll("script,meta,style").forEach((n) => n.remove());
		const fonts = [];
		const fontRules = (rules) => {
			for (const rule of rules) {
				if (rule instanceof CSSFontFaceRule) fonts.push(rule.cssText);
				else if ("cssRules" in rule) fontRules(rule.cssRules);
			}
		};
		for (const sheet of document.styleSheets) fontRules(sheet.cssRules);
		if (fonts.length) {
			const style = document.createElement("style");
			style.textContent = fonts.join("\n");
			html.querySelector("head")?.append(style);
		}
		html.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
		const serialized = new XMLSerializer().serializeToString(html);
		if (serialized.length > 16 * 1024 * 1024) throw new Error("This frame exceeds the preview size limit.");
		send({
			boxes,
			html: serialized
		});
	};
	void collect().catch((e) => send({ error: String(e) }));
}
