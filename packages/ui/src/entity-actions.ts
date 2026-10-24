import type { ResourceType } from "@pkm/contracts";
import {
  ENTITY_TYPES,
  type EntityType,
  type AreaId,
  type ProjectId,
  type TaskId,
  type ResourceId,
  type TopicId,
  type PkmClient,
  type PkmEntitySummary,
} from "@pkm/contracts";
import {
  parseMarkdownEntity,
  serializeMarkdownEntity,
  updateEntityMetadata,
  type EntityMetadataPatch,
} from "@pkm/core";
export interface HierarchyEntityPatch {
  readonly authors?: readonly string[] | null;
  readonly relatedEntityIds?: readonly string[] | null;
  readonly description?: string | null;
  readonly displayName?: string;
  readonly status?: string;
  readonly priority?: string | null;
  readonly areaId?: string | null;
  readonly projectId?: string | null;
  readonly topicIds?: readonly string[];
  readonly resourceType?: ResourceType | null;
  readonly canonicalIdentifier?: string | null;
  readonly sourceUri?: string | null;
  readonly assetPath?: string | null;
  readonly journalDate?: string | null;
  readonly dueAt?: string | null;
  readonly deletedAt?: string | null;
}

export const ENTITY_TYPE_OPTIONS: readonly {
  readonly value: EntityType;
  readonly label: string;
}[] = [
  { value: "entry", label: "Entry" },
  { value: "task", label: "Task" },
  { value: "project", label: "Project" },
  { value: "resource", label: "Resource" },
  { value: "topic", label: "Topic" },
  { value: "area", label: "Area" },
];

export const isEntityType = (value: string): value is EntityType =>
  ENTITY_TYPES.some((type) => type === value);

export const entryContextPatch = (
  context: PkmEntitySummary | null,
): EntityMetadataPatch | null => {
  if (context === null) return null;
  switch (context.type) {
    case "area":
      return { entryContexts: { area: context.id as AreaId } };
    case "project":
      return { entryContexts: { project: context.id as ProjectId } };
    case "task":
      return { entryContexts: { task: context.id as TaskId } };
    case "resource":
      return { entryContexts: { resource: context.id as ResourceId } };
    case "topic":
      return { topics: [context.id as TopicId] };
    default:
      return null;
  }
};

export const creationContextPatch = (
  type: EntityType,
  context: PkmEntitySummary | null,
): EntityMetadataPatch | null => {
  if (context === null) return null;
  if (type === "entry") return entryContextPatch(context);
  if (
    type === "resource" &&
    ["area", "project", "task", "resource"].includes(context.type)
  )
    return { relatedEntityIds: [context.id] };
  if (type === "project" && context.type === "area") {
    return { areaId: context.id as AreaId };
  }
  if (type === "task" && context.type === "project") {
    return { projectId: context.id as ProjectId };
  }
  if (type === "task" && context.type === "area") {
    return { areaId: context.id as AreaId };
  }
  if (type !== "topic" && context.type === "topic") {
    return { topics: [context.id as TopicId] };
  }
  return null;
};

// Area/Project/Task relationships to a Resource are stored on the Resource.
export const creationSourceContextPatch = (
  type: EntityType,
  context: PkmEntitySummary | null,
  createdId: string,
): EntityMetadataPatch | null =>
  context?.type === "resource" && ["area", "project", "task"].includes(type)
    ? {
        relatedEntityIds: [
          ...new Set([...(context.relatedEntityIds ?? []), createdId]),
        ],
      }
    : null;

export const canCreateInContext = (
  type: EntityType,
  context: PkmEntitySummary,
): boolean =>
  creationContextPatch(type, context) !== null ||
  creationSourceContextPatch(type, context, "") !== null;

export const linkCreatedEntityToContext = async (
  client: Pick<PkmClient, "loadEntity" | "saveEntity">,
  type: EntityType,
  context: PkmEntitySummary | null,
  createdId: string,
): Promise<void> => {
  if (
    context === null ||
    creationSourceContextPatch(type, context, createdId) === null
  )
    return;
  const current = await client.loadEntity(context.id);
  if (current.draft !== null) {
    throw new Error(
      "ContextのResourceに未保存draftがあります。保存または破棄してから関連を追加してください。",
    );
  }
  const patch = creationSourceContextPatch(type, current.entity, createdId);
  if (patch === null) throw new Error("ContextのResourceが見つかりません。");
  const updated = updateEntityMetadata(current.content, patch);
  const result = await client.saveEntity({
    entityId: context.id,
    content: updated.content,
    expectedFileHash: current.fileHash,
  });
  if (!result.ok)
    throw new Error("ContextのResourceへの関連保存が外部更新と競合しました。");
};

const toMetadataPatch = (patch: HierarchyEntityPatch): EntityMetadataPatch => ({
  ...(patch.authors === undefined ? {} : { authors: patch.authors }),
  ...(patch.relatedEntityIds === undefined
    ? {}
    : { relatedEntityIds: patch.relatedEntityIds }),
  ...(patch.description === undefined
    ? {}
    : { description: patch.description }),
  ...(patch.displayName === undefined
    ? {}
    : { displayName: patch.displayName }),
  ...(patch.status === undefined
    ? {}
    : {
        status: patch.status as Exclude<
          EntityMetadataPatch["status"],
          undefined
        >,
      }),
  ...(patch.priority === undefined
    ? {}
    : {
        priority: patch.priority as Exclude<
          EntityMetadataPatch["priority"],
          undefined
        >,
      }),
  ...(patch.areaId === undefined
    ? {}
    : {
        areaId: patch.areaId as Exclude<
          EntityMetadataPatch["areaId"],
          undefined
        >,
      }),
  ...(patch.projectId === undefined
    ? {}
    : {
        projectId: patch.projectId as Exclude<
          EntityMetadataPatch["projectId"],
          undefined
        >,
      }),
  ...(patch.topicIds === undefined
    ? {}
    : {
        topics: patch.topicIds as Exclude<
          EntityMetadataPatch["topics"],
          undefined
        >,
      }),
  ...(patch.resourceType === undefined
    ? {}
    : { resourceType: patch.resourceType }),
  ...(patch.canonicalIdentifier === undefined
    ? {}
    : { canonicalIdentifier: patch.canonicalIdentifier }),
  ...(patch.sourceUri === undefined ? {} : { sourceUri: patch.sourceUri }),
  ...(patch.assetPath === undefined ? {} : { assetPath: patch.assetPath }),
  ...(patch.journalDate === undefined
    ? {}
    : { journalDate: patch.journalDate }),
  ...(patch.dueAt === undefined ? {} : { dueAt: patch.dueAt }),
  ...(patch.deletedAt === undefined ? {} : { deletedAt: patch.deletedAt }),
});

// UI-independent editing operations. Applications own notifications, refresh and navigation.
export const createEntityActions = (
  client: Pick<PkmClient, "loadEntity" | "saveEntity">,
) => ({
  async updateMetadata(
    entityId: string,
    patch: HierarchyEntityPatch,
  ): Promise<void> {
    const current = await client.loadEntity(entityId);
    if (current.draft !== null) {
      throw new Error(
        "このEntityには未保存draftがあります。詳細画面で保存または破棄してから表で編集してください。",
      );
    }
    const updated = updateEntityMetadata(
      current.content,
      toMetadataPatch(patch),
    );
    const result = await client.saveEntity({
      entityId,
      content: updated.content,
      expectedFileHash: current.fileHash,
    });
    if (!result.ok) {
      throw new Error(
        "外部更新と競合したため表の変更を保存できませんでした。詳細画面で内容を確認してください。",
      );
    }
  },
  async updateEntryBody(
    entityId: string,
    expectedBody: string,
    body: string,
  ): Promise<void> {
    const current = await client.loadEntity(entityId);
    const parsed = parseMarkdownEntity(current.content);
    if (
      current.draft !== null ||
      !parsed.ok ||
      parsed.value.entity.type !== "entry" ||
      parsed.value.body !== expectedBody
    ) {
      throw new Error(
        "Entryに別の編集があります。一覧を更新し、詳細画面で確認してください。",
      );
    }
    const result = await client.saveEntity({
      entityId,
      content: serializeMarkdownEntity(parsed.value, { body }),
      expectedFileHash: current.fileHash,
    });
    if (!result.ok)
      throw new Error("外部更新と競合しました。詳細画面で確認してください。");
  },
});
