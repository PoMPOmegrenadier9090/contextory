import { assetPathFromMarkdownUrl } from "@pkm/ui";

export const downloadAsset = (path: string, fileName?: string): void => {
  const assetPath = assetPathFromMarkdownUrl(path);
  if (assetPath === null) throw new TypeError("Invalid asset path");
  const query = new URLSearchParams({ download: "1" });
  if (fileName) query.set("fileName", fileName);
  const link = document.createElement("a");
  link.href = `/api/${assetPath}?${query}`;
  link.download = fileName || assetPath.split("/").at(-1)!;
  document.body.append(link);
  link.click();
  link.remove();
};
