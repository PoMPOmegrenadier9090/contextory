import type { DocNode } from "./object-document.js";
import type {
  FieldDefinition,
  ObjectPage,
  ObjectSummary,
  ObjectTimelineEntry,
  ObjectType,
  TypeDefinition,
} from "./object-model.js";

export interface ObjectOverview {
  readonly navigation: readonly ObjectSummary[];
  readonly recent: readonly ObjectSummary[];
}

export interface ObjectTypePatch {
  readonly name?: string;
  readonly color?: string | null;
  readonly checkbox?: boolean;
  readonly extends?: string | null;
  readonly fields?: readonly FieldDefinition[];
}

/** WebとDesktopが共有するObject保存境界。 */
export interface ObjectClient {
  loadPage(hostId: string): Promise<ObjectPage>;
  savePage(
    hostId: string,
    doc: DocNode,
    keepalive?: boolean,
  ): Promise<ObjectPage>;
  searchObjects(
    query: string,
    exclude?: string | null,
  ): Promise<readonly ObjectSummary[]>;
  objectsOfType(type: string): Promise<readonly ObjectSummary[]>;
  createObject(input: {
    readonly id: string;
    readonly type: ObjectType;
    readonly title: string;
    readonly parentId: string | null;
  }): Promise<ObjectSummary>;
  patchObject(
    id: string,
    patch: { readonly title?: string; readonly done?: boolean },
  ): Promise<ObjectSummary>;
  timeline(id: string): Promise<readonly ObjectTimelineEntry[]>;
  types(): Promise<readonly TypeDefinition[]>;
  updateType(name: string, patch: ObjectTypePatch): Promise<TypeDefinition>;
  overview(from: number, to: number): Promise<ObjectOverview>;
}
