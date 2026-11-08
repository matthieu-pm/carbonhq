import type { SVGProps } from "react";

export type ShapeTriangleFilledGlyph20Props = SVGProps<SVGSVGElement> & {
  strokeWidth?: number | string;
};

export function ShapeTriangleFilledGlyph20({
  strokeWidth = 2,
  ...props
}: ShapeTriangleFilledGlyph20Props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={20} height={20} viewBox="0 0 20 20" {...props}><path d="m8.2646,4.2796L3.2659,13.0059c-.7638,1.3333.1989,2.9941,1.7354,2.9941h9.9973c1.5366,0,2.4992-1.6608,1.7354-2.9941l-4.9986-8.7263c-.7683-1.3412-2.7026-1.3412-3.4709,0Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} fill="currentColor"></path></svg>
  );
}
