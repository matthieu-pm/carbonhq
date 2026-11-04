import type { SVGProps } from "react";

export type TerminalOutline18Props = SVGProps<SVGSVGElement> & {
  strokeWidth?: number | string;
};

export function TerminalOutline18({
  strokeWidth = 1.5,
  ...props
}: TerminalOutline18Props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={18} height={18} viewBox="0 0 18 18" {...props}><polyline points="2.75 14.25 8 9 2.75 3.75" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth}></polyline><line x1="9.5" y1="14.25" x2="15.25" y2="14.25" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} data-color="color-2"></line></svg>
  );
}
