import type {
  PkmAssetUpload as CreateVaultAssetRequest,
  PkmAsset as VaultAssetInfo,
} from "@pkm/contracts";
export type {
  PkmAssetUpload as CreateVaultAssetRequest,
  PkmAsset as VaultAssetInfo,
} from "@pkm/contracts";
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, stat } from "node:fs/promises";
import { basename, dirname } from "node:path";

import { assertVaultWritePathSafe, resolveVaultPath } from "./vault-file.js";

import { MAX_ASSET_BYTES } from "@pkm/contracts";
export { MAX_ASSET_BYTES } from "@pkm/contracts";

export interface VaultAssetContent {
  readonly mimeType: string;
  readonly data: Buffer;
}

const IMAGE_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

const imageMatches = (extension: string, data: Buffer): boolean => {
  switch (extension) {
    case "png":
      return data.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
    case "jpg":
    case "jpeg":
      return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
    case "gif":
      return (
        data.subarray(0, 6).toString("ascii") === "GIF87a" ||
        data.subarray(0, 6).toString("ascii") === "GIF89a"
      );
    case "webp":
      return (
        data.subarray(0, 4).toString("ascii") === "RIFF" &&
        data.subarray(8, 12).toString("ascii") === "WEBP"
      );
    default:
      return false;
  }
};

const ASSET_PATH = /^assets\/(images|files)\/[0-9a-f-]{36}\.[a-z0-9]{1,10}$/;

export const requireAssetPath = (path: string): string => {
  if (!ASSET_PATH.test(path)) throw new TypeError("Invalid asset path");
  return path;
};

const assetMimeType = (path: string): string => {
  const extension = path.split(".").at(-1) ?? "";
  return path.startsWith("assets/images/")
    ? (IMAGE_TYPES[extension] ?? "application/octet-stream")
    : "application/octet-stream";
};

export const prepareVaultAsset = (
  request: CreateVaultAssetRequest,
  assetId: string = randomUUID(),
): { asset: VaultAssetInfo; data: Buffer } => {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      assetId,
    )
  )
    throw new TypeError("Invalid asset ID");
  const fileName = basename(request.fileName.replaceAll("\\", "/"))
    .split("")
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("")
    .trim();
  if (fileName.length === 0 || fileName.length > 255)
    throw new TypeError("Invalid asset file name");
  if (
    request.dataBase64.length === 0 ||
    request.dataBase64.length > Math.ceil(MAX_ASSET_BYTES / 3) * 4 ||
    request.dataBase64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(request.dataBase64)
  ) {
    throw new TypeError("Invalid or oversized asset data");
  }
  const data = Buffer.from(request.dataBase64, "base64");
  if (data.length === 0 || data.length > MAX_ASSET_BYTES)
    throw new TypeError("Asset must be between 1 byte and 10 MiB");
  const extension = /^[a-z0-9]{1,10}$/i.test(fileName.split(".").at(-1) ?? "")
    ? (fileName.split(".").at(-1) ?? "bin").toLowerCase()
    : "bin";
  const image =
    IMAGE_TYPES[extension] !== undefined && imageMatches(extension, data);
  const path = `assets/${image ? "images" : "files"}/${assetId}.${extension}`;
  return {
    asset: { path, fileName, mimeType: assetMimeType(path), size: data.length },
    data,
  };
};

export const createVaultAsset = async (
  vaultRoot: string,
  request: CreateVaultAssetRequest,
  assetId?: string,
): Promise<VaultAssetInfo> => {
  const { asset, data } = prepareVaultAsset(request, assetId);
  const { path } = asset;
  const absolutePath = resolveVaultPath(vaultRoot, path);
  await assertVaultWritePathSafe(vaultRoot, path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await assertVaultWritePathSafe(vaultRoot, path);
  const file = await open(absolutePath, "wx", 0o600);
  try {
    await file.writeFile(data);
  } finally {
    await file.close();
  }
  return asset;
};

export const readVaultAsset = async (
  vaultRoot: string,
  assetPath: string,
): Promise<VaultAssetContent> => {
  const path = requireAssetPath(assetPath);
  await assertVaultWritePathSafe(vaultRoot, path);
  const absolutePath = resolveVaultPath(vaultRoot, path);
  const metadata = await stat(absolutePath);
  if (!metadata.isFile() || metadata.size > MAX_ASSET_BYTES)
    throw new TypeError("Invalid or oversized asset");
  return { mimeType: assetMimeType(path), data: await readFile(absolutePath) };
};

export const vaultAssetAbsolutePath = async (
  vaultRoot: string,
  assetPath: string,
): Promise<string> => {
  const path = requireAssetPath(assetPath);
  await assertVaultWritePathSafe(vaultRoot, path);
  const absolutePath = resolveVaultPath(vaultRoot, path);
  const metadata = await stat(absolutePath);
  if (!metadata.isFile()) throw new TypeError("Asset is not a file");
  return absolutePath;
};
