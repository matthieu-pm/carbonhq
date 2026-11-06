import { REPO } from "@/lib/links";

const STABLE_MANIFEST = "https://matthieu-pm.github.io/carbonhq/stable.json";

/// The stable manifest selects the desktop release independently of CLI tags.
export async function stableDownload(): Promise<string | null> {
  const options = { next: { revalidate: 60 } };

  try {
    const manifest = await fetch(STABLE_MANIFEST, { ...options, signal: AbortSignal.timeout(5000) });
    if (!manifest.ok) return null;
    const { version } = await manifest.json();
    if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) return null;

    const mirror = process.env.DOWNLOADS_URL?.replace(/\/$/, "");
    if (mirror) return `${mirror}/Carbon_universal.dmg`;

    const repo = new URL(REPO).pathname.slice(1);
    const release = await fetch(`https://api.github.com/repos/${repo}/releases/tags/v${version}`, {
      ...options,
      signal: AbortSignal.timeout(5000),
    });
    if (!release.ok) return null;
    const { assets } = await release.json() as {
      assets: { name: string; browser_download_url: string }[];
    };
    return assets.find((asset) => asset.name.endsWith("_universal.dmg"))?.browser_download_url ?? null;
  } catch {
    return null;
  }
}
