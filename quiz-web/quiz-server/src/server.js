import "dotenv/config";
import cors from "cors";
import express from "express";
import mongoose from "mongoose";
import { examsRouter } from "./routes/exams.js";

const PORT = Number(process.env.PORT) || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";

if (!MONGODB_URI) {
  console.error("Missing MONGODB_URI in environment (.env)");
  process.exit(1);
}

const app = express();

app.use(
  cors({
    origin: CORS_ORIGIN.split(",").map((s) => s.trim()),
    credentials: true,
  })
);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, mongo: mongoose.connection.readyState === 1 });
});

app.use("/api/exams", examsRouter);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Server error" });
});

await mongoose.connect(MONGODB_URI);
console.log("MongoDB connected");

app.listen(PORT, () => {
  console.log(`quiz-server listening on http://localhost:${PORT}`);
});
