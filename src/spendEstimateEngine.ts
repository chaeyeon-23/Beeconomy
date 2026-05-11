/**
 * 일정 → 예상 소비 (1인당 원) — Vite/Node 공통. 네트워크 호출은 spendEstimate.ts.
 */

export type SpendEstimateInput = {
  title: string;
  /** YYYY-MM-DD */
  eventDateIso: string;
  /** YYYY-MM-DD — 있으면 일정 기간(포함) 일수로 국내 여행·기간형 추정에 사용 */
  eventEndDateIso?: string | null;
  timeLabel: string;
  headcountLabel: string;
  monthlyBudgetWon: number | null;
  /**
   * 일정 마법사에서 고른 예상 소비 카테고리(joinSpendCategories 형식, 카테고리 구분자로 이어짐).
   * 제목만으로는 안 잡히는 경우(예: 「핀테크 팀플」+ 카페)에 맥락을 더함.
   */
  plannedSpendCategoriesJoined?: string;
};

const PLANNED_CATEGORY_JOIN_SEP = "\u001e";

/** 제목 + 예상 카테고리 — 휴리스틱·보정에서 공통으로 사용 */
function spendEstimateHaystack(input: SpendEstimateInput): string {
  const plan = (input.plannedSpendCategoriesJoined ?? "").split(PLANNED_CATEGORY_JOIN_SEP).join(" ");
  return `${input.title} ${plan}`.replace(/\s+/g, " ").trim();
}

/** 시작·종료(포함) 사이 달력 일 수. 잘못된 값·역순이면 1 */
export function inclusiveTripDayCount(startIso: string, endIso?: string | null): number {
  if (endIso == null || String(endIso).trim() === "") {
    return 1;
  }
  const s = startIso.trim();
  const e = String(endIso).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !/^\d{4}-\d{2}-\d{2}$/.test(e)) {
    return 1;
  }
  const a = new Date(`${s}T12:00:00`);
  const b = new Date(`${e}T12:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) {
    return 1;
  }
  const diffDays = Math.round((b.getTime() - a.getTime()) / 86400000);
  if (diffDays < 0) {
    return 1;
  }
  return Math.min(45, Math.max(1, diffDays + 1));
}

function tripKeywordTitle(title: string): boolean {
  return /여행|트립|\btrip\b|관광|호캉스|워케이션|패키지|출장|\bMT\b|수련회|연수|제주|부산|강릉|경주|속초|양양|전주|통영|여수/i.test(title);
}

/** 일정 인원(라벨에서 첫 정수). 없으면 1 — 캘린더 예산 곱셈·API 나눗셈과 동일 기준 유지 */
export function headcountPeopleFromLabel(headcountLabel: string): number {
  const m = headcountLabel.match(/(\d+)/);
  if (!m) {
    return 1;
  }
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 50) : 1;
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
  const people = Math.max(1, headcountPeopleFromLabel(input.headcountLabel));
  const hay = spendEstimateHaystack(input);
  const tripDays = inclusiveTripDayCount(input.eventDateIso, input.eventEndDateIso ?? null);
  const tripWord = tripKeywordTitle(hay);

  /** 여행·복수일: 1인당 «기간 전체» 묶음 러프(식비·간단 이동·잡비 수준, 국내 가정) */
  if (tripDays > 1) {
    const dailyBase = tripWord ? 34000 : 26000;
    let perPerson = dailyBase * Math.pow(tripDays, 0.88);
    perPerson = roundToNearest1000(perPerson);
    perPerson = applyMonthlyBudgetCapPerPerson(perPerson, people, input.monthlyBudgetWon);
    const floor = tripDays >= 10 ? 150_000 : tripDays >= 7 ? 120_000 : tripDays >= 4 ? 70_000 : 35_000;
    return Math.max(floor, Math.min(550_000, perPerson));
  }
  if (tripDays === 1 && tripWord) {
    let perPerson = 40000;
    perPerson = applyMonthlyBudgetCapPerPerson(perPerson, people, input.monthlyBudgetWon);
    return Math.max(18_000, roundToNearest1000(perPerson));
  }

  if (/병원|의원|진료|검진|치과/i.test(hay)) {
    let perPerson = 13000;
    if (/검진/i.test(hay)) {
      perPerson = 35000;
    } else if (/치과/i.test(hay)) {
      perPerson = 25000;
    }
    perPerson = applyMonthlyBudgetCapPerPerson(perPerson, people, input.monthlyBudgetWon);
    return Math.max(5000, roundToNearest1000(perPerson));
  }

  if (/브런치/i.test(hay)) {
    let perPerson = 15000;
    perPerson = applyMonthlyBudgetCapPerPerson(perPerson, people, input.monthlyBudgetWon);
    return Math.max(5000, roundToNearest1000(perPerson));
  }

  if (/구독|\bOTT\b|넷플릭스|netflix|디즈니|disney|쿠팡플레이|wavve|웨이브/i.test(hay)) {
    let perPerson = 14000;
    perPerson = applyMonthlyBudgetCapPerPerson(perPerson, people, input.monthlyBudgetWon);
    return Math.max(5000, roundToNearest1000(perPerson));
  }

  const hour = parseHourFromTimeLabel(input.timeLabel);
  const titleT = input.title.trim();
  /** 제목이 커피·디저트 위주일 때만 저녁 시간대에도 낮은 추정(카페·간식 카테고리 오분류 방지) */
  const coffeeOnlyHint =
    /카페\s*에서|스타벅스|투썸|이디야|메가커피|빽다방|커피\s*만|티타임|디저트\s*만|케이크\s*만/i.test(
      titleT,
    );
  const eveningMealHint =
    /저녁|회식|술자리|맛집|야식|한끼|약속|식사|고깃|삼겹|소고기|이자카야|파스타|우동|라멘|한식|양식/i.test(
      hay,
    );
  const lunchMealHint = /점심|런치/i.test(hay);

  const isDinnerHour = hour != null && hour >= 17 && hour < 24;
  const isLunchHour = hour != null && hour >= 11 && hour < 15;
  /** 15~16시: 늦은 점심·카페·가벼운 모임 묶음(3시 모임 등) */
  const isAfternoon = hour != null && hour >= 15 && hour < 17;

  const useDinnerMeal =
    !coffeeOnlyHint && (isDinnerHour || (hour == null && eveningMealHint));
  const useLunchMeal =
    !coffeeOnlyHint && !useDinnerMeal && (isLunchHour || (hour == null && lunchMealHint));

  if (useDinnerMeal) {
    let perPerson = 38_000;
    if (/영화|movie|cinema|극장/i.test(hay)) {
      perPerson += 15_000;
    }
    if (/생일|케이크|파티/i.test(hay)) {
      perPerson += Math.round(15_000 / people);
    }
    if (/회식|고깃|삼겹|무한|뷔페|오마카세|파인다이닝|코스/i.test(hay)) {
      perPerson += 12_000;
    }
    perPerson = applyMonthlyBudgetCapPerPerson(perPerson, people, input.monthlyBudgetWon);
    return Math.max(25_000, roundToNearest1000(perPerson));
  }

  if (useLunchMeal) {
    let perPerson = 28_000;
    if (/영화|movie|cinema|극장/i.test(hay)) {
      perPerson += 15_000;
    }
    if (/생일|케이크|파티/i.test(hay)) {
      perPerson += Math.round(12_000 / people);
    }
    perPerson = applyMonthlyBudgetCapPerPerson(perPerson, people, input.monthlyBudgetWon);
    return Math.max(18_000, roundToNearest1000(perPerson));
  }

  if (/커피|카페|간식/i.test(hay)) {
    let perPerson = 8000;
    perPerson = applyMonthlyBudgetCapPerPerson(perPerson, people, input.monthlyBudgetWon);
    return Math.max(5000, roundToNearest1000(perPerson));
  }

  let perPerson = 18_000;
  if (isDinnerHour) {
    perPerson = 38_000;
  } else if (isLunchHour) {
    perPerson = 28_000;
  } else if (isAfternoon) {
    perPerson = 16_000;
  }

  if (/영화|movie|cinema|극장/i.test(hay)) {
    perPerson += 15000;
  }
  if (/생일|케이크|파티/i.test(hay)) {
    perPerson += Math.round(12000 / people);
  }

  perPerson = applyMonthlyBudgetCapPerPerson(perPerson, people, input.monthlyBudgetWon);

  return Math.max(8000, roundToNearest1000(perPerson));
}

/**
 * API/모델이 모임 **식대 등 합계**를 1인당 필드에 넣는 오류 보정.
 * 인원이 늘어날수록 합계만 커지고 1인 부담은 비슷한 경우가 많아, 합계로 의심되면 ÷ 인원.
 */
export function reconcilePerPersonWonAfterApi(
  rawWon: number,
  input: SpendEstimateInput,
  heuristicPerPerson: number,
): number {
  if (!Number.isFinite(rawWon) || rawWon < 0) {
    return Math.max(0, Math.round(heuristicPerPerson));
  }
  const people = Math.max(1, headcountPeopleFromLabel(input.headcountLabel));
  const h = Math.max(1, Math.round(heuristicPerPerson));
  let x = Math.round(rawWon);

  if (people >= 2) {
    const asSplit = Math.round(x / people);
    const splitLo = Math.max(2_500, Math.floor(h * 0.3));
    const splitHi = Math.min(150_000, Math.max(35_000, h * 5 + 20_000));
    if (asSplit >= splitLo && asSplit <= splitHi) {
      const impliedGroup = h * people;
      const looksLikeStuffedGroupTotal =
        x >= Math.max(40_000, impliedGroup * 0.55) &&
        (x >= impliedGroup * 0.82 || x >= 95_000) &&
        x > h * 2.2;
      if (looksLikeStuffedGroupTotal) {
        x = asSplit;
      }
    }
  }

  const lux = /웨딩|연회|뷔페|오마카세|파인다이닝|코스요리|무한리필/i.test(spendEstimateHaystack(input));
  const td = inclusiveTripDayCount(input.eventDateIso, input.eventEndDateIso ?? null);
  const cap =
    lux ? 400_000 : td > 1 ? Math.min(600_000, Math.max(200_000, 55_000 * td)) : 130_000;
  return Math.min(Math.max(x, 0), cap);
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

/** { data: { ... } } / { result: { ... } } 한 단계 펼침 */
function flattenPayload(data: Record<string, unknown>): Record<string, unknown> {
  const inner = data.data ?? data.result ?? data.body;
  if (inner && typeof inner === "object" && !Array.isArray(inner)) {
    return { ...data, ...(inner as Record<string, unknown>) };
  }
  return data;
}

function readDeclaredGroupTotal(payload: Record<string, unknown>): number | null {
  return (
    parseWonValue(payload.totalEstimatedWon) ??
    parseWonValue(payload.estimatedTotalWon) ??
    parseWonValue(payload.groupTotalWon) ??
    parseWonValue(payload.totalAmount) ??
    parseWonValue(payload.groupTotal) ??
    null
  );
}

function readLegacyMaybeTotal(payload: Record<string, unknown>): number | null {
  const raw =
    payload.estimatedWon ??
    payload.estimatedAmount ??
    payload.amountWon ??
    payload.amount ??
    payload.result ??
    payload.won;

  return parseWonValue(raw);
}

function normalizeAmountUnit(raw: unknown): string {
  if (typeof raw !== "string") {
    return "";
  }
  return raw.trim().toLowerCase().replace(/-/g, "_");
}

/**
 * API JSON → 항상 1인당 원.
 */
export function readPerPersonWonFromJson(
  data: Record<string, unknown>,
  input: SpendEstimateInput,
): number | null {
  const people = Math.max(1, headcountPeopleFromLabel(input.headcountLabel));
  const payload = flattenPayload(data);

  const unit = normalizeAmountUnit(
    payload.estimatedUnit ?? payload.amountUnit ?? payload.unit ?? payload.scope,
  );

  const explicitPP = parseWonValue(
    payload.estimatedWonPerPerson ??
      payload.perPersonWon ??
      payload.perPersonEstimatedWon ??
      payload.amountPerPerson,
  );

  const declaredTotal = readDeclaredGroupTotal(payload);
  const legacyTotal = readLegacyMaybeTotal(payload);

  if (payload.isTotal === true && explicitPP != null && explicitPP >= 0) {
    return Math.round(explicitPP / people);
  }

  if (unit === "total" || unit === "group" || unit === "all") {
    const t =
      declaredTotal ??
      legacyTotal ??
      (explicitPP != null && explicitPP >= 0 ? explicitPP : null);
    if (t != null && t >= 0) {
      return Math.round(t / people);
    }
  }

  if (unit === "per_person" || unit === "perperson" || unit === "each") {
    if (explicitPP != null && explicitPP >= 0) {
      return Math.round(explicitPP);
    }
    const t = declaredTotal ?? legacyTotal;
    if (t != null && t >= 0) {
      return Math.round(t / people);
    }
  }

  const total = declaredTotal ?? legacyTotal;

  if (explicitPP != null && explicitPP >= 0) {
    if (total != null && total > 0 && people > 1) {
      const sameish = Math.abs(explicitPP - total) / total;
      if (sameish < 0.02) {
        return Math.round(total / people);
      }
      const impliedTotal = explicitPP * people;
      const matchImplied = Math.abs(impliedTotal - total) / total;
      if (matchImplied < 0.08) {
        return Math.round(explicitPP);
      }
    }
    return Math.round(explicitPP);
  }

  if (total != null && total >= 0) {
    return Math.round(total / people);
  }

  return null;
}
