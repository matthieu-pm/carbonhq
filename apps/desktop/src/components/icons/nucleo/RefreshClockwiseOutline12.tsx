import type { SVGProps } from "react";

export type RefreshClockwiseOutline12Props = SVGProps<SVGSVGElement> & {
  strokeWidth?: number | string;
};

export function RefreshClockwiseOutline12({
  strokeWidth = 1.5,
  ...props
}: RefreshClockwiseOutline12Props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={12} height={12} viewBox="0 0 12 12" {...props}><polyline points="4.25 8.25 1.25 8.25 1.25 11.25" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} data-color="color-2"></polyline><path d="m1.282,8.306c.854,1.743,2.646,2.944,4.718,2.944,2.832,0,5.141-2.243,5.246-5.049" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} data-color="color-2"></path><polyline points="7.75 3.75 10.75 3.75 10.75 .75" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth}></polyline><path d="m10.718,3.694c-.854-1.743-2.646-2.944-4.718-2.944-2.832,0-5.141,2.243-5.246,5.049" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth}></path></svg>
  );
}
