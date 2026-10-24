export const ENTITY_TYPES = [
  "entry",
  "project",
  "task",
  "resource",
  "topic",
  "area",
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

export const supportsMarkdownBody = (type: string): type is EntityType =>
  ENTITY_TYPES.some((entityType) => entityType === type);

export const ENTITY_DIRECTORIES = {
  entry: "entries",
  project: "projects",
  task: "tasks",
  resource: "resources",
  topic: "topics",
  area: "areas",
} as const satisfies Record<EntityType, string>;

export const ENTITY_ID_PREFIXES = {
  entry: "ent",
  project: "prj",
  task: "tsk",
  resource: "res",
  topic: "topic",
  area: "area",
} as const satisfies Record<EntityType, string>;

export type Uuid = `${string}-${string}-${string}-${string}-${string}`;
export type VaultId = Uuid;
export type EntryId = `ent_${Uuid}`;
export type ProjectId = `prj_${Uuid}`;
export type TaskId = `tsk_${Uuid}`;
export type ResourceId = `res_${Uuid}`;
export type TopicId = `topic_${Uuid}`;
export type AreaId = `area_${Uuid}`;

export type EntityId =
  EntryId | ProjectId | TaskId | ResourceId | TopicId | AreaId;

export interface EntityIdByType {
  readonly entry: EntryId;
  readonly project: ProjectId;
  readonly task: TaskId;
  readonly resource: ResourceId;
  readonly topic: TopicId;
  readonly area: AreaId;
}

export interface UuidV7Options {
  readonly timestampMs?: number;
  readonly randomBytes?: Uint8Array;
}

const byteToHex = (value: number): string =>
  value.toString(16).padStart(2, "0");

export const createUuidV7 = (options: UuidV7Options = {}): Uuid => {
  const timestampMs = options.timestampMs ?? Date.now();
  if (
    !Number.isSafeInteger(timestampMs) ||
    timestampMs < 0 ||
    timestampMs > 0xffffffffffff
  ) {
    throw new RangeError("UUIDv7 timestamp must be a 48-bit integer");
  }

  const randomBytes =
    options.randomBytes ??
    globalThis.crypto.getRandomValues(new Uint8Array(16));
  if (randomBytes.length !== 16) {
    throw new RangeError("UUIDv7 requires exactly 16 random bytes");
  }
  const bytes = Uint8Array.from(randomBytes);
  let timestamp = BigInt(timestampMs);
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(timestamp & 0xffn);
    timestamp >>= 8n;
  }
  bytes[6] = 0x70 | (bytes[6]! & 0x0f);
  bytes[8] = 0x80 | (bytes[8]! & 0x3f);

  const hex = [...bytes].map(byteToHex).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export const createEntityId = <TType extends EntityType>(
  type: TType,
  options?: UuidV7Options,
): EntityIdByType[TType] =>
  `${ENTITY_ID_PREFIXES[type]}_${createUuidV7(options)}` as EntityIdByType[TType];

export const getEntityRelativePath = <TType extends EntityType>(
  type: TType,
  id: EntityIdByType[TType],
): string => `${ENTITY_DIRECTORIES[type]}/${id}.md`;

export type IsoDate = `${number}-${number}-${number}`;
export type IsoDateTime = string;

export const STATUSES = [
  "not_started",
  "in_progress",
  "on_hold",
  "done",
] as const;
export type Status = (typeof STATUSES)[number];

export const PRIORITIES = [
  "lowest",
  "low",
  "normal",
  "high",
  "highest",
] as const;
export type Priority = (typeof PRIORITIES)[number];

export const RESOURCE_TYPES = [
  "book",
  "paper",
  "web_article",
  "other",
] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export const STATUS_ORDER = [
  "in_progress",
  "not_started",
  "on_hold",
  "done",
] as const;
export const PRIORITY_ORDER = [
  "highest",
  "high",
  "normal",
  "low",
  "lowest",
] as const;
export const workStatusRank = (value: string | null): number => {
  const index = STATUS_ORDER.findIndex((candidate) => candidate === value);
  return index < 0 ? STATUS_ORDER.length : index;
};
export const workPriorityRank = (value: string | null): number => {
  const index = PRIORITY_ORDER.findIndex((candidate) => candidate === value);
  return index < 0 ? PRIORITY_ORDER.length : index;
};
export const compareWork = (
  a: { status: string | null; priority: string | null },
  b: { status: string | null; priority: string | null },
): number =>
  workStatusRank(a.status) - workStatusRank(b.status) ||
  workPriorityRank(a.priority) - workPriorityRank(b.priority);
export const isActiveWork = (entity: {
  type: string;
  status: string | null;
}): boolean =>
  !["project", "task"].includes(entity.type) ||
  !["done", "on_hold"].includes(entity.status ?? "");

export const ORIGINS = ["human", "ai", "system"] as const;
export type Origin = (typeof ORIGINS)[number];

export interface VaultConfig {
  readonly vault_id: VaultId;
  readonly schema_version: 1;
}

export interface BaseEntity<TType extends EntityType, TId extends EntityId> {
  readonly id: TId;
  readonly type: TType;
  readonly created_at: IsoDateTime;
  readonly updated_at: IsoDateTime;
  readonly deleted_at?: IsoDateTime | null;
}

export interface EntryContexts {
  readonly area?: AreaId | null;
  readonly project?: ProjectId | null;
  readonly task?: TaskId | null;
  readonly resource?: ResourceId | null;
}

export interface EntryEntity extends BaseEntity<"entry", EntryId> {
  readonly title?: string | null;
  /** ISO date for all-day values, or ISO datetime with timezone. */
  readonly occurred_at?: string | null;
  readonly journal_date?: IsoDate | null;
  readonly origin: Origin;
  readonly curated_at?: IsoDateTime | null;
  readonly exclude_from_ai: boolean;
  readonly contexts?: EntryContexts | null;
  readonly topics?: readonly TopicId[] | null;
  readonly generated_at?: IsoDateTime | null;
  readonly source_entity_ids?: readonly EntityId[] | null;
}

export interface ProjectEntity extends BaseEntity<"project", ProjectId> {
  readonly description?: string | null;
  readonly title: string;
  readonly status: Status;
  readonly priority?: Priority | null;
  readonly area_id?: AreaId | null;
  readonly topics?: readonly TopicId[] | null;
  readonly completed_at?: IsoDateTime | null;
}

interface TaskFields extends BaseEntity<"task", TaskId> {
  readonly description?: string | null;
  readonly title: string;
  readonly status: Status;
  readonly priority?: Priority | null;
  readonly topics?: readonly TopicId[] | null;
  /** ISO date for all-day deadlines, or ISO datetime with timezone. */
  readonly due_at?: string | null;
  readonly completed_at?: IsoDateTime | null;
}

export type TaskEntity = TaskFields &
  (
    | { readonly project_id: ProjectId; readonly area_id?: never }
    | { readonly project_id?: null; readonly area_id?: AreaId | null }
  );

export interface ResourceEntity extends BaseEntity<"resource", ResourceId> {
  readonly resource_type?: ResourceType | null;
  readonly authors?: readonly string[] | null;
  readonly related_entity_ids?:
    readonly (AreaId | ProjectId | TaskId | ResourceId)[] | null;
  readonly description?: string | null;
  readonly title: string;
  readonly canonical_identifier?: string | null;
  readonly source_uri?: string | null;
  readonly asset_path?: string | null;
  readonly version?: string | null;
  readonly acquired_at?: IsoDateTime | null;
  readonly local_content_status?: string | null;
  readonly topics?: readonly TopicId[] | null;
}

export interface TopicEntity extends BaseEntity<"topic", TopicId> {
  readonly description?: string | null;
  readonly name: string;
}

export interface AreaEntity extends BaseEntity<"area", AreaId> {
  readonly description?: string | null;
  readonly name: string;
  readonly topics?: readonly TopicId[] | null;
}

export type Entity =
  | EntryEntity
  | ProjectEntity
  | TaskEntity
  | ResourceEntity
  | TopicEntity
  | AreaEntity;

export const FRONTMATTER_KEY_ORDER = {
  entry: [
    "id",
    "type",
    "title",
    "created_at",
    "updated_at",
    "occurred_at",
    "journal_date",
    "origin",
    "curated_at",
    "exclude_from_ai",
    "contexts",
    "topics",
    "generated_at",
    "source_entity_ids",
    "deleted_at",
  ],
  project: [
    "id",
    "type",
    "title",
    "description",
    "status",
    "priority",
    "area_id",
    "topics",
    "completed_at",
    "created_at",
    "updated_at",
    "deleted_at",
  ],
  task: [
    "id",
    "type",
    "title",
    "description",
    "status",
    "priority",
    "project_id",
    "area_id",
    "topics",
    "due_at",
    "completed_at",
    "created_at",
    "updated_at",
    "deleted_at",
  ],
  resource: [
    "id",
    "type",
    "title",
    "description",
    "authors",
    "related_entity_ids",
    "resource_type",
    "canonical_identifier",
    "source_uri",
    "asset_path",
    "version",
    "acquired_at",
    "local_content_status",
    "topics",
    "created_at",
    "updated_at",
    "deleted_at",
  ],
  topic: [
    "id",
    "type",
    "name",
    "description",
    "created_at",
    "updated_at",
    "deleted_at",
  ],
  area: [
    "id",
    "type",
    "name",
    "description",
    "topics",
    "created_at",
    "updated_at",
    "deleted_at",
  ],
} as const satisfies Record<EntityType, readonly string[]>;
