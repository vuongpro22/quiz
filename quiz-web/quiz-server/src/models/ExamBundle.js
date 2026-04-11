import mongoose from "mongoose";

const examBundleSchema = new mongoose.Schema(
  {
    examKey: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      maxlength: 512,
    },
    questionsText: { type: String, required: true },
    answersText: { type: String, required: true },
    answersExtension: {
      type: String,
      enum: ["csv", "txt"],
      default: "csv",
    },
  },
  { timestamps: true }
);

export const ExamBundle = mongoose.model("ExamBundle", examBundleSchema);
