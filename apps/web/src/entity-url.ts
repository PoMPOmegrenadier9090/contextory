import { entityIdSchema } from "@pkm/core";
export const entityFromUrl = (url: string): string | null => {
  const id = new URL(url).searchParams.get("entity");
  return entityIdSchema.safeParse(id).success ? id : null;
};
export const urlForEntity = (url: string, id: string | null): string => {
  const next = new URL(url);
  if (id === null) next.searchParams.delete("entity");
  else next.searchParams.set("entity", entityIdSchema.parse(id));
  return next.href;
};
