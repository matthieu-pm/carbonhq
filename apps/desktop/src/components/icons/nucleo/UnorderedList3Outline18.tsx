import type { SVGProps } from "react";

export type UnorderedList3Outline18Props = SVGProps<SVGSVGElement> & {
  strokeWidth?: number | string;
};

/// Nucleo's native 18px canvas keeps the toolbar glyph crisp at its rendered size.
export function UnorderedList3Outline18({
  strokeWidth = 1.5,
  ...props
}: UnorderedList3Outline18Props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={18} height={18} viewBox="0 0 18 18" {...props}><line x1="9.75" y1="5.25" x2="15.75" y2="5.25" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} data-color="color-2"></line><line x1="9.75" y1="12.75" x2="15.75" y2="12.75" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} data-color="color-2"></line><path d="m2.75,3.8974v2.7051c0,.1826.1922.3013.3555.2197l2.7051-1.3526c.181-.0905.181-.3489,0-.4394l-2.7051-1.3526c-.1633-.0817-.3555.0371-.3555.2197Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} fill="currentColor"></path><path d="m2.75,11.3974v2.7051c0,.1826.1922.3013.3555.2197l2.7051-1.3526c.181-.0905.181-.3489,0-.4394l-2.7051-1.3526c-.1633-.0817-.3555.0371-.3555.2197Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} fill="currentColor"></path></svg>
  );
}
