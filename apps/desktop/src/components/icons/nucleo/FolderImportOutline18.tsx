import type { SVGProps } from "react";

export type FolderImportOutline18Props = SVGProps<SVGSVGElement> & {
  strokeWidth?: number | string;
};

export function FolderImportOutline18({
  strokeWidth = 1.5,
  ...props
}: FolderImportOutline18Props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={18} height={18} viewBox="0 0 18 18" {...props}><path d="m2.25,6.75v-2c0-1.1046.8954-2,2-2h1.825c.5871,0,1.1444.258,1.5244.7055l1.5236,1.7945h4.627c1.1046,0,2,.8954,2,2v5.5c0,1.1046-.8954,2-2,2H4.25c-1.1046,0-2-.8954-2-2v-2" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth}></path><path d="m2.25,10.75c0-.5523.4477-1,1-1h5.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} data-color="color-2"></path><polyline points="6.5 7.5 8.75 9.75 6.5 12" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} data-color="color-2"></polyline></svg>
  );
}
