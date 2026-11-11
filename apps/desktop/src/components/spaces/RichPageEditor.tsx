import { forwardRef, memo, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Paragraph from "@tiptap/extension-paragraph";
import { flattenExtensions } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Markdown } from "@tiptap/markdown";
import { TableKit, TableCell, TableHeader } from "@tiptap/extension-table";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Image from "@tiptap/extension-image";
import { Mathematics } from "@tiptap/extension-mathematics";
import { Bold, CheckSquare, Code, Columns3, Heading1, Heading2, Heading3, ImagePlus, Italic, Link2, List, ListOrdered, Minus, Paperclip, SquareCode, Quote, Redo2, Rows3, Sigma, Strikethrough, Table2, Trash2, Type, Undo2, Workflow, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { parsePageUrl, type PageTarget } from "@/lib/pages";
import { openLink } from "@/lib/openLink";
import { PAGE_TABLE_CELL_CONTENT, pageTablePasteReason, parsePageParagraph, richMarkdownReason } from "@/lib/pageMarkdown";
import "katex/dist/katex.min.css";
import "./rich-editor.css";

export type PageEditorHandle = {
  getMarkdown(): string;
  insertMarkdown(text: string): void;
  focus(): void;
};

type Props = {
  markdown: string;
  onChange: (markdown: string) => void;
  onEdit: () => void;
  onOpenPage?: (target: PageTarget) => void;
  onAttach?: () => void;
  showToolbar?: boolean;
  resolveImage?: (src: string) => string | undefined | Promise<string | undefined>;
};
type InputKind = "link" | "image" | "inlineMath" | "blockMath";
type InputState = { kind: InputKind; value: string; from: number; to: number; position?: number };
type SlashItem = { label: string; hint: string; Icon: LucideIcon; group: string; shortcut?: string; run: (editor: Editor) => void };
type SlashState = { from: number; to: number; query: string; index: number; left: number; top: number; above: boolean; maxHeight: number };
type Floating = { left: number; top: number };

function Tool({ label, Icon, active, disabled, onClick }: {
  label: string; Icon: LucideIcon; active?: boolean; disabled?: boolean; onClick: () => void;
}) {
  return <Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon-sm" aria-label={label} aria-pressed={active === undefined ? undefined : active} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={onClick}><Icon /></Button></TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>;
}

function FormatTools({ editor }: { editor: Editor }) {
  const state = useEditorState({ editor, selector: ({ editor: current }) => ({
    bold: current.isActive("bold"), italic: current.isActive("italic"), strike: current.isActive("strike"), code: current.isActive("code"),
  }) });
  return <><Tool label="Bold" Icon={Bold} active={state.bold} onClick={() => editor.chain().focus().toggleBold().run()} /><Tool label="Italic" Icon={Italic} active={state.italic} onClick={() => editor.chain().focus().toggleItalic().run()} /><Tool label="Strikethrough" Icon={Strikethrough} active={state.strike} onClick={() => editor.chain().focus().toggleStrike().run()} /><Tool label="Inline code" Icon={Code} active={state.code} onClick={() => editor.chain().focus().toggleCode().run()} /></>;
}

/// Toolbar subscriptions stay here so typing cannot redraw the Spaces list or Page shell.
function Toolbar({ editor, input, attach, expanded }: { editor: Editor; input: (kind: InputKind) => void; attach?: () => void; expanded: boolean }) {
  const state = useEditorState({ editor, selector: ({ editor: current }) => ({
    heading: current.getAttributes("heading").level as number | undefined,
    bullets: current.isActive("bulletList"), ordered: current.isActive("orderedList"), tasks: current.isActive("taskList"), quote: current.isActive("blockquote"), table: current.isActive("table"), codeBlock: current.isActive("codeBlock"), language: (current.getAttributes("codeBlock").language ?? "") as string,
    undo: current.can().undo(), redo: current.can().redo(),
  }) });
  if (!expanded && !state.table && !state.codeBlock) return null;
  return <div className="spaces-rich-toolbar" data-contextual={!expanded} role="toolbar" aria-label="Page formatting">
    {expanded && <>
    <label className="spaces-rich-block-select"><span className="sr-only">Text style</span><select aria-label="Text style" disabled={state.table} value={state.heading ?? "paragraph"} onChange={(event) => {
      const value = event.target.value;
      if (value === "paragraph") editor.chain().focus().setParagraph().run();
      else editor.chain().focus().toggleHeading({ level: Number(value) as 1 | 2 | 3 | 4 | 5 | 6 }).run();
    }}><option value="paragraph">Text</option>{[1, 2, 3, 4, 5, 6].map((level) => <option key={level} value={level}>Heading {level}</option>)}</select></label>
    <span className="spaces-rich-divider" />
    <FormatTools editor={editor} />
    <Tool label="Link" Icon={Link2} onClick={() => input("link")} />
    <span className="spaces-rich-divider" />
    <Tool label="Bullet list" disabled={state.table} Icon={List} active={state.bullets} onClick={() => editor.chain().focus().toggleBulletList().run()} />
    <Tool label="Numbered list" disabled={state.table} Icon={ListOrdered} active={state.ordered} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
    <Tool label="Checklist" disabled={state.table} Icon={CheckSquare} active={state.tasks} onClick={() => editor.chain().focus().toggleTaskList().run()} />
    <Tool label="Quote" disabled={state.table} Icon={Quote} active={state.quote} onClick={() => editor.chain().focus().toggleBlockquote().run()} />
    <Tool label="Code block" disabled={state.table} Icon={SquareCode} active={state.codeBlock} onClick={() => editor.chain().focus().toggleCodeBlock().run()} />
    <Tool label="Insert table" disabled={state.table} Icon={Table2} onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} />
    <Tool label="Image" disabled={state.table} Icon={ImagePlus} onClick={() => input("image")} />
    <Tool label="Math formula" Icon={Sigma} onClick={() => input("inlineMath")} />
    {attach && <Tool label="Attach file" disabled={state.table} Icon={Paperclip} onClick={attach} />}
    <span className="spaces-rich-divider" />
    <Tool label="Undo" Icon={Undo2} disabled={!state.undo} onClick={() => editor.chain().focus().undo().run()} />
    <Tool label="Redo" Icon={Redo2} disabled={!state.redo} onClick={() => editor.chain().focus().redo().run()} />
    </>}
    {state.codeBlock && <label className="spaces-rich-code-language">Language<input aria-label="Code language" placeholder="plain text" value={state.language} onChange={(event) => editor.commands.updateAttributes("codeBlock", { language: event.target.value.replace(/\s/g, "") || null })} /></label>}
    {state.table && <div className="spaces-rich-table-tools" role="group" aria-label="Table actions">
      <TableAction onClick={() => editor.chain().focus().addRowBefore().run()}>Row above</TableAction>
      <Tool label="Add row below" Icon={Rows3} onClick={() => editor.chain().focus().addRowAfter().run()} />
      <TableAction onClick={() => editor.chain().focus().addColumnBefore().run()}>Column before</TableAction>
      <Tool label="Add column after" Icon={Columns3} onClick={() => editor.chain().focus().addColumnAfter().run()} />
      <TableAction onClick={() => editor.chain().focus().deleteRow().run()}>Remove row</TableAction>
      <TableAction onClick={() => editor.chain().focus().deleteColumn().run()}>Remove column</TableAction>
      <Tool label="Remove table" Icon={Trash2} onClick={() => editor.chain().focus().deleteTable().run()} />
    </div>}
  </div>;
}

function TableAction({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <Button type="button" variant="ghost" size="xs" onMouseDown={(event) => event.preventDefault()} onClick={onClick}>{children}</Button>;
}

const INPUT_LABELS: Record<InputKind, string> = { link: "Edit link", image: "Insert image", inlineMath: "Inline formula", blockMath: "Block formula" };

/// A mounted editor owns its draft; echoed Markdown props never reset the caret or undo history.
const RichPageEditor = memo(forwardRef<PageEditorHandle, Props>(function RichPageEditor(props, ref) {
  const callbacks = useRef(props);
  callbacks.current = props;
  const initial = useRef(props.markdown);
  const started = useRef(performance.now());
  const root = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const imageViews = useRef(new Set<() => void>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const version = useRef(0);
  const serialized = useRef({ version: 0, markdown: initial.current });
  const [input, setInput] = useState<InputState | null>(null);
  const [pasteMessage, setPasteMessage] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [floating, setFloating] = useState<Floating | null>(null);
  const [viewReady, setViewReady] = useState(false);
  const slashRef = useRef(slash);
  slashRef.current = slash;
  const dismissedSlash = useRef<string | null>(null);
  const runSlashRef = useRef<(index: number) => boolean>(() => false);
  const listId = useId();

  const openInput = useCallback((kind: InputKind, value?: string, position?: number) => {
    const current = editorRef.current;
    if (!current || (current.isActive("table") && (kind === "image" || kind === "blockMath"))) return;
    setFloating(null);
    setInputError(null);
    setInput({ kind, value: value ?? (kind === "link" ? current.getAttributes("link").href ?? "" : ""), from: current.state.selection.from, to: current.state.selection.to, position });
  }, []);

  const extensions = useMemo(() => [
    StarterKit.configure({ paragraph: false, underline: false, link: { openOnClick: false, protocols: ["carbon-page", "carbon-asset"] } }),
    Paragraph.extend({ parseMarkdown: parsePageParagraph }),
    Markdown.configure({ markedOptions: { gfm: true } }),
    TableKit.configure({ table: { resizable: false }, tableCell: false, tableHeader: false }),
    TableCell.extend({ content: PAGE_TABLE_CELL_CONTENT }),
    TableHeader.extend({ content: PAGE_TABLE_CELL_CONTENT }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Image.extend({
      addNodeView() {
        return ({ node }) => {
          const dom = document.createElement("span");
          dom.className = "spaces-rich-image";
          dom.contentEditable = "false";
          const image = document.createElement("img");
          image.draggable = false;
          image.loading = "lazy";
          image.decoding = "async";
          const fallback = document.createElement("span");
          fallback.className = "spaces-rich-image-fallback";
          fallback.hidden = true;
          dom.append(image, fallback);
          let current = node;
          let generation = 0;
          let previousSource = "";
          const refresh = () => {
            const turn = ++generation;
            const source = String(current.attrs.src ?? "");
            image.alt = String(current.attrs.alt ?? "");
            image.title = String(current.attrs.title ?? "");
            if (source !== previousSource) { image.removeAttribute("src"); image.hidden = true; previousSource = source; }
            const show = (resolved: string | undefined) => {
              if (turn !== generation) return;
              dom.removeAttribute("aria-busy");
              fallback.hidden = !!resolved;
              image.hidden = !resolved;
              fallback.textContent = current.attrs.alt || "Image unavailable";
              if (resolved && image.getAttribute("src") !== resolved) image.src = resolved;
            };
            dom.setAttribute("aria-busy", "true");
            try {
              const resolved = callbacks.current.resolveImage ? callbacks.current.resolveImage(source) : /^https?:\/\//i.test(source) ? source : undefined;
              if (typeof resolved === "string" || resolved === undefined) show(resolved);
              else void resolved.then(show).catch(() => show(undefined));
            } catch { show(undefined); }
          };
          image.onload = () => { image.hidden = false; fallback.hidden = true; };
          image.onerror = () => { image.hidden = true; fallback.hidden = false; fallback.textContent = current.attrs.alt || "Image unavailable"; };
          imageViews.current.add(refresh);
          refresh();
          return {
            dom,
            update(next: ProseMirrorNode) { if (next.type !== current.type) return false; current = next; refresh(); return true; },
            ignoreMutation: () => true,
            destroy() { generation += 1; imageViews.current.delete(refresh); },
          };
        };
      },
    }).configure({ allowBase64: false, inline: true }),
    Mathematics.configure({
      katexOptions: { throwOnError: false, trust: false },
      inlineOptions: { onClick: (node, position) => openInput("inlineMath", node.attrs.latex, position) },
      blockOptions: { onClick: (node, position) => openInput("blockMath", node.attrs.latex, position) },
    }),
  ], [openInput]);

  const getMarkdown = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (editorRef.current && serialized.current.version !== version.current) serialized.current = { version: version.current, markdown: editorRef.current.getMarkdown() };
    return serialized.current.markdown;
  }, []);

  const updateMenus = useCallback((current: Editor) => {
    const host = root.current;
    if (!host) return;
    const { selection } = current.state;
    const { $from } = selection;
    const before = $from.parent.textBetween(0, $from.parentOffset, "\n", "\ufffc");
    const match = $from.parent.type.name === "paragraph" && selection.empty && !current.isActive("table") ? /^\/([\w ]{0,30})$/.exec(before) : null;
    if (!match) dismissedSlash.current = null;
    if (match && before !== dismissedSlash.current) {
      try {
        const at = current.view.coordsAtPos(selection.from);
        const box = host.getBoundingClientRect();
        const viewport = host.closest(".spaces-document-scroll")?.getBoundingClientRect();
        const bottom = Math.min(window.innerHeight, viewport?.bottom ?? window.innerHeight) - 12;
        const top = Math.max(0, viewport?.top ?? 0) + 12;
        if (at.bottom < top || at.top > bottom) setSlash(null);
        else {
          const below = bottom - at.bottom - 6;
          const above = at.top - top - 6;
          const upwards = below < 240 && above > below;
          const maxHeight = Math.max(48, Math.min(440, upwards ? above : below));
          setSlash((previous) => ({ from: $from.start(), to: selection.from, query: match[1], index: previous?.query === match[1] ? previous.index : 0, left: Math.max(0, Math.min(at.left - box.left, box.width - 272)), top: (upwards ? at.top - 6 : at.bottom + 6) - box.top, above: upwards, maxHeight }));
        }
      } catch { setSlash(null); }
    } else setSlash(null);
    if (!selection.empty && current.isFocused && !current.isActive("codeBlock") && !input) {
      try {
        const at = current.view.coordsAtPos(selection.from);
        const box = host.getBoundingClientRect();
        setFloating({ left: Math.max(0, Math.min(at.left - box.left, box.width - 160)), top: Math.max(0, at.top - box.top - 40) });
      } catch { setFloating(null); }
    } else setFloating(null);
  }, [input]);
  const menuUpdater = useRef(updateMenus);
  menuUpdater.current = updateMenus;

  const editor = useEditor({
    extensions,
    // Lazy mounts can suspend before commit; editor callbacks must start after React mounts.
    immediatelyRender: false,
    content: initial.current,
    contentType: "markdown",
    shouldRerenderOnTransaction: false,
    enableInputRules: flattenExtensions(extensions).filter((extension) => extension.name !== "blockMath"),
    editorProps: {
      attributes: { class: "spaces-rich-content", "aria-label": "Page content", "aria-multiline": "true", role: "textbox", spellcheck: "true" },
      handleKeyDown: (_view, event) => {
        const active = slashRef.current;
        if (!active) return false;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          setSlash((previous) => previous ? { ...previous, index: previous.index + (event.key === "ArrowDown" ? 1 : -1) } : null);
          return true;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          if (runSlashRef.current(active.index)) { event.preventDefault(); return true; }
          setSlash(null);
          return false;
        }
        if (event.key === "Escape") { event.preventDefault(); dismissedSlash.current = `/${active.query}`; setSlash(null); return true; }
        return false;
      },
      handlePaste: (_view, event) => {
        const text = event.clipboardData?.getData("text/plain") ?? "";
        const html = event.clipboardData?.getData("text/html") ?? "";
        const reason = (editorRef.current?.isActive("table") ? pageTablePasteReason(text, html) : null) ?? richMarkdownReason(text);
        if (reason) {
          event.preventDefault();
          setPasteMessage(`${reason} Switch to source mode to paste this content without changes.`);
          return true;
        }
        if (!event.clipboardData?.getData("text/html") && /(?:^|\n)(?:#{1,6} |[-*+] |\d+\. |>|`{3,}|~{3,}|\|)|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)/.test(text)) {
          event.preventDefault();
          editorRef.current?.chain().focus().insertContent(text, { contentType: "markdown" }).run();
          return true;
        }
        return false;
      },
      handleClick: (_view, _position, event) => {
        const anchor = event.target instanceof Element ? event.target.closest("a") : null;
        const target = anchor && parsePageUrl(anchor.getAttribute("href") ?? "");
        if (!target) {
          if (anchor && (event.metaKey || event.ctrlKey)) { event.preventDefault(); openLink(anchor.href, event); return true; }
          return false;
        }
        event.preventDefault();
        callbacks.current.onOpenPage?.(target);
        return true;
      },
    },
    onCreate: ({ editor: current }) => {
      setViewReady(true);
      if (root.current) { root.current.dataset.ready = "true"; root.current.dataset.initMs = String(Math.round(performance.now() - started.current)); }
      menuUpdater.current(current);
    },
    onUpdate: ({ editor: current }) => {
      setPasteMessage(null);
      version.current += 1;
      callbacks.current.onEdit();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => callbacks.current.onChange(getMarkdown()), 300);
      menuUpdater.current(current);
    },
    onSelectionUpdate: ({ editor: current }) => menuUpdater.current(current),
    onBlur: () => { setFloating(null); setSlash(null); },
  });
  editorRef.current = editor;
  useEffect(() => {
    const scroll = root.current?.closest(".spaces-document-scroll");
    const reposition = () => { if (editor && (editor.isFocused || slashRef.current || !editor.state.selection.empty)) menuUpdater.current(editor); };
    scroll?.addEventListener("scroll", reposition, { passive: true });
    window.addEventListener("resize", reposition);
    return () => { scroll?.removeEventListener("scroll", reposition); window.removeEventListener("resize", reposition); };
  }, [editor]);

  useImperativeHandle(ref, () => ({
    getMarkdown,
    insertMarkdown: (text) => {
      const reason = (editorRef.current?.isActive("table") ? pageTablePasteReason(text) : null) ?? richMarkdownReason(text);
      if (reason) throw new Error(reason);
      editorRef.current?.chain().focus().insertContent(text, { contentType: "markdown" }).run();
    },
    focus: () => { editorRef.current?.commands.focus(); },
  }), [getMarkdown]);
  useLayoutEffect(() => () => {
    // Feature gating can unmount without navigation; retain the final unsent edit before teardown.
    if (timer.current) callbacks.current.onChange(getMarkdown());
  }, [getMarkdown]);
  useEffect(() => { for (const refresh of imageViews.current) refresh(); }, [props.resolveImage]);
  useEffect(() => {
    if (!editor || !viewReady || !editor.isInitialized || editor.isDestroyed) return;
    if (slash) { editor.view.dom.setAttribute("aria-controls", listId); editor.view.dom.setAttribute("aria-expanded", "true");
      const selected = root.current?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]');
      if (selected) {
        editor.view.dom.setAttribute("aria-activedescendant", selected.id);
        const list = selected.parentElement;
        if (list && selected.offsetTop + selected.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = selected.offsetTop + selected.offsetHeight - list.clientHeight;
        else if (list && selected.offsetTop < list.scrollTop) list.scrollTop = selected.offsetTop;
      }
    }
    else { editor.view.dom.removeAttribute("aria-controls"); editor.view.dom.removeAttribute("aria-expanded"); editor.view.dom.removeAttribute("aria-activedescendant"); }
  }, [editor, slash, listId, viewReady]);

  const modifier = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl ";
  const commands: SlashItem[] = useMemo(() => [
    ...([1, 2, 3] as const).map((level) => ({ label: `Heading ${level}`, hint: "Section title", Icon: [Heading1, Heading2, Heading3][level - 1], group: "headings", shortcut: `${modifier}⌥${level}`, run: (current: Editor) => { current.chain().focus().setHeading({ level }).run(); } })),
    { label: "Bulleted list", hint: "Bullet list", Icon: List, group: "lists", shortcut: `${modifier}⇧8`, run: (current) => { current.chain().focus().toggleBulletList().run(); } },
    { label: "Numbered list", hint: "Ordered list", Icon: ListOrdered, group: "lists", shortcut: `${modifier}⇧7`, run: (current) => { current.chain().focus().toggleOrderedList().run(); } },
    { label: "Checklist", hint: "Tasks and todos", Icon: CheckSquare, group: "lists", shortcut: `${modifier}⇧9`, run: (current) => { current.chain().focus().toggleTaskList().run(); } },
    { label: "Insert image…", hint: "Image URL media", Icon: ImagePlus, group: "media", run: () => openInput("image") },
    ...(props.onAttach ? [{ label: "Attach files…", hint: "Upload image or file", Icon: Paperclip, group: "media", run: () => callbacks.current.onAttach?.() }] : []),
    { label: "Code block", hint: "Fenced code source", Icon: SquareCode, group: "blocks", shortcut: `${modifier}⌥C`, run: (current) => { current.chain().focus().toggleCodeBlock().run(); } },
    { label: "Diagram", hint: "Mermaid diagram source", Icon: Workflow, group: "blocks", run: (current) => { current.chain().focus().setCodeBlock({ language: "mermaid" }).run(); } },
    { label: "LaTeX math block", hint: "Equation block formula", Icon: Sigma, group: "blocks", run: () => openInput("blockMath") },
    { label: "Table", hint: "Rows and columns", Icon: Table2, group: "blocks", run: (current) => { current.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); } },
    { label: "Blockquote", hint: "Quote a passage", Icon: Quote, group: "blocks", run: (current) => { current.chain().focus().toggleBlockquote().run(); } },
    { label: "Divider", hint: "Horizontal rule", Icon: Minus, group: "blocks", run: (current) => { current.chain().focus().setHorizontalRule().run(); } },
    { label: "Text", hint: "Plain paragraph", Icon: Type, group: "other", shortcut: `${modifier}⌥0`, run: (current) => { current.chain().focus().setParagraph().run(); } },
    { label: "Inline math", hint: "Inline formula", Icon: Sigma, group: "other", run: () => openInput("inlineMath") },
  ], [openInput, props.onAttach, modifier]);
  const filtered = commands.filter((command) => `${command.label} ${command.hint}`.toLowerCase().includes(slash?.query.toLowerCase() ?? ""));
  const activeIndex = filtered.length ? ((slash?.index ?? 0) % filtered.length + filtered.length) % filtered.length : 0;
  const runSlash = (index: number) => {
    const active = slashRef.current;
    const command = filtered[((index % filtered.length) + filtered.length) % filtered.length];
    if (!editor || !active || !command) return false;
    setSlash(null);
    editor.chain().focus().deleteRange({ from: active.from, to: active.to }).run();
    command.run(editor);
    return true;
  };
  runSlashRef.current = runSlash;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!editor || !input) return;
    const value = input.value.trim();
    if ((input.kind === "image" || input.kind === "link") && value && !/^(?:(?:https?|mailto|tel|carbon-page|carbon-asset):|[^\s:]+(?:\/|$)|[/.#])/i.test(value)) { setInputError("Enter a web address, a Page link, or a relative path."); return; }
    if (!value && input.kind !== "link") { setInputError("Enter a value first."); return; }
    const chain = editor.chain().focus().setTextSelection({ from: input.from, to: input.to });
    if (input.kind === "link") {
      if (!value) chain.extendMarkRange("link").unsetLink().run();
      else chain.extendMarkRange("link").setLink({ href: value }).run();
    } else if (input.kind === "image") chain.setImage({ src: value }).run();
    else if (input.kind === "inlineMath") {
      if (input.position !== undefined) chain.updateInlineMath({ latex: value, pos: input.position }).run();
      else chain.insertInlineMath({ latex: value }).run();
    } else if (input.position !== undefined) chain.updateBlockMath({ latex: value, pos: input.position }).run();
    else chain.insertBlockMath({ latex: value }).run();
    setInput(null);
  };

  return <div className="spaces-rich-editor" ref={root} data-ready="false">
    {editor && <div className={props.showToolbar ? undefined : "spaces-rich-toolbar-anchor"}><Toolbar editor={editor} input={openInput} attach={props.onAttach} expanded={props.showToolbar ?? false} /></div>}
    {pasteMessage && <p className="spaces-rich-paste-message" role="status">{pasteMessage}</p>}
    <EditorContent editor={editor} />
    {editor && floating && !input && <div className="spaces-rich-floating" role="toolbar" aria-label="Selected text formatting" style={{ left: floating.left, top: floating.top }}><FormatTools editor={editor} /><Tool label="Link selected text" Icon={Link2} onClick={() => openInput("link")} /></div>}
    {slash && <div className="spaces-rich-slash" id={listId} role="listbox" aria-label="Insert block" style={{ left: slash.left, top: slash.top, maxHeight: slash.maxHeight, transform: slash.above ? "translateY(-100%)" : undefined }}>
      {filtered.length ? filtered.map((command, index) => <button type="button" key={command.label} id={`${listId}-${index}`} role="option" aria-selected={index === activeIndex} className={!slash.query && index > 0 && command.group !== filtered[index - 1].group ? "spaces-rich-slash-group" : undefined} onMouseDown={(event) => event.preventDefault()} onMouseMove={() => setSlash((previous) => previous?.index === index ? previous : previous ? { ...previous, index } : null)} onClick={() => runSlash(index)}><command.Icon aria-hidden="true" /><span>{command.label}</span>{command.shortcut && <kbd>{command.shortcut}</kbd>}</button>) : <p>No matching blocks</p>}
    </div>}
    <Dialog open={input !== null} onOpenChange={(open) => { if (!open) { setInput(null); editor?.commands.focus(); } }}>
      <DialogContent onCloseAutoFocus={(event) => { event.preventDefault(); editor?.commands.focus(); }}><div className="spaces-rich-editor"><DialogHeader><DialogTitle>{input ? INPUT_LABELS[input.kind] : "Insert"}</DialogTitle><DialogDescription>{input?.kind === "link" ? "Enter a URL. Leave it empty to remove the link." : input?.kind === "image" ? "Use an image URL, or attach an image from the Page toolbar." : "Write the formula in LaTeX."}</DialogDescription></DialogHeader>
        <form onSubmit={submit} className="spaces-rich-input-form"><label><span className="sr-only">{input ? INPUT_LABELS[input.kind] : "Value"}</span><input autoFocus value={input?.value ?? ""} onChange={(event) => { setInput((previous) => previous ? { ...previous, value: event.target.value } : null); setInputError(null); }} placeholder={input?.kind === "link" || input?.kind === "image" ? "https://…" : "E = mc^2"} /></label>{inputError && <p role="alert">{inputError}</p>}<Button type="submit">{input?.kind === "link" ? "Apply" : "Insert"}</Button></form></div>
      </DialogContent>
    </Dialog>
  </div>;
}));

export default RichPageEditor;
