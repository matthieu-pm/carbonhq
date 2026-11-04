import type { SVGProps } from "react";

export type ArrowLeftOutline12Props = SVGProps<SVGSVGElement> & {
  strokeWidth?: number | string;
};

export function ArrowLeftOutline12({
  strokeWidth = 1.5,
  ...props
}: ArrowLeftOutline12Props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={12} height={12} viewBox="0 0 12 12" {...props}><line x1="11" y1="6" x2="1.25" y2="6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} data-color="color-2"></line><polyline points="4.25 2.75 1 6 4.25 9.25" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth}></polyline></svg>
  );
}
