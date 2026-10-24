import type { Status, Priority } from "@pkm/contracts";

export const STATUS_OPTIONS = [
  { value: "not_started", label: "未着手" },
  { value: "in_progress", label: "進行中" },
  { value: "on_hold", label: "保留" },
  { value: "done", label: "完了" },
] as const satisfies readonly {
  readonly value: Status;
  readonly label: string;
}[];

export const PRIORITY_OPTIONS = [
  { value: "lowest", label: "最低" },
  { value: "low", label: "低" },
  { value: "normal", label: "通常" },
  { value: "high", label: "高" },
  { value: "highest", label: "最高" },
] as const satisfies readonly {
  readonly value: Priority;
  readonly label: string;
}[];

export const RESOURCE_TYPE_OPTIONS = [
  { value: "book", label: "書籍" },
  { value: "paper", label: "論文" },
  { value: "web_article", label: "Web記事" },
  { value: "other", label: "その他" },
] as const;
