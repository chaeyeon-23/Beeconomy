import type { SpendEstimateInput } from "../src/spendEstimateEngine.ts";
import {
  estimateSpendHeuristic,
  headcountPeopleFromLabel,
  inclusiveTripDayCount,
  reconcilePerPersonWonAfterApi,
} from "../src/spendEstimateEngine.ts";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

function clampPerPersonWon(n: number): number {
  if (!Number.isFinite(n)) {
    return NaN;
  }
  const r = Math.round(n);
  return Math.min(5_000_000, Math.max(1_000, r));
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  const body = fence ? fence[1].trim() : trimmed;
  try {
    const v = JSON.parse(body) as unknown;
    return v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * OpenAI API 키가 있으면 1인당 예상 지출(원)을 JSON으로 받고, 없거나 오류면 null.
 */
export async function estimateSpendWithOpenAI(input: SpendEstimateInput): Promise<number | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  const heuristicHint = estimateSpendHeuristic(input);
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  const people = headcountPeopleFromLabel(input.headcountLabel);
  const tripDays = inclusiveTripDayCount(input.eventDateIso, input.eventEndDateIso ?? null);

  const userPayload = {
    title: input.title,
    date: input.eventDateIso,
    eventEndDateIso: input.eventEndDateIso ?? null,
    tripDaysInclusive: tripDays,
    time: input.timeLabel,
    headcountText: input.headcountLabel,
    headcountPeople: people,
    monthlyBudgetWon: input.monthlyBudgetWon,
    plannedSpendCategoriesJoined: input.plannedSpendCategoriesJoined ?? "",
  };

  const system = `당신은 한국 기준 개인·모임 지출을 추정하는 도우미입니다.
입력(제목·날짜·시각·인원·이번 달 예산·예상 소비 카테고리 문자열)을 바탕으로 **한 사람이 통장에서 나갈 1인 부담금(원, 정수)** 만 추정하세요.

중요:
- 회식·동아리·모임·MT 등은 보통 1인 1만~6만 원대가 많습니다. 고깃·뷔페·연말 파티도 **1인이 실제로 내는 몫**만 넣으세요.
- **여행·출장 등 tripDaysInclusive(포함 일수)가 2일 이상**이면, 식사 한 끼가 아니라 **그 기간 동안 1인이 쓸 법한 식비·교통·입장료·잡비를 합친 총액** 수준으로 잡으세요. 국내 며칠 여행이면 1인당 수십만~수백만 원대도 흔합니다.
- **모임 전체 식대 합계·총액·N명이 먹은 총비용**을 넣지 마세요. 인원 수와 무관하게 "1인" 기준만.
- plannedSpendCategoriesJoined에 카페·간식·구독 등이 있으면 제목이 짧아도 그 맥락을 반영하세요(예: 팀플+카페면 1인 커피·음료 수준).
- 숫자 하나만: JSON 객체 키는 정확히 "estimatedWonPerPerson" 만. 다른 키·문장·마크다운 금지.`;

  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.35,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(userPayload) },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.warn("[openai] spend estimate failed:", res.status, errText.slice(0, 200));
    return null;
  }

  const data = (await res.json()) as Record<string, unknown>;
  const choices = data.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }
  const msg = choices[0] as Record<string, unknown>;
  const message = msg.message as Record<string, unknown> | undefined;
  const content = typeof message?.content === "string" ? message.content : "";
  const obj = extractJsonObject(content);
  if (!obj) {
    return null;
  }
  const raw = obj.estimatedWonPerPerson;
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? parseInt(raw.replace(/\D/g, ""), 10) : NaN;
  if (!Number.isFinite(n)) {
    return null;
  }
  const clamped = clampPerPersonWon(n);
  return reconcilePerPersonWonAfterApi(clamped, input, heuristicHint);
}
