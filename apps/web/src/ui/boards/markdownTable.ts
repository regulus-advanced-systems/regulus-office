/**
 * Pipe tables for the markdown parser (#264): a header row, a delimiter row
 * (`| --- | :---: |`) with as many cells, then body rows until a blank line
 * or a line without a pipe. Cells come back as source text for the inline
 * parser; `\|` and pipes inside code spans do not split a cell.
 */

export type TableAlign = "left" | "center" | "right" | null;

export interface TableSource {
  align: TableAlign[];
  head: string[];
  rows: string[][];
  /** Index of the first line after the table. */
  next: number;
}

export const MAX_TABLE_ROWS = 2000;
const DELIMITER_CELL = /^:?-+:?$/;

/** Split a row into trimmed cells, without the outer pipes. */
export function splitRow(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let inCode = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] as string;
    if (ch === "\\" && line[i + 1] === "|") {
      cell += "|";
      i += 1;
    } else if (ch === "`") {
      inCode = !inCode;
      cell += ch;
    } else if (ch === "|" && !inCode) {
      cells.push(cell.trim());
      cell = "";
    } else cell += ch;
  }
  cells.push(cell.trim());
  if (cells[0] === "") cells.shift();
  if (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
  return cells;
}

/** The table that starts at `lines[at]`, or null. */
export function tableAt(lines: readonly string[], at: number): TableSource | null {
  const header = lines[at];
  const delimiter = lines[at + 1];
  if (header === undefined || delimiter === undefined) return null;
  if (!header.includes("|") || !/^[\s|:-]+$/.test(delimiter) || !delimiter.includes("-"))
    return null;
  const head = splitRow(header);
  const marks = splitRow(delimiter);
  if (head.length === 0 || marks.length !== head.length) return null;
  if (!marks.every((m) => DELIMITER_CELL.test(m))) return null;
  const align = marks.map((m): TableAlign => {
    const left = m.startsWith(":");
    const right = m.endsWith(":");
    return left && right ? "center" : right ? "right" : left ? "left" : null;
  });
  const rows: string[][] = [];
  let i = at + 2;
  for (; i < lines.length && rows.length < MAX_TABLE_ROWS; i++) {
    const line = lines[i] as string;
    if (line.trim() === "" || !line.includes("|")) break;
    const cells = splitRow(line).slice(0, head.length);
    while (cells.length < head.length) cells.push("");
    rows.push(cells);
  }
  return { align, head, rows, next: i };
}
