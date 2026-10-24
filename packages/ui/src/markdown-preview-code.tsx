import { lazy, Suspense, useState } from "react";

interface CodeProps {
  readonly code: string;
  readonly language: string;
}

const HighlightedCode = lazy(async () => {
  const { highlightCode } = await import("codemirror-live-markdown");
  return {
    default: ({ code, language }: CodeProps) => (
      <span
        dangerouslySetInnerHTML={{
          __html: highlightCode(code, language || "text").html,
        }}
      />
    ),
  };
});

export const MarkdownPreviewCode = ({ code, language }: CodeProps) => {
  const [copyLabel, setCopyLabel] = useState("コピー");
  return (
    <div className="pkm-preview-code">
      <div className="pkm-code-header">
        <select
          className="pkm-code-language"
          aria-label="コードブロックの言語"
          disabled
          value={language}
        >
          <option value={language}>{language || "言語を選択"}</option>
        </select>
        <button
          className="pkm-code-copy"
          type="button"
          aria-label="コードをコピー"
          onClick={() => {
            void navigator.clipboard
              .writeText(code)
              .then(() => setCopyLabel("コピー済み"))
              .catch(() => setCopyLabel("コピー失敗"));
          }}
        >
          {copyLabel}
        </button>
      </div>
      <pre className="pkm-preview-code-body">
        <code>
          <Suspense fallback={code}>
            <HighlightedCode code={code} language={language} />
          </Suspense>
        </code>
      </pre>
    </div>
  );
};
