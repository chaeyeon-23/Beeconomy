/**
 * 일정 → 예상 소비 금액 (항상 1인당 원화).
 * - API: 1인당 필드가 있으면 우선, 합계만 있으면 인원으로 나눔.
 * - 로컬 개발: 기본으로 로컬 API 서버( spendEstimateEngine )를 호출합니다.
 */

import {
  type SpendEstimateInput,
  estimateSpendHeuristic,
  headcountPeopleFromLabel,
  readPerPersonWonFromJson,
  reconcilePerPersonWonAfterApi,
} from "./spendEstimateEngine";

export type { SpendEstimateInput } from "./spendEstimateEngine";
export {
  estimateSpendHeuristic,
  headcountPeopleFromLabel,
  inclusiveTripDayCount,
  reconcilePerPersonWonAfterApi,
} from "./spendEstimateEngine";

function resolveSpendEstimateApiUrl(): string {
  const configured = import.meta.env.VITE_SPEND_ESTIMATE_API_URL?.trim();
  if (configured) {
    return configured;
  }
  if (import.meta.env.DEV) {
    return "http://127.0.0.1:3001/api/spend-estimate";
  }
  return "";
}

/**
 * 서버 스펙에 맞게 body/헤더/필드명을 바꿔 쓰면 됩니다.
 */
export async function fetchSpendEstimateFromApi(input: SpendEstimateInput): Promise<number | null> {
  const url = resolveSpendEstimateApiUrl();
  if (!url) {
    return null;
  }

  const key = import.meta.env.VITE_SPEND_ESTIMATE_API_KEY?.trim();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify({
      title: input.title,
      date: input.eventDateIso,
      endDate: input.eventEndDateIso ?? undefined,
      eventEndDateIso: input.eventEndDateIso ?? undefined,
      time: input.timeLabel,
      headcount: input.headcountLabel,
      headcountPeople: headcountPeopleFromLabel(input.headcountLabel),
      monthlyBudgetWon: input.monthlyBudgetWon,
      ...(input.plannedSpendCategoriesJoined?.trim()
        ? { plannedSpendCategories: input.plannedSpendCategoriesJoined.trim() }
        : {}),
    }),
  });

  if (!res.ok) {
    throw new Error(`예상 금액 API 오류 (${res.status})`);
  }

  const responseData = (await res.json()) as Record<string, unknown>;
  const won = readPerPersonWonFromJson(responseData, input);
  if (won == null || !Number.isFinite(won) || won < 0) {
    return null;
  }
  const hint = estimateSpendHeuristic(input);
  return Math.round(reconcilePerPersonWonAfterApi(won, input, hint));
}

export async function resolveSpendEstimate(input: SpendEstimateInput): Promise<number> {
  try {
    const fromApi = await fetchSpendEstimateFromApi(input);
    if (fromApi != null && Number.isFinite(fromApi)) {
      return Math.max(0, fromApi);
    }
  } catch {
    // API 실패 시 휴리스틱
  }
  return estimateSpendHeuristic(input);
}
