import type { SVGProps } from "react";

export type CirclePlayOutline12Props = SVGProps<SVGSVGElement> & {
  strokeWidth?: number | string;
};

export function CirclePlayOutline12({ strokeWidth = 1.5, ...props }: CirclePlayOutline12Props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={12} height={12} viewBox="0 0 12 12" {...props}><circle cx="6" cy="6" r="5.25" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth}></circle><path d="m7.724,5.482l-2.308-1.385c-.403-.242-.916.048-.916.518v2.771c0,.47.513.76.916.518l2.308-1.385c.391-.235.391-.802,0-1.037Z" fill="currentColor" strokeWidth={0} data-color="color-2"></path></svg>
  );
}
