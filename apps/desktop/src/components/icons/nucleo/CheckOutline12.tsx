import type { SVGProps } from "react";

export type CheckOutline12Props = SVGProps<SVGSVGElement> & {
  strokeWidth?: number | string;
};

export function CheckOutline12({
  strokeWidth = 1.5,
  ...props
}: CheckOutline12Props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={12} height={12} viewBox="0 0 12 12" {...props}><path d="m1.76,7.004l2.25,3L10.24,1.746" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth}></path></svg>
  );
}
