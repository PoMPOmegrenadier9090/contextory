import { createContext } from "react";

export const copyImage = async (
  image: HTMLImageElement,
  source?: Promise<Blob>,
): Promise<void> => {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined")
    throw new Error("この環境では画像のコピーを利用できません。");
  const png = (async () => {
    const bitmap = source ? await createImageBitmap(await source) : undefined;
    if (!bitmap) await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = bitmap?.width ?? image.naturalWidth;
    canvas.height = bitmap?.height ?? image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("画像を読み込めませんでした。");
    context.drawImage(bitmap ?? image, 0, 0);
    bitmap?.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!blob) throw new Error("画像をコピーできませんでした。");
    return blob;
  })();
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
};

export const ImageClipboardContext = createContext(copyImage);
