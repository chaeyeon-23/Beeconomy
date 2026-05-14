/**
 * 비코노미 로컬 API — 소비 예상(1인당) 등. 프로덕션은 별도 호스트에 배포해 두고
 * 프론트의 VITE_SPEND_ESTIMATE_API_URL 로 연결하면 됩니다.
 */

import "dotenv/config";
import cors from "cors";
import express from "express";
import { estimateSpendWithOpenAI } from "./aiSpendEstimate.ts";
import {
  type SpendEstimateInput,
  estimateSpendHeuristic,
  headcountPeopleFromLabel,
} from "../src/spendEstimateEngine.ts";

const PORT = Number(process.env.PORT ?? "3001");

const app = express();
app.use(express.json({ limit: "32kb" }));
/** 로컬·사내 미리보기용. 공개 배포 시 도메인 화이트리스트로 바꾸세요. */
app.use(cors({ origin: true }));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "beeconomy-api",
    openai: Boolean(process.env.OPENAI_API_KEY?.trim()),
  });
});

function parseSpendEstimateBody(body: unknown): SpendEstimateInput | null {
  if (body == null || typeof body !== "object") {
    return null;
  }
  const o = body as Record<string, unknown>;
  const title = typeof o.title === "string" ? o.title : "";
  const date =
    typeof o.date === "string"
      ? o.date
      : typeof o.eventDateIso === "string"
        ? o.eventDateIso
        : "";
  const time = typeof o.time === "string" ? o.time : "";
  const headcount = typeof o.headcount === "string" ? o.headcount : "";
  const endDateRaw =
    typeof o.endDate === "string"
      ? o.endDate
      : typeof o.eventEndDateIso === "string"
        ? o.eventEndDateIso
        : "";
  const eventEndDateIso = endDateRaw.trim() === "" ? null : endDateRaw.trim();
  let monthlyBudgetWon: number | null = null;
  if (typeof o.monthlyBudgetWon === "number" && Number.isFinite(o.monthlyBudgetWon)) {
    monthlyBudgetWon = o.monthlyBudgetWon;
  }
  const plannedRaw =
    typeof o.plannedSpendCategories === "string"
      ? o.plannedSpendCategories
      : typeof o.plannedSpendCategoriesJoined === "string"
        ? o.plannedSpendCategoriesJoined
        : "";
  const plannedSpendCategoriesJoined = plannedRaw.trim();
  if (title.trim() === "" || date.trim() === "") {
    return null;
  }
  return {
    title: title.trim(),
    eventDateIso: date.trim(),
    eventEndDateIso,
    timeLabel: time,
    headcountLabel: headcount,
    monthlyBudgetWon,
    ...(plannedSpendCategoriesJoined !== ""
      ? { plannedSpendCategoriesJoined }
      : {}),
  };
}

app.post("/api/spend-estimate", async (req, res) => {
  const input = parseSpendEstimateBody(req.body);
  if (!input) {
    res.status(400).json({ error: "Invalid body: need title, date (YYYY-MM-DD)" });
    return;
  }
  const people = headcountPeopleFromLabel(input.headcountLabel);
  let perPerson = estimateSpendHeuristic(input);
  let source: "openai" | "heuristic" = "heuristic";
  let breakdown: Record<string, unknown> | undefined;

  try {
    const ai = await estimateSpendWithOpenAI(input);
    if (ai != null && Number.isFinite(ai.estimatedWonPerPerson)) {
      perPerson = ai.estimatedWonPerPerson;
      source = "openai";
      breakdown = ai.breakdown as unknown as Record<string, unknown>;
    }
  } catch (e) {
    console.warn("[api/spend-estimate] OpenAI error, using heuristic:", e);
  }

  res.json({
    estimatedWonPerPerson: perPerson,
    estimatedUnit: "per_person",
    headcountPeople: people,
    source,
    ...(breakdown ? { spendBreakdown: breakdown } : {}),
  });
});

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.listen(PORT, "0.0.0.0", () => {
  const ai = Boolean(process.env.OPENAI_API_KEY?.trim());
  console.log(
    `[beeconomy-api] http://127.0.0.1:${PORT}  POST /api/spend-estimate  (OpenAI: ${ai ? "on" : "off"})`,
  );
});
