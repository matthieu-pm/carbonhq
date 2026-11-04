import type { SVGProps } from "react";

export type PenOutline12Props = SVGProps<SVGSVGElement> & {
  strokeWidth?: number | string;
};

export function PenOutline12({
  strokeWidth = 1.5,
  ...props
}: PenOutline12Props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={12} height={12} viewBox="0 0 12 12" {...props}><path d="M10.161 1.83896C10.92 2.59796 10.92 3.82996 10.161 4.58896L5.38 9.36997C5.131 9.61897 4.821 9.79798 4.481 9.88798L1.25 10.75L2.112 7.51896C2.203 7.17896 2.381 6.86897 2.63 6.61997L7.411 1.83896C8.17 1.07996 9.402 1.07996 10.161 1.83896Z" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" fill="none"></path></svg>
  );
}
