import type { SVGProps } from "react";

export type DoodleOutline18Props = SVGProps<SVGSVGElement> & {
  strokeWidth?: number | string;
};

export function DoodleOutline18({
  strokeWidth = 1.5,
  ...props
}: DoodleOutline18Props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={18} height={18} viewBox="0 0 18 18" {...props}><path d="m4.8404,2.25c-3.2556,2.6989-3.1932,6.5748-1.1928,8.1571,1.7743,1.4036,5.0348.9719,7.008-.3968,1.9472-1.3508,3.2194-3.7759,2.2117-4.9604-.9517-1.1187-3.8673-1.2374-6.5606,1.433-2.2633,2.244-3.0929,6.2074-.8698,8.113,2.1832,1.8713,7.1734,1.6167,10.3131-1.8739" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth}></path></svg>
  );
}
