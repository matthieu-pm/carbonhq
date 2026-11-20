import { gallery } from "@openpresentation/gallery";
import { toSvg } from "@openpresentation/opf-render";
import { loadPreviewFonts } from "@openpresentation/opf-render/preview-fonts";

import { readPage, type PageAsset, type PageTarget } from "@/lib/pages";
import { fileSrc, invoke, qualify } from "@/lib/transport";

export function imagePreview(blob: Blob, asset: PageAsset): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Could not preview ${asset.name}.`));
    reader.readAsDataURL(blob.slice(0, blob.size, asset.mimeType));
  });
}

export async function loadDeckImage(asset: PageAsset, server: string): Promise<string> {
  const response = await fetch(fileSrc(qualify(asset.path, server)));
  if (!response.ok) throw new Error(`Could not load ${asset.name}.`);
  return imagePreview(await response.blob(), asset);
}

/// An isolated SVG image with outlined text keeps the slide's fonts in a thumbnail.
export async function renderSlide(document: unknown, slide = 0, images?: Map<string, string>): Promise<string> {
  const fonts = await loadPreviewFonts("/opf-fonts");
  await fonts.ensure(document, { catalogs: [gallery] });
  const svg = toSvg(document, slide + 1, {
    fonts, catalogs: [gallery], text: "paths",
    imageResolver: (src) => (src && images?.get(src)) || undefined,
  });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const covers = new Map<string, Promise<string>>();

async function drawCover(page: PageTarget & { revision: number }) {
  const current = await readPage(page);
  const saved = current.revision === page.revision ? current : await readPage(page, page.revision);
  const document = JSON.parse(saved.markdown);
  const images = new Map<string, string>();
  if (saved.markdown.includes("carbon-asset://")) {
    const cover = JSON.stringify({ ...document, slides: document.slides?.slice(0, 1) });
    const assets = await invoke<PageAsset[]>("list_page_assets", { id: page.id }, page.server);
    await Promise.all(assets.filter((asset) => asset.mimeType.startsWith("image/") && cover.includes(asset.url))
      .map(async (asset) => images.set(asset.url, await loadDeckImage(asset, page.server))));
  }
  return renderSlide(document, 0, images);
}

export function deckCover(page: PageTarget & { revision: number }): Promise<string> {
  const key = `${page.server}:${page.id}:${page.revision}`;
  const cached = covers.get(key);
  if (cached) return cached;
  const made = drawCover(page);
  made.catch(() => { if (covers.get(key) === made) covers.delete(key); });
  covers.set(key, made);
  if (covers.size > 60) covers.delete(covers.keys().next().value!);
  return made;
}

/// Slide titles of a deck's JSON, for the conflict dialog and the library.
export function deckSlides(markdown: string): string[] {
  try {
    const slides = (JSON.parse(markdown) as { slides?: { title?: unknown }[] }).slides ?? [];
    return slides.map((slide, index) => typeof slide?.title === "string" && slide.title.trim() ? slide.title : `Slide ${index + 1}`);
  } catch { return []; }
}
