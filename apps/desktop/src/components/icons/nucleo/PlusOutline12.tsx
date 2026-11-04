import type { SVGProps } from "react";

export type PlusOutline12Props = SVGProps<SVGSVGElement> & {
  strokeWidth?: number | string;
};

export function PlusOutline12({
  strokeWidth = 1.5,
  ...props
}: PlusOutline12Props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={12} height={12} viewBox="0 0 12 12" {...props}><line x1="10.75" y1="6" x2="1.25" y2="6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} data-color="color-2"></line><line x1="6" y1="10.75" x2="6" y2="1.25" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth}></line></svg>
  );
}
