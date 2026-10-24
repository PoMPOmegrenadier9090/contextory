import { markdownToPlainText } from "@pkm/core";

interface LabeledEntity {
  readonly id: string;
  readonly type: string;
  readonly displayName: string | null;
  readonly body: string;
  readonly createdAt?: string;
  readonly created_at?: string;
}

const entryTimestamp = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export const entityUiTitle = (entity: LabeledEntity): string =>
  entity.displayName ??
  (entity.type === "entry"
    ? (() => {
        const createdAt = entity.createdAt ?? entity.created_at;
        if (createdAt === undefined) return entity.id;
        const date = new Date(createdAt);
        return Number.isNaN(date.getTime())
          ? entity.id
          : entryTimestamp.format(date);
      })()
    : "無題");

export const entryBodyPreview = (entity: LabeledEntity): string | null => {
  if (entity.type !== "entry" || entity.displayName !== null) return null;
  const plainText = markdownToPlainText(entity.body).replace(/\s+/g, " ");
  return plainText.length > 100
    ? `${plainText.slice(0, 100)}…`
    : plainText || null;
};
