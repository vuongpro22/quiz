/** Mirrors quiz_gui.py / answer_csv.py parsing for browser use. */

export type QuestionData = {
  question: string;
  options: [string, string][];
  chooseCount: number;
};

export type QuestionsMap = Record<number, QuestionData>;

function normalizeAnswerCell(cell: string): Set<string> {
  const raw = cell.trim().toUpperCase().replace(/\s+/g, "");
  if (!raw) return new Set();
  if (raw.includes(",")) {
    return new Set(raw.split(",").filter(Boolean));
  }
  const letters = new Set<string>();
  for (const ch of raw) {
    if (ch >= "A" && ch <= "F") letters.add(ch);
  }
  return letters;
}

function csvFirstRowIsHeader(row: string[]): boolean {
  if (!row.length) return false;
  const firstRaw = (row[0] ?? "").trim();
  if (!firstRaw) return false;
  if (firstRaw.startsWith("#")) return true;
  const first = firstRaw.toUpperCase().replace(/\s+/g, "");
  if (/^[A-F]+(,[A-F]+)*$/.test(first)) return false;
  if (firstRaw.length > 12) return true;
  if (/PMG|Question|Course|FE|RE|\.com|header/i.test(firstRaw)) return true;
  if (firstRaw.includes("-") && firstRaw.length > 8) return true;
  return false;
}

/** Minimal CSV row parser: handles quoted fields with commas. */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let i = 0;
  let inQuotes = false;
  while (i < line.length) {
    const c = line[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cur += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      out.push(cur);
      cur = "";
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  out.push(cur);
  return out;
}

function parseCsvRows(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map(parseCsvLine);
}

export function parseAnswersCsv(content: string): Map<number, Set<string>> {
  const bomStripped = content.replace(/^\uFEFF/, "");
  const rows = parseCsvRows(bomStripped);
  const answers = new Map<number, Set<string>>();
  if (!rows.length) return answers;

  const dataRows = csvFirstRowIsHeader(rows[0]!) ? rows.slice(1) : rows;

  dataRows.forEach((row, idx) => {
    const qNum = idx + 1;
    if (!row.length) return;
    let selected = new Set<string>();
    for (const cell of row) {
      selected = normalizeAnswerCell(cell);
      if (selected.size) break;
    }
    if (selected.size) answers.set(qNum, selected);
  });
  return answers;
}

export function parseAnswersTxt(content: string): Map<number, Set<string>> {
  const answers = new Map<number, Set<string>>();
  const pattern = /^Q(\d+)\s*:\s*([A-F](?:\s*,\s*[A-F])*)\s*$/i;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(pattern);
    if (!match) continue;
    const qNum = parseInt(match[1]!, 10);
    const parts = match[2]!.split(",").map((p) => p.trim().toUpperCase());
    answers.set(qNum, new Set(parts));
  }
  return answers;
}

export function parseAnswers(content: string, fileName: string): Map<number, Set<string>> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv")) return parseAnswersCsv(content);
  return parseAnswersTxt(content);
}

export function splitQuestionBlocks(content: string): [number, string][] {
  const pattern = /=+\s*Q(\d+)\.webp\s*=+/gi;
  const matches: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(content)) !== null) {
    matches.push(m);
  }
  const blocks: [number, string][] = [];
  matches.forEach((match, idx) => {
    const qNum = parseInt(match[1]!, 10);
    const start = match.index + match[0].length;
    const end = idx + 1 < matches.length ? matches[idx + 1]!.index : content.length;
    const blockText = content.slice(start, end).trim();
    if (blockText) blocks.push([qNum, blockText]);
  });
  return blocks;
}

export function parseQuestionBlock(block: string, fallbackQNum: number): [number, string, [string, string][], number] {
  const lines = block.split(/\r?\n/).map((ln) => ln.replace(/\s+$/, ""));
  let qNum = fallbackQNum;
  let i = 0;
  const questionLines: string[] = [];
  const headerRe = /^\s*Question:\s*(\d+)\s*(.*)$/i;

  while (i < lines.length && !lines[i]!.trim()) i++;

  if (i < lines.length) {
    const hm = lines[i]!.match(headerRe);
    if (hm) {
      qNum = parseInt(hm[1]!, 10);
      const first = hm[2]!.trim();
      if (first) questionLines.push(first);
      i++;
    }
  }

  const chooseLineRe = /^\s*\(Choose\s+(\d+)\s+answers?\)\s*$/i;
  let chooseCount = 1;
  let optionStart = lines.length;

  while (i < lines.length) {
    const line = lines[i]!;
    const stripped = line.trim();
    const cm = stripped.match(chooseLineRe);
    if (cm) {
      chooseCount = parseInt(cm[1]!, 10);
      optionStart = i + 1;
      break;
    }
    if (/^[A-F]\.\s/.test(stripped)) {
      optionStart = i;
      break;
    }
    questionLines.push(line);
    i++;
  }

  let questionText = questionLines.join("\n").trim();
  if (!questionText) {
    for (const ln of lines) {
      const s = ln.trim();
      if (!s || s.startsWith("(") || /^[A-F]\.\s/.test(s)) continue;
      questionText = s;
      break;
    }
    if (!questionText) questionText = `Question ${qNum}`;
  }

  const optionsBlock = lines.slice(optionStart).join("\n");
  // End anchor: use `$` — in JS `\Z` is NOT “end of string” (unlike Python); it matches literal “Z”.
  const optionRe = /([A-F])\.\s*([\s\S]+?)(?=\n[A-F]\.\s|$)/gi;
  const options: [string, string][] = [];
  let om: RegExpExecArray | null;
  while ((om = optionRe.exec(optionsBlock)) !== null) {
    const key = om[1]!.toUpperCase();
    const text = om[2]!.replace(/\s+/g, " ").trim();
    options.push([key, text]);
  }

  return [qNum, questionText, options, chooseCount];
}

export function parseQuestions(content: string): QuestionsMap {
  const questions: QuestionsMap = {};
  for (const [headerQNum, block] of splitQuestionBlocks(content)) {
    try {
      const [qNum, questionText, options, chooseCount] = parseQuestionBlock(block, headerQNum);
      questions[qNum] = { question: questionText, options, chooseCount };
    } catch {
      continue;
    }
  }
  return questions;
}

export function intersectQuestionNumbers(
  questions: QuestionsMap,
  answers: Map<number, Set<string>>
): number[] {
  const qKeys = new Set(Object.keys(questions).map(Number));
  const nums: number[] = [];
  for (const k of answers.keys()) {
    if (qKeys.has(k)) nums.push(k);
  }
  return nums.sort((a, b) => a - b);
}

export function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}
