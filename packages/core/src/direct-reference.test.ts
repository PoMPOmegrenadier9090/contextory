import { describe, expect, it } from "vitest";

import {
  analyzeDirectReferences,
  extractDirectReferences,
} from "./direct-reference.js";

const TASK_ID = "tsk_01997c2a-7b1c-7a01-8a10-000000000004";
const PROJECT_ID = "prj_01997c2a-7b1c-7a01-8a10-000000000003";
const RESOURCE_ID = "res_01997c2a-7b1c-7a01-8a10-000000000005";

describe("extractDirectReferences", () => {
  it("extracts references from supported text containers", () => {
    const markdown = `本文 [[task:${TASK_ID}|次の作業]]

> [[project:${PROJECT_ID}|PKM開発]]

- [[resource:${RESOURCE_ID}]]

| Resource |
| --- |
| [[resource:${RESOURCE_ID}\\|資料]] |
`;

    expect(extractDirectReferences(markdown)).toMatchObject([
      { targetType: "task", targetId: TASK_ID, label: "次の作業" },
      { targetType: "project", targetId: PROJECT_ID, label: "PKM開発" },
      { targetType: "resource", targetId: RESOURCE_ID, label: null },
    ]);
  });

  it("treats table-cell references as plain text and reports a warning", () => {
    const tableReference = `[[resource:${RESOURCE_ID}\\|資料]]`;
    const markdown = `| Resource |\n| --- |\n| ${tableReference} |\n`;

    const analysis = analyzeDirectReferences(markdown);

    expect(analysis.references).toEqual([]);
    expect(analysis.issues).toEqual([
      {
        code: "UNSUPPORTED_TABLE_REFERENCE",
        severity: "warning",
        message: "Direct References in table cells are treated as plain text",
        startOffset: markdown.indexOf(tableReference),
        endOffset: markdown.indexOf(tableReference) + tableReference.length,
      },
    ]);
  });

  it("ignores excluded Markdown nodes and escaped syntax", () => {
    const markdown = `\\[[task:${TASK_ID}|escaped]]

\`[[task:${TASK_ID}|inline code]]\`

\`\`\`
[[task:${TASK_ID}|fenced code]]
\`\`\`

<div>[[task:${TASK_ID}|html]]</div>

[destination](<[[task:${TASK_ID}|not text]]>)
`;

    expect(extractDirectReferences(markdown)).toEqual([]);
  });

  it("ignores unknown types, malformed IDs, and type-prefix mismatches", () => {
    const markdown = `
[[person:${TASK_ID}|unknown]]
[[task:not-a-uuid|invalid]]
[[task:${PROJECT_ID}|mismatch]]
[[task:${TASK_ID}|valid]]
`;

    expect(extractDirectReferences(markdown)).toMatchObject([
      { targetType: "task", targetId: TASK_ID, label: "valid" },
    ]);
  });
});
