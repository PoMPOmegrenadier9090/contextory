import {
  MAX_ASSET_BYTES,
  type PkmAsset,
  type PkmAssetUpload,
} from "@pkm/contracts";
export type { PkmAsset, PkmAssetUpload } from "@pkm/contracts";
import { prepareImageUpload, type AssetUploadSource } from "./image-upload.js";
import { imageDimensions, readImageSettings } from "./image-settings.js";
export type AssetUploader = (
  file: File,
  source?: AssetUploadSource,
) => Promise<PkmAsset>;

export const MAX_UPLOAD_BYTES = MAX_ASSET_BYTES;

export const fileToAssetUpload = async (
  original: File,
  source: AssetUploadSource = "file",
): Promise<PkmAssetUpload> => {
  const file = await prepareImageUpload(original, source);
  if (file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
    throw new Error("添付ファイルは1バイト以上・10 MiB以下にしてください。");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    chunks.push(
      String.fromCharCode(...bytes.subarray(offset, offset + 32_768)),
    );
  }
  return { fileName: file.name, dataBase64: btoa(chunks.join("")) };
};

export const markdownForAsset = (asset: PkmAsset): string => {
  const label = asset.fileName
    .replaceAll("\\", "\\\\")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]")
    .replaceAll("\n", " ");
  const width = asset.mimeType.startsWith("image/")
    ? readImageSettings().defaultWidth
    : 0;
  const link = `[${label}${width ? `|${width}` : ""}](../${asset.path})`;
  return asset.mimeType.startsWith("image/") ? `!${link}` : link;
};

export const assetPathFromMarkdownUrl = (url: string): string | null => {
  const path = url.replace(/^(?:\.\.\/|\.\/)+/, "");
  return /^assets\/(images|files)\/[0-9a-f-]{36}\.[a-z0-9]{1,10}$/.test(path)
    ? path
    : null;
};

export const assetUrl = (url: string, baseUrl: string): string => {
  const path = assetPathFromMarkdownUrl(url);
  return path === null ? url : `${baseUrl}${path}`;
};

export interface ReferencedAsset {
  readonly path: string;
  readonly label: string;
}

export const referencedAssets = (
  markdown: string,
): readonly ReferencedAsset[] => {
  const assets = new Map<string, ReferencedAsset>();
  for (const match of markdown.matchAll(
    /!?\[((?:\\.|[^\]\\])*)\]\((\.\.\/assets\/[^)]+)\)/g,
  )) {
    const path = assetPathFromMarkdownUrl(match[2] ?? "");
    if (path !== null && !assets.has(path)) {
      assets.set(path, {
        path,
        label: (match[0].startsWith("!")
          ? imageDimensions(match[1] ?? "").alt
          : (match[1] ?? "")
        )
          .replaceAll("\\[", "[")
          .replaceAll("\\]", "]")
          .replaceAll("\\\\", "\\"),
      });
    }
  }
  return [...assets.values()];
};

export const referencedAssetPaths = (markdown: string): readonly string[] =>
  referencedAssets(markdown).map((asset) => asset.path);
