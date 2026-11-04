import type { SVGProps } from "react";

export type Globe2Outline12Props = SVGProps<SVGSVGElement> & {
  strokeWidth?: number | string;
};

export function Globe2Outline12({
  strokeWidth = 1.5,
  ...props
}: Globe2Outline12Props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={12} height={12} viewBox="0 0 12 12" {...props}><ellipse cx="6" cy="6" rx="2.172" ry="5.25" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} data-color="color-2"></ellipse><line x1=".75" y1="6" x2="11.25" y2="6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} data-color="color-2"></line><circle cx="6" cy="6" r="5.25" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth}></circle></svg>
  );
}
