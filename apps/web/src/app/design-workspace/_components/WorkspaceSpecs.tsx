import type { ReactNode } from "react";
import { EFFECTS, Key, TOKEN_KINDS, TOOLS } from "./kit";
import { Band, Heading, LABEL, LINE, MUTED } from "./shell";

export function WorkspaceSpecs({ showTools = false }: { showTools?: boolean }) {
  return (
    <Band id="spec" className="py-20">
      <Heading lead="The spec sheet.">What ships in the Design workspace today.</Heading>
      <dl className={`mt-12 border-t lg:mt-20 ${LINE}`}>
        {showTools && (
          <Row term="Tools">
            <span className="flex flex-wrap gap-x-5 gap-y-2">
              {TOOLS.map((t) => (
                <span key={t.name} className="flex items-center gap-2">
                  <Key>{t.key}</Key>
                  {t.name}
                </span>
              ))}
            </span>
          </Row>
        )}
        <Row term="Frame presets">Phone, tablet, desktop, presentation, smartwatch, paper and social sizes.</Row>
        <Row term="Layout">Free placement or flex: direction, align, justify, wrap, gap and padding. Per-corner radius, typography and blending.</Row>
        <Row term="Effects">{EFFECTS.join(", ")}.</Row>
        <Row term="Token kinds">{TOKEN_KINDS.join(", ")}.</Row>
        <Row term="Storage">One .canvas.json per canvas under canvases/ in the project. Archived canvases move to canvases/.archive.</Row>
        <Row term="Canvas chat">Docked per canvas, with tabs. A comment sends your note, a snapshot of the board and the canvas path.</Row>
        <Row term="History">⌘Z and ⇧⌘Z walk back up to 80 steps. Edits save on their own a moment after you stop.</Row>
      </dl>
    </Band>
  );
}

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className={`grid gap-2 border-b py-4 sm:grid-cols-[200px_minmax(0,1fr)] ${LINE}`}>
      <dt className={`${LABEL} pt-1 ${MUTED}`}>{term}</dt>
      <dd className="text-[15px] leading-[22px]">{children}</dd>
    </div>
  );
}
