import {
  ENTITY_ID_PREFIXES,
  ENTITY_TYPES,
  type EntityId,
  type EntityType,
} from "@pkm/contracts";
import type { Root, Text } from "mdast";
import { parseMarkdownBody } from "./markdown-body.js";
import { visit } from "unist-util-visit";

export interface DirectReference {
  readonly targetType: EntityType;
  readonly targetId: EntityId;
  readonly label: string | null;
  readonly startOffset: number;
  readonly endOffset: number;
}

export interface DirectReferenceIssue {
  readonly code: "UNSUPPORTED_TABLE_REFERENCE";
  readonly severity: "warning";
  readonly message: string;
  readonly startOffset: number;
  readonly endOffset: number;
}

export interface DirectReferenceAnalysis {
  readonly references: readonly DirectReference[];
  readonly issues: readonly DirectReferenceIssue[];
}

interface SourceRange {
  readonly from: number;
  readonly to: number;
}

const UUID_V7_SOURCE =
  "[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

const REFERENCE_PATTERN =
  /\[\[(entry|project|task|resource|topic|area):([^\]\\|\r\n]+)(?:(?:\\\||\|)([^\]\r\n]+))?\]\]/gi;

const entityTypes = new Set<string>(ENTITY_TYPES);

const isEscaped = (source: string, index: number): boolean => {
  let backslashes = 0;
  for (
    let cursor = index - 1;
    cursor >= 0 && source[cursor] === "\\";
    cursor--
  ) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
};

const isEntityType = (value: string): value is EntityType =>
  entityTypes.has(value);

const isMatchingEntityId = (
  type: EntityType,
  value: string,
): value is EntityId => {
  const prefix = ENTITY_ID_PREFIXES[type];
  return new RegExp(`^${prefix}_${UUID_V7_SOURCE}$`, "i").test(value);
};

export const analyzeDirectReferences = (
  markdownBody: string,
  tree?: Root,
): DirectReferenceAnalysis => {
  if (!markdownBody.includes("[[")) return { references: [], issues: [] };
  tree ??= parseMarkdownBody(markdownBody);
  const references: DirectReference[] = [];
  const issues: DirectReferenceIssue[] = [];
  const tableCellRanges: SourceRange[] = [];

  visit(tree, "tableCell", (node) => {
    const from = node.position?.start.offset;
    const to = node.position?.end.offset;
    if (from !== undefined && to !== undefined) {
      tableCellRanges.push({ from, to });
    }
  });

  visit(tree, "text", (node: Text) => {
    const startOffset = node.position?.start.offset;
    const endOffset = node.position?.end.offset;
    if (startOffset === undefined || endOffset === undefined) {
      return;
    }

    const source = markdownBody.slice(startOffset, endOffset);
    const pattern = new RegExp(
      REFERENCE_PATTERN.source,
      REFERENCE_PATTERN.flags,
    );
    for (const match of source.matchAll(pattern)) {
      const localOffset = match.index;
      const targetType = match[1]?.toLowerCase();
      const targetId = match[2];
      if (
        localOffset === undefined ||
        targetType === undefined ||
        targetId === undefined ||
        isEscaped(source, localOffset) ||
        !isEntityType(targetType) ||
        !isMatchingEntityId(targetType, targetId)
      ) {
        continue;
      }

      const reference: DirectReference = {
        targetType,
        targetId,
        label: match[3] ?? null,
        startOffset: startOffset + localOffset,
        endOffset: startOffset + localOffset + match[0].length,
      };

      const isInTableCell = tableCellRanges.some(
        ({ from, to }) =>
          reference.startOffset >= from && reference.endOffset <= to,
      );
      if (isInTableCell) {
        issues.push({
          code: "UNSUPPORTED_TABLE_REFERENCE",
          severity: "warning",
          message: "Direct References in table cells are treated as plain text",
          startOffset: reference.startOffset,
          endOffset: reference.endOffset,
        });
        continue;
      }

      references.push(reference);
    }
  });

  return { references, issues };
};

export const extractDirectReferences = (
  markdownBody: string,
  tree?: Root,
): readonly DirectReference[] =>
  analyzeDirectReferences(markdownBody, tree).references;
