import type { SVGProps } from "react";

export type ChevronDownOutline12Props = SVGProps<SVGSVGElement> & {
  strokeWidth?: number | string;
};

export function ChevronDownOutline12({
  strokeWidth = 1.5,
  ...props
}: ChevronDownOutline12Props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={12} height={12} viewBox="0 0 12 12" {...props}><polyline points="1.75 4.25 6 8.5 10.25 4.25" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth}></polyline></svg>
  );
}
