import { macosDownload } from "@/lib/download";

/// Keep installer links current while letting the browser handle the file.
export async function GET() {
  return new Response(null, {
    status: 307,
    headers: {
      Location: await macosDownload(),
      "Cache-Control": "no-store",
    },
  });
}
