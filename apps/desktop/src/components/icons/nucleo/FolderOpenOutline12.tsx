import type { SVGProps } from "react";

export type FolderOpenOutline12Props = SVGProps<SVGSVGElement> & {
  strokeWidth?: number | string;
};

export function FolderOpenOutline12({
  strokeWidth = 1.5,
  ...props
}: FolderOpenOutline12Props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={12} height={12} viewBox="0 0 12 12" {...props}><path d="m1.75,5.25v-2.5c0-.828.672-1.5,1.5-1.5h.952c.606,0,1.179.275,1.559.748l.603.752h1.886c1.105,0,2,.895,2,2v.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} data-color="color-2"></path><path d="m2.468,5.25h7.063c.909,0,1.609.802,1.486,1.703l-.282,2.068c-.135.991-.982,1.73-1.982,1.73H3.246c-1,0-1.847-.739-1.982-1.73l-.282-2.068c-.123-.901.577-1.703,1.486-1.703Z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth}></path></svg>
  );
}
