/**
 * 일정 → 예상 소비 금액 (항상 1인당 원화).
 * - API: `estimatedWonPerPerson` 등이 있으면 그대로 사용. 없으면 `estimatedWon` 등은
 *   모임 전체 금액으로 보고 인원으로 나눕니다.
 * - 휴리스틱: 1인 기준으로 계산합니다.
 */

export type SpendEstimateInput = {
  title: string;
  /** YYYY-MM-DD */
  eventDateIso: string;
  timeLabel: string;
  headcountLabel: string;
  monthlyBudgetWon: number | null;
};

function parseHeadcountDigits(s: string): number {
  const m = s.match(/(\d+)/);
  if (!m) {
    return 2;
  }
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 50) : 2;
}

function parseHourFromTimeLabel(s: string): number | null {
  const t = s.trim();
  if (!t) {
    return null;
  }
  const hm = t.match(/(\d{1,2})\s*:\s*(\d{2})/);
  if (hm) {
    return parseInt(hm[1], 10);
  }
  const h = t.match(/(\d{1,2})\s*시/);
  if (h) {
    return parseInt(h[1], 10);
  }
  return null;
}

function roundToNearest1000(n: number) {
  return Math.round(n / 1000) * 1000;
}

function applyMonthlyBudgetCapPerPerson(
  perPerson: number,
  people: number,
  monthlyBudgetWon: number | null,
): number {
  if (monthlyBudgetWon == null || monthlyBudgetWon <= 0) {
    return perPerson;
  }
  const capPerPerson = Math.floor((monthlyBudgetWon * 0.35) / people);
  if (capPerPerson > 0) {
    return Math.min(perPerson, capPerPerson);
  }
  return perPerson;
}

export function estimateSpendHeuristic(input: SpendEstimateInput): number {
  const people = Math.max(1, parseHeadcountDigits(input.headcountLabel));
  const title = input.title;

  // 의료 일정은 식사/문화 가산과 섞지 않음 (점심·저녁 티켓 + 진료비가 중복되는 문제 방지)
  if (/병원|의원|진료|검진|치과/i.test(title)) {
    let perPerson = 13000;
    if (/검진/i.test(title)) {
      perPerson = 35000;
    } else if (/치과/i.test(title)) {
      perPerson = 25000;
    }
    perPerson = applyMonthlyBudgetCapPerPerson(perPerson, people, input.monthlyBudgetWon);
    return Math.max(5000, roundToNearest1000(perPerson));
  }

  // 브런치는 식사에 가깝고, 커피만 마시는 일정과 구분
  if (/브런치/i.test(title)) {
    let perPerson = 15000;
    perPerson = applyMonthlyBudgetCapPerPerson(perPerson, people, input.monthlyBudgetWon);
    return Math.max(5000, roundToNearest1000(perPerson));
  }

  // 카페·커피만: 식사 기본값(15~22k)에 +α 하면 비현실적으로 큼 → 음료 1잔 수준
  if (/커피|카페/i.test(title)) {
    let perPerson = 5000;
    perPerson = applyMonthlyBudgetCapPerPerson(perPerson, people, input.monthlyBudgetWon);
    return Math.max(4000, roundToNearest1000(perPerson));
  }

  const hour = parseHourFromTimeLabel(input.timeLabel);
  const isDinner = hour != null && hour >= 17;
  const isLunch = hour != null && hour >= 11 && hour < 15;

  let perPerson = 15000;
  if (isDinner) {
    perPerson = 22000;
  } else if (isLunch) {
    perPerson = 18000;
  }

  if (/영화|movie|cinema|극장/i.test(title)) {
    perPerson += 15000;
  }
  if (/생일|케이크|파티/i.test(title)) {
    perPerson += Math.round(35000 / people);
  }

  perPerson = applyMonthlyBudgetCapPerPerson(perPerson, people, input.monthlyBudgetWon);

  return Math.max(5000, roundToNearest1000(perPerson));
}

function parseWonValue(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === "string") {
    const n = parseInt(raw.replace(/\D/g, ""), 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function readWonFromJson(data: Record<string, unknown>): number | null {
  const raw =
    data.estimatedWon ??
    data.estimatedAmount ??
    data.amountWon ??
    data.amount ??
    data.result ??
    data.won;

  return parseWonValue(raw);
}

/** API가 1인 금액을 주면 그대로, 합계만 주면 인원으로 나눔. */
function readPerPersonWonFromJson(data: Record<string, unknown>, input: SpendEstimateInput): number | null {
  const explicitRaw =
    data.estimatedWonPerPerson ??
    data.perPersonWon ??
    data.perPersonEstimatedWon ??
    data.amountPerPerson;

  const explicit = parseWonValue(explicitRaw);
  if (explicit != null && explicit >= 0) {
    return explicit;
  }

  const total = readWonFromJson(data);
  if (total == null || total < 0) {
    return null;
  }
  const people = Math.max(1, parseHeadcountDigits(input.headcountLabel));
  return Math.round(total / people);
}

/**
 * 서버 스펙에 맞게 body/헤더/필드명을 바꿔 쓰면 됩니다.
 */
export async function fetchSpendEstimateFromApi(input: SpendEstimateInput): Promise<number | null> {
  const url = import.meta.env.VITE_SPEND_ESTIMATE_API_URL?.trim();
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
      time: input.timeLabel,
      headcount: input.headcountLabel,
      monthlyBudgetWon: input.monthlyBudgetWon,
    }),
  });

  if (!res.ok) {
    throw new Error(`예상 금액 API 오류 (${res.status})`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  const won = readPerPersonWonFromJson(data, input);
  return won != null && won >= 0 ? Math.round(won) : null;
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
