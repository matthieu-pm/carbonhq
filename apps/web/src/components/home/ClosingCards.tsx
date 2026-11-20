import { DownloadButton } from "@/components/DownloadButton";
import { InstallCommand } from "@/components/InstallCommand";
import { Newsletter } from "@/components/home/Newsletter";

export function ClosingCards() {
  return (
    <div className="relative min-w-0 font-inter text-left antialiased">
      <div className="grid divide-y divide-white/30 border-y border-white/30 bg-white/10 sm:grid-cols-2 sm:divide-x sm:divide-y-0 sm:border-x">
        <Way label="On your Mac" title="Download the app.">
          <DownloadButton from="cta" className="inline-flex h-10 items-center gap-2 self-start rounded-[6px] bg-white px-4 text-[14px] leading-5 font-medium text-[#0B0B0F] shadow-[inset_0_-1px_0_#4D4C4C,0_1px_2px_#00000040] transition-opacity hover:opacity-90 [&>svg]:-mt-0.5" />
        </Way>
        <Way label="On a server" title="Install the CLI.">
          <InstallCommand />
        </Way>
      </div>
      <Newsletter />
    </div>
  );
}

/// One of the two ways in: a label, a line, and the thing to do at the foot.
function Way({ label, title, children }: { label: string; title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[200px] min-w-0 flex-col justify-between gap-8 p-6">
      <div className="flex flex-col gap-1.5">
        <p className="font-mono text-[11px] leading-[14px] tracking-[0.06em] text-white/70 uppercase">{label}</p>
        <h3 className="text-[20px] leading-[26px] tracking-[-0.02em] text-white">{title}</h3>
      </div>
      {children}
    </div>
  );
}
