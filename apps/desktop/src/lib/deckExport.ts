import { gallery } from "@openpresentation/gallery";
import { toPptx } from "@openpresentation/opf-pptx";
import type { BrowserFontsHandle } from "@openpresentation/opf-render/fonts-browser";
import type { PageAsset } from "@/lib/pages";
import { fileSrc, invoke, LOCAL, qualify } from "@/lib/transport";

export async function exportDeck(document: unknown, title: string, fonts: BrowserFontsHandle, assets: PageAsset[], server: string) {
  await fonts.ensure(document, { catalogs: [gallery] });
  const bytes = await toPptx(document, {
    fonts, catalogs: [gallery], strictAssets: true,
    imageResolver: async (source) => {
      const image = assets.find((asset) => asset.url === source && asset.mimeType.startsWith("image/"));
      if (!image) return null;
      const response = await fetch(fileSrc(qualify(image.path, server)));
      if (!response.ok) throw new Error(`Could not load ${image.name}.`);
      return { data: new Uint8Array(await response.arrayBuffer()), mediaType: image.mimeType };
    },
  });
  if ("__TAURI_INTERNALS__" in window) {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 32768) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    }
    await invoke("save_powerpoint_file", { title, data: btoa(binary) }, LOCAL);
    return;
  }
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }));
  const link = window.document.createElement("a");
  link.href = url;
  link.download = `${title}.pptx`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
