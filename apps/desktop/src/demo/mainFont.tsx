import { useState } from "react";
import ReactDOM from "react-dom/client";

import MainFontRow from "@/components/settings/MainFontRow";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import DemoThemeBar from "@/demo/ThemeBar";
import { applyStoredFont, MAIN_FONT_KEY, refreshFonts, setMainFont, useMainFont } from "@/lib/fonts";
import "../App.css";

const FAMILIES = ["Arial", "Hiragino Sans", "Times New Roman"];

Object.assign(window, {
  __TAURI_INTERNALS__: {
    invoke: async (command: string) => command === "list_font_families" ? FAMILIES : null,
  },
});

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

function check(passed: boolean, message: string) {
  if (!passed) throw new Error(message);
}

/// Drives the real input so composition and empty-result handling cannot pass on a mock handler.
async function runKeyboardChecks() {
  setMainFont("Times New Roman");
  await frame();
  document.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!.click();
  await frame();
  const input = document.querySelector<HTMLInputElement>('[role="combobox"]')!;
  const fill = async (value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await frame();
  };
  const key = async (key: string, options: KeyboardEventInit = {}) => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...options }));
    await frame();
  };
  const unchanged = (message: string) => {
    check(localStorage.getItem(MAIN_FONT_KEY) === JSON.stringify("Times New Roman"), message);
    check(input.isConnected, `${message}: picker closed`);
  };

  await fill("Arial");
  await key("Enter", { isComposing: true });
  unchanged("IME confirmation changed the font");
  await key("Enter", { keyCode: 229 });
  unchanged("WebKit composition confirmation changed the font");
  await fill("no-such-installed-font");
  await key("ArrowDown");
  await key("Enter");
  unchanged("An unmatched search reset the font");
  check(!input.hasAttribute("aria-activedescendant"), "An empty list names an active option");
  await fill("Arial");
  await key("Enter");
  check(localStorage.getItem(MAIN_FONT_KEY) === JSON.stringify("Arial"), "Enter did not select the match");
  check(!input.isConnected, "Selecting a font left the picker open");
}

function Demo() {
  const { selected } = useMainFont();
  const [result, setResult] = useState("Not run");
  const [running, setRunning] = useState(false);

  return (
    <TooltipProvider>
      <DemoThemeBar />
      <main className="mx-auto flex max-w-160 flex-col gap-8 p-8 pb-48">
        <h1 className="text-base font-medium">Main font</h1>
        <MainFontRow />
        <p className="text-chat">Chat text follows the main font. The quick brown fox jumps over the lazy dog.</p>
        <pre className="font-mono text-code">const code = "Geist Mono";</pre>
        <Button
          variant="outline"
          disabled={running}
          onClick={() => {
            const previous = selected;
            setRunning(true);
            void runKeyboardChecks()
              .then(() => setResult("Passed: IME, WebKit composition, unmatched search and Enter selection"))
              .catch((error: Error) => setResult(`Failed: ${error.message}`))
              .finally(() => { setMainFont(previous); setRunning(false); });
          }}
        >
          Run keyboard checks
        </Button>
        <p role="status" className="text-ui">{result}</p>
      </main>
    </TooltipProvider>
  );
}

applyStoredFont();
void refreshFonts().then(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(<Demo />);
});
