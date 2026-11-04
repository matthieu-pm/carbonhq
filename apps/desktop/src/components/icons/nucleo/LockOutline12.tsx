import type { SVGProps } from "react";

export type LockOutline12Props = SVGProps<SVGSVGElement> & {
  strokeWidth?: number | string;
};

export function LockOutline12({
  strokeWidth = 1.5,
  ...props
}: LockOutline12Props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={12} height={12} viewBox="0 0 12 12" {...props}><line x1="6" y1="7.5" x2="6" y2="8.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} data-color="color-2"></line><path d="m3.75,4.75v-1.75c0-1.243,1.007-2.25,2.25-2.25h0c1.243,0,2.25,1.007,2.25,2.25v1.75" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} data-color="color-2"></path><rect x="1.25" y="4.75" width={9.5} height={6.5} rx="1.5" ry="1.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth}></rect></svg>
  );
}
