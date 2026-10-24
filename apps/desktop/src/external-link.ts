// Only web URLs may leave the renderer through the OS browser.
export const externalWebUrl = (value: string): string | null => {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") &&
      url.username === "" &&
      url.password === ""
      ? url.href
      : null;
  } catch {
    return null;
  }
};
