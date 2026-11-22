import type { SVGProps } from "react";

export type UnorderedList4Outline18Props = SVGProps<SVGSVGElement> & {
  strokeWidth?: number | string;
};

export function UnorderedList4Outline18({
  strokeWidth = 1.5,
  ...props
}: UnorderedList4Outline18Props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={18} height={18} viewBox="0 0 18 18" {...props}><line x1="8.25" y1="9" x2="15.75" y2="9" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} data-color="color-2"></line><line x1="8.25" y1="3.75" x2="15.75" y2="3.75" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} data-color="color-2"></line><line x1="8.25" y1="14.25" x2="15.75" y2="14.25" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} data-color="color-2"></line><polygon points="2.25 7.75 2.25 10.25 4.75 9 2.25 7.75" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} fill="currentColor"></polygon><polygon points="2.25 12.75 2.25 15.25 4.75 14 2.25 12.75" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} fill="currentColor"></polygon><polygon points="2.25 2.75 2.25 5.25 4.75 4 2.25 2.75" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} fill="currentColor"></polygon></svg>
  );
}
