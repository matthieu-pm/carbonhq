import type { Metadata } from "next";

import { Closing } from "@/components/home/Closing";
import { SiteNav } from "@/components/home/SiteNav";
import { macosDownload } from "@/lib/download";

import { StartDownload } from "./client";

export const metadata: Metadata = {
  title: "Download - Carbon",
  description: "Download Carbon for macOS.",
};

export default async function Download() {
  const url = await macosDownload();

  return (
    <div
      data-home
      className="min-h-screen overflow-x-clip bg-black font-inter text-white antialiased light:bg-[#F4F4F2] light:text-[#0A0A0A]"
    >
      <StartDownload url={url} />
      <header className="px-5 pb-[120px] sm:px-8">
        <div className="mx-auto w-full max-w-[960px]">
          <SiteNav bare />
          <div className="lg:ml-[102px] lg:max-w-[756px]">
            <h1 className="pt-16 font-inter text-[28px] leading-[32px] font-normal tracking-[-0.03em] text-balance sm:pt-[101px] sm:text-[36px] sm:leading-[40px]">
              Thanks for downloading Carbon.
            </h1>
            <p className="mt-4 text-[16px] text-[#A0A0A0] light:text-[#555]">
              Your download starts automatically.{" "}
              <a
                href="/download/macos"
                className="text-white underline decoration-white/30 underline-offset-4 light:text-[#0A0A0A] light:decoration-black/30"
              >
                Download it manually
              </a>
              .
            </p>
          </div>
        </div>
      </header>

      <Closing />
    </div>
  );
}
