import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..");
const src = path.join(root, "same-question.txt");
const destDir = path.join(__dirname, "..", "public");
const dest = path.join(destDir, "same-question.txt");

if (!fs.existsSync(src)) {
  console.error("Missing:", src);
  process.exit(1);
}
fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
console.log("same-question.txt -> quiz-web/public/same-question.txt");
