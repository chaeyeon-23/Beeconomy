import type { SpendEstimateInput } from "../src/spendEstimateEngine.ts";
import {
  estimateSpendHeuristic,
  headcountPeopleFromLabel,
  inclusiveTripDayCount,
  isCafeOnlyPlannedSpend,
  premiumEscalatorKeywordsActive,
  reconcilePerPersonWonAfterApi,
  spendEstimateHaystack,
} from "../src/spendEstimateEngine.ts";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

export type AiSpendBreakdown = {
  baseWonPerPerson: number;
  regionalMultiplier: number;
  afterRegionalWonPerPerson: number;
  premiumEscalatorApplied: boolean;
  premiumMultiplier: number;
  afterPremiumWonPerPerson: number;
  hiddenCostsWonPerPerson: number;
  hiddenCostItems: string[];
  reasoningBrief: string;
};

export type EstimateSpendWithOpenAiResult = {
  estimatedWonPerPerson: number;
  breakdown: AiSpendBreakdown;
};

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

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === "string") {
    const n = parseInt(v.replace(/\D/g, ""), 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function readStringArray(v: unknown, maxLen: number): string[] {
  if (!Array.isArray(v)) {
    return [];
  }
  return v
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .slice(0, maxLen)
    .map((s) => s.trim().slice(0, 120));
}

/**
 * 모델이 단계별 금액을 빼먹어도, 합이 더 크면 보수적으로 맞춤.
 */
function conservativeFinalFromBreakdown(
  declared: number,
  b: AiSpendBreakdown,
  premiumForced: boolean,
): number {
  const sumFloor = Math.round(
    b.afterPremiumWonPerPerson + b.hiddenCostsWonPerPerson,
  );
  let x = Math.max(declared, sumFloor);
  if (premiumForced && b.premiumEscalatorApplied) {
    x = Math.max(x, Math.round(b.afterRegionalWonPerPerson * 1.12 + b.hiddenCostsWonPerPerson));
  }
  return x;
}

function parseBreakdown(obj: Record<string, unknown>, premiumForced: boolean): AiSpendBreakdown | null {
  const base = num(obj.baseWonPerPerson);
  const regionalM = num(obj.regionalMultiplier);
  const afterReg = num(obj.afterRegionalWonPerPerson);
  const afterPrem = num(obj.afterPremiumWonPerPerson);
  const hidden = num(obj.hiddenCostsWonPerPerson);
  const premM = num(obj.premiumMultiplier);
  const reasoning =
    typeof obj.reasoningBrief === "string" ? obj.reasoningBrief.trim().slice(0, 400) : "";

  if (
    base == null ||
    regionalM == null ||
    afterReg == null ||
    afterPrem == null ||
    hidden == null ||
    premM == null
  ) {
    return null;
  }

  const premiumApplied = premiumForced || obj.premiumEscalatorApplied === true;

  return {
    baseWonPerPerson: Math.round(base),
    regionalMultiplier: Math.min(2, Math.max(0.5, regionalM)),
    afterRegionalWonPerPerson: Math.round(afterReg),
    premiumEscalatorApplied: premiumApplied,
    premiumMultiplier: Math.min(2, Math.max(1, premM)),
    afterPremiumWonPerPerson: Math.round(afterPrem),
    hiddenCostsWonPerPerson: Math.max(0, Math.round(hidden)),
    hiddenCostItems: readStringArray(obj.hiddenCostItems, 6),
    reasoningBrief: reasoning || "단계별 추정을 반영했습니다.",
  };
}

/**
 * OpenAI API 키가 있으면 1인당 예상 지출과 단계별 근거 JSON을 받고, 없거나 오류면 null.
 */
export async function estimateSpendWithOpenAI(
  input: SpendEstimateInput,
): Promise<EstimateSpendWithOpenAiResult | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  const heuristicHint = estimateSpendHeuristic(input);
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  const people = headcountPeopleFromLabel(input.headcountLabel);
  const tripDays = inclusiveTripDayCount(input.eventDateIso, input.eventEndDateIso ?? null);
  const hay = spendEstimateHaystack(input);
  const premiumForced = premiumEscalatorKeywordsActive(hay);

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
    textForKeywords: hay,
    premiumEscalatorKeywordsDetected: premiumForced,
    cafeOnlyPlannedSpend: isCafeOnlyPlannedSpend(input),
  };

  const system = `당신은 한국 기준 **스마트 예산 분석기**입니다. 임의의 숫자를 던지지 말고, 아래 순서를 **반드시** 지켜 1인 부담금(원)을 산출하세요.

## 산출 순서 (논리적 누적)
1) **기본가(base)**: 약속 유형(식사/여행/문화/의료/구독 등)에 맞는 **1인 기준 시장 통상가**에서 출발합니다. 회식·모임도 **1인이 실제로 내는 몫**만 (전체 식대 합계 금지). **저녁 일반 외식**(고급 키워드 없음)은 base **약 2만 원**에서 출발하고, **회식·고깃·뷔페·무한리필 등**은 base **약 3만 원 전후**에서 출발하세요. 점심은 통상 **2만 원대 초반**에서 출발합니다. 술·2차·핫플은 hidden/premium으로 보수 반영하세요.
   - **카페만 계획(cafeOnlyPlannedSpend=true)**: 사용자 payload에 이 값이 true이면 제목에 회식·술이 있어도 **저녁 회식 식대로 잡지 말고** 커피·디저트·간식 **1인 통상가**(대략 1~2만 원 전후에서 출발, 지역·매장급에 맞게 조정)로 base를 잡습니다. 이 경우 **술자리·회식 연장·야식** 등 회식형 hidden cost는 **0**으로 두세요.
2) **지역 물가 가중치(regionalMultiplier)**: 제주·강남·핫플 등은 1.05~1.12 범위에서 곱합니다. 로컬 동네 기본은 1.0.
3) **프리미엄 에스컬레이터(Premium Escalator)**: 사용자 입력에 오마카세·백화점·파인다이닝·명품·면세점 등 **고단가·충동구매 맥락**이 있거나, premiumEscalatorKeywordsDetected가 true이면 **반드시** premiumEscalatorApplied=true, premiumMultiplier는 1.15~1.35(보수적). 주류 추가·덧메뉴·예비비 성격을 이 단계에 흡수합니다.
4) **숨은 비용(hiddenCosts) — 귀추적 추론**: 사용자가 말하지 않아도 흔한 부가비용을 **1인 기준**으로 가산합니다. 예: 야간 술자리→택시/대리 가능성, 항공→수하물·공항 이동, 장거리 이동→주차/하이패스, 관광지→간식·기념품, 며칠 일정→현지 이동 잡비. 항목명은 hiddenCostItems 배열(짧은 한글 구문, 최대 6개).

## 수식 (JSON 숫자 일관성)
- afterRegionalWonPerPerson = round(baseWonPerPerson * regionalMultiplier)
- afterPremiumWonPerPerson = round(afterRegionalWonPerPerson * premiumMultiplier) — premiumMultiplier는 프리미엄이 아니면 정확히 1
- **estimatedWonPerPerson** = afterPremiumWonPerPerson + hiddenCostsWonPerPerson (반올림)
- tripDaysInclusive ≥ 2 이면 한 끼가 아니라 **기간 전체 1인 총액** 수준으로 base를 잡을 것.

## 출력
반드시 JSON 객체 하나만. 키:
- baseWonPerPerson (정수)
- regionalMultiplier (소수, 0.95~1.15 권장)
- afterRegionalWonPerPerson (정수)
- premiumEscalatorApplied (불리언)
- premiumMultiplier (소수, 1 또는 1.15~1.35)
- afterPremiumWonPerPerson (정수)
- hiddenCostsWonPerPerson (정수, 없으면 0)
- hiddenCostItems (문자열 배열)
- estimatedWonPerPerson (정수)
- reasoningBrief (한두 문장, 한국어)

마크다운·코드펜스·다른 키 금지.`;

  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.25,
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

  const breakdown = parseBreakdown(obj, premiumForced);
  const rawEst = num(obj.estimatedWonPerPerson);
  if (breakdown == null || rawEst == null || !Number.isFinite(rawEst)) {
    return null;
  }

  if (premiumForced) {
    breakdown.premiumEscalatorApplied = true;
    if (breakdown.premiumMultiplier < 1.12) {
      breakdown.premiumMultiplier = 1.18;
    }
    breakdown.afterPremiumWonPerPerson = Math.round(
      breakdown.afterRegionalWonPerPerson * breakdown.premiumMultiplier,
    );
  }

  let estimated = conservativeFinalFromBreakdown(Math.round(rawEst), breakdown, premiumForced);
  estimated = clampPerPersonWon(estimated);
  estimated = Math.round(reconcilePerPersonWonAfterApi(estimated, input, heuristicHint));

  return {
    estimatedWonPerPerson: estimated,
    breakdown,
  };
}
