import type { PoolQuestionItem } from "./randomQuizPool";

/** Cosine bigram; ~0,86 thường bắt được câu OCR gần giống, có thể chỉnh trong mã. */
export const DEFAULT_SIMILARITY_THRESHOLD = 0.86;

/**
 * Bỏ cụm OCR kiểu `(Choose 1 answer)`, `(Choose | answer)`, `(Choose 2 answers)` ở bất kỳ đâu trong stem.
 */
function stripChooseParentheticals(s: string): string {
  let t = s;
  for (let k = 0; k < 6; k++) {
    const next = t.replace(/\(\s*choose[^)]{0,220}\)/gi, " ");
    if (next === t) break;
    t = next;
  }
  return t;
}

/**
 * Chuẩn hoá để so sánh / diff: bỏ khác biệt đánh máy & OCR (nháy, gạch), cụm (Choose…),
 * và toàn bộ dấu câu Unicode (\p{P}) + ký tự `|` (OCR trong “Choose | answer”).
 */
export function normalizeForCompare(text: string): string {
  let s = text.normalize("NFKC");
  s = s.replace(/[\u200B-\u200D\uFEFF]/g, "");
  // Nháy đơn / apostrophe (ASCII, typographic, prime, acute)
  s = s.replace(/[\u2018\u2019\u02BC\u00B4\u2032]/g, "'");
  // Nháy kép
  s = s.replace(/[\u201C\u201D\u201E\u201F\u00AB\u00BB\u2033]/g, '"');
  s = s.replace(/\u2026/g, "...");
  s = s.replace(/[\u2013\u2014\u2212]/g, "-");
  s = s.replace(/\s+/g, " ").trim().toLowerCase();
  s = stripChooseParentheticals(s);
  s = s.replace(/\|/g, " ");
  s = s.replace(/\p{P}+/gu, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/** Cosine trên bigram ký tự — nhanh, phù hợp gom câu gần giống OCR. */
export function bigramCosineSimilarity(a: string, b: string): number {
  const na = normalizeForCompare(a);
  const nb = normalizeForCompare(b);
  if (na.length < 2 || nb.length < 2) return na === nb ? 1 : 0;
  const count = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2);
      m.set(bg, (m.get(bg) ?? 0) + 1);
    }
    return m;
  };
  const A = count(na);
  const B = count(nb);
  let dot = 0;
  let sa = 0;
  let sb = 0;
  for (const v of A.values()) sa += v * v;
  for (const v of B.values()) sb += v * v;
  for (const [k, va] of A) {
    const vb = B.get(k);
    if (vb !== undefined) dot += va * vb;
  }
  if (!sa || !sb) return 0;
  return dot / (Math.sqrt(sa) * Math.sqrt(sb));
}

class UnionFind {
  private parent: number[];
  private rank: number[];

  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = new Array(n).fill(0);
  }

  find(x: number): number {
    const p = this.parent;
    while (p[x] !== x) {
      p[x] = p[p[x]!]!;
      x = p[x]!;
    }
    return x;
  }

  union(a: number, b: number): void {
    let ra = this.find(a);
    let rb = this.find(b);
    if (ra === rb) return;
    if (this.rank[ra]! < this.rank[rb]!) [ra, rb] = [rb, ra];
    this.parent[rb] = ra;
    if (this.rank[ra] === this.rank[rb]) this.rank[ra]!++;
  }
}

function cmpExamItem(a: PoolQuestionItem, b: PoolQuestionItem): number {
  const s = a.sourceExam.localeCompare(b.sourceExam);
  if (s !== 0) return s;
  return a.qNum - b.qNum;
}

/**
 * Gom nhóm câu gần giống (≥2 câu / nhóm), giống ý tưởng `similar_questions.cluster_similar`.
 * `threshold`: cosine bigram, mặc định ~0,86 khớp nhiều cặp “gần giống” OCR.
 */
export function clusterSimilarPool(
  pool: PoolQuestionItem[],
  threshold: number,
  minQuestionLen = 15
): PoolQuestionItem[][] {
  const records = pool.filter((p) => p.question.trim().length >= minQuestionLen);
  const n = records.length;
  if (n < 2) return [];

  const lengths = records.map((r) => normalizeForCompare(r.question).length);
  const uf = new UnionFind(n);

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const li = lengths[i]!;
      const lj = lengths[j]!;
      if (li && lj) {
        const lo = Math.min(li, lj);
        const hi = Math.max(li, lj);
        if (hi > lo * 1.35 + 30) continue;
      }
      if (bigramCosineSimilarity(records[i]!.question, records[j]!.question) >= threshold) {
        uf.union(i, j);
      }
    }
  }

  const buckets = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = uf.find(i);
    const arr = buckets.get(r);
    if (arr) arr.push(i);
    else buckets.set(r, [i]);
  }

  const groups: PoolQuestionItem[][] = [];
  for (const idxs of buckets.values()) {
    if (idxs.length < 2) continue;
    const g = idxs.map((k) => records[k]!).sort(cmpExamItem);
    groups.push(g);
  }

  groups.sort((ga, gb) => cmpExamItem(ga[0]!, gb[0]!));
  return groups;
}

/** Hint ngắn: khác gì so với câu mẫu (diff theo từ, LCS tiền tố). */
export function hintVsReference(thisText: string, refText: string): string {
  const a = normalizeForCompare(thisText);
  const b = normalizeForCompare(refText);
  if (a === b) return "(Giống câu mẫu)";
  const wa = a.split(" ").filter(Boolean);
  const wb = b.split(" ").filter(Boolean);
  const n = wa.length;
  const m = wb.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (wa[i - 1] === wb[j - 1]) dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      else dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
    }
  }
  const raw: string[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && wa[i - 1] === wb[j - 1]) {
      i--;
      j--;
      continue;
    }
    if (i > 0 && dp[i]![j] === dp[i - 1]![j]!) {
      raw.push(`thêm '${wa[i - 1]!}'`);
      i--;
      continue;
    }
    if (j > 0 && dp[i]![j] === dp[i]![j - 1]!) {
      raw.push(`bỏ '${wb[j - 1]!}'`);
      j--;
      continue;
    }
    if (i > 0) {
      raw.push(`thêm '${wa[i - 1]!}'`);
      i--;
    } else if (j > 0) {
      raw.push(`bỏ '${wb[j - 1]!}'`);
      j--;
    } else {
      break;
    }
  }
  const parts = raw.reverse();
  const merged: string[] = [];
  for (let k = 0; k < parts.length; k++) {
    const cur = parts[k]!;
    const next = parts[k + 1];
    const m1 = cur.match(/^thêm '(.+)'$/);
    const m2 = next?.match(/^bỏ '(.+)'$/);
    if (m1 && m2) {
      merged.push(`'${m2[1]!}' → '${m1[1]!}'`);
      k++;
      continue;
    }
    const m3 = cur.match(/^bỏ '(.+)'$/);
    const m4 = next?.match(/^thêm '(.+)'$/);
    if (m3 && m4) {
      merged.push(`'${m3[1]!}' → '${m4[1]!}'`);
      k++;
      continue;
    }
    merged.push(cur);
  }
  const out = merged.slice(0, 10);
  if (!out.length) return "(Khác nhẹ)";
  return out.join("; ");
}

export type SimilarSlide = {
  item: PoolQuestionItem;
  /** 1-based for UI */
  groupIndex: number;
  indexInGroup: number;
  groupSize: number;
  hint: string;
};

/**
 * Giữ câu mẫu (phần tử đầu sau sort) và chỉ các biến thể thực sự khác nội dung sau chuẩn hoá.
 * Câu trùng hẳn với mẫu (hint sẽ là « Giống câu mẫu ») không đưa vào danh sách ôn.
 * Nhóm chỉ còn 1 câu thì bỏ hẳn nhóm.
 */
export function pruneIdenticalToReference(groups: PoolQuestionItem[][]): PoolQuestionItem[][] {
  const out: PoolQuestionItem[][] = [];
  for (const g of groups) {
    if (!g.length) continue;
    const ref = g[0]!;
    const norm0 = normalizeForCompare(ref.question);
    const filtered = [ref, ...g.slice(1).filter((q) => normalizeForCompare(q.question) !== norm0)];
    if (filtered.length >= 2) out.push(filtered);
  }
  return out;
}

/** Nối các nhóm liền nhau: mỗi nhóm các biến thể đứng cạnh nhau (đã bỏ trùng nội dung với mẫu). */
export function buildSimilarSlides(groups: PoolQuestionItem[][]): SimilarSlide[] {
  const pruned = pruneIdenticalToReference(groups);
  const slides: SimilarSlide[] = [];
  pruned.forEach((g, gi) => {
    g.forEach((item, idx) => {
      const hint =
        idx === 0
          ? "Câu mẫu trong nhóm — so sánh với các biến thể kế bên để thấy chỗ đổi chữ / số."
          : hintVsReference(item.question, g[0]!.question);
      slides.push({
        item,
        groupIndex: gi + 1,
        indexInGroup: idx + 1,
        groupSize: g.length,
        hint,
      });
    });
  });
  return slides;
}
