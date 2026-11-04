import type { SVGProps } from "react";

export type XmarkOutline12Props = SVGProps<SVGSVGElement> & {
  strokeWidth?: number | string;
};

export function XmarkOutline12({
  strokeWidth = 1.5,
  ...props
}: XmarkOutline12Props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={12} height={12} viewBox="0 0 12 12" {...props}><line x1="2.25" y1="9.75" x2="9.75" y2="2.25" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} data-color="color-2"></line><line x1="9.75" y1="9.75" x2="2.25" y2="2.25" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth}></line></svg>
  );
}
