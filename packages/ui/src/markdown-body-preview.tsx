import { extractDirectReferences } from "@pkm/core";
import { defaultUrlTransform, type Components } from "react-markdown";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import {
  parseMarkdownPreview,
  ENTITY_SCHEME,
} from "./markdown-preview-tree.js";
import { createContext, useContext, useMemo, useState } from "react";

import { assetPathFromMarkdownUrl, assetUrl } from "./asset-links.js";
import { MarkdownPreviewCode } from "./markdown-preview-code.js";
import { imageDimensions } from "./image-settings.js";
import { useReferenceLabels } from "./use-reference-labels.js";
import type { DirectReferenceCompletionOption } from "./reference-completion.js";
import { LinkPreviews } from "./link-preview.js";

const TodoPosition = createContext<number | undefined>(undefined);
const PreviewCheckbox = ({
  checked,
  onToggle,
}: {
  readonly checked: boolean;
  readonly onToggle: MarkdownBodyPreviewProps["onToggleTodo"];
}): React.JSX.Element => {
  const from = useContext(TodoPosition);
  const [pending, setPending] = useState(false);
  return (
    <input
      type="checkbox"
      checked={checked}
      disabled={pending || from === undefined || onToggle === undefined}
      aria-label={
        checked ? "チェックリストを未完了に戻す" : "チェックリストを完了にする"
      }
      onChange={(event) => {
        if (from === undefined || onToggle === undefined) return;
        setPending(true);
        void onToggle(from, event.currentTarget.checked).finally(() =>
          setPending(false),
        );
      }}
    />
  );
};

const EMPTY_REFERENCE_OPTIONS: readonly DirectReferenceCompletionOption[] = [];

const escapeMarkdownLabel = (value: string): string =>
  value.replaceAll("\\", "\\\\").replaceAll("[", "\\[").replaceAll("]", "\\]");

export const prepareMarkdownBodyPreview = (
  body: string,
  labels: ReadonlyMap<string, string> = new Map(),
): string => {
  let transformed = body;
  const references = [...extractDirectReferences(body)].sort(
    (a, b) => b.startOffset - a.startOffset,
  );
  for (const reference of references) {
    const label = escapeMarkdownLabel(
      reference.label ?? labels.get(reference.targetId) ?? "未解決の参照",
    );
    const link = `[${label}](${ENTITY_SCHEME}${reference.targetId})`;
    transformed =
      transformed.slice(0, reference.startOffset) +
      link +
      transformed.slice(reference.endOffset);
  }
  return transformed;
};

export interface MarkdownBodyPreviewProps {
  readonly showLinkPreviews?: boolean;
  readonly body: string;
  readonly onOpenEntity: (entityId: string) => void;
  readonly className?: string;
  readonly referenceOptions?: readonly DirectReferenceCompletionOption[];
  readonly assetBaseUrl?: string | undefined;
  readonly onOpenAsset?:
    ((path: string, fileName?: string) => void) | undefined;
  readonly onToggleTodo?:
    ((from: number, checked: boolean) => Promise<void>) | undefined;
}

export const MarkdownBodyPreview = ({
  body,
  onOpenEntity,
  className,
  assetBaseUrl = "/api/",
  onOpenAsset,
  onToggleTodo,
  showLinkPreviews = false,
  referenceOptions = EMPTY_REFERENCE_OPTIONS,
}: MarkdownBodyPreviewProps): React.JSX.Element => {
  const parsed = useMemo(() => parseMarkdownPreview(body), [body]);
  const labels = useReferenceLabels(parsed.references, referenceOptions);
  const transformUrl = (url: string): string => {
    if (url.startsWith(ENTITY_SCHEME)) return url;
    const resolved = assetUrl(url, assetBaseUrl);
    return resolved !== url ? resolved : defaultUrlTransform(url);
  };
  const components: Components = {
    pre: ({ node, children }) => {
      const code = node?.children[0];
      if (code?.type !== "element" || code.tagName !== "code")
        return <pre>{children}</pre>;
      const language =
        String(code.properties.className ?? "").match(
          /language-([^ ,]+)/,
        )?.[1] ?? "";
      const text = code.children
        .map((child) => (child.type === "text" ? child.value : ""))
        .join("")
        .replace(/\n$/, "");
      return <MarkdownPreviewCode code={text} language={language} />;
    },
    img: ({ alt = "", src, title }) => {
      const dimensions = imageDimensions(alt);
      return (
        <img
          title={title}
          src={typeof src === "string" ? transformUrl(src) : undefined}
          alt={dimensions.alt}
          width={dimensions.width}
          style={{ maxWidth: "100%", height: "auto" }}
        />
      );
    },
    li: ({ node, children, ...props }) => {
      const from = node?.properties.dataTodoFrom;
      return (
        <li {...props}>
          <TodoPosition.Provider
            value={typeof from === "number" ? from : undefined}
          >
            {children}
          </TodoPosition.Provider>
        </li>
      );
    },
    input: ({ type, checked }) =>
      type === "checkbox" ? (
        <PreviewCheckbox checked={checked ?? false} onToggle={onToggleTodo} />
      ) : (
        <input type={type} disabled />
      ),
    a: ({ href: rawHref, children, node }) => {
      const href = rawHref === undefined ? undefined : transformUrl(rawHref);
      if (href?.startsWith(ENTITY_SCHEME)) {
        const entityId = href.slice(ENTITY_SCHEME.length);
        return (
          <button
            className="markdown-entity-link"
            type="button"
            data-open-entity={entityId}
            onClick={() => onOpenEntity(entityId)}
          >
            {node?.properties.dataUnlabelled
              ? (labels.get(entityId) ?? children)
              : children}
          </button>
        );
      }
      const assetPath =
        href?.startsWith(assetBaseUrl) === true
          ? assetPathFromMarkdownUrl(href.slice(assetBaseUrl.length))
          : null;
      if (assetPath !== null && onOpenAsset !== undefined) {
        return (
          <button
            className="markdown-asset-link"
            type="button"
            onClick={() =>
              onOpenAsset(
                assetPath,
                typeof children === "string" ? children : undefined,
              )
            }
          >
            {children}
          </button>
        );
      }
      if (assetPath !== null) {
        return (
          <a
            href={href}
            download={typeof children === "string" ? children : true}
          >
            {children}
          </a>
        );
      }
      return (
        <a href={href} rel="noreferrer" target="_blank">
          {children}
        </a>
      );
    },
  };
  return (
    <>
      <article className={`pkm-markdown-content ${className ?? ""}`.trim()}>
        {toJsxRuntime(parsed.tree, {
          Fragment,
          jsx,
          jsxs,
          components,
          passNode: true,
          passKeys: true,
          ignoreInvalidStyle: true,
        })}
      </article>
      {showLinkPreviews && <LinkPreviews links={parsed.links} />}
    </>
  );
};
