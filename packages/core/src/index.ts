export { descriptionSchema } from "./entity-schema.js";
export type {
  TodoQuery,
  IndexedTodo,
  TodoPage,
  ToggleTodoRequest,
  Entity,
  EntityId,
  EntityType,
  EntryContexts,
  Priority,
  Status,
  VaultConfig,
} from "@pkm/contracts";
export { extractMarkdownTodos } from "./markdown-todos.js";
export { parseMarkdownBody } from "./markdown-body.js";
export type { MarkdownTodoItem } from "./markdown-todos.js";
export { parseTodoQuery, parseToggleTodoRequest } from "./todo-contract.js";
export {
  createEntityId,
  ENTITY_DIRECTORIES,
  ENTITY_TYPES,
  getEntityRelativePath,
} from "@pkm/contracts";

export {
  areaSchema,
  entityIdSchema,
  entitySchema,
  entrySchema,
  projectSchema,
  resourceSchema,
  taskSchema,
  topicSchema,
  vaultConfigFileSchema,
  vaultConfigSchema,
} from "./entity-schema.js";
export type {
  ParsedEntity,
  ParsedVaultConfig,
  ParsedVaultConfigFile,
} from "./entity-schema.js";
export {
  updateEntityMetadata,
  normalizeEntityDisplayName,
} from "./entity-metadata.js";
export {
  addJournalDays,
  requireJournalDate,
  todayJournalDate,
} from "./journal-date.js";
export type {
  EntityMetadataPatch,
  UpdatedEntityMetadata,
  UpdateEntityMetadataOptions,
} from "./entity-metadata.js";
export { getEntityDisplayName } from "./display-name.js";
export {
  analyzeDirectReferences,
  extractDirectReferences,
} from "./direct-reference.js";
export type {
  DirectReference,
  DirectReferenceAnalysis,
  DirectReferenceIssue,
} from "./direct-reference.js";
export { parseMarkdownEntity } from "./markdown-parser.js";
export type {
  MarkdownParseError,
  MarkdownParseErrorCode,
  ParsedMarkdownEntity,
  ParseMarkdownEntityResult,
} from "./markdown-parser.js";
export {
  serializeMarkdownEntity,
  serializeNewMarkdownEntity,
} from "./markdown-serializer.js";
export type {
  SerializeMarkdownEntityOptions,
  SerializeNewMarkdownEntityOptions,
} from "./markdown-serializer.js";
export { markdownToPlainText } from "./markdown-plain-text.js";
export {
  assessVaultSchemaVersion,
  CURRENT_SCHEMA_VERSION,
} from "./schema-version.js";
export type {
  VaultAccessMode,
  VaultSchemaCompatibility,
} from "./schema-version.js";
export {
  collectEntityReferences,
  validateEntityFile,
  validateVault,
} from "./validator.js";
export type {
  EntityReferenceKind,
  EntityReferenceTarget,
  EntityFileValidation,
  InvalidEntityFile,
  ValidEntityFile,
  ValidationIssue,
  ValidationIssueCode,
  ValidationSeverity,
  VaultSourceFile,
  VaultValidationResult,
} from "./validator.js";
export { parseVaultConfig } from "./vault-config.js";
export type {
  ParseVaultConfigResult,
  VaultConfigParseError,
  VaultConfigParseErrorCode,
} from "./vault-config.js";

export {
  parseCreateAssetRequest,
  parseCreateEntityRequest,
  parseOrphanAssetDeletion,
  parseResolveEntityConflictRequest,
  parseResolveSyncthingConflictRequest,
  parseSaveSyncthingConflictDraftRequest,
  parseSaveDraftRequest,
  parseSaveEntityRequest,
  parsePermanentlyDeleteEntityRequest,
  requireRequestString,
  requireRequestRecord,
} from "./request-validation.js";
export {
  parseEntityPageQuery,
  parseBacklinkPageQuery,
} from "./entity-query.js";

export { parseMetadataPatch, requireFileHash } from "./request-validation.js";

export {
  agentCommandSchema,
  agentAssetUploadSchema,
  agentQuerySchema,
  agentContextsSchema,
  agentEntryPatchSchema,
  agentTaskPatchSchema,
  agentProjectPatchSchema,
  agentResourcePatchSchema,
  agentTopicPatchSchema,
  agentAreaPatchSchema,
} from "./agent-contract.js";
export type { AgentCommand } from "./agent-contract.js";

export { entityQueryAffected } from "./entity-query-impact.js";
