type DisplayNameEntity =
  | { readonly type: "entry"; readonly title?: string | null | undefined }
  | {
      readonly type: "project" | "task" | "resource";
      readonly title: string;
    }
  | { readonly type: "topic" | "area"; readonly name: string };

export const getEntityDisplayName = (
  entity: DisplayNameEntity,
): string | null => {
  switch (entity.type) {
    case "entry":
      return entity.title?.trim() || null;
    case "project":
    case "task":
    case "resource":
      return entity.title.trim() || null;
    case "topic":
    case "area":
      return entity.name.trim() || null;
  }
};
