import type { SVGProps } from "react";

export type CaretMaximizeDiagonalOutline12Props = SVGProps<SVGSVGElement> & {
  strokeWidth?: number | string;
};

export function CaretMaximizeDiagonalOutline12({
  strokeWidth = 1.5,
  ...props
}: CaretMaximizeDiagonalOutline12Props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={12} height={12} viewBox="0 0 12 12" {...props}><path d="m5.854,1.75h4.146c.138,0,.25.112.25.25v4.146c0,.223-.269.334-.427.177L5.677,2.177c-.157-.157-.046-.427.177-.427Z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} data-color="color-2"></path><path d="m1.75,5.854v4.146c0,.138.112.25.25.25h4.146c.223,0,.334-.269.177-.427L2.177,5.677c-.157-.157-.427-.046-.427.177Z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth}></path></svg>
  );
}
