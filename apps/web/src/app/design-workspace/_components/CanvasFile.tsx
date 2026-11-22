import { GitBranch } from "lucide-react";
import { RepoTree, cx } from "./kit";
import { Band, Heading, LABEL, LINE, MUTED } from "./shell";

export function CanvasFile() {
  return (
    <Band id="file" className="py-20">
      <div className={`grid border ${LINE} lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]`}>
        <div className={`flex flex-col justify-between gap-10 border-b p-6 lg:border-r lg:border-b-0 ${LINE}`}>
          <div>
            <span className={`${LABEL} ${MUTED}`}>It&apos;s just a file</span>
            <Heading lead="Review a design like code." className="mt-4 lg:ml-0!">
              Branch it, diff it, merge it.
            </Heading>
            <p className={`mt-6 text-[15px] leading-[22px] ${MUTED}`}>
              Carbon writes each canvas to canvases/ in your project as JSON: pages, layers and tokens. Your agent can open it like any other file.
            </p>
          </div>
          <RepoTree className={`-mx-6 border-t py-4 ${LINE}`} />
        </div>
        <div className="min-w-0 overflow-x-auto bg-[#0A0A0A] p-6 light:bg-[#FAFAFA]">
          <div className="mb-4 flex items-center gap-2 font-mono text-[12px] text-white/60 light:text-black/55">
            <GitBranch className="size-3.5" />
            canvases/flows/checkout.canvas.json
          </div>
          <pre className="font-mono text-[12.5px] leading-[21px]">
            <Diff />
          </pre>
        </div>
      </div>
    </Band>
  );
}

const DIFF: [sign: " " | "+" | "-", text: string][] = [
  [" ", "{"],
  [" ", '  "version": 1,'],
  [" ", '  "pages": [{ "id": "mobile", "name": "Mobile", "background": "#1F1F1F" }],'],
  [" ", '  "elements": ['],
  [" ", "    {"],
  [" ", '      "kind": "Rectangle",'],
  [" ", '      "name": "Pay button",'],
  ["-", '      "y": 742,'],
  ["+", '      "y": 692,'],
  [" ", '      "style": {'],
  ["-", '        "borderRadius": "8px"'],
  ["+", '        "borderRadius": "@6c1d2f0a-8e4b-4f61-9a57-2d3c8b1e0f94"'],
  [" ", "      },"],
  [" ", '      "effects": [{ "kind": "Fill", "enabled": true,'],
  [" ", '        "fields": { "type": "Solid", "color": "@a41f9e27-3b5c-4d08-8f6e-71c2d9b40a13" } }]'],
  [" ", "    }"],
  [" ", "  ],"],
  ["+", '  "tokens": [{ "id": "6c1d2f0a-8e4b-4f61-9a57-2d3c8b1e0f94", "kind": "Radius", "name": "md", "value": "12px" }]'],
  [" ", "}"],
];

function Diff() {
  return (
    <>
      {DIFF.map(([sign, text], i) => (
        <div
          key={i}
          className={cx(
            "-mx-6 px-6 whitespace-pre",
            sign === "+" && "bg-[#3FB95026] text-[#7EE2A8] light:bg-[#1A7F3714] light:text-[#1A7F37]",
            sign === "-" && "bg-[#F8514926] text-[#FF9C96] light:bg-[#CF222E12] light:text-[#CF222E]",
            sign === " " && "text-white/70 light:text-[#0A0A0A]/70",
          )}
        >
          <span className="mr-3 inline-block w-3 opacity-60 select-none">{sign}</span>
          {text}
        </div>
      ))}
    </>
  );
}
