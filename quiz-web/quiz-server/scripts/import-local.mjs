/**
 * Đọc output_text/*.txt và answer/* cùng stem (thư mục cha của quiz-web), upsert vào MongoDB.
 * Chạy từ quiz-web/quiz-server: npm run import:local
 */
import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import { ExamBundle } from "../src/models/ExamBundle.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..", "..");
const OUTPUT_TEXT = path.join(ROOT, "output_text");
const ANSWER_DIR = path.join(ROOT, "answer");

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("Set MONGODB_URI in quiz-web/quiz-server/.env");
  process.exit(1);
}

async function findAnswerFile(stem) {
  for (const ext of [".csv", ".txt"]) {
    const p = path.join(ANSWER_DIR, stem + ext);
    try {
      await fs.access(p);
      return { path: p, ext: ext.slice(1) };
    } catch {
      continue;
    }
  }
  return null;
}

async function main() {
  await mongoose.connect(MONGODB_URI);
  const names = await fs.readdir(OUTPUT_TEXT);
  const txts = names.filter((n) => n.toLowerCase().endsWith(".txt"));
  let upserted = 0;
  let skipped = 0;

  for (const name of txts) {
    const stem = name.replace(/\.txt$/i, "");
    const ans = await findAnswerFile(stem);
    if (!ans) {
      console.warn(`Skip (no answer file): ${stem}`);
      skipped++;
      continue;
    }
    const questionsText = await fs.readFile(path.join(OUTPUT_TEXT, name), "utf8");
    const answersText = await fs.readFile(ans.path, "utf8");
    await ExamBundle.findOneAndUpdate(
      { examKey: stem },
      {
        examKey: stem,
        questionsText,
        answersText,
        answersExtension: ans.ext,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    console.log(`OK: ${stem}`);
    upserted++;
  }

  console.log(`Done. Upserted ${upserted}, skipped ${skipped}.`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
