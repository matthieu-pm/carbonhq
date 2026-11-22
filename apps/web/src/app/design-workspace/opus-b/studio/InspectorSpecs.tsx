import { LABEL } from "../_shared/Shell";

const SPECS: [string, string][] = [
  ["Frame presets", "iPhone 16, Android compact, iPad mini and Pro, MacBook Air and Pro, Full HD, 16:9, A4, US Letter, Apple Watch, square and story."],
  ["Layout", "Free placement, or Flex with direction, align, justify, wrap, gap and padding. Arrow keys nudge by 1, Shift by 10."],
  ["Fills", "Solid, linear, radial or conic, with extra gradient stops, or an embedded PNG, JPEG, WebP or GIF."],
  ["Effects", "Border per side, outline, shadow, inner shadow, filter, backdrop filter and text stroke. Stack, reorder, hide."],
  ["Type", "Family, size, weight, line height, tracking, alignment, case and decoration, each bindable to a token."],
  ["History", "⌘Z and ⇧⌘Z walk back up to 80 steps. Edits save on their own a moment after you stop."],
];

export function InspectorSpecs() {
  return (
    <dl className="mt-12 grid border-t border-[#FFFFFF26] light:border-black/10 sm:grid-cols-2 lg:ml-[102px]">
      {SPECS.map(([term, body]) => (
        <div key={term} className="flex flex-col gap-2 border-b border-[#FFFFFF26] py-6 sm:pr-10 light:border-black/10">
          <dt className={LABEL}>{term}</dt>
          <dd className="text-[15px] leading-[22px] text-[#CFCFCF] light:text-[#3F3F46]">{body}</dd>
        </div>
      ))}
    </dl>
  );
}
