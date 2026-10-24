import { lazy, Suspense } from "react";
import type { MarkdownLiveEditorProps } from "./markdown-live-editor.js";

const Editor = lazy(() =>
  import("./markdown-live-editor.js").then((module) => ({
    default: module.MarkdownLiveEditor,
  })),
);

export const MarkdownLiveEditor = (
  props: MarkdownLiveEditorProps,
): React.JSX.Element => (
  <Suspense fallback={<div role="status">エディタを読み込み中…</div>}>
    <Editor {...props} />
  </Suspense>
);
