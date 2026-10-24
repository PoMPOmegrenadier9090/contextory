import { parseDocument, type Document } from "yaml";
import type { ZodIssue } from "zod";

import { entitySchema, type ParsedEntity } from "./entity-schema.js";

export type MarkdownParseErrorCode =
  | "MISSING_FRONTMATTER"
  | "UNCLOSED_FRONTMATTER"
  | "INVALID_YAML"
  | "NON_OBJECT_FRONTMATTER"
  | "INVALID_ENTITY";

export interface MarkdownParseError {
  readonly code: MarkdownParseErrorCode;
  readonly message: string;
  readonly source: string;
  readonly issues?: readonly ZodIssue[];
  readonly frontmatter?: unknown;
}

interface SplitFrontmatter {
  readonly frontmatterSource: string;
  readonly body: string;
  readonly lineEnding: "\n" | "\r\n";
}

export interface ParsedMarkdownEntity {
  readonly source: string;
  readonly frontmatterSource: string;
  readonly body: string;
  readonly lineEnding: "\n" | "\r\n";
  readonly document: Document;
  readonly entity: ParsedEntity;
}

export type ParseMarkdownEntityResult =
  | { readonly ok: true; readonly value: ParsedMarkdownEntity }
  | { readonly ok: false; readonly error: MarkdownParseError };

const splitFrontmatter = (
  source: string,
):
  | { readonly ok: true; readonly value: SplitFrontmatter }
  | { readonly ok: false; readonly error: MarkdownParseError } => {
  const opening = /^---(\r\n|\n)/.exec(source);
  if (opening === null) {
    return {
      ok: false,
      error: {
        code: "MISSING_FRONTMATTER",
        message: "Entity Markdown must start with YAML frontmatter",
        source,
      },
    };
  }

  const lineEnding = opening[1] as "\n" | "\r\n";
  const closingPattern = /^---[ \t]*(?:\r\n|\n|$)/gm;
  closingPattern.lastIndex = opening[0].length;
  const closing = closingPattern.exec(source);

  if (closing === null) {
    return {
      ok: false,
      error: {
        code: "UNCLOSED_FRONTMATTER",
        message: "YAML frontmatter does not have a closing delimiter",
        source,
      },
    };
  }

  return {
    ok: true,
    value: {
      frontmatterSource: source.slice(opening[0].length, closing.index),
      body: source.slice(closing.index + closing[0].length),
      lineEnding,
    },
  };
};

export const parseMarkdownEntity = (
  source: string,
): ParseMarkdownEntityResult => {
  const split = splitFrontmatter(source);
  if (!split.ok) {
    return split;
  }

  const document = parseDocument(split.value.frontmatterSource, {
    keepSourceTokens: true,
    prettyErrors: true,
  });

  if (document.errors.length > 0) {
    return {
      ok: false,
      error: {
        code: "INVALID_YAML",
        message: document.errors.map((error) => error.message).join("; "),
        source,
      },
    };
  }

  const data: unknown = document.toJS();
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return {
      ok: false,
      error: {
        code: "NON_OBJECT_FRONTMATTER",
        message: "Entity frontmatter must be a YAML mapping",
        source,
      },
    };
  }

  const parsed = entitySchema.safeParse(data);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "INVALID_ENTITY",
        message: "Entity frontmatter does not satisfy schema v1",
        source,
        issues: parsed.error.issues,
        frontmatter: data,
      },
    };
  }

  return {
    ok: true,
    value: {
      source,
      frontmatterSource: split.value.frontmatterSource,
      body: split.value.body,
      lineEnding: split.value.lineEnding,
      document,
      entity: parsed.data,
    },
  };
};
