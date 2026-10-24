import { parseMarkdownEntity } from "@pkm/core";
import { MarkdownBodyPreview, prepareMarkdownBodyPreview } from "@pkm/ui";

export const prepareMarkdownPreview = (content: string): string => {
  const parsed = parseMarkdownEntity(content);
  return prepareMarkdownBodyPreview(parsed.ok ? parsed.value.body : content);
};

export interface MarkdownPreviewProps {
  readonly content: string;
  readonly onOpenEntity: (entityId: string) => void;
}

export const MarkdownPreview = ({
  content,
  onOpenEntity,
}: MarkdownPreviewProps): React.JSX.Element => {
  const parsed = parseMarkdownEntity(content);
  return (
    <MarkdownBodyPreview
      body={parsed.ok ? parsed.value.body : content}
      className="markdown-preview"
      onOpenEntity={onOpenEntity}
    />
  );
};
