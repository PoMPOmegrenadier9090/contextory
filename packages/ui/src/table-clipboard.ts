export const tableClipboardCells = (text: string): string[][] => {
  const source = text.replace(/\r\n?/g, "\n").replace(/\n$/, "");
  const rows: string[][] = [[]];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index++) {
    const character = source[index]!;
    if (character === '"' && quoted) {
      if (source[index + 1] === '"') {
        cell += '"';
        index++;
      } else quoted = false;
    } else if (
      character === '"' &&
      cell === "" &&
      /^"(?:[^"]|"")*"(?:\t|\n|$)/.test(source.slice(index))
    ) {
      quoted = true;
    } else if (!quoted && (character === "\t" || character === "\n")) {
      rows.at(-1)!.push(cell);
      cell = "";
      if (character === "\n") rows.push([]);
    } else cell += character;
  }
  rows.at(-1)!.push(cell);
  return rows;
};

export const clipboardTableMarkdown = (
  rows: readonly (readonly string[])[],
): string => {
  const width = rows.reduce((count, row) => Math.max(count, row.length), 0);
  const render = (row: readonly string[]) =>
    `| ${Array.from({ length: width }, (_, index) =>
      (row[index] ?? "")
        .replace(/\r?\n/g, "<br>")
        .replace(/\\*\|/g, (pipe) =>
          pipe.length % 2 === 1 ? `\\${pipe}` : pipe,
        )
        .trim(),
    ).join(" | ")} |`;
  return [
    render(rows[0] ?? []),
    render(Array<string>(width).fill("---")),
    ...rows.slice(1).map(render),
  ].join("\n");
};
