import type { SVGProps } from "react";

export type DotsOutline12Props = SVGProps<SVGSVGElement> & {
  strokeWidth?: number | string;
};

export function DotsOutline12({
  strokeWidth = 1.5,
  ...props
}: DotsOutline12Props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={12} height={12} viewBox="0 0 12 12" {...props}><circle cx="6" cy="6" r="1" fill="currentColor" strokeWidth={0} data-color="color-2"></circle><circle cx="2" cy="6" r="1" strokeWidth={0} fill="currentColor"></circle><circle cx="10" cy="6" r="1" strokeWidth={0} fill="currentColor"></circle></svg>
  );
}
