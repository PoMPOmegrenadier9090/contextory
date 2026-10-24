export interface TodoQuery {
  readonly state?: "unchecked" | "checked" | "all" | undefined;
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
  readonly scopeType?: "area" | "project" | "task" | "resource" | undefined;
  readonly scopeId?: string | undefined;
}

export interface IndexedTodo {
  readonly entryId: string;
  readonly entryTitle: string | null;
  readonly createdAt: string;
  readonly markerFrom: number;
  readonly markerTo: number;
  readonly text: string;
  readonly checked: boolean;
  readonly depth: number;
  readonly fileHash: `sha256:${string}`;
}

export interface TodoPage {
  readonly items: readonly IndexedTodo[];
  readonly nextCursor: string | null;
}

export interface ToggleTodoRequest {
  readonly entryId: string;
  readonly markerFrom: number;
  readonly checked: boolean;
  readonly expectedFileHash: `sha256:${string}`;
}
