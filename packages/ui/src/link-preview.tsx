import { Paper } from "@mantine/core";
import type {
  PkmEntitySummary,
  PkmClient,
  PkmLinkPreview,
} from "@pkm/contracts";
import type { Root, RootContent } from "mdast";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

export const LinkPreviewContext = createContext<
  PkmClient["linkPreview"] | null
>(null);
const parser = unified().use(remarkParse).use(remarkGfm);

export const previewLinks = (
  body: string,
  tree: Root = parser.parse(body),
): string[] => {
  const definitions = new Map<string, string>();
  for (const node of tree.children)
    if (node.type === "definition") definitions.set(node.identifier, node.url);
  const urls = new Set<string>();
  const walk = (node: Root | RootContent) => {
    const value =
      node.type === "link"
        ? node.url
        : node.type === "linkReference"
          ? definitions.get(node.identifier)
          : undefined;
    if (value) {
      try {
        const url = new URL(value);
        if (
          ["http:", "https:"].includes(url.protocol) &&
          !url.username &&
          !url.password
        )
          urls.add(url.href);
      } catch {
        /* Non-URL Markdown links stay ordinary links. */
      }
    }
    if ("children" in node) node.children.forEach(walk);
  };
  walk(tree);
  // shortcut: show up to three distinct links per entry; expand if real notes need more.
  return [...urls].slice(0, 3);
};

export const singlePreviewUrl = (body: string): string | null => {
  const value = body.trim().replace(/^<([^<>]+)>$/, "$1");
  if (!/^https?:\/\/[^\s<>]+$/i.test(value)) return null;
  try {
    const url = new URL(value);
    return url.username || url.password ? null : url.href;
  } catch {
    return null;
  }
};

const LinkPreviewCard = ({ url }: { readonly url: string }) => {
  const load = useContext(LinkPreviewContext);
  const anchor = useRef<HTMLAnchorElement>(null);
  const [preview, setPreview] = useState<PkmLinkPreview | null>(null);
  const [faviconFailed, setFaviconFailed] = useState(false);
  useEffect(() => {
    setPreview(null);
    setFaviconFailed(false);
    if (!load || !anchor.current) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        timer = setTimeout(() => {
          void load(url)
            .then((result) => {
              if (!cancelled) setPreview(result);
            })
            .catch(() => {});
        }, 350);
      },
      { rootMargin: "200px" },
    );
    observer.observe(anchor.current);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [load, url]);
  const domain = new URL(url).hostname;
  const favicon =
    !faviconFailed &&
    /^data:image\/(png|x-icon|jpeg|gif|webp);base64,/.test(
      preview?.faviconDataUrl ?? "",
    )
      ? preview!.faviconDataUrl
      : null;
  return (
    <a
      ref={anchor}
      className="link-preview-card"
      href={url}
      target="_blank"
      rel="noreferrer"
      aria-label={preview?.title ?? url}
    >
      <span className="link-preview-icon" aria-hidden="true">
        {favicon ? (
          <img
            src={favicon}
            alt=""
            decoding="async"
            onError={() => setFaviconFailed(true)}
          />
        ) : (
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path
              d="m10 13 4-4m-6 6-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 2 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"
              transform="translate(1 1)"
            />
          </svg>
        )}
      </span>
      <span className="link-preview-content">
        <span className="link-preview-title">{preview?.title ?? url}</span>
        {preview?.description && (
          <span className="link-preview-description">
            {preview.description}
          </span>
        )}
        <span className="link-preview-site">
          {preview?.siteName ? `${preview.siteName} · ${domain}` : domain}
        </span>
      </span>
      <span className="link-preview-external" aria-hidden="true">
        ↗
      </span>
    </a>
  );
};

export const LinkPreviews = ({
  body = "",
  links: supplied,
}: {
  readonly body?: string;
  readonly links?: readonly string[];
}) => {
  const links = useMemo(() => supplied ?? previewLinks(body), [body, supplied]);
  return links.length ? (
    <div className="link-previews">
      {links.map((url) => (
        <LinkPreviewCard key={url} url={url} />
      ))}
    </div>
  ) : null;
};

export const LinkOnlyEntry = ({
  entry,
  url,
  onOpenEntity,
}: {
  readonly entry: Pick<PkmEntitySummary, "id" | "displayName" | "createdAt">;
  readonly url: string;
  readonly onOpenEntity: (id: string) => void;
}) => (
  <Paper withBorder p={0} className="timeline-entry-card timeline-link-entry">
    <LinkPreviewCard key={url} url={url} />
    <button
      type="button"
      className="timeline-link-entry-open"
      data-open-entity={entry.id}
      aria-label="Entryを開く"
      title={`${entry.displayName ?? "Entry"} · ${new Date(entry.createdAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}`}
      onClick={() => onOpenEntity(entry.id)}
    >
      ⋯
    </button>
  </Paper>
);
