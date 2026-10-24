import { readImageSettings } from "./image-settings.js";

export type AssetUploadSource = "paste" | "file";

// Walk container chunks rather than guessing animation from the filename.
const animated = (bytes: Uint8Array, mime: string): boolean => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const webp = mime === "image/webp";
  for (let offset = webp ? 12 : 8; offset + 8 <= bytes.length;) {
    const tagAt = offset + (webp ? 0 : 4);
    const tag = String.fromCharCode(...bytes.subarray(tagAt, tagAt + 4));
    if (tag === "ANIM" || tag === "ANMF" || tag === "acTL") return true;
    const length = view.getUint32(offset + (webp ? 4 : 0), webp);
    offset += 8 + length + (webp ? length % 2 : 4);
  }
  return false;
};

export const prepareImageUpload = async (
  file: File,
  source: AssetUploadSource,
): Promise<File> => {
  const settings = readImageSettings();
  if (
    !settings.webp ||
    (source !== "paste" && !settings.includeFiles) ||
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size > 50 * 1024 * 1024
  )
    return file;
  let image: ImageBitmap | undefined;
  try {
    if (
      file.type !== "image/jpeg" &&
      animated(new Uint8Array(await file.arrayBuffer()), file.type)
    )
      return file;
    image = await createImageBitmap(file);
    if (image.width * image.height > 100_000_000) return file;
    const scale =
      settings.maxDimension === 0
        ? 1
        : Math.min(
            1,
            settings.maxDimension / Math.max(image.width, image.height),
          );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", settings.quality / 100),
    );
    if (!blob || blob.type !== "image/webp" || blob.size >= file.size)
      return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".webp", {
      type: "image/webp",
    });
  } catch {
    return file;
  } finally {
    image?.close();
  }
};
