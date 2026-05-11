import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AgreementV4,
  Asset,
  Badge,
  BottomCTA,
  Button,
  CTAButton,
  FixedBottomCTA,
  List,
  ListHeader,
  ListRow,
  Post,
  ProgressBar,
  ProgressStep,
  ProgressStepper,
  Rating,
  Spacing,
  StepperRow,
  Text,
  TextField,
  Top,
} from "@toss/tds-mobile";
import { adaptive } from "@toss/tds-colors";
import { setClipboardText, SetClipboardTextPermissionError } from "@apps-in-toss/web-framework";
import { headcountPeopleFromLabel, resolveSpendEstimate } from "./spendEstimate";
import "./App.css";

const NICKNAME_STORAGE_KEY = "bikonomy_nickname";
const HIVE_INVITE_STORAGE_KEY = "bikonomy_hive_invite_id";

function readStoredNickname(): string {
  try {
    return localStorage.getItem(NICKNAME_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

const CALENDAR_EVENTS_KEY = "bikonomy_calendar_events";

type RecurrenceFrequency = "none" | "daily" | "weekly" | "monthly";

type CalendarEventRecord = {
  id: string;
  year: number;
  monthIndex: number;
  day: number;
  /** 포함 종료일(여행 등). 없으면 시작일 하루만 */
  endYear?: number;
  endMonthIndex?: number;
  endDay?: number;
  title: string;
  timeLabel: string;
  headcountLabel: string;
  estimatedWonPerPerson: number | null;
  /** 예상 소비 카테고리(복수). `joinSpendCategories` 형식, 없으면 생략·빈 문자열 */
  plannedSpendCategories?: string;
  /** 반복 없음 생략. 반복 시 종료일은 캘린더 표시에 쓰이지 않고 시작일 기준으로만 반복 */
  recurrence?: RecurrenceFrequency;
  /** true면 소비 입력 대상·예산 초과 알림에서 제외(월급일 등) */
  excludeFromSpendTracking?: boolean;
};

function isCalendarEventRecord(x: unknown): x is CalendarEventRecord {
  if (x == null || typeof x !== "object") {
    return false;
  }
  const o = x as Record<string, unknown>;
  const base =
    typeof o.id === "string" &&
    typeof o.year === "number" &&
    typeof o.monthIndex === "number" &&
    typeof o.day === "number" &&
    typeof o.title === "string" &&
    typeof o.timeLabel === "string" &&
    typeof o.headcountLabel === "string" &&
    (o.estimatedWonPerPerson === null || typeof o.estimatedWonPerPerson === "number");
  if (!base) {
    return false;
  }
  if (o.plannedSpendCategories !== undefined && typeof o.plannedSpendCategories !== "string") {
    return false;
  }
  if (o.recurrence !== undefined && o.recurrence !== null) {
    if (o.recurrence !== "none" && o.recurrence !== "daily" && o.recurrence !== "weekly" && o.recurrence !== "monthly") {
      return false;
    }
  }
  if (o.excludeFromSpendTracking !== undefined && typeof o.excludeFromSpendTracking !== "boolean") {
    return false;
  }
  const ey = o.endYear;
  const em = o.endMonthIndex;
  const ed = o.endDay;
  const none = ey === undefined && em === undefined && ed === undefined;
  if (none) {
    return true;
  }
  if (typeof ey !== "number" || typeof em !== "number" || typeof ed !== "number") {
    return false;
  }
  if (!Number.isFinite(ey) || em < 0 || em > 11 || ed < 1) {
    return false;
  }
  const dimEnd = new Date(ey, em + 1, 0).getDate();
  if (ed > dimEnd) {
    return false;
  }
  const sy = o.year as number;
  const sm = o.monthIndex as number;
  const sd = o.day as number;
  return new Date(ey, em, ed).getTime() >= new Date(sy, sm, sd).getTime();
}

function readStoredCalendarEvents(): CalendarEventRecord[] {
  try {
    const raw = localStorage.getItem(CALENDAR_EVENTS_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isCalendarEventRecord);
  } catch {
    return [];
  }
}

function newCalendarEventId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `ev-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
}

function readOrCreateHiveInviteId(): string {
  try {
    const existing = localStorage.getItem(HIVE_INVITE_STORAGE_KEY);
    if (existing && existing.length > 0) {
      return existing;
    }
    const id = newCalendarEventId();
    localStorage.setItem(HIVE_INVITE_STORAGE_KEY, id);
    return id;
  } catch {
    return `hive-${Date.now()}`;
  }
}

/** 토스 미니앱(WebView)은 `navigator.clipboard`가 동작하지 않을 수 있어 `setClipboardText`를 우선 사용 */
async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await setClipboardText(text);
    return true;
  } catch (err) {
    if (err instanceof SetClipboardTextPermissionError) {
      try {
        const again = await setClipboardText.openPermissionDialog();
        if (again === "allowed") {
          await setClipboardText(text);
          return true;
        }
      } catch {
        // fall through to 웹 API
      }
    }
  }
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.width = "1px";
    ta.style.height = "1px";
    ta.style.opacity = "0";
    ta.style.pointerEvents = "none";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

const SPEND_ENTRIES_KEY = "bikonomy_spend_entries";
/** 설문 완료 시 저장 — 홈 복귀 후에도 꿀단지·공유 링크에 소비 유형 반영 */
const SURVEY_RESULT_PATH_KEY = "bikonomy_survey_consumer_path";
const HONEY_JAR_INDEX_KEY = "bikonomy_honey_jar_index";
const BUDGET_MONTH_KEY = "bikonomy_budget_month";
const BUDGET_VALUE_KEY = "bikonomy_budget_value";
const HONEY_JAR_INDEX_DEFAULT = 0;
/** 소비 칭찬/경고 알림 1회당 지수 변화 (0~100 누적) */
const HONEY_JAR_INDEX_DELTA = 6;
/** 같은 알림 상태(일정·예산·총액)로 꿀단지를 두 번 깎지 않음 */
const HONEY_FEEDBACK_APPLIED_KEY = "bikonomy_honey_feedback_applied_v1";

function readStoredHoneyJarIndex(): number {
  try {
    const raw = localStorage.getItem(HONEY_JAR_INDEX_KEY);
    if (raw == null || raw === "") {
      return HONEY_JAR_INDEX_DEFAULT;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      return HONEY_JAR_INDEX_DEFAULT;
    }
    return Math.min(100, Math.max(0, Math.round(n)));
  } catch {
    return HONEY_JAR_INDEX_DEFAULT;
  }
}

function readHoneyFeedbackAppliedKeys(): Set<string> {
  try {
    const raw = localStorage.getItem(HONEY_FEEDBACK_APPLIED_KEY);
    if (!raw) {
      return new Set();
    }
    const p = JSON.parse(raw) as unknown;
    if (!Array.isArray(p)) {
      return new Set();
    }
    return new Set(p.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

function appendHoneyFeedbackAppliedKey(key: string) {
  const s = readHoneyFeedbackAppliedKeys();
  s.add(key);
  try {
    localStorage.setItem(HONEY_FEEDBACK_APPLIED_KEY, JSON.stringify([...s].slice(-200)));
  } catch {
    // ignore quota / private mode
  }
}

function wasHoneyFeedbackKeyApplied(key: string): boolean {
  return readHoneyFeedbackAppliedKeys().has(key);
}

function formatYearMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function readStoredBudgetMonth(): string | null {
  try {
    const m = localStorage.getItem(BUDGET_MONTH_KEY);
    return m != null && /^\d{4}-\d{2}$/.test(m) ? m : null;
  } catch {
    return null;
  }
}

function readStoredBudgetValue(): string {
  try {
    return localStorage.getItem(BUDGET_VALUE_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeBudgetPersist(monthYm: string, value: string): void {
  try {
    localStorage.setItem(BUDGET_MONTH_KEY, monthYm);
    localStorage.setItem(BUDGET_VALUE_KEY, value);
  } catch {
    // ignore quota / private mode
  }
}

function clearBudgetPersist(): void {
  try {
    localStorage.removeItem(BUDGET_MONTH_KEY);
    localStorage.removeItem(BUDGET_VALUE_KEY);
  } catch {
    // ignore
  }
}

const SPEND_CATEGORIES = [
  "식비",
  "카페·간식",
  "교통",
  "쇼핑",
  "문화·여가",
  "구독·OTT",
  "의료",
  "기타",
] as const;

/** 여러 카테고리를 한 필드에 저장할 때 쓰는 구분자(라벨 문자열에 안 쓰임) */
const SPEND_CATEGORY_SEP = "\x1e";

function joinSpendCategories(selected: string[]): string {
  const order = new Map<string, number>(SPEND_CATEGORIES.map((c, i) => [c, i]));
  const sorted = [...selected].sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99));
  return sorted.join(SPEND_CATEGORY_SEP);
}

function splitSpendCategoriesStored(stored: string): string[] {
  if (!stored) {
    return [];
  }
  const known = new Set<string>(SPEND_CATEGORIES);
  return stored.split(SPEND_CATEGORY_SEP).filter(c => known.has(c));
}

/** 구독·OTT는 AI 추정 대신 1인당 금액을 직접 받음 */
function planIncludesSubscriptionOtt(selectedCategories: string[]): boolean {
  return selectedCategories.includes("구독·OTT");
}

function formatSpendCategoryLabel(stored: string): string {
  const parts = splitSpendCategoriesStored(stored);
  return parts.length > 0 ? parts.join(", ") : "—";
}

function formatEventPlannedCategoriesShort(ev: CalendarEventRecord): string | null {
  const parts = splitSpendCategoriesStored(ev.plannedSpendCategories ?? "");
  if (parts.length === 0) {
    return null;
  }
  const head = parts.slice(0, 3).join(" · ");
  return parts.length > 3 ? `${head} …` : head;
}

function totalSpentWonAll(entries: SpendEntryRecord[]): number {
  return entries.reduce((sum, e) => sum + (Number.isFinite(e.amountWon) ? e.amountWon : 0), 0);
}

function formatSignedWon(amount: number): string {
  const n = Math.round(amount);
  const sign = n < 0 ? "-" : "";
  return `${sign}${priceFormat.transform(Math.abs(n))}원`;
}

type SpendEntryRecord = {
  id: string;
  eventId: string;
  amountWon: number;
  category: string;
  rating: number;
  /** 반복 일정의 특정 회차(YYYY-MM-DD). 없으면 일반 일정 1건 */
  occurrenceYmd?: string;
};

function isSpendEntryRecord(x: unknown): x is SpendEntryRecord {
  if (x == null || typeof x !== "object") {
    return false;
  }
  const o = x as Record<string, unknown>;
  if (o.occurrenceYmd !== undefined && typeof o.occurrenceYmd !== "string") {
    return false;
  }
  return (
    typeof o.id === "string" &&
    typeof o.eventId === "string" &&
    typeof o.amountWon === "number" &&
    typeof o.category === "string" &&
    typeof o.rating === "number"
  );
}

function readStoredSpendEntries(): SpendEntryRecord[] {
  try {
    const raw = localStorage.getItem(SPEND_ENTRIES_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isSpendEntryRecord);
  } catch {
    return [];
  }
}

function newSpendEntryId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `sp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
}

const SIREN_LOTTIE_SRC = "https://static.toss.im/lotties-common/siren-2-spot.json";

/** AI 1인당 예상 × 인원(추정) = 이번 일정 예상 총액 */
function estimatedBudgetWonForEvent(ev: CalendarEventRecord): number | null {
  if (ev.excludeFromSpendTracking) {
    return null;
  }
  if ((ev.recurrence ?? "none") !== "none") {
    return null;
  }
  if (ev.estimatedWonPerPerson == null || !Number.isFinite(ev.estimatedWonPerPerson)) {
    return null;
  }
  const people = Math.max(1, headcountPeopleFromLabel(ev.headcountLabel));
  return Math.round(ev.estimatedWonPerPerson * people);
}

function totalSpentWonForEvent(eventId: string, entries: SpendEntryRecord[]): number {
  return entries.filter(e => e.eventId === eventId).reduce((sum, e) => sum + e.amountWon, 0);
}

/** 같은 초과 상태(항목·예산·총 소비)로는 캘린더 들어올 때 경고를 반복하지 않음 */
const SPEND_OVER_DISMISS_KEY = "bikonomy_spend_over_dismiss_v1";

type SpendOverDismissRecord = { eventId: string; cap: number; spent: number };

function readSpendOverDismissRecords(): SpendOverDismissRecord[] {
  try {
    const raw = localStorage.getItem(SPEND_OVER_DISMISS_KEY);
    if (!raw) {
      return [];
    }
    const p = JSON.parse(raw) as unknown;
    if (!Array.isArray(p)) {
      return [];
    }
    return p.filter((x): x is SpendOverDismissRecord => {
      if (x == null || typeof x !== "object") {
        return false;
      }
      const o = x as Record<string, unknown>;
      return (
        typeof o.eventId === "string" &&
        typeof o.cap === "number" &&
        typeof o.spent === "number" &&
        Number.isFinite(o.cap) &&
        Number.isFinite(o.spent)
      );
    });
  } catch {
    return [];
  }
}

function writeSpendOverDismissRecords(rows: SpendOverDismissRecord[]) {
  try {
    localStorage.setItem(SPEND_OVER_DISMISS_KEY, JSON.stringify(rows));
  } catch {
    // ignore quota / private mode
  }
}

function recordSpendOverDismiss(eventId: string, cap: number, spent: number) {
  const c = Math.round(cap);
  const s = Math.round(spent);
  const next = readSpendOverDismissRecords().filter(r => r.eventId !== eventId);
  next.push({ eventId, cap: c, spent: s });
  writeSpendOverDismissRecords(next.slice(-80));
}

function findSpendOverEventIdForAutoAlert(
  events: CalendarEventRecord[],
  entries: SpendEntryRecord[],
): string | null {
  const dismissed = new Set(
    readSpendOverDismissRecords().map(r => `${r.eventId}\t${r.cap}\t${r.spent}`),
  );
  let bestId: string | null = null;
  let bestOver = 0;
  for (const ev of events) {
    const cap = estimatedBudgetWonForEvent(ev);
    if (cap == null || cap <= 0) {
      continue;
    }
    const spent = totalSpentWonForEvent(ev.id, entries);
    if (spent <= cap) {
      continue;
    }
    const c = Math.round(cap);
    const s = Math.round(spent);
    if (dismissed.has(`${ev.id}\t${c}\t${s}`)) {
      continue;
    }
    const over = spent - cap;
    if (bestId == null || over > bestOver) {
      bestId = ev.id;
      bestOver = over;
    }
  }
  return bestId;
}

function eventHasSpendEntry(eventId: string, entries: SpendEntryRecord[], occurrenceYmd?: string | null): boolean {
  return entries.some(e => {
    if (e.eventId !== eventId) {
      return false;
    }
    if (occurrenceYmd != null && occurrenceYmd !== "") {
      return e.occurrenceYmd === occurrenceYmd;
    }
    return e.occurrenceYmd == null || e.occurrenceYmd === "";
  });
}

type SpendPickerSlot = {
  eventId: string;
  occurrenceYmd: string | null;
  sortTs: number;
};

function spendOccYmdFromParts(yr: number, mo: number, d: number): string {
  return `${yr}-${String(mo + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** 소비가 귀속되는 일(YYYY-MM-DD). 반복 회차는 occurrenceYmd, 그 외는 일정 시작일 */
function spendEntryAttributedYmd(entry: SpendEntryRecord, events: CalendarEventRecord[]): string | null {
  if (entry.occurrenceYmd != null && entry.occurrenceYmd !== "" && /^\d{4}-\d{2}-\d{2}$/.test(entry.occurrenceYmd)) {
    return entry.occurrenceYmd;
  }
  const ev = events.find(e => e.id === entry.eventId);
  if (ev == null) {
    return null;
  }
  return spendOccYmdFromParts(ev.year, ev.monthIndex, ev.day);
}

function spendEntryInCalendarMonth(
  entry: SpendEntryRecord,
  events: CalendarEventRecord[],
  year: number,
  monthIndex: number,
): boolean {
  const ymd = spendEntryAttributedYmd(entry, events);
  if (ymd == null) {
    return false;
  }
  const p = ymd.split("-").map(Number);
  if (p.length !== 3 || !p.every(n => Number.isFinite(n))) {
    return false;
  }
  return p[0] === year && p[1] - 1 === monthIndex;
}

function filterSpendEntriesInMonth(
  entries: SpendEntryRecord[],
  events: CalendarEventRecord[],
  year: number,
  monthIndex: number,
): SpendEntryRecord[] {
  return entries.filter(e => spendEntryInCalendarMonth(e, events, year, monthIndex));
}

function advanceRecurringOne(
  freq: Exclude<RecurrenceFrequency, "none">,
  cy: number,
  cm: number,
  cd: number,
  anchorDay: number,
): { y: number; m: number; d: number } {
  if (freq === "daily") {
    const t = new Date(cy, cm, cd + 1);
    return { y: t.getFullYear(), m: t.getMonth(), d: t.getDate() };
  }
  if (freq === "weekly") {
    const t = new Date(cy, cm, cd + 7);
    return { y: t.getFullYear(), m: t.getMonth(), d: t.getDate() };
  }
  const nm = new Date(cy, cm + 1, 1);
  const dim = daysInMonthCount(nm.getFullYear(), nm.getMonth());
  return { y: nm.getFullYear(), m: nm.getMonth(), d: Math.min(anchorDay, dim) };
}

function collectSpendPickerSlots(
  events: CalendarEventRecord[],
  entries: SpendEntryRecord[],
  now: Date,
): SpendPickerSlot[] {
  const slots: SpendPickerSlot[] = [];
  const nowTs = now.getTime();
  for (const ev of events) {
    if (ev.excludeFromSpendTracking) {
      continue;
    }
    const freq = calendarEventRecurrence(ev);
    if (freq === "none") {
      if (!isCalendarEventPastForSpend(ev, now)) {
        continue;
      }
      if (eventHasSpendEntry(ev.id, entries, null)) {
        continue;
      }
      slots.push({
        eventId: ev.id,
        occurrenceYmd: null,
        sortTs: calendarEventLastDayEndTs(ev),
      });
      continue;
    }
    const anchorDay = ev.day;
    let cy = ev.year;
    let cm = ev.monthIndex;
    let cd = ev.day;
    for (let i = 0; i < 500; i++) {
      const endOcc = new Date(cy, cm, cd, 23, 59, 59, 999).getTime();
      if (endOcc > nowTs) {
        break;
      }
      const occ = spendOccYmdFromParts(cy, cm, cd);
      if (!eventHasSpendEntry(ev.id, entries, occ)) {
        slots.push({ eventId: ev.id, occurrenceYmd: occ, sortTs: endOcc });
      }
      const nxt = advanceRecurringOne(freq, cy, cm, cd, anchorDay);
      cy = nxt.y;
      cm = nxt.m;
      cd = nxt.d;
    }
  }
  slots.sort((a, b) => b.sortTs - a.sortTs);
  return slots;
}

/** 한 소비에 여러 카테고리면 금액을 균등 분배해 합산(카테고리 합 = 해당 소비들의 총액) */
function aggregateSpendByCategory(entries: SpendEntryRecord[]): { category: string; won: number }[] {
  const map = new Map<string, number>();
  for (const e of entries) {
    const amt = Number.isFinite(e.amountWon) ? e.amountWon : 0;
    if (amt <= 0) {
      continue;
    }
    const cats = splitSpendCategoriesStored(e.category);
    if (cats.length === 0) {
      continue;
    }
    const share = amt / cats.length;
    for (const c of cats) {
      map.set(c, (map.get(c) ?? 0) + share);
    }
  }
  const rows = SPEND_CATEGORIES.map(c => ({
    category: c,
    won: Math.round(map.get(c) ?? 0),
  })).filter(x => x.won > 0);
  rows.sort((a, b) => b.won - a.won);
  return rows;
}

type CalendarFlowMode =
  | "calendar"
  | "pickDate"
  | "addEvent"
  | "eventEstimate"
  | "eventManualAmount"
  | "spendOverAlert"
  | "spendPraiseAlert";

type Screen =
  | "welcome"
  | "nickname"
  | "budget"
  | "home"
  | "honeyChallenge"
  | "calendar"
  | "survey"
  | "surveyQuiz"
  | "surveyLoading"
  | "surveyResult";

/** 이전 3문항 설문 경로(로컬에 남아 있을 수 있음) → 5가지 소비 유형 */
const LEGACY_PATH_TO_CONSUMER_TYPE: Record<string, ConsumerTypeId> = {
  AAA: "honey_impulse",
  AAB: "honey_planner",
  ABA: "honey_balanced",
  ABB: "honey_saver",
  BAA: "honey_free",
  BAB: "honey_planner",
  BBA: "honey_balanced",
  BBB: "honey_saver",
};

const SURVEY_QUESTION_COUNT = 7;

/** 7문항 A/B. 각 문항은 5유형(저축·고집·자린고비·과시·충동)에 가중치를 더함 */
const SURVEY_QUESTIONS: { title: string; optionA: string; optionB: string }[] = [
  {
    title: "소비를 시작할 때 나의 마음가짐에 더 가까운 쪽은?",
    optionA: "[A] 예산과 계획 안에서 통제해야 마음이 편하다.",
    optionB: "[B] 꽂히면 일단 사야 직성이 풀린다.",
  },
  {
    title: "맞춤 혜택·추천을 받았을 때 나는?",
    optionA: "[A] 꿀팁이면 적극 참고하고, 합리적이면 수용하는 편이다.",
    optionB: "[B] 참고는 하지만 결제는 내 취향·고집대로 가는 편이다.",
  },
  {
    title: "돈에 대한 나의 궁극적인 스탠스는?",
    optionA: "[A] 나를 위한 보상과 지금의 만족이 먼저다.",
    optionB: "[B] 저축과 미래 든든함, 절약이 먼저다.",
  },
  {
    title: "쇼핑할 때 가격·할인에 대한 나는?",
    optionA: "[A] 가격 비교·할인·최저가를 찾는 과정이 꽤 재미있다.",
    optionB: "[B] 마음에 드면 비교는 대충하고 빨리 결정하고 싶다.",
  },
  {
    title: "지름신이 올 때 더 끌리는 쪽은?",
    optionA: "[A] 브랜드·디자인·남에게 보일 멋이 있다.",
    optionB: "[B] 나만 알면 되는 실속·기능이 있다.",
  },
  {
    title: "스트레스가 쌓인 날, 지출과 가까운 나는?",
    optionA: "[A] 쇼핑·배송이 오면 기분이 한결 나아진다.",
    optionB: "[B] 지출보다 산책·잠·취미로 푸는 편이다.",
  },
  {
    title: "결제 직전 나의 습관에 가까운 쪽은?",
    optionA: "[A] 한 번 더 생각하거나 장바구니에 두고 돌아본다.",
    optionB: "[B] 망설임 없이 바로 결제하는 편이다.",
  },
];

/** 문항별 A/B 선택 시 각 유형에 더할 점수 (정의된 5유형 성향 반영) */
const SURVEY_SCORE_WEIGHTS: {
  a: Partial<Record<ConsumerTypeId, number>>;
  b: Partial<Record<ConsumerTypeId, number>>;
}[] = [
  { a: { honey_planner: 2, honey_saver: 1 }, b: { honey_free: 2, honey_impulse: 1 } },
  { a: { honey_planner: 1, honey_saver: 1 }, b: { honey_balanced: 2 } },
  { a: { honey_impulse: 1, honey_free: 2 }, b: { honey_planner: 2, honey_saver: 2 } },
  { a: { honey_saver: 3 }, b: { honey_free: 2, honey_impulse: 1 } },
  { a: { honey_impulse: 3 }, b: { honey_saver: 1, honey_balanced: 1 } },
  { a: { honey_free: 3 }, b: { honey_planner: 1, honey_saver: 1 } },
  { a: { honey_planner: 2, honey_saver: 1 }, b: { honey_free: 1, honey_impulse: 2 } },
];

const SURVEY_SCORE_TIE_ORDER: ConsumerTypeId[] = [
  "honey_planner",
  "honey_saver",
  "honey_impulse",
  "honey_free",
  "honey_balanced",
];

function emptyConsumerScores(): Record<ConsumerTypeId, number> {
  return {
    honey_planner: 0,
    honey_balanced: 0,
    honey_saver: 0,
    honey_impulse: 0,
    honey_free: 0,
  };
}

/** 7글자 A/B 답 → 점수 합산으로 5유형 중 1개 */
function consumerTypeFromSurveyAnswers(path: string): ConsumerTypeId {
  const scores = emptyConsumerScores();
  const n = Math.min(SURVEY_QUESTION_COUNT, path.length);
  for (let i = 0; i < n; i++) {
    const bit = path[i];
    const w = SURVEY_SCORE_WEIGHTS[i];
    const add = bit === "A" ? w.a : w.b;
    for (const id of SURVEY_SCORE_TIE_ORDER) {
      const v = add[id];
      if (v != null) {
        scores[id] += v;
      }
    }
  }
  let bestScore = -1;
  let best: ConsumerTypeId = "honey_balanced";
  for (const id of SURVEY_SCORE_TIE_ORDER) {
    if (scores[id] > bestScore) {
      bestScore = scores[id];
      best = id;
    }
  }
  return best;
}

type ConsumerTypeId =
  | "honey_planner"
  | "honey_balanced"
  | "honey_saver"
  | "honey_impulse"
  | "honey_free";

const CONSUMER_TYPES: Record<
  ConsumerTypeId,
  { label: string; description: string; emoji: string }
> = {
  honey_planner: {
    label: "저축형 소비자",
    description:
      "저축형 소비자는 지금 당장 필요하지 않으면 지갑을 열지 않는 타입이에요.",
    emoji: "u1F603",
  },
  honey_balanced: {
    label: "고집형 소비자",
    description:
      "고집형 소비자는 유행이나 한 번 꽂힌 브랜드나 물건은 주변에서 아무리 말려도 기어코 사고야 마는 뚝심이 있어요.",
    emoji: "u1F624",
  },
  honey_saver: {
    label: "자린고비형 소비자",
    description:
      "자린고비형 소비자는 최저가를 찾는 것을 즐기며 지출을 최소화하는 데 모든 에너지를 쏟아요.",
    emoji: "u1F635_u200D_u1F4AB",
  },
  honey_impulse: {
    label: "과시형 소비자",
    description:
      "과시형 소비자는 남들에게 보여지는 내 모습에 아낌없이 투자하는 타입이에요. 사람들의 시선을 끌 수 있는 화려하고 비싼 물건을 살 때 가장 큰 행복을 느껴요.",
    emoji: "u1F911",
  },
  honey_free: {
    label: "충동형 소비자",
    description:
      "충동형 소비자는 지금 당장 사야 직성이 풀려요! 스트레스 받을 때 지갑이 열리는 타입이에요.",
    emoji: "u1FAE9",
  },
};

function resolveConsumerType(path: string): ConsumerTypeId {
  if (path.length === 3) {
    const legacy = LEGACY_PATH_TO_CONSUMER_TYPE[path];
    if (legacy != null) {
      return legacy;
    }
  }
  if (path.length >= SURVEY_QUESTION_COUNT) {
    return consumerTypeFromSurveyAnswers(path.slice(0, SURVEY_QUESTION_COUNT));
  }
  return "honey_balanced";
}

function buildHoneyChallengeInviteUrl(inviteId: string, consumerTypeId: ConsumerTypeId | null): string {
  const url = new URL(window.location.href);
  url.searchParams.set("hive", inviteId);
  if (consumerTypeId != null) {
    url.searchParams.set("ct", consumerTypeId);
  } else {
    url.searchParams.delete("ct");
  }
  return url.toString();
}

function isConsumerTypeId(id: string): id is ConsumerTypeId {
  return Object.prototype.hasOwnProperty.call(CONSUMER_TYPES, id);
}

function parseConsumerTypeQueryParam(value: string | null): ConsumerTypeId | null {
  if (value == null || value === "") {
    return null;
  }
  return isConsumerTypeId(value) ? value : null;
}

/**
 * 친구가 공유한 링크(?hive=…&ct=…)로 연 경우.
 * 내 초대 링크를 내 기기에서 열면 null(일반 꿀단지 화면).
 */
function parseHoneyFriendShareFromUrl(): { consumerTypeId: ConsumerTypeId } | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const u = new URL(window.location.href);
    const hive = u.searchParams.get("hive");
    const ct = parseConsumerTypeQueryParam(u.searchParams.get("ct"));
    if (hive == null || hive === "" || ct == null) {
      return null;
    }
    const myInvite = readOrCreateHiveInviteId();
    if (hive === myInvite) {
      return null;
    }
    return { consumerTypeId: ct };
  } catch {
    return null;
  }
}

function readStoredSurveyResultPath(): string | null {
  try {
    const raw = localStorage.getItem(SURVEY_RESULT_PATH_KEY);
    if (raw == null || raw === "") {
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

function writeStoredSurveyResultPath(path: string | null) {
  try {
    if (path == null || path === "") {
      localStorage.removeItem(SURVEY_RESULT_PATH_KEY);
    } else {
      localStorage.setItem(SURVEY_RESULT_PATH_KEY, path);
    }
  } catch {
    // ignore
  }
}

const APP_ICON =
  "https://static.toss.im/appsintoss/31139/53105092-e2a9-454b-8a6e-eb7808a98977.png";
const BEE_EMOJI = "https://static.toss.im/2d-emojis/png/4x/u1F41D.png";
const HAND_EMOJI = "https://static.toss.im/2d-emojis/png/4x/u1F590_u1F3FC.png";
const HONEY_EMOJI = "https://static.toss.im/2d-emojis/png/4x/u1F36F.png";
const SURVEY_LOADING_COIN = "https://static.toss.im/3d/coin-dollar-apng.png";
const SUN_EMOJI_3D = "https://static.toss.im/3d-emojis/u1F31E.png";
const HONEY_JAR_HERO_IMG =
  "https://static.toss.im/ml-product/tosst-inapp_nptcll2734q5za0fq2003it8.png";
/** 캘린더 하단 「n일 소비」내역 카드에 표시 */
const CALENDAR_SPEND_MONEY_EMOJI = "https://static.toss.im/2d-emojis/png/4x/u1F4B0.png";
const priceFormat = {
  transform: (value: string | number) =>
    `${value}`.replace(/\D/g, "").replace(/\B(?=(\d{3})+(?!\d))/g, ","),
  reset: (value: string | number) => `${value}`.replace(/\D/g, ""),
};

function calendarEventStartOfDayTs(ev: CalendarEventRecord): number {
  return new Date(ev.year, ev.monthIndex, ev.day).getTime();
}

/** 포함 종료일의 0시 타임스탬프(없으면 시작일) */
function calendarEventEndInclusiveStartTs(ev: CalendarEventRecord): number {
  if (
    ev.endYear != null &&
    ev.endMonthIndex != null &&
    ev.endDay != null &&
    Number.isFinite(ev.endYear) &&
    ev.endMonthIndex >= 0 &&
    ev.endMonthIndex <= 11 &&
    ev.endDay >= 1
  ) {
    const dim = new Date(ev.endYear, ev.endMonthIndex + 1, 0).getDate();
    if (ev.endDay <= dim) {
      return new Date(ev.endYear, ev.endMonthIndex, ev.endDay).getTime();
    }
  }
  return calendarEventStartOfDayTs(ev);
}

/** 포함 종료일의 연·월·일(검증은 calendarEventEndInclusiveStartTs와 동일 전제) */
function calendarEventEndYmd(ev: CalendarEventRecord): { y: number; m: number; d: number } {
  if (
    ev.endYear != null &&
    ev.endMonthIndex != null &&
    ev.endDay != null &&
    Number.isFinite(ev.endYear) &&
    ev.endMonthIndex >= 0 &&
    ev.endMonthIndex <= 11 &&
    ev.endDay >= 1
  ) {
    const dim = new Date(ev.endYear, ev.endMonthIndex + 1, 0).getDate();
    if (ev.endDay <= dim) {
      return { y: ev.endYear, m: ev.endMonthIndex, d: ev.endDay };
    }
  }
  return { y: ev.year, m: ev.monthIndex, d: ev.day };
}

/** 마지막 일정일 로컬 23:59:59.999 — 이 시각이 지나면 소비 입력에서 「지난 일정」으로 간주 */
function calendarEventLastDayEndTs(ev: CalendarEventRecord): number {
  const { y, m, d } = calendarEventEndYmd(ev);
  return new Date(y, m, d, 23, 59, 59, 999).getTime();
}

function isCalendarEventPastForSpend(ev: CalendarEventRecord, now: Date): boolean {
  return calendarEventLastDayEndTs(ev) < now.getTime();
}

function calendarEventRecurrence(ev: CalendarEventRecord): RecurrenceFrequency {
  const r = ev.recurrence;
  if (r === "daily" || r === "weekly" || r === "monthly") {
    return r;
  }
  return "none";
}

function calendarEventCoversDay(ev: CalendarEventRecord, y: number, m: number, day: number): boolean {
  const freq = calendarEventRecurrence(ev);
  if (freq === "none") {
    const t = new Date(y, m, day).getTime();
    return t >= calendarEventStartOfDayTs(ev) && t <= calendarEventEndInclusiveStartTs(ev);
  }
  const anchor = new Date(ev.year, ev.monthIndex, ev.day);
  anchor.setHours(0, 0, 0, 0);
  const cell = new Date(y, m, day);
  cell.setHours(0, 0, 0, 0);
  if (cell.getTime() < anchor.getTime()) {
    return false;
  }
  if (freq === "daily") {
    return true;
  }
  if (freq === "weekly") {
    const diffDays = Math.round((cell.getTime() - anchor.getTime()) / 86400000);
    return diffDays >= 0 && diffDays % 7 === 0;
  }
  const dim = daysInMonthCount(y, m);
  const dom = Math.min(ev.day, dim);
  return day === dom;
}

function calendarEventIsMultiDay(ev: CalendarEventRecord): boolean {
  if (calendarEventRecurrence(ev) !== "none") {
    return false;
  }
  return calendarEventEndInclusiveStartTs(ev) > calendarEventStartOfDayTs(ev);
}

function eventOverlapsCalendarMonth(ev: CalendarEventRecord, y: number, m: number): boolean {
  const dim = new Date(y, m + 1, 0).getDate();
  for (let d = 1; d <= dim; d++) {
    if (calendarEventCoversDay(ev, y, m, d)) {
      return true;
    }
  }
  return false;
}

function formatCalendarEventDateHead(ev: CalendarEventRecord): string {
  if (!calendarEventIsMultiDay(ev)) {
    return `${ev.day}일`;
  }
  const ey = ev.endYear as number;
  const em = ev.endMonthIndex as number;
  const ed = ev.endDay as number;
  if (ev.year === ey && ev.monthIndex === em) {
    return `${ev.day}일–${ed}일`;
  }
  return `${ev.monthIndex + 1}/${ev.day}–${em + 1}/${ed}`;
}

function formatYmdRangeLine(
  sy: number,
  sm: number,
  sd: number,
  ey?: number,
  em?: number,
  ed?: number,
): string {
  if (ey == null || em == null || ed == null) {
    return `${sy}년 ${sm + 1}월 ${sd}일`;
  }
  const s = new Date(sy, sm, sd).getTime();
  const e = new Date(ey, em, ed).getTime();
  if (e <= s) {
    return `${sy}년 ${sm + 1}월 ${sd}일`;
  }
  if (sy === ey && sm === em) {
    return `${sy}년 ${sm + 1}월 ${sd}일–${ed}일`;
  }
  return `${sy}년 ${sm + 1}월 ${sd}일–${ey}년 ${em + 1}월 ${ed}일`;
}

function formatCalendarEventDateLine(ev: CalendarEventRecord): string {
  return formatYmdRangeLine(ev.year, ev.monthIndex, ev.day, ev.endYear, ev.endMonthIndex, ev.endDay);
}

/** 달력 셀 안에서 이웃한 날과 이어지는 형광펜 막대(멀티데이만) */
function calendarEventRangeStripCaps(
  ev: CalendarEventRecord,
  y: number,
  m: number,
  day: number,
): { roundLeft: boolean; roundRight: boolean } | null {
  if (!calendarEventIsMultiDay(ev) || !calendarEventCoversDay(ev, y, m, day)) {
    return null;
  }
  const prev = new Date(y, m, day - 1);
  const next = new Date(y, m, day + 1);
  const prevIn = calendarEventCoversDay(ev, prev.getFullYear(), prev.getMonth(), prev.getDate());
  const nextIn = calendarEventCoversDay(ev, next.getFullYear(), next.getMonth(), next.getDate());
  return { roundLeft: !prevIn, roundRight: !nextIn };
}

function rangeHighlightHueFromId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  return h % 360;
}

function formatCalendarEventSubtitle(ev: CalendarEventRecord): string {
  const parts: string[] = [];
  if (ev.timeLabel.trim()) {
    parts.push(ev.timeLabel.trim());
  }
  if (ev.headcountLabel.trim()) {
    parts.push(ev.headcountLabel.trim());
  }
  if (ev.estimatedWonPerPerson != null && Number.isFinite(ev.estimatedWonPerPerson)) {
    parts.push(`1인 ${priceFormat.transform(ev.estimatedWonPerPerson)}원`);
  }
  const plannedBits = splitSpendCategoriesStored(ev.plannedSpendCategories ?? "");
  if (plannedBits.length > 0) {
    parts.push(plannedBits.join(" · "));
  }
  const freq = calendarEventRecurrence(ev);
  if (freq === "daily") {
    parts.push("매일 반복");
  } else if (freq === "weekly") {
    parts.push("매주 반복");
  } else if (freq === "monthly") {
    parts.push("매달 반복");
  }
  if (ev.excludeFromSpendTracking) {
    parts.push("소비 집계 제외");
  }
  return parts.length > 0 ? parts.join(" · ") : "세부 정보 없음";
}

function formatCalendarListRowDetail(ev: CalendarEventRecord): string {
  const sub = formatCalendarEventSubtitle(ev);
  const head = `${formatCalendarEventDateHead(ev)} · ${ev.title}`;
  return sub !== "세부 정보 없음" ? `${head} · ${sub}` : head;
}

const KOREAN_WEEKDAY_SHORT = ["일", "월", "화", "수", "목", "금", "토"] as const;

/** 홈 상단: 오늘 기준 앞뒤 3일씩(총 7일) 요일·일자·past/today/future */
function homeDateStripDays(today: Date): {
  key: string;
  day: string;
  date: string;
  tone: "past" | "today" | "future";
}[] {
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(todayStart);
    d.setDate(todayStart.getDate() - 3 + i);
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    let tone: "past" | "today" | "future";
    if (dayStart.getTime() < todayStart.getTime()) {
      tone = "past";
    } else if (dayStart.getTime() === todayStart.getTime()) {
      tone = "today";
    } else {
      tone = "future";
    }
    return {
      key: `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`,
      day: KOREAN_WEEKDAY_SHORT[d.getDay()],
      date: String(d.getDate()),
      tone,
    };
  });
}

/** 아직 끝나지 않았거나 오늘 이후에 시작하는 일정 중, 시작이 가장 빠른 일정 */
function findNextCalendarEventFromToday(
  events: CalendarEventRecord[],
  today: Date,
): CalendarEventRecord | null {
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const ongoingOrFuture = events.filter(ev => calendarEventEndInclusiveStartTs(ev) >= startOfToday);
  if (ongoingOrFuture.length === 0) {
    return null;
  }
  ongoingOrFuture.sort((a, b) => {
    const ta = calendarEventStartOfDayTs(a);
    const tb = calendarEventStartOfDayTs(b);
    if (ta !== tb) {
      return ta - tb;
    }
    return a.id.localeCompare(b.id);
  });
  return ongoingOrFuture[0];
}

/** 홈 '다가올 항목은?': 날짜·제목·시간만 표시 (인원·예상 금액 제외) */
function formatHomeNextEventSubtitle(ev: CalendarEventRecord): string {
  const t = ev.timeLabel.trim();
  return t ? t : "세부 정보 없음";
}

function formatHomeNextEventDetail(ev: CalendarEventRecord): string {
  const sub = formatHomeNextEventSubtitle(ev);
  const title = ev.title.trim() || "제목 없음";
  const head = `${formatCalendarEventDateLine(ev)} · ${title}`;
  return sub !== "세부 정보 없음" ? `${head} · ${sub}` : head;
}

function computeInitialAppScreen(): Screen {
  if (typeof window === "undefined") {
    return "welcome";
  }
  if (parseHoneyFriendShareFromUrl() != null) {
    return "honeyChallenge";
  }
  const nick = readStoredNickname().trim();
  if (nick === "") {
    return "welcome";
  }
  const curYm = formatYearMonth(new Date());
  const savedYm = readStoredBudgetMonth();
  const savedVal = readStoredBudgetValue().trim();
  if (savedYm !== curYm || savedVal === "") {
    return "budget";
  }
  return "home";
}

function computeInitialBudgetInput(): string {
  if (typeof window === "undefined") {
    return "";
  }
  if (parseHoneyFriendShareFromUrl() != null) {
    return "";
  }
  const nick = readStoredNickname().trim();
  if (nick === "") {
    return "";
  }
  const curYm = formatYearMonth(new Date());
  const savedYm = readStoredBudgetMonth();
  if (savedYm !== curYm) {
    return "";
  }
  return readStoredBudgetValue();
}

function App() {
  const appBoot = useMemo(() => {
    const s = computeInitialAppScreen();
    return { screen: s, agreed: s !== "welcome" };
  }, []);
  const [screen, setScreen] = useState<Screen>(appBoot.screen);
  const [agreed, setAgreed] = useState(appBoot.agreed);
  const [nickname, setNickname] = useState(() => readStoredNickname());
  const [budget, setBudget] = useState(computeInitialBudgetInput);
  const [surveyResultPath, setSurveyResultPath] = useState<string | null>(() => readStoredSurveyResultPath());
  const [calendarMode, setCalendarMode] = useState<CalendarFlowMode>("calendar");
  const [spendAlertEventId, setSpendAlertEventId] = useState<string | null>(null);
  const [openSpendEntryFromHome, setOpenSpendEntryFromHome] = useState(false);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEventRecord[]>(() =>
    readStoredCalendarEvents(),
  );
  const [spendEntries, setSpendEntries] = useState<SpendEntryRecord[]>(() => readStoredSpendEntries());
  const [honeyJarIndex, setHoneyJarIndex] = useState(() => readStoredHoneyJarIndex());
  /** 일정 추가 시 날짜 선택(pickDate)을 거쳐 addEvent로 왔으면 true — 헤더 뒤로 시 pickDate로 복귀 */
  const [calendarAddEventViaPickDate, setCalendarAddEventViaPickDate] = useState(false);

  /** 예전 기본값 50 + 알림 이력 없음 → 알림 기반 점수(0 시작)와 맞춤 */
  useLayoutEffect(() => {
    try {
      if (readHoneyFeedbackAppliedKeys().size > 0) {
        return;
      }
      const raw = localStorage.getItem(HONEY_JAR_INDEX_KEY);
      if (raw === "50") {
        localStorage.setItem(HONEY_JAR_INDEX_KEY, "0");
        setHoneyJarIndex(0);
      }
    } catch {
      // ignore
    }
  }, []);

  const consumeSpendEntryFromHome = useCallback(() => setOpenSpendEntryFromHome(false), []);

  const goToSpendEntryFromHome = useCallback(() => {
    setOpenSpendEntryFromHome(true);
    setCalendarMode("addEvent");
    setScreen("calendar");
  }, []);

  const monthlyBudgetWon = useMemo(() => {
    const digits = priceFormat.reset(budget);
    if (digits === "") {
      return null;
    }
    const n = Number(digits);
    return Number.isFinite(n) ? n : null;
  }, [budget]);

  const spendEntriesThisMonth = useMemo(() => {
    const d = new Date();
    return filterSpendEntriesInMonth(spendEntries, calendarEvents, d.getFullYear(), d.getMonth());
  }, [spendEntries, calendarEvents]);

  const totalSpentThisMonth = useMemo(
    () => totalSpentWonAll(spendEntriesThisMonth),
    [spendEntriesThisMonth],
  );

  const lastMonthSpendSummary = useMemo(() => {
    const d = new Date();
    const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    const py = prev.getFullYear();
    const pm = prev.getMonth();
    const entries = filterSpendEntriesInMonth(spendEntries, calendarEvents, py, pm);
    return {
      label: `${py}년 ${pm + 1}월`,
      total: totalSpentWonAll(entries),
      categories: aggregateSpendByCategory(entries),
    };
  }, [spendEntries, calendarEvents]);

  const remainingBudgetLabel = useMemo(() => {
    if (monthlyBudgetWon == null) {
      return "예산 미설정";
    }
    return formatSignedWon(monthlyBudgetWon - totalSpentThisMonth);
  }, [monthlyBudgetWon, totalSpentThisMonth]);

  const surveyConsumerTypeId = useMemo((): ConsumerTypeId | null => {
    if (surveyResultPath == null) {
      return null;
    }
    return resolveConsumerType(surveyResultPath);
  }, [surveyResultPath]);

  const surveyConsumerTypeLabel = useMemo(
    () => (surveyConsumerTypeId != null ? CONSUMER_TYPES[surveyConsumerTypeId].label : null),
    [surveyConsumerTypeId],
  );

  useEffect(() => {
    const trimmed = nickname.trim();
    if (!trimmed) {
      return;
    }
    try {
      localStorage.setItem(NICKNAME_STORAGE_KEY, trimmed);
    } catch {
      // ignore quota / private mode
    }
  }, [nickname]);

  useEffect(() => {
    try {
      localStorage.setItem(CALENDAR_EVENTS_KEY, JSON.stringify(calendarEvents));
    } catch {
      // ignore quota / private mode
    }
  }, [calendarEvents]);

  useEffect(() => {
    try {
      localStorage.setItem(SPEND_ENTRIES_KEY, JSON.stringify(spendEntries));
    } catch {
      // ignore quota / private mode
    }
  }, [spendEntries]);

  useEffect(() => {
    try {
      localStorage.setItem(HONEY_JAR_INDEX_KEY, String(honeyJarIndex));
    } catch {
      // ignore quota / private mode
    }
  }, [honeyJarIndex]);

  useEffect(() => {
    writeStoredSurveyResultPath(surveyResultPath);
  }, [surveyResultPath]);

  useLayoutEffect(() => {
    const nick = readStoredNickname().trim();
    if (nick === "") {
      return;
    }
    const curYm = formatYearMonth(new Date());
    const savedYm = readStoredBudgetMonth();
    if (savedYm != null && savedYm !== curYm) {
      clearBudgetPersist();
    }
  }, []);

  useEffect(() => {
    if (screen !== "calendar") {
      setCalendarMode("calendar");
      setSpendAlertEventId(null);
    }
  }, [screen]);

  useEffect(() => {
    if (screen === "calendar" && calendarMode === "calendar") {
      setCalendarAddEventViaPickDate(false);
    }
  }, [screen, calendarMode]);

  const dismissSpendFeedbackAlert = useCallback(() => {
    if (spendAlertEventId != null && calendarMode === "spendOverAlert") {
      const ev = calendarEvents.find(e => e.id === spendAlertEventId);
      const cap = ev ? estimatedBudgetWonForEvent(ev) : null;
      if (cap != null && cap > 0) {
        const spent = totalSpentWonForEvent(spendAlertEventId, spendEntries);
        if (spent > cap) {
          recordSpendOverDismiss(spendAlertEventId, cap, spent);
        }
      }
    }
    setSpendAlertEventId(null);
    setCalendarMode("addEvent");
  }, [spendAlertEventId, calendarMode, calendarEvents, spendEntries]);

  useEffect(() => {
    if (screen !== "calendar") {
      return;
    }
    if (calendarMode !== "spendOverAlert" && calendarMode !== "spendPraiseAlert") {
      return;
    }
    if (spendAlertEventId == null) {
      return;
    }
    const ev = calendarEvents.find(e => e.id === spendAlertEventId);
    if (ev == null) {
      return;
    }
    const cap = estimatedBudgetWonForEvent(ev);
    if (cap == null || cap <= 0) {
      return;
    }
    const spent = totalSpentWonForEvent(spendAlertEventId, spendEntries);
    const isOver = calendarMode === "spendOverAlert";
    if (isOver && spent <= cap) {
      return;
    }
    if (!isOver && spent > cap) {
      return;
    }
    const c = Math.round(cap);
    const s = Math.round(spent);
    const key = `${isOver ? "o" : "p"}|${spendAlertEventId}|${c}|${s}`;
    if (wasHoneyFeedbackKeyApplied(key)) {
      return;
    }
    appendHoneyFeedbackAppliedKey(key);
    setHoneyJarIndex(prev => {
      const delta = isOver ? -HONEY_JAR_INDEX_DELTA : HONEY_JAR_INDEX_DELTA;
      return Math.min(100, Math.max(0, prev + delta));
    });
  }, [screen, calendarMode, spendAlertEventId, calendarEvents, spendEntries]);

  useEffect(() => {
    if (screen !== "calendar" || calendarMode !== "calendar") {
      return;
    }
    const id = findSpendOverEventIdForAutoAlert(calendarEvents, spendEntries);
    if (id == null) {
      return;
    }
    queueMicrotask(() => {
      setSpendAlertEventId(id);
      setCalendarMode("spendOverAlert");
    });
  }, [screen, calendarMode, calendarEvents, spendEntries]);

  const headerBack = useCallback(() => {
    if (screen === "calendar") {
      if (calendarMode === "spendOverAlert" || calendarMode === "spendPraiseAlert") {
        dismissSpendFeedbackAlert();
        return;
      }
      if (calendarMode === "eventEstimate" || calendarMode === "eventManualAmount") {
        setCalendarMode("addEvent");
        return;
      }
      if (calendarMode === "addEvent") {
        if (calendarAddEventViaPickDate) {
          setCalendarMode("pickDate");
        } else {
          setCalendarAddEventViaPickDate(false);
          setCalendarMode("calendar");
        }
        return;
      }
      if (calendarMode === "pickDate") {
        setCalendarMode("calendar");
        return;
      }
      setScreen("home");
      return;
    }
    if (screen === "honeyChallenge") {
      setScreen("home");
      return;
    }
    if (screen === "nickname") {
      setScreen("welcome");
      return;
    }
    if (screen === "budget") {
      setScreen("nickname");
      return;
    }
    if (screen === "home") {
      setScreen("budget");
      return;
    }
    if (screen === "survey") {
      setScreen("home");
      return;
    }
    if (screen === "surveyQuiz") {
      setScreen("survey");
      return;
    }
    if (screen === "surveyLoading") {
      setScreen("surveyQuiz");
      return;
    }
    if (screen === "surveyResult") {
      setScreen("home");
      return;
    }
  }, [screen, calendarMode, calendarAddEventViaPickDate, dismissSpendFeedbackAlert]);

  return (
    <main className="app-shell">
      <AppHeader onBack={screen === "welcome" ? undefined : headerBack} />

      {screen === "welcome" && (
        <WelcomeScreen
          agreed={agreed}
          onAgreementChange={setAgreed}
          onNext={() => setScreen("nickname")}
        />
      )}
      {screen === "nickname" && (
        <NicknameScreen
          nickname={nickname}
          onChangeNickname={setNickname}
          onNext={() => setScreen("budget")}
        />
      )}
      {screen === "budget" && (
        <BudgetScreen
          budget={budget}
          onChangeBudget={setBudget}
          onBack={() => setScreen("nickname")}
          onNext={() => {
            writeBudgetPersist(formatYearMonth(new Date()), budget.trim());
            setScreen("home");
          }}
        />
      )}
      {screen === "home" && (
        <HomeScreen
          remainingBudgetLabel={remainingBudgetLabel}
          calendarEvents={calendarEvents}
          spendEntriesThisMonth={spendEntriesThisMonth}
          lastMonthSpendSummary={lastMonthSpendSummary}
          surveyConsumerTypeId={surveyConsumerTypeId}
          onEditBudget={() => setScreen("budget")}
          onCalendar={() => setScreen("calendar")}
          onSpendEntry={goToSpendEntryFromHome}
          onSurvey={() => setScreen("survey")}
          onHoneyChallenge={() => setScreen("honeyChallenge")}
        />
      )}
      {screen === "honeyChallenge" && (
        <HoneyChallengeScreen
          honeyJarIndex={honeyJarIndex}
          surveyConsumerTypeId={surveyConsumerTypeId}
          consumerTypeLabel={surveyConsumerTypeLabel}
          onFriendInviteClose={() => setScreen("welcome")}
        />
      )}
      {screen === "calendar" && (
        <CalendarScreen
          mode={calendarMode}
          onModeChange={setCalendarMode}
          monthlyBudgetWon={monthlyBudgetWon}
          calendarEvents={calendarEvents}
          spendEntries={spendEntries}
          spendAlertEventId={spendAlertEventId}
          openSpendEntryFromHome={openSpendEntryFromHome}
          onConsumeOpenSpendEntryFromHome={consumeSpendEntryFromHome}
          onDismissSpendFeedbackAlert={dismissSpendFeedbackAlert}
          onEnterAddEventFromPickDate={() => setCalendarAddEventViaPickDate(true)}
          onResetAddEventViaPickDate={() => setCalendarAddEventViaPickDate(false)}
          onAddCalendarEvent={event => setCalendarEvents(prev => [...prev, event])}
          onUpdateCalendarEvent={event =>
            setCalendarEvents(prev => prev.map(e => (e.id === event.id ? event : e)))
          }
          onDeleteCalendarEvent={id => {
            setCalendarEvents(prev => prev.filter(e => e.id !== id));
            setSpendEntries(prev => prev.filter(s => s.eventId !== id));
          }}
          onAddSpendEntry={entry => {
            setSpendEntries(prev => {
              const next = [...prev, entry];
              const ev = calendarEvents.find(e => e.id === entry.eventId);
              const cap = ev ? estimatedBudgetWonForEvent(ev) : null;
              if (ev && cap != null && cap > 0) {
                const spent = totalSpentWonForEvent(entry.eventId, next);
                const isOver = spent > cap;
                window.setTimeout(() => {
                  setSpendAlertEventId(entry.eventId);
                  setCalendarMode(isOver ? "spendOverAlert" : "spendPraiseAlert");
                }, 0);
              }
              return next;
            });
          }}
          onUpdateSpendEntry={entry =>
            setSpendEntries(prev => prev.map(e => (e.id === entry.id ? entry : e)))
          }
          onDeleteSpendEntry={id => setSpendEntries(prev => prev.filter(e => e.id !== id))}
        />
      )}
      {screen === "survey" && <SurveyScreen onNext={() => setScreen("surveyQuiz")} />}
      {screen === "surveyQuiz" && (
        <SurveyQuizScreen
          onBack={() => setScreen("survey")}
          onComplete={path => {
            setSurveyResultPath(path);
            setScreen("surveyLoading");
          }}
        />
      )}
      {screen === "surveyLoading" && (
        <SurveyLoadingScreen
          onDone={() => {
            setScreen("surveyResult");
          }}
        />
      )}
      {screen === "surveyResult" && surveyResultPath && (
        <SurveyResultScreen
          path={surveyResultPath}
          nickname={nickname}
          onHome={() => {
            setScreen("home");
          }}
        />
      )}
    </main>
  );
}

function AppHeader({ onBack }: { onBack?: () => void }) {
  return (
    <header className="app-header">
      {onBack ? (
        <button
          className="icon-button"
          type="button"
          aria-label="뒤로 가기"
          onClick={() => onBack()}
        >
          <Asset.Icon
            frameShape={Asset.frameShape.CleanW24}
            backgroundColor="transparent"
            name="icon-arrow-back-ios-mono"
            color={adaptive.grey900}
            aria-hidden={true}
            ratio="1/1"
          />
        </button>
      ) : (
        <span className="app-header-back-placeholder" aria-hidden={true} />
      )}

      <div className="brand">
        <Asset.Image
          frameShape={Asset.frameShape.CleanW16}
          backgroundColor="transparent"
          src={APP_ICON}
          aria-hidden={true}
          style={{ aspectRatio: "1/1" }}
        />
        <Text color={adaptive.grey900} typography="t6" fontWeight="semibold">
          비코노미
        </Text>
      </div>

      <div className="header-actions">
        <button className="pill-icon-button" type="button" aria-label="좋아요">
          <Asset.Icon
            frameShape={Asset.frameShape.CleanW20}
            backgroundColor="transparent"
            name="icon-heart-mono"
            color={adaptive.greyOpacity600}
            aria-hidden={true}
            ratio="1/1"
          />
        </button>
        <div className="segmented-actions">
          <button className="pill-icon-button" type="button" aria-label="더 보기">
            <Asset.Icon
              frameShape={Asset.frameShape.CleanW20}
              backgroundColor="transparent"
              name="icon-dots-mono"
              color={adaptive.greyOpacity600}
              aria-hidden={true}
              ratio="1/1"
            />
          </button>
          <span className="header-divider" />
          <button className="pill-icon-button" type="button" aria-label="닫기">
            <Asset.Icon
              frameShape={Asset.frameShape.CleanW20}
              backgroundColor="transparent"
              name="icon-x-mono"
              color={adaptive.greyOpacity600}
              aria-hidden={true}
              ratio="1/1"
            />
          </button>
        </div>
      </div>
    </header>
  );
}

function WelcomeScreen({
  agreed,
  onAgreementChange,
  onNext,
}: {
  agreed: boolean;
  onAgreementChange: (value: boolean) => void;
  onNext: () => void;
}) {
  return (
    <section className="screen welcome-screen">
      <Top
        title={
          <Top.TitleParagraph size={28} color="#000000">
            일침이와 함께 예산을 관리해보세요
          </Top.TitleParagraph>
        }
      />

      <Spacing size={84} />
      <div className="emoji-row">
        <Asset.Image
          frameShape={Asset.frameShape.CleanW100}
          backgroundColor="transparent"
          src={BEE_EMOJI}
          aria-hidden={true}
          style={{ aspectRatio: "1/1" }}
        />
      </div>
      <Spacing size={30} />

      <div className="stepper-panel">
        <StepperRow
          left={<StepperRow.NumberIcon number={1} />}
          center={<StepperRow.Texts type="A" title="예산을 입력하고" description="" />}
        />
        <StepperRow
          left={<StepperRow.NumberIcon number={2} />}
          center={<StepperRow.Texts type="A" title="캘린더 항목과 소비를 입력하면" description="" />}
        />
        <StepperRow
          left={<StepperRow.NumberIcon number={3} />}
          center={
            <StepperRow.Texts
              type="A"
              title="일침이가 소비를 예상해줘요"
              description=""
            />
          }
          hideLine={true}
        />
      </div>

      <Spacing size={11} />
      <label className="agreement-button" htmlFor="welcome-service-agree">
        <AgreementV4
          variant="small"
          left={
            <AgreementV4.Checkbox
              id="welcome-service-agree"
              variant="checkbox"
              checked={agreed}
              onCheckedChange={onAgreementChange}
            />
          }
          middle={<AgreementV4.Text>서비스 이용 동의</AgreementV4.Text>}
        />
      </label>

      <Spacing size={25} />
      <div className="welcome-action">
        <Button className="welcome-join-button" disabled={!agreed} onClick={onNext}>
          가입하기
        </Button>
      </div>
    </section>
  );
}

function NicknameScreen({
  nickname,
  onChangeNickname,
  onNext,
}: {
  nickname: string;
  onChangeNickname: (value: string) => void;
  onNext: () => void;
}) {
  return (
    <section className="screen form-screen nickname-screen">
      <Spacing size={12} />
      <div className="nickname-screen-emoji">
        <Asset.Image
          frameShape={Asset.frameShape.CleanW100}
          backgroundColor="transparent"
          src={HAND_EMOJI}
          aria-hidden={true}
          style={{ aspectRatio: "1/1", display: "block" }}
        />
      </div>
      <Spacing size={4} />
      <Text
        display="block"
        color={adaptive.grey800}
        typography="t3"
        fontWeight="bold"
        textAlign="center"
      >
        반갑습니다!
      </Text>
      <Spacing size={4} />
      <Text
        display="block"
        color={adaptive.grey600}
        typography="t6"
        fontWeight="regular"
        textAlign="center"
      >
        비코노미에 오신 걸 환영해요. 편하게 불릴 이름을 알려주세요.
      </Text>
      <Spacing size={16} />
      <TextField.Clearable
        variant="box"
        hasError={false}
        label="뭐라고 불러드릴까요?"
        labelOption="sustain"
        value={nickname}
        placeholder="예 : 절약왕, 김금수"
        suffix=""
        prefix=""
        onChange={event => onChangeNickname(event.target.value)}
      />
      <BottomCTA.Single disabled={nickname.trim().length === 0} onClick={onNext}>
        확인
      </BottomCTA.Single>
    </section>
  );
}

function BudgetScreen({
  budget,
  onChangeBudget,
  onBack,
  onNext,
}: {
  budget: string;
  onChangeBudget: (value: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <section className="screen budget-screen">
      <Top
        title={
          <Top.TitleParagraph size={22} color={adaptive.grey900}>
            이번 달 예산을 설정해보세요 일침이가 예산 관리를 도와줘요
          </Top.TitleParagraph>
        }
      />

      <Spacing size={44} />
      <div className="emoji-row">
        <Asset.Image
          frameShape={Asset.frameShape.CleanW100}
          backgroundColor="transparent"
          src={HONEY_EMOJI}
          aria-hidden={true}
          style={{ aspectRatio: "1/1" }}
        />
      </div>
      <Spacing size={28} />

      <TextField.Clearable
        variant="box"
        hasError={false}
        label="금액"
        labelOption="sustain"
        value={budget}
        placeholder="이번 달 예산 입력하기"
        suffix="원"
        format={priceFormat}
        onChange={event => onChangeBudget(event.target.value)}
      />

      <BottomCTA.Double
        leftButton={
          <CTAButton color="dark" variant="weak" onClick={onBack}>
            뒤로 가기
          </CTAButton>
        }
        rightButton={
          <CTAButton disabled={budget.trim().length === 0} onClick={onNext}>
            준비 완료!
          </CTAButton>
        }
      />
    </section>
  );
}

function HomeScreen({
  remainingBudgetLabel,
  calendarEvents,
  spendEntriesThisMonth,
  lastMonthSpendSummary,
  surveyConsumerTypeId,
  onEditBudget,
  onCalendar,
  onSpendEntry,
  onSurvey,
  onHoneyChallenge,
}: {
  remainingBudgetLabel: string;
  calendarEvents: CalendarEventRecord[];
  spendEntriesThisMonth: SpendEntryRecord[];
  lastMonthSpendSummary: { label: string; total: number; categories: { category: string; won: number }[] };
  surveyConsumerTypeId: ConsumerTypeId | null;
  onEditBudget: () => void;
  onCalendar: () => void;
  onSpendEntry: () => void;
  onSurvey: () => void;
  onHoneyChallenge: () => void;
}) {
  const today = useMemo(() => new Date(), []);
  const nextCalendarEvent = useMemo(
    () => findNextCalendarEventFromToday(calendarEvents, today),
    [calendarEvents, today],
  );
  const days = useMemo(() => homeDateStripDays(today), [today]);
  const categorySpendStats = useMemo(
    () => aggregateSpendByCategory(spendEntriesThisMonth),
    [spendEntriesThisMonth],
  );
  const categorySpendTotal = useMemo(
    () => categorySpendStats.reduce((s, r) => s + r.won, 0),
    [categorySpendStats],
  );
  const thisMonthLabel = useMemo(
    () => `${today.getFullYear()}년 ${today.getMonth() + 1}월`,
    [today],
  );
  const [showSpendStats, setShowSpendStats] = useState(false);

  const homeProfileEmojiSrc = useMemo(() => {
    if (surveyConsumerTypeId == null) {
      return HONEY_EMOJI;
    }
    const em = CONSUMER_TYPES[surveyConsumerTypeId].emoji;
    return `https://static.toss.im/2d-emojis/png/4x/${em}.png`;
  }, [surveyConsumerTypeId]);

  return (
    <section className="screen home-screen">
      <div className="emoji-row">
        <Asset.Image
          frameShape={Asset.frameShape.CleanW100}
          backgroundColor="transparent"
          src={homeProfileEmojiSrc}
          aria-hidden={true}
          style={{ aspectRatio: "1/1" }}
        />
      </div>
      <Top
        title={<Top.TitleParagraph size={28}>{remainingBudgetLabel}</Top.TitleParagraph>}
        subtitleTop={
          <Top.SubtitleTextButton size="xsmall">이번 달 남은 예산</Top.SubtitleTextButton>
        }
        upperGap={40}
        right={<Top.RightButton onClick={onEditBudget}>설정하기</Top.RightButton>}
        rightVerticalAlign="end"
      />

      <Spacing size={36} />
      <div className="home-shortcut-grid">
        {(
          [
            { emoji: "u1F5D3", label: "캘린더", onClick: onCalendar },
            { emoji: "u1F913", label: "소비유형 MBTI", onClick: onSurvey },
            { emoji: "u1F36F", label: "내 꿀단지 챌린지", onClick: onHoneyChallenge },
          ] as const
        ).map((item, index) => (
          <button
            key={item.label}
            type="button"
            className={`shortcut-card ${index === 0 ? "full-width" : ""}`}
            aria-label={item.label}
            onClick={item.onClick}
          >
            <Asset.Image
              frameShape={Asset.frameShape.CleanW24}
              backgroundColor="transparent"
              src={`https://static.toss.im/2d-emojis/png/4x/${item.emoji}.png`}
              aria-hidden={true}
              style={{ aspectRatio: "1/1" }}
            />
            <Text color={adaptive.grey700} typography="t7" fontWeight="semibold">
              {item.label}
            </Text>
          </button>
        ))}
      </div>

      <Spacing size={31} />
      <div className="date-strip">
        {days.map(item => (
          <div className={`date-item ${item.tone}`} key={item.key}>
            <Text color={adaptive.grey500} typography="t7" fontWeight="regular">
              {item.day}
            </Text>
            <Text
              color={item.tone === "past" ? adaptive.grey500 : adaptive.grey700}
              typography="t5"
              fontWeight="bold"
            >
              {item.date}
            </Text>
          </div>
        ))}
      </div>

      <Spacing size={31} />
      <List>
        <ListRow
          left={<ListRow.Icon name="icon-emoji-money-with-wings" />}
          contents={
            <ListRow.Texts
              type="2RowTypeD"
              top="오늘의 소비를 입력하세요"
              topProps={{ color: adaptive.grey600 }}
              bottom="소비 입력하러 가기"
              bottomProps={{ color: adaptive.blue500, fontWeight: "bold" }}
            />
          }
          verticalPadding={16}
          arrowType="right"
          withTouchEffect={true}
          onClick={onSpendEntry}
        />
        <ListRow
          left={<ListRow.Icon name="icon-calendar-alarm" />}
          contents={
            <ListRow.Texts
              type="2RowTypeD"
              top="다가올 항목은?"
              topProps={{ color: adaptive.grey600 }}
              bottom={
                nextCalendarEvent
                  ? formatHomeNextEventDetail(nextCalendarEvent)
                  : "캘린더에 항목을 추가해 보세요"
              }
              bottomProps={
                nextCalendarEvent
                  ? { color: adaptive.blue500, fontWeight: "bold" }
                  : { color: adaptive.grey500, fontWeight: "regular" }
              }
            />
          }
          verticalPadding={16}
          arrowType="right"
          withTouchEffect={true}
          onClick={onCalendar}
        />
        <ListRow
          left={
            <ListRow.Image
              type="circle"
              src="https://static.toss.im/2d-emojis/png/4x/u1F4CA.png"
              border={false}
            />
          }
          contents={
            <ListRow.Texts
              type="2RowTypeD"
              top="소비 통계"
              topProps={{ color: adaptive.grey600 }}
              bottom={showSpendStats ? "탭하여 접기" : "이번 달·지난 달 카테고리 보기"}
              bottomProps={{ color: adaptive.blue500, fontWeight: "bold" }}
            />
          }
          verticalPadding={16}
          arrowType="right"
          withTouchEffect={true}
          aria-expanded={showSpendStats}
          onClick={() => setShowSpendStats(s => !s)}
        />
      </List>

      {showSpendStats ? (
        <>
          <Spacing size={20} />
          <div className="home-category-stats">
            <Text color={adaptive.grey800} typography="t5" fontWeight="bold" display="block">
              {thisMonthLabel} 소비
            </Text>
            <Spacing size={8} />
            <Text color={adaptive.grey600} typography="t6" fontWeight="medium" display="block">
              총 {priceFormat.transform(categorySpendTotal)}원
            </Text>
            <Spacing size={12} />
            {categorySpendStats.length === 0 ? (
              <Text color={adaptive.grey500} typography="t6" fontWeight="regular" display="block">
                이번 달 입력된 소비가 없어요
              </Text>
            ) : (
              <div className="home-category-stats__list" role="list">
                {categorySpendStats.map(row => {
                  const ratio = categorySpendTotal > 0 ? row.won / categorySpendTotal : 0;
                  const pctLabel = `${Math.round(ratio * 100)}%`;
                  return (
                    <div className="home-category-stats__row" key={`cur-${row.category}`} role="listitem">
                      <div className="home-category-stats__row-head">
                        <Text color={adaptive.grey800} typography="t6" fontWeight="semibold">
                          {row.category}
                        </Text>
                        <Text color={adaptive.grey600} typography="t7" fontWeight="medium">
                          {priceFormat.transform(row.won)}원 · {pctLabel}
                        </Text>
                      </div>
                      <Spacing size={6} />
                      <ProgressBar size="normal" color={adaptive.blue500} progress={ratio} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <Spacing size={28} />
          <div className="home-category-stats">
            <Text color={adaptive.grey800} typography="t5" fontWeight="bold" display="block">
              {lastMonthSpendSummary.label} 소비
            </Text>
            <Spacing size={8} />
            <Text color={adaptive.grey600} typography="t6" fontWeight="medium" display="block">
              총 {priceFormat.transform(lastMonthSpendSummary.total)}원
            </Text>
            <Spacing size={12} />
            {lastMonthSpendSummary.categories.length === 0 ? (
              <Text color={adaptive.grey500} typography="t6" fontWeight="regular" display="block">
                지난 달에 입력된 소비가 없어요
              </Text>
            ) : (
              <div className="home-category-stats__list" role="list">
                {lastMonthSpendSummary.categories.map(row => {
                  const ratio =
                    lastMonthSpendSummary.total > 0 ? row.won / lastMonthSpendSummary.total : 0;
                  const pctLabel = `${Math.round(ratio * 100)}%`;
                  return (
                    <div className="home-category-stats__row" key={`prev-${row.category}`} role="listitem">
                      <div className="home-category-stats__row-head">
                        <Text color={adaptive.grey800} typography="t6" fontWeight="semibold">
                          {row.category}
                        </Text>
                        <Text color={adaptive.grey600} typography="t7" fontWeight="medium">
                          {priceFormat.transform(row.won)}원 · {pctLabel}
                        </Text>
                      </div>
                      <Spacing size={6} />
                      <ProgressBar size="normal" color={adaptive.blue500} progress={ratio} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}

function HoneyChallengeStarRow({ filled }: { filled: number }) {
  return (
    <div className="honey-challenge-stars" aria-hidden={true}>
      {Array.from({ length: 5 }, (_, i) => (
        <Asset.Icon
          key={i}
          frameShape={Asset.frameShape.CleanW16}
          backgroundColor="transparent"
          name="icon-star-mono"
          color={i < filled ? adaptive.yellow500 : adaptive.grey300}
          ratio="1/1"
        />
      ))}
    </div>
  );
}

function HoneyChallengeScreen({
  honeyJarIndex,
  surveyConsumerTypeId,
  consumerTypeLabel,
  onFriendInviteClose,
}: {
  honeyJarIndex: number;
  /** 공유 URL ?ct= 에 넣을 소비 유형 id (설문 완료 시) */
  surveyConsumerTypeId: ConsumerTypeId | null;
  /** 설문 완료 시에만 유형명 표시 */
  consumerTypeLabel: string | null;
  /** 친구 초대 링크로 열었을 때 하단으로 앱 시작 화면으로 보내기 */
  onFriendInviteClose: () => void;
}) {
  const [copyHint, setCopyHint] = useState<string | null>(null);
  const inviteId = useMemo(() => readOrCreateHiveInviteId(), []);
  const shareUrl = useMemo(
    () => buildHoneyChallengeInviteUrl(inviteId, surveyConsumerTypeId),
    [inviteId, surveyConsumerTypeId],
  );
  const friendShareFromUrl = useMemo(() => parseHoneyFriendShareFromUrl(), []);

  const shareHoneyLink = async () => {
    const ok = await copyTextToClipboard(shareUrl);
    setCopyHint(
      ok
        ? "초대 링크를 복사했어요. 친구에게 붙여넣기만 하면 돼요!"
        : "복사에 실패했어요. 잠시 후 다시 눌러주세요.",
    );
    if (ok) {
      window.setTimeout(() => setCopyHint(null), 3200);
    }
  };

  if (friendShareFromUrl != null) {
    const profile = CONSUMER_TYPES[friendShareFromUrl.consumerTypeId];
    const emojiSrc = `https://static.toss.im/2d-emojis/png/4x/${profile.emoji}.png`;
    return (
      <section className="screen honey-challenge-screen honey-challenge-screen--friend-share">
        <Spacing size={12} />
        <Asset.Image
          frameShape={Asset.frameShape.CleanW250}
          backgroundColor="transparent"
          src={HONEY_JAR_HERO_IMG}
          aria-hidden={true}
          style={{ aspectRatio: "1/1" }}
        />
        <Spacing size={28} />
        <Text
          display="block"
          color={adaptive.grey600}
          typography="t7"
          fontWeight="medium"
          textAlign="center"
        >
          친구가 공유한 꿀단지 챌린지
        </Text>
        <Spacing size={10} />
        <Text
          display="block"
          color={adaptive.grey800}
          typography="t4"
          fontWeight="bold"
          textAlign="center"
        >
          소비 유형 · {profile.label}
        </Text>
        <Spacing size={16} />
        <div className="honey-challenge-friend-emoji" style={{ display: "flex", justifyContent: "center" }}>
          <Asset.Image
            frameShape={Asset.frameShape.CleanW120}
            backgroundColor="transparent"
            src={emojiSrc}
            aria-hidden={true}
            style={{ aspectRatio: "1/1" }}
          />
        </div>
        <Spacing size={20} />
        <Text
          display="block"
          color={adaptive.grey600}
          typography="t6"
          fontWeight="regular"
          textAlign="center"
        >
          꿀단지 지수는 친구의 앱에서만 확인할 수 있어요.
        </Text>
        <Spacing size={40} />
        <Button variant="primary" display="full" onClick={onFriendInviteClose}>
          나도 비코노미에서 챌린지하기
        </Button>
      </section>
    );
  }

  return (
    <section className="screen honey-challenge-screen">
      <Spacing size={12} />
      <Asset.Image
        frameShape={Asset.frameShape.CleanW250}
        backgroundColor="transparent"
        src={HONEY_JAR_HERO_IMG}
        aria-hidden={true}
        style={{ aspectRatio: "1/1" }}
      />
      <Spacing size={34} />
      <div className="honey-challenge-progress-wrap">
        {consumerTypeLabel != null ? (
          <Text
            display="block"
            color={adaptive.grey600}
            typography="t7"
            fontWeight="medium"
            textAlign="center"
          >
            나의 소비 유형 · {consumerTypeLabel}
          </Text>
        ) : (
          <Text
            display="block"
            color={adaptive.grey600}
            typography="t7"
            fontWeight="medium"
            textAlign="center"
          >
            나의 소비 유형
          </Text>
        )}
        <Spacing size={8} />
        <Text
          display="block"
          color={adaptive.grey700}
          typography="t6"
          fontWeight="bold"
          textAlign="center"
        >
          꿀단지 지수 {honeyJarIndex}점
        </Text>
        <Spacing size={8} />
        <ProgressBar size="normal" color="#f04452" progress={honeyJarIndex / 100} />
      </div>
      <Spacing size={24} />
      <div className="honey-challenge-reviews">
        <ListRow
          left={
            <ListRow.Image
              type="circle"
              src="https://static.toss.im/illusts/img-profile-10.png"
              border={false}
            />
          }
          contents={
            <ListRow.Texts
              type="2RowTypeC"
              top="친구1"
              topProps={{ color: adaptive.grey800, fontWeight: "bold" }}
              bottom="충동형 소비자"
              bottomProps={{ color: adaptive.grey500 }}
            />
          }
          verticalPadding="large"
          arrowType="right"
        />
        <div className="honey-challenge-review-meta">
          <HoneyChallengeStarRow filled={1} />
          <Text color={adaptive.grey700} typography="t7" fontWeight="medium">
            님 분발하시길 1점 드림
          </Text>
        </div>
        <Spacing size={24} />
        <ListRow
          left={
            <ListRow.Image
              type="circle"
              src="https://static.toss.im/illusts/img-profile-10.png"
              border={false}
            />
          }
          contents={
            <ListRow.Texts
              type="2RowTypeC"
              top="친구2"
              topProps={{ color: adaptive.grey800, fontWeight: "bold" }}
              bottom="절약형 소비자"
              bottomProps={{ color: adaptive.grey500 }}
            />
          }
          verticalPadding="large"
          arrowType="right"
        />
        <div className="honey-challenge-review-meta">
          <HoneyChallengeStarRow filled={3} />
          <Text color={adaptive.grey700} typography="t7" fontWeight="medium">
            돈 그렇게 쓰는 거 아닌데 ㅋㅋ
          </Text>
        </div>
      </div>
      <Spacing size={60} />
      <Button variant="weak" display="full" onClick={shareHoneyLink}>
        내 꿀단지 공유하기
      </Button>
      {copyHint ? (
        <>
          <Spacing size={12} />
          <Text display="block" color={adaptive.grey600} typography="t7" fontWeight="regular" textAlign="center">
            {copyHint}
          </Text>
        </>
      ) : null}
    </section>
  );
}

type CalendarCell = {
  day: number;
  inMonth: boolean;
  isToday: boolean;
  key: string;
};

function buildMonthGrid(year: number, monthIndex: number, today: Date): CalendarCell[] {
  const first = new Date(year, monthIndex, 1);
  const startPad = first.getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cells: CalendarCell[] = [];
  const prevLast = new Date(year, monthIndex, 0).getDate();

  for (let i = 0; i < startPad; i++) {
    const day = prevLast - startPad + 1 + i;
    cells.push({
      day,
      inMonth: false,
      isToday: false,
      key: `prev-${year}-${monthIndex}-${day}`,
    });
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const isToday =
      today.getFullYear() === year &&
      today.getMonth() === monthIndex &&
      today.getDate() === d;
    cells.push({
      day: d,
      inMonth: true,
      isToday,
      key: `in-${year}-${monthIndex}-${d}`,
    });
  }

  const remainder = cells.length % 7;
  const pad = remainder === 0 ? 0 : 7 - remainder;
  for (let d = 1; d <= pad; d++) {
    cells.push({
      day: d,
      inMonth: false,
      isToday: false,
      key: `next-${year}-${monthIndex}-${d}`,
    });
  }

  return cells;
}

function daysInMonthCount(year: number, monthIndex: number) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function clampDayToMonth(year: number, monthIndex: number, day: number) {
  const max = daysInMonthCount(year, monthIndex);
  return Math.min(Math.max(1, day), max);
}

function eventHasValidDate(year: number, monthIndex: number, day: number): boolean {
  if (!Number.isFinite(year) || monthIndex < 0 || monthIndex > 11 || day < 1) {
    return false;
  }
  return day <= daysInMonthCount(year, monthIndex);
}

const SCHEDULE_WIZARD_LAST_STEP = 5;

function CalendarScreen({
  mode,
  onModeChange,
  monthlyBudgetWon,
  calendarEvents,
  spendEntries,
  spendAlertEventId,
  openSpendEntryFromHome,
  onConsumeOpenSpendEntryFromHome,
  onDismissSpendFeedbackAlert,
  onEnterAddEventFromPickDate,
  onResetAddEventViaPickDate,
  onAddCalendarEvent,
  onUpdateCalendarEvent,
  onDeleteCalendarEvent,
  onAddSpendEntry,
  onUpdateSpendEntry,
  onDeleteSpendEntry,
}: {
  mode: CalendarFlowMode;
  onModeChange: (mode: CalendarFlowMode) => void;
  monthlyBudgetWon: number | null;
  calendarEvents: CalendarEventRecord[];
  spendEntries: SpendEntryRecord[];
  spendAlertEventId: string | null;
  openSpendEntryFromHome: boolean;
  onConsumeOpenSpendEntryFromHome: () => void;
  onDismissSpendFeedbackAlert: () => void;
  onEnterAddEventFromPickDate: () => void;
  onResetAddEventViaPickDate: () => void;
  onAddCalendarEvent: (event: CalendarEventRecord) => void;
  onUpdateCalendarEvent: (event: CalendarEventRecord) => void;
  onDeleteCalendarEvent: (id: string) => void;
  onAddSpendEntry: (entry: SpendEntryRecord) => void;
  onUpdateSpendEntry: (entry: SpendEntryRecord) => void;
  onDeleteSpendEntry: (id: string) => void;
}) {
  const today = useMemo(() => new Date(), []);
  const [viewYear, setViewYear] = useState(() => today.getFullYear());
  const [viewMonth, setViewMonth] = useState(() => today.getMonth());
  const [calendarSelectedDay, setCalendarSelectedDay] = useState(() =>
    clampDayToMonth(today.getFullYear(), today.getMonth(), today.getDate()),
  );

  const [chipTab, setChipTab] = useState<"schedule" | "spend">("schedule");
  const [spendSelectedEventId, setSpendSelectedEventId] = useState<string | null>(null);
  /** 반복 일정 소비 시 어떤 회차인지(YYYY-MM-DD). 일반 일정은 null */
  const [spendSelectedOccurrenceYmd, setSpendSelectedOccurrenceYmd] = useState<string | null>(null);
  const [spendAmount, setSpendAmount] = useState("");
  const [spendCategories, setSpendCategories] = useState<string[]>([]);
  const [spendRating, setSpendRating] = useState(4);
  const [eventTitle, setEventTitle] = useState("");
  const [eventTime, setEventTime] = useState("");
  const [eventHeadcount, setEventHeadcount] = useState("");
  /** 일정에 붙이는 예상 소비 카테고리(소비 입력 탭과 동일 다중 선택) */
  const [scheduleEventCategories, setScheduleEventCategories] = useState<string[]>([]);
  const [eventYear, setEventYear] = useState(() => today.getFullYear());
  const [eventMonth, setEventMonth] = useState(() => today.getMonth());
  const [eventDay, setEventDay] = useState(() => today.getDate());
  const [eventEndYear, setEventEndYear] = useState(() => today.getFullYear());
  const [eventEndMonth, setEventEndMonth] = useState(() => today.getMonth());
  const [eventEndDay, setEventEndDay] = useState(() => today.getDate());
  const [datePickRole, setDatePickRole] = useState<"start" | "end">("start");
  /** 일정 추가: 0날짜 →1제목 →2시간 →3인원 →4예상카테고리 →5반복·소비제외 */
  const [scheduleWizardStep, setScheduleWizardStep] = useState(0);
  const [eventRecurrence, setEventRecurrence] = useState<RecurrenceFrequency>("none");
  const [eventExcludeFromSpend, setEventExcludeFromSpend] = useState(false);

  const [estimatedWon, setEstimatedWon] = useState<number | null>(null);
  const [estimateLoading, setEstimateLoading] = useState(false);
  /** 구독·OTT 일정: 1인당 직접 입력 */
  const [manualPerPersonAmount, setManualPerPersonAmount] = useState("");

  /** 소비 입력 탭에서 수정 중인 기록 id (없으면 신규 추가) */
  const [editingSpendEntryId, setEditingSpendEntryId] = useState<string | null>(null);
  /** 일정 수정 중이면 해당 id (신규 추가면 null) */
  const [editingCalendarEventId, setEditingCalendarEventId] = useState<string | null>(null);
  const spendPrefillTokenRef = useRef<string | null>(null);

  const [pickDateYear, setPickDateYear] = useState(() => today.getFullYear());
  const [pickDateMonth, setPickDateMonth] = useState(() => today.getMonth());
  const [pickDateDay, setPickDateDay] = useState(() => today.getDate());

  const cells = useMemo(
    () => buildMonthGrid(viewYear, viewMonth, today),
    [viewYear, viewMonth, today],
  );
  const pickDateCells = useMemo(
    () => buildMonthGrid(pickDateYear, pickDateMonth, today),
    [pickDateYear, pickDateMonth, today],
  );
  const weekdays = KOREAN_WEEKDAY_SHORT;

  useEffect(() => {
    if (mode === "calendar") {
      setEditingCalendarEventId(null);
    }
  }, [mode]);

  useEffect(() => {
    if (mode !== "addEvent") {
      return;
    }
    const startTs = new Date(eventYear, eventMonth, eventDay).getTime();
    const endTs = new Date(eventEndYear, eventEndMonth, eventEndDay).getTime();
    if (endTs < startTs) {
      setEventEndYear(eventYear);
      setEventEndMonth(eventMonth);
      setEventEndDay(eventDay);
    }
  }, [mode, eventYear, eventMonth, eventDay, eventEndYear, eventEndMonth, eventEndDay]);

  const spendFeedbackEvent = useMemo(() => {
    if (
      (mode !== "spendOverAlert" && mode !== "spendPraiseAlert") ||
      spendAlertEventId == null
    ) {
      return undefined;
    }
    return calendarEvents.find(e => e.id === spendAlertEventId);
  }, [mode, spendAlertEventId, calendarEvents]);

  const spendAlertCap = spendFeedbackEvent ? estimatedBudgetWonForEvent(spendFeedbackEvent) : null;
  const spendAlertSpent =
    spendAlertEventId != null ? totalSpentWonForEvent(spendAlertEventId, spendEntries) : 0;

  const scheduleWizardCanGoNext = useMemo(() => {
    switch (scheduleWizardStep) {
      case 0:
        return (
          eventHasValidDate(eventYear, eventMonth, eventDay) &&
          eventHasValidDate(eventEndYear, eventEndMonth, eventEndDay) &&
          new Date(eventEndYear, eventEndMonth, eventEndDay).getTime() >=
            new Date(eventYear, eventMonth, eventDay).getTime()
        );
      case 1:
        return eventTitle.trim().length > 0;
      case 2:
      case 3:
        return true;
      case 4:
        return true;
      case 5:
        return true;
      default:
        return false;
    }
  }, [
    scheduleWizardStep,
    eventYear,
    eventMonth,
    eventDay,
    eventEndYear,
    eventEndMonth,
    eventEndDay,
    eventTitle,
  ]);

  const eventDaysInViewMonth = useMemo(() => {
    const days = new Set<number>();
    const dim = daysInMonthCount(viewYear, viewMonth);
    for (const ev of calendarEvents) {
      if (!eventOverlapsCalendarMonth(ev, viewYear, viewMonth)) {
        continue;
      }
      for (let d = 1; d <= dim; d++) {
        if (calendarEventCoversDay(ev, viewYear, viewMonth, d)) {
          days.add(d);
        }
      }
    }
    return days;
  }, [calendarEvents, viewYear, viewMonth]);

  const spendEntriesOnSelectedDay = useMemo(() => {
    return spendEntries
      .filter(e => {
        if (e.occurrenceYmd) {
          const p = e.occurrenceYmd.split("-").map(Number);
          if (p.length !== 3 || !p.every(n => Number.isFinite(n))) {
            return false;
          }
          return p[0] === viewYear && p[1] - 1 === viewMonth && p[2] === calendarSelectedDay;
        }
        const ev = calendarEvents.find(ce => ce.id === e.eventId);
        return (
          ev != null && calendarEventCoversDay(ev, viewYear, viewMonth, calendarSelectedDay)
        );
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  }, [spendEntries, calendarEvents, viewYear, viewMonth, calendarSelectedDay]);

  const monthEventsSorted = useMemo(() => {
    return calendarEvents
      .filter(e => eventOverlapsCalendarMonth(e, viewYear, viewMonth))
      .sort(
        (a, b) =>
          calendarEventStartOfDayTs(a) - calendarEventStartOfDayTs(b) || a.id.localeCompare(b.id),
      );
  }, [calendarEvents, viewYear, viewMonth]);

  const eventsOnSelectedDay = useMemo(() => {
    return calendarEvents
      .filter(e => calendarEventCoversDay(e, viewYear, viewMonth, calendarSelectedDay))
      .sort((a, b) => a.id.localeCompare(b.id));
  }, [calendarEvents, viewYear, viewMonth, calendarSelectedDay]);

  useEffect(() => {
    setCalendarSelectedDay(d => clampDayToMonth(viewYear, viewMonth, d));
  }, [viewYear, viewMonth]);

  const { nextEventInMonth, lastPastEventInMonth } = useMemo(() => {
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const upcoming: CalendarEventRecord[] = [];
    const past: CalendarEventRecord[] = [];
    for (const ev of monthEventsSorted) {
      if (calendarEventEndInclusiveStartTs(ev) >= startOfToday) {
        upcoming.push(ev);
      } else {
        past.push(ev);
      }
    }
    upcoming.sort(
      (a, b) =>
        calendarEventStartOfDayTs(a) - calendarEventStartOfDayTs(b) || a.id.localeCompare(b.id),
    );
    past.sort(
      (a, b) =>
        calendarEventEndInclusiveStartTs(b) - calendarEventEndInclusiveStartTs(a) ||
        a.id.localeCompare(b.id),
    );
    return {
      nextEventInMonth: upcoming[0] ?? null,
      lastPastEventInMonth: past[0] ?? null,
    };
  }, [monthEventsSorted, today]);

  /** 소비 입력: 끝난 일정(또는 반복 회차)마다 슬롯. 수정 중이면 해당 슬롯을 목록 앞에 붙임 */
  const spendPickerSlots = useMemo(() => {
    void (mode === "addEvent" && chipTab === "spend");
    const now = new Date();
    let slots = collectSpendPickerSlots(calendarEvents, spendEntries, now);
    if (editingSpendEntryId != null) {
      const editingEntry = spendEntries.find(e => e.id === editingSpendEntryId);
      if (editingEntry) {
        const ev = calendarEvents.find(e => e.id === editingEntry.eventId);
        if (ev && !ev.excludeFromSpendTracking) {
          const occ = editingEntry.occurrenceYmd ?? null;
          const has = slots.some(
            s => s.eventId === ev.id && (s.occurrenceYmd ?? null) === (occ ?? null),
          );
          if (!has) {
            const sortTs =
              occ != null
                ? (() => {
                    const p = occ.split("-").map(Number);
                    return new Date(p[0], p[1] - 1, p[2], 23, 59, 59, 999).getTime();
                  })()
                : calendarEventLastDayEndTs(ev);
            slots = [{ eventId: ev.id, occurrenceYmd: occ, sortTs }, ...slots];
          }
        }
      }
    }
    slots.sort((a, b) => b.sortTs - a.sortTs);
    return slots;
  }, [calendarEvents, spendEntries, editingSpendEntryId, mode, chipTab]);

  useEffect(() => {
    if (!openSpendEntryFromHome || mode !== "addEvent") {
      return;
    }
    setChipTab("spend");
    onConsumeOpenSpendEntryFromHome();
  }, [openSpendEntryFromHome, mode, onConsumeOpenSpendEntryFromHome]);

  useEffect(() => {
    if (mode !== "addEvent") {
      setEditingSpendEntryId(null);
    }
  }, [mode]);

  useEffect(() => {
    if (chipTab !== "spend") {
      setEditingSpendEntryId(null);
    }
  }, [chipTab]);

  useEffect(() => {
    if (mode !== "addEvent" || chipTab !== "spend") {
      return;
    }
    if (editingSpendEntryId != null) {
      const editingEntry = spendEntries.find(e => e.id === editingSpendEntryId);
      if (
        editingEntry &&
        spendPickerSlots.some(
          s =>
            s.eventId === editingEntry.eventId &&
            (s.occurrenceYmd ?? null) === (editingEntry.occurrenceYmd ?? null),
        )
      ) {
        setSpendSelectedEventId(editingEntry.eventId);
        setSpendSelectedOccurrenceYmd(editingEntry.occurrenceYmd ?? null);
        return;
      }
    }
    const first = spendPickerSlots[0];
    if (first) {
      setSpendSelectedEventId(first.eventId);
      setSpendSelectedOccurrenceYmd(first.occurrenceYmd);
    } else {
      setSpendSelectedEventId(null);
      setSpendSelectedOccurrenceYmd(null);
    }
  }, [mode, chipTab, spendPickerSlots, editingSpendEntryId, spendEntries]);

  /** 신규 소비 입력: 선택한 일정에 예상 카테고리가 있으면 칩을 그대로 채움(직접 바꿀 수 있음) */
  useEffect(() => {
    if (mode !== "addEvent" || chipTab !== "spend" || editingSpendEntryId != null) {
      return;
    }
    if (spendSelectedEventId == null) {
      return;
    }
    const ev = calendarEvents.find(e => e.id === spendSelectedEventId);
    const fromPlan = ev ? splitSpendCategoriesStored(ev.plannedSpendCategories ?? "") : [];
    setSpendCategories(fromPlan);
    // spendSelectedEventId가 바뀔 때만 채움 — calendarEvents를 deps에 넣으면 입력 중 칩이 덮일 수 있음
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 위 이유로 calendarEvents 제외
  }, [spendSelectedEventId, mode, chipTab, editingSpendEntryId]);

  useEffect(() => {
    if (mode !== "addEvent" || chipTab !== "spend" || editingSpendEntryId == null) {
      spendPrefillTokenRef.current = null;
      return;
    }
    if (spendPrefillTokenRef.current === editingSpendEntryId) {
      return;
    }
    const entry = spendEntries.find(e => e.id === editingSpendEntryId);
    if (!entry) {
      setEditingSpendEntryId(null);
      return;
    }
    spendPrefillTokenRef.current = editingSpendEntryId;
    setSpendAmount(priceFormat.transform(entry.amountWon));
    setSpendCategories(splitSpendCategoriesStored(entry.category));
    setSpendRating(entry.rating);
    setSpendSelectedOccurrenceYmd(entry.occurrenceYmd ?? null);
  }, [mode, chipTab, editingSpendEntryId, spendEntries]);

  const spendSubmitEnabled = useMemo(() => {
    if (spendSelectedEventId == null || spendCategories.length === 0) {
      return false;
    }
    if (spendPickerSlots.length === 0) {
      return false;
    }
    if (
      !spendPickerSlots.some(
        s =>
          s.eventId === spendSelectedEventId &&
          (s.occurrenceYmd ?? null) === (spendSelectedOccurrenceYmd ?? null),
      )
    ) {
      return false;
    }
    const digits = priceFormat.reset(spendAmount);
    if (digits === "") {
      return false;
    }
    const n = Number(digits);
    return Number.isFinite(n) && n > 0;
  }, [
    spendPickerSlots,
    spendSelectedEventId,
    spendSelectedOccurrenceYmd,
    spendCategories,
    spendAmount,
  ]);

  const commitSpendEntry = () => {
    if (!spendSubmitEnabled || spendSelectedEventId == null || spendCategories.length === 0) {
      return;
    }
    const digits = priceFormat.reset(spendAmount);
    const n = Number(digits);
    const occPayload =
      spendSelectedOccurrenceYmd != null && spendSelectedOccurrenceYmd !== ""
        ? { occurrenceYmd: spendSelectedOccurrenceYmd }
        : {};
    if (editingSpendEntryId != null) {
      onUpdateSpendEntry({
        id: editingSpendEntryId,
        eventId: spendSelectedEventId,
        amountWon: Math.round(n),
        category: joinSpendCategories(spendCategories),
        rating: spendRating,
        ...occPayload,
      });
      setEditingSpendEntryId(null);
      spendPrefillTokenRef.current = null;
    } else {
      onAddSpendEntry({
        id: newSpendEntryId(),
        eventId: spendSelectedEventId,
        amountWon: Math.round(n),
        category: joinSpendCategories(spendCategories),
        rating: spendRating,
        ...occPayload,
      });
    }
    setSpendAmount("");
    setSpendCategories([]);
    setSpendRating(4);
    setSpendSelectedOccurrenceYmd(null);
  };

  const beginEditSpendEntry = (entry: SpendEntryRecord) => {
    spendPrefillTokenRef.current = null;
    setChipTab("spend");
    onModeChange("addEvent");
    setEditingSpendEntryId(entry.id);
  };

  const cancelSpendForm = () => {
    setEditingSpendEntryId(null);
    setEditingCalendarEventId(null);
    spendPrefillTokenRef.current = null;
    setSpendAmount("");
    setSpendCategories([]);
    setSpendRating(4);
    setSpendSelectedOccurrenceYmd(null);
    onModeChange("calendar");
  };

  const leaveScheduleAddFlow = () => {
    setEditingCalendarEventId(null);
    setManualPerPersonAmount("");
    onModeChange("calendar");
  };

  const buildCalendarEventFromWizard = (
    id: string,
    perPersonWonOverride?: number | null,
  ): CalendarEventRecord => {
    const startTs = new Date(eventYear, eventMonth, eventDay).getTime();
    const endTs = new Date(eventEndYear, eventEndMonth, eventEndDay).getTime();
    const isMultiDay = endTs > startTs;
    const plannedJoined = joinSpendCategories(scheduleEventCategories);
    const perPerson =
      perPersonWonOverride !== undefined ? perPersonWonOverride : estimatedWon;
    return {
      id,
      year: eventYear,
      monthIndex: eventMonth,
      day: eventDay,
      ...(isMultiDay
        ? { endYear: eventEndYear, endMonthIndex: eventEndMonth, endDay: eventEndDay }
        : {}),
      title: eventTitle.trim(),
      timeLabel: eventTime.trim(),
      headcountLabel: eventHeadcount.trim(),
      estimatedWonPerPerson: perPerson,
      ...(plannedJoined ? { plannedSpendCategories: plannedJoined } : {}),
      ...(eventRecurrence !== "none" ? { recurrence: eventRecurrence } : {}),
      ...(eventExcludeFromSpend ? { excludeFromSpendTracking: true } : {}),
    };
  };

  const beginEditCalendarEvent = (ev: CalendarEventRecord) => {
    onResetAddEventViaPickDate();
    setEditingCalendarEventId(ev.id);
    setEventYear(ev.year);
    setEventMonth(ev.monthIndex);
    setEventDay(ev.day);
    if (ev.endYear != null && ev.endMonthIndex != null && ev.endDay != null) {
      setEventEndYear(ev.endYear);
      setEventEndMonth(ev.endMonthIndex);
      setEventEndDay(ev.endDay);
    } else {
      setEventEndYear(ev.year);
      setEventEndMonth(ev.monthIndex);
      setEventEndDay(ev.day);
    }
    setEventTitle(ev.title);
    setEventTime(ev.timeLabel);
    setEventHeadcount(ev.headcountLabel);
    setEstimatedWon(ev.estimatedWonPerPerson);
    setScheduleEventCategories(splitSpendCategoriesStored(ev.plannedSpendCategories ?? ""));
    setEventRecurrence(ev.recurrence ?? "none");
    setEventExcludeFromSpend(ev.excludeFromSpendTracking ?? false);
    setScheduleWizardStep(0);
    setChipTab("schedule");
    onModeChange("addEvent");
  };

  const saveEditedCalendarEventFromWizard = () => {
    if (editingCalendarEventId == null) {
      return;
    }
    onUpdateCalendarEvent(buildCalendarEventFromWizard(editingCalendarEventId));
    setEditingCalendarEventId(null);
    setEstimatedWon(null);
    onModeChange("calendar");
  };

  const handleDeleteCalendarEvent = (ev: CalendarEventRecord) => {
    const linked = spendEntries.filter(s => s.eventId === ev.id).length;
    const msg =
      linked > 0
        ? `이 항목에 연결된 소비 ${linked}건도 함께 삭제돼요. 항목을 삭제할까요?`
        : "이 항목을 삭제할까요?";
    if (!window.confirm(msg)) {
      return;
    }
    onDeleteCalendarEvent(ev.id);
  };

  const confirmDeleteSpendEntry = (entry: SpendEntryRecord) => {
    if (!window.confirm("이 소비 기록을 삭제할까요?")) {
      return;
    }
    onDeleteSpendEntry(entry.id);
    if (editingSpendEntryId === entry.id) {
      setEditingSpendEntryId(null);
      spendPrefillTokenRef.current = null;
      setSpendAmount("");
      setSpendCategories([]);
      setSpendRating(4);
      setSpendSelectedOccurrenceYmd(null);
    }
  };

  const startPickDateFlow = () => {
    setEditingCalendarEventId(null);
    setEditingSpendEntryId(null);
    spendPrefillTokenRef.current = null;
    setDatePickRole("start");
    setPickDateYear(viewYear);
    setPickDateMonth(viewMonth);
    const sameAsToday =
      viewYear === today.getFullYear() && viewMonth === today.getMonth();
    const initialDay = sameAsToday ? today.getDate() : 1;
    setPickDateDay(clampDayToMonth(viewYear, viewMonth, initialDay));
    setEventTitle("");
    setEventTime("");
    setEventHeadcount("");
    setScheduleEventCategories([]);
    setEventRecurrence("none");
    setEventExcludeFromSpend(false);
    setManualPerPersonAmount("");
    setScheduleWizardStep(0);
    setChipTab("schedule");
    onModeChange("pickDate");
  };

  const goPickPrevMonth = () => {
    const d = new Date(pickDateYear, pickDateMonth - 1, 1);
    const y = d.getFullYear();
    const m = d.getMonth();
    setPickDateYear(y);
    setPickDateMonth(m);
    setPickDateDay(d => clampDayToMonth(y, m, d));
  };

  const goPickNextMonth = () => {
    const d = new Date(pickDateYear, pickDateMonth + 1, 1);
    const y = d.getFullYear();
    const m = d.getMonth();
    setPickDateYear(y);
    setPickDateMonth(m);
    setPickDateDay(d => clampDayToMonth(y, m, d));
  };

  const confirmPickDateAndContinue = () => {
    if (datePickRole === "start") {
      setEventYear(pickDateYear);
      setEventMonth(pickDateMonth);
      setEventDay(pickDateDay);
    } else {
      setEventEndYear(pickDateYear);
      setEventEndMonth(pickDateMonth);
      setEventEndDay(pickDateDay);
    }
    onEnterAddEventFromPickDate();
    onModeChange("addEvent");
  };

  const reopenPickDateFromForm = () => {
    setDatePickRole("start");
    setPickDateYear(eventYear);
    setPickDateMonth(eventMonth);
    setPickDateDay(clampDayToMonth(eventYear, eventMonth, eventDay));
    onModeChange("pickDate");
  };

  const reopenPickEndDateFromForm = () => {
    setDatePickRole("end");
    setPickDateYear(eventEndYear);
    setPickDateMonth(eventEndMonth);
    setPickDateDay(clampDayToMonth(eventEndYear, eventEndMonth, eventEndDay));
    onModeChange("pickDate");
  };

  const requestSpendEstimateAndShow = () => {
    onModeChange("eventEstimate");
  };

  const openSubscriptionManualAmountFlow = (prefillPerPerson?: number | null) => {
    setEstimatedWon(null);
    if (prefillPerPerson != null && Number.isFinite(prefillPerPerson) && prefillPerPerson > 0) {
      setManualPerPersonAmount(priceFormat.transform(Math.round(prefillPerPerson)));
    } else {
      setManualPerPersonAmount("");
    }
    onModeChange("eventManualAmount");
  };

  const finishEstimateAndReturnToCalendar = (perPersonOverride?: number | null) => {
    setViewYear(eventYear);
    setViewMonth(eventMonth);
    const usePer = perPersonOverride !== undefined ? perPersonOverride : estimatedWon;
    if (editingCalendarEventId != null) {
      onUpdateCalendarEvent(buildCalendarEventFromWizard(editingCalendarEventId, usePer));
      setEditingCalendarEventId(null);
    } else {
      onAddCalendarEvent(buildCalendarEventFromWizard(newCalendarEventId(), usePer));
    }
    setEstimatedWon(null);
    setManualPerPersonAmount("");
    onModeChange("calendar");
  };

  const manualAmountSubmitEnabled = useMemo(() => {
    const digits = priceFormat.reset(manualPerPersonAmount);
    if (digits === "") {
      return false;
    }
    const n = Number(digits);
    return Number.isFinite(n) && n > 0;
  }, [manualPerPersonAmount]);

  const confirmManualPerPersonAmount = () => {
    if (!manualAmountSubmitEnabled) {
      return;
    }
    const n = Math.round(Number(priceFormat.reset(manualPerPersonAmount)));
    if (!Number.isFinite(n) || n <= 0) {
      return;
    }
    finishEstimateAndReturnToCalendar(n);
  };

  useEffect(() => {
    if (mode !== "eventEstimate") {
      return;
    }
    let cancelled = false;
    const iso = `${eventYear}-${String(eventMonth + 1).padStart(2, "0")}-${String(eventDay).padStart(2, "0")}`;
    const endIsoRaw = `${eventEndYear}-${String(eventEndMonth + 1).padStart(2, "0")}-${String(eventEndDay).padStart(2, "0")}`;
    const hasRange =
      new Date(eventEndYear, eventEndMonth, eventEndDay).getTime() >
      new Date(eventYear, eventMonth, eventDay).getTime();
    (async () => {
      setEstimateLoading(true);
      setEstimatedWon(null);
      try {
        const won = await resolveSpendEstimate({
          title: eventTitle.trim(),
          eventDateIso: iso,
          eventEndDateIso: hasRange ? endIsoRaw : null,
          timeLabel: eventTime.trim(),
          headcountLabel: eventHeadcount.trim(),
          monthlyBudgetWon,
          plannedSpendCategoriesJoined: joinSpendCategories(scheduleEventCategories),
        });
        if (!cancelled) {
          setEstimatedWon(won);
        }
      } finally {
        if (!cancelled) {
          setEstimateLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    mode,
    eventTitle,
    eventTime,
    eventHeadcount,
    eventYear,
    eventMonth,
    eventDay,
    eventEndYear,
    eventEndMonth,
    eventEndDay,
    monthlyBudgetWon,
    scheduleEventCategories,
  ]);

  return (
    <>
      {mode === "calendar" && (
        <section className="screen calendar-screen">
          <div className="calendar-screen-inner">
            <header className="calendar-screen-header">
              <Text
                color={adaptive.grey800}
                typography="t5"
                fontWeight="bold"
                display="block"
                className="calendar-month-title"
              >
                {viewYear}년 {viewMonth + 1}월
              </Text>
            </header>

            <div className="calendar-calendar-block">
              <div className="calendar-weekdays">
                {weekdays.map(d => (
                  <Text
                    key={d}
                    color={adaptive.grey500}
                    typography="t6"
                    fontWeight="regular"
                    textAlign="center"
                    display="block"
                  >
                    {d}
                  </Text>
                ))}
              </div>
              <Spacing size={12} />
              <div className="calendar-grid">
                {cells.map(cell => {
                  let color = adaptive.grey600;
                  if (!cell.inMonth) {
                    color = adaptive.grey300;
                  } else if (cell.isToday) {
                    color = adaptive.grey700;
                  }
                  const hasScheduleDay =
                    cell.inMonth && eventDaysInViewMonth.has(cell.day);
                  const showEventDot =
                    cell.inMonth &&
                    calendarEvents.some(
                      ev =>
                        !calendarEventIsMultiDay(ev) &&
                        calendarEventCoversDay(ev, viewYear, viewMonth, cell.day),
                    );
                  const rangeStripItems = cell.inMonth
                    ? calendarEvents
                        .map(ev => {
                          const caps = calendarEventRangeStripCaps(ev, viewYear, viewMonth, cell.day);
                          return caps == null ? null : { ev, caps };
                        })
                        .filter(
                          (
                            x,
                          ): x is {
                            ev: CalendarEventRecord;
                            caps: { roundLeft: boolean; roundRight: boolean };
                          } => x != null,
                        )
                        .slice(0, 4)
                    : [];
                  const isSelected = cell.inMonth && cell.day === calendarSelectedDay;

                  if (!cell.inMonth) {
                    return (
                      <div key={cell.key} className="calendar-day calendar-day--out">
                        <span className="calendar-day-range-slot" aria-hidden={true} />
                        <span className="calendar-day-inner">
                          <Text
                            color={color}
                            typography="t5"
                            fontWeight="medium"
                            textAlign="center"
                            display="block"
                          >
                            {cell.day}
                          </Text>
                          <span className="calendar-day-markers" aria-hidden={true} />
                        </span>
                      </div>
                    );
                  }

                  return (
                    <button
                      key={cell.key}
                      type="button"
                      className={`calendar-day${cell.isToday ? " calendar-day--today" : ""}${isSelected ? " calendar-day--selected" : ""}`}
                      aria-pressed={isSelected}
                      aria-label={`${viewMonth + 1}월 ${cell.day}일${hasScheduleDay ? ", 일정 있음" : ""}`}
                      onClick={() => setCalendarSelectedDay(cell.day)}
                    >
                      <span className="calendar-day-range-slot" aria-hidden={true}>
                        {rangeStripItems.length > 0 ? (
                          <span className="calendar-day-range-stack">
                            {rangeStripItems.map(({ ev, caps }) => (
                              <span
                                key={ev.id}
                                className={`calendar-day-range-seg${
                                  caps.roundLeft ? " calendar-day-range-seg--cap-left" : ""
                                }${caps.roundRight ? " calendar-day-range-seg--cap-right" : ""}${
                                  !caps.roundLeft ? " calendar-day-range-seg--extend-left" : ""
                                }${!caps.roundRight ? " calendar-day-range-seg--extend-right" : ""}`}
                                style={{
                                  background: `hsl(${rangeHighlightHueFromId(ev.id)} 82% 58% / 0.42)`,
                                }}
                              />
                            ))}
                          </span>
                        ) : null}
                      </span>
                      <span className="calendar-day-inner">
                        <Text
                          color={color}
                          typography="t5"
                          fontWeight="medium"
                          textAlign="center"
                          display="block"
                        >
                          {cell.day}
                        </Text>
                        <span className="calendar-day-markers" aria-hidden={true}>
                          {showEventDot ? (
                            <span className="calendar-day-dot calendar-day-dot--event" />
                          ) : null}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="calendar-day-events-block">
              <Spacing size={20} />
              <Text
                color={adaptive.grey800}
                typography="t5"
                fontWeight="bold"
                display="block"
              >
                {viewMonth + 1}월 {calendarSelectedDay}일 일정
              </Text>
              <Spacing size={12} />
              {eventsOnSelectedDay.length === 0 ? (
                <Text color={adaptive.grey500} typography="t6" fontWeight="regular" display="block">
                  이 날 일정이 없어요
                </Text>
              ) : (
                <div className="calendar-spend-records">
                  {eventsOnSelectedDay.map(ev => (
                    <div key={ev.id} className="calendar-spend-record-card">
                      <div className="calendar-spend-record-card__main">
                        <Text color={adaptive.grey800} typography="t5" fontWeight="bold" display="block">
                          {ev.title.trim() || "제목 없음"}
                        </Text>
                        <Text color={adaptive.grey600} typography="t7" fontWeight="regular" display="block">
                          {formatCalendarListRowDetail(ev)}
                        </Text>
                      </div>
                      <div className="calendar-spend-record-card__actions">
                        <button
                          type="button"
                          className="calendar-spend-record-card__btn"
                          onClick={() => beginEditCalendarEvent(ev)}
                        >
                          수정
                        </button>
                        <button
                          type="button"
                          className="calendar-spend-record-card__btn calendar-spend-record-card__btn--danger"
                          onClick={() => handleDeleteCalendarEvent(ev)}
                        >
                          삭제
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <Spacing size={28} />
              <Text
                color={adaptive.grey800}
                typography="t5"
                fontWeight="bold"
                display="block"
              >
                {viewMonth + 1}월 {calendarSelectedDay}일 소비
              </Text>
              <Spacing size={12} />
              {spendEntriesOnSelectedDay.length === 0 ? (
                <Text color={adaptive.grey500} typography="t6" fontWeight="regular" display="block">
                  이 날 기록된 소비가 없어요
                </Text>
              ) : (
                <div className="calendar-spend-records">
                  {spendEntriesOnSelectedDay.map(entry => {
                    const linked = calendarEvents.find(e => e.id === entry.eventId);
                    const eventTitle = linked?.title.trim() || "항목";
                    return (
                      <div key={entry.id} className="calendar-spend-record-card">
                        <div className="calendar-spend-record-card__emoji" aria-hidden={true}>
                          <Asset.Image
                            frameShape={Asset.frameShape.CleanW24}
                            backgroundColor="transparent"
                            src={CALENDAR_SPEND_MONEY_EMOJI}
                            style={{ aspectRatio: "1/1", width: 28, height: 28 }}
                            aria-hidden={true}
                          />
                        </div>
                        <div className="calendar-spend-record-card__main">
                          <Text
                            color={adaptive.grey800}
                            typography="t5"
                            fontWeight="bold"
                            display="block"
                          >
                            {priceFormat.transform(entry.amountWon)}원
                          </Text>
                          <Text
                            color={adaptive.grey600}
                            typography="t7"
                            fontWeight="regular"
                            display="block"
                          >
                            {eventTitle} · {formatSpendCategoryLabel(entry.category)}
                          </Text>
                          <Text color={adaptive.grey500} typography="t7" fontWeight="regular" display="block">
                            별점 {entry.rating}/5
                          </Text>
                        </div>
                        <div className="calendar-spend-record-card__actions">
                          <button
                            type="button"
                            className="calendar-spend-record-card__btn"
                            onClick={() => beginEditSpendEntry(entry)}
                          >
                            수정
                          </button>
                          <button
                            type="button"
                            className="calendar-spend-record-card__btn calendar-spend-record-card__btn--danger"
                            onClick={() => confirmDeleteSpendEntry(entry)}
                          >
                            삭제
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="calendar-list-block">
              <Spacing size={28} />
              <List>
                <ListRow
                  left={
                    <ListRow.AssetIcon
                      size="xsmall"
                      shape="original"
                      name="icon-calendar-alarm"
                    />
                  }
                  contents={
                    <ListRow.Texts
                      type="2RowTypeA"
                      top="다가올 항목"
                      topProps={{ color: adaptive.grey700, fontWeight: "bold" }}
                      bottom={
                        nextEventInMonth
                          ? formatCalendarListRowDetail(nextEventInMonth)
                          : "이번 달 다가올 항목이 없어요"
                      }
                      bottomProps={{ color: adaptive.grey600 }}
                    />
                  }
                  verticalPadding="large"
                />
                <ListRow
                  left={
                    <ListRow.AssetIcon
                      size="xsmall"
                      shape="original"
                      name="icon-calendar-x-mono"
                      color={adaptive.blue500}
                    />
                  }
                  contents={
                    <ListRow.Texts
                      type="2RowTypeA"
                      top="지난 항목"
                      topProps={{ color: adaptive.grey700, fontWeight: "bold" }}
                      bottom={
                        lastPastEventInMonth
                          ? formatCalendarListRowDetail(lastPastEventInMonth)
                          : "이번 달 지난 항목이 없어요"
                      }
                      bottomProps={{ color: adaptive.grey600 }}
                    />
                  }
                  verticalPadding="large"
                />
              </List>
            </div>

            <div className="calendar-cta-wrap">
              <Spacing size={20} />
              <div className="calendar-add-btn-shell">
                <Button
                  className="calendar-add-btn"
                  type="button"
                  onClick={startPickDateFlow}
                >
                  일정 추가하기
                </Button>
              </div>
            </div>
          </div>
        </section>
      )}

      {mode === "pickDate" && (
        <section className="screen calendar-pick-date-screen">
          <div className="calendar-screen-inner">
            <ListHeader
              title={
                <ListHeader.TitleParagraph
                  color={adaptive.grey800}
                  fontWeight="bold"
                  typography="t4"
                >
                  {datePickRole === "end" ? "종료일 선택" : "시작일 선택"}
                </ListHeader.TitleParagraph>
              }
              descriptionPosition="bottom"
            />
            <Spacing size={16} />
            <div className="calendar-pick-date-nav">
              <button
                type="button"
                className="calendar-pick-date-nav-btn"
                aria-label="이전 달"
                onClick={goPickPrevMonth}
              >
                <Asset.Icon
                  frameShape={Asset.frameShape.CleanW24}
                  backgroundColor="transparent"
                  name="icon-arrow-back-ios-mono"
                  color={adaptive.grey700}
                  aria-hidden={true}
                  ratio="1/1"
                />
              </button>
              <Text color={adaptive.grey800} typography="t5" fontWeight="bold" textAlign="center">
                {pickDateYear}년 {pickDateMonth + 1}월
              </Text>
              <button
                type="button"
                className="calendar-pick-date-nav-btn"
                aria-label="다음 달"
                onClick={goPickNextMonth}
              >
                <span className="calendar-pick-date-nav-icon-flip" aria-hidden={true}>
                  <Asset.Icon
                    frameShape={Asset.frameShape.CleanW24}
                    backgroundColor="transparent"
                    name="icon-arrow-back-ios-mono"
                    color={adaptive.grey700}
                    ratio="1/1"
                  />
                </span>
              </button>
            </div>
            <div className="calendar-calendar-block">
              <div className="calendar-weekdays">
                {weekdays.map(d => (
                  <Text
                    key={d}
                    color={adaptive.grey500}
                    typography="t6"
                    fontWeight="regular"
                    textAlign="center"
                    display="block"
                  >
                    {d}
                  </Text>
                ))}
              </div>
              <Spacing size={12} />
              <div className="calendar-grid">
                {pickDateCells.map(cell => {
                  if (!cell.inMonth) {
                    return (
                      <div key={cell.key} className="calendar-day calendar-day--muted">
                        <span className="calendar-day-range-slot" aria-hidden={true} />
                        <span className="calendar-day-inner">
                          <Text
                            color={adaptive.grey300}
                            typography="t5"
                            fontWeight="medium"
                            textAlign="center"
                            display="block"
                          >
                            {cell.day}
                          </Text>
                          <span className="calendar-day-markers" aria-hidden={true} />
                        </span>
                      </div>
                    );
                  }
                  const isSelected = pickDateDay === cell.day;
                  const isToday =
                    today.getFullYear() === pickDateYear &&
                    today.getMonth() === pickDateMonth &&
                    today.getDate() === cell.day;
                  const labelColor = isSelected
                    ? adaptive.background
                    : isToday
                      ? adaptive.grey700
                      : adaptive.grey600;
                  return (
                    <button
                      key={cell.key}
                      type="button"
                      className={`calendar-day-btn${isSelected ? " calendar-day-btn--selected" : ""}${isToday && !isSelected ? " calendar-day-btn--today" : ""}`}
                      onClick={() => setPickDateDay(cell.day)}
                    >
                      <span className="calendar-day-range-slot" aria-hidden={true} />
                      <span className="calendar-day-inner">
                        <Text
                          color={labelColor}
                          typography="t5"
                          fontWeight="medium"
                          textAlign="center"
                          display="block"
                        >
                          {cell.day}
                        </Text>
                        <span className="calendar-day-markers" aria-hidden={true} />
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <Spacing size={24} />
            <Text color={adaptive.grey600} typography="t6" fontWeight="regular" textAlign="center">
              {pickDateYear}년 {pickDateMonth + 1}월 {pickDateDay}일
              {datePickRole === "end" ? " · 종료일" : " · 시작일"}
            </Text>
          </div>
          <BottomCTA.Single onClick={confirmPickDateAndContinue}>다음</BottomCTA.Single>
        </section>
      )}

      {mode === "addEvent" && (
        <section className="screen calendar-add-event-screen">
          <div className="calendar-add-event-inner">
            <div className="calendar-chip-row" role="tablist" aria-label="입력 유형">
              <button
                type="button"
                role="tab"
                aria-selected={chipTab === "schedule"}
                className={`calendar-chip-tab${chipTab === "schedule" ? " calendar-chip-tab--selected" : ""}`}
                onClick={() => setChipTab("schedule")}
              >
                일정 추가
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={chipTab === "spend"}
                className={`calendar-chip-tab${chipTab === "spend" ? " calendar-chip-tab--selected" : ""}`}
                onClick={() => setChipTab("spend")}
              >
                소비 입력
              </button>
            </div>

            {chipTab === "schedule" ? (
              <>
                <Spacing size={16} />
                <ListHeader
                  title={
                    <ListHeader.TitleParagraph
                      color={adaptive.grey800}
                      fontWeight="bold"
                      typography="t4"
                    >
                      일정 추가하기
                    </ListHeader.TitleParagraph>
                  }
                  descriptionPosition="bottom"
                />
                <Spacing size={12} />
                <ProgressStepper variant="icon" activeStepIndex={scheduleWizardStep} checkForFinish={true}>
                  <ProgressStep title="날짜" />
                  <ProgressStep title="무엇?" />
                  <ProgressStep title="몇 시?" />
                  <ProgressStep title="누구?" />
                  <ProgressStep title="예상?" />
                  <ProgressStep title="반복" />
                </ProgressStepper>
                <Spacing size={20} />
                {scheduleWizardStep === 0 ? (
                  <>
                    <Text color={adaptive.grey600} typography="t6" fontWeight="regular" display="block">
                      시작·종료를 눌러 달력에서 고르세요. 하루만이면 종료를 시작과 같게 두면 돼요.
                    </Text>
                    <Spacing size={12} />
                    <ListRow
                      arrowType="right"
                      withTouchEffect={true}
                      onClick={reopenPickDateFromForm}
                      contents={
                        <ListRow.Texts
                          type="2RowTypeA"
                          top="시작일"
                          topProps={{ color: adaptive.grey600 }}
                          bottom={`${eventYear}년 ${eventMonth + 1}월 ${eventDay}일`}
                          bottomProps={{ color: adaptive.grey700, fontWeight: "bold" }}
                        />
                      }
                      verticalPadding="large"
                    />
                    <ListRow
                      arrowType="right"
                      withTouchEffect={true}
                      onClick={reopenPickEndDateFromForm}
                      contents={
                        <ListRow.Texts
                          type="2RowTypeA"
                          top="종료일"
                          topProps={{ color: adaptive.grey600 }}
                          bottom={`${eventEndYear}년 ${eventEndMonth + 1}월 ${eventEndDay}일${
                            new Date(eventEndYear, eventEndMonth, eventEndDay).getTime() <=
                            new Date(eventYear, eventMonth, eventDay).getTime()
                              ? " (당일)"
                              : ""
                          }`}
                          bottomProps={{ color: adaptive.grey700, fontWeight: "bold" }}
                        />
                      }
                      verticalPadding="large"
                    />
                  </>
                ) : null}
                {scheduleWizardStep === 1 ? (
                  <TextField.Clearable
                    variant="box"
                    hasError={false}
                    label="이름 또는 제목"
                    labelOption="sustain"
                    value={eventTitle}
                    placeholder="예) 넷플릭스, 팀 회식, 병원"
                    onChange={e => setEventTitle(e.target.value)}
                  />
                ) : null}
                {scheduleWizardStep === 2 ? (
                  <TextField.Clearable
                    variant="box"
                    hasError={false}
                    label="몇 시에 만나나요?"
                    labelOption="sustain"
                    value={eventTime}
                    placeholder="예) 12:30 (선택)"
                    onChange={e => setEventTime(e.target.value)}
                  />
                ) : null}
                {scheduleWizardStep === 3 ? (
                  <TextField.Clearable
                    variant="box"
                    hasError={false}
                    label="몇명이서 만나나요?"
                    labelOption="sustain"
                    value={eventHeadcount}
                    placeholder="예) 2명 (선택)"
                    onChange={e => setEventHeadcount(e.target.value)}
                  />
                ) : null}
                {scheduleWizardStep === 4 ? (
                  <>
                    <Text color={adaptive.grey700} typography="t5" fontWeight="regular" display="block">
                      이번에 쓸 것 같은 소비 항목을 골라 주세요
                    </Text>
                    <Spacing size={14} />
                    <div className="spend-category-grid">
                      {SPEND_CATEGORIES.map(cat => (
                        <button
                          key={cat}
                          type="button"
                          className={`spend-category-chip${
                            scheduleEventCategories.includes(cat) ? " spend-category-chip--selected" : ""
                          }`}
                          onClick={() =>
                            setScheduleEventCategories(prev =>
                              prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat],
                            )
                          }
                        >
                          {cat}
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}
                {scheduleWizardStep === 5 ? (
                  <>
                    <Text color={adaptive.grey700} typography="t5" fontWeight="regular" display="block">
                      달력에 반복해서 표시할까요?
                    </Text>
                    <Spacing size={14} />
                    <div className="spend-category-grid">
                      {(
                        [
                          { v: "none" as const, label: "반복 없음" },
                          { v: "daily" as const, label: "매일" },
                          { v: "weekly" as const, label: "매주" },
                          { v: "monthly" as const, label: "매달" },
                        ] as const
                      ).map(({ v, label }) => (
                        <button
                          key={v}
                          type="button"
                          className={`spend-category-chip${eventRecurrence === v ? " spend-category-chip--selected" : ""}`}
                          onClick={() => setEventRecurrence(v)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <Spacing size={24} />
                    <Text color={adaptive.grey700} typography="t5" fontWeight="regular" display="block">
                      소비·예산 알림에 포함할까요?
                    </Text>
                    <Spacing size={10} />
                    <div className="spend-category-grid">
                      <button
                        type="button"
                        className={`spend-category-chip${!eventExcludeFromSpend ? " spend-category-chip--selected" : ""}`}
                        onClick={() => setEventExcludeFromSpend(false)}
                      >
                        소비 기록 대상
                      </button>
                      <button
                        type="button"
                        className={`spend-category-chip${eventExcludeFromSpend ? " spend-category-chip--selected" : ""}`}
                        onClick={() => setEventExcludeFromSpend(true)}
                      >
                        소비 집계 제외
                      </button>
                    </div>
                  </>
                ) : null}
              </>
            ) : (
              <>
                <Spacing size={16} />
                {calendarEvents.length === 0 ? (
                  <Text color={adaptive.grey600} typography="t5" fontWeight="regular">
                    먼저 「일정 추가」 탭에서 일정을 등록한 뒤, 여기서 그 일정에 맞는 소비를 남겨 주세요.
                  </Text>
                ) : spendPickerSlots.length === 0 ? (
                  <Text color={adaptive.grey600} typography="t5" fontWeight="regular">
                    소비는 해당 날이 지난 뒤에만 남길 수 있어요. 오늘 기준으로 이미 끝난 항목이 없거나, 끝난 항목에는
                    모두 입력했어요. 아직 날이 안 지난 항목은 그날이 지난 뒤에 다시 확인해 주세요.
                  </Text>
                ) : (
                  <>
                    {editingSpendEntryId != null ? (
                      <>
                        <Text color={adaptive.blue500} typography="t6" fontWeight="semibold" display="block">
                          소비 기록 수정 중
                        </Text>
                        <Spacing size={10} />
                        {(() => {
                          const ev = calendarEvents.find(e => e.id === spendSelectedEventId);
                          if (!ev) {
                            return null;
                          }
                          return (
                            <div className="calendar-spend-edit-summary">
                              <Text color={adaptive.grey600} typography="t7" fontWeight="regular" display="block">
                                연결된 항목
                              </Text>
                              <Spacing size={4} />
                              <Text color={adaptive.grey800} typography="t5" fontWeight="bold" display="block">
                                {ev.title.trim() || "제목 없음"}
                              </Text>
                              <Text color={adaptive.grey600} typography="t7" fontWeight="regular" display="block">
                                {formatCalendarEventDateLine(ev)}
                                {ev.timeLabel.trim() ? ` · ${ev.timeLabel.trim()}` : ""}
                              </Text>
                              {spendSelectedOccurrenceYmd != null ? (
                                <>
                                  <Spacing size={4} />
                                  <Text color={adaptive.grey500} typography="t7" fontWeight="medium" display="block">
                                    이번 회차 {spendSelectedOccurrenceYmd.replace(/-/g, ".")}
                                  </Text>
                                </>
                              ) : null}
                            </div>
                          );
                        })()}
                        <Spacing size={20} />
                      </>
                    ) : (
                      <>
                        <Text color={adaptive.grey800} typography="t6" fontWeight="semibold" display="block">
                          어느 항목의 소비인가요?
                        </Text>
                        <Spacing size={10} />
                        <div className="calendar-spend-event-picker" role="listbox" aria-label="항목 선택">
                          {spendPickerSlots.map(slot => {
                            const ev = calendarEvents.find(e => e.id === slot.eventId);
                            if (!ev) {
                              return null;
                            }
                            const selected =
                              spendSelectedEventId === slot.eventId &&
                              (spendSelectedOccurrenceYmd ?? null) === (slot.occurrenceYmd ?? null);
                            return (
                              <button
                                key={`${slot.eventId}-${slot.occurrenceYmd ?? "once"}`}
                                type="button"
                                role="option"
                                aria-selected={selected}
                                className={`calendar-spend-event-option${selected ? " calendar-spend-event-option--selected" : ""}`}
                                onClick={() => {
                                  setSpendSelectedEventId(slot.eventId);
                                  setSpendSelectedOccurrenceYmd(slot.occurrenceYmd);
                                }}
                              >
                                <Text color={adaptive.grey800} typography="t5" fontWeight="bold" display="block">
                                  {ev.title}
                                </Text>
                                <Text color={adaptive.grey600} typography="t7" fontWeight="regular" display="block">
                                  {slot.occurrenceYmd != null
                                    ? `이번 회차 ${slot.occurrenceYmd.replace(/-/g, ".")}`
                                    : `${formatCalendarEventDateLine(ev)}${ev.timeLabel.trim() ? ` · ${ev.timeLabel.trim()}` : ""}`}
                                </Text>
                                {formatEventPlannedCategoriesShort(ev) != null ? (
                                  <>
                                    <Spacing size={4} />
                                    <Text color={adaptive.grey500} typography="t7" fontWeight="medium" display="block">
                                      {formatEventPlannedCategoriesShort(ev)}
                                    </Text>
                                  </>
                                ) : null}
                              </button>
                            );
                          })}
                        </div>
                        <Spacing size={20} />
                      </>
                    )}
                    <TextField.Clearable
                      variant="box"
                      hasError={false}
                      label="금액"
                      labelOption="sustain"
                      value={spendAmount}
                      placeholder="금액 입력"
                      suffix="원"
                      format={priceFormat}
                      onChange={e => setSpendAmount(e.target.value)}
                    />
                    <Spacing size={20} />
                    <Text color={adaptive.grey700} typography="t5" fontWeight="regular" display="block">
                      카테고리를 정해보세요! (여러 개 선택 가능)
                    </Text>
                    <Spacing size={14} />
                    <div className="spend-category-grid">
                      {SPEND_CATEGORIES.map(cat => (
                        <button
                          key={cat}
                          type="button"
                          className={`spend-category-chip${spendCategories.includes(cat) ? " spend-category-chip--selected" : ""}`}
                          onClick={() =>
                            setSpendCategories(prev =>
                              prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat],
                            )
                          }
                        >
                          {cat}
                        </button>
                      ))}
                    </div>
                    <Spacing size={24} />
                    <div className="spend-rating-wrap">
                      <Rating
                        readOnly={false}
                        value={spendRating}
                        max={5}
                        size="big"
                        aria-label="별점 평가"
                        aria-valuetext={`5점 만점 중 ${spendRating}점`}
                        onValueChange={setSpendRating}
                      />
                    </div>
                  </>
                )}
              </>
            )}

            <Spacing size={32} />
          </div>

          {chipTab === "schedule" ? (
            scheduleWizardStep === 0 ? (
              <BottomCTA.Double
                leftButton={
                  <CTAButton color="dark" variant="weak" onClick={leaveScheduleAddFlow}>
                    닫기
                  </CTAButton>
                }
                rightButton={
                  <CTAButton
                    onClick={() => setScheduleWizardStep(1)}
                    disabled={!scheduleWizardCanGoNext}
                  >
                    다음
                  </CTAButton>
                }
              />
            ) : scheduleWizardStep < SCHEDULE_WIZARD_LAST_STEP ? (
              <BottomCTA.Double
                leftButton={
                  <CTAButton
                    color="dark"
                    variant="weak"
                    onClick={() => setScheduleWizardStep(s => Math.max(0, s - 1))}
                  >
                    이전
                  </CTAButton>
                }
                rightButton={
                  <CTAButton
                    onClick={() => setScheduleWizardStep(s => s + 1)}
                    disabled={!scheduleWizardCanGoNext}
                  >
                    다음
                  </CTAButton>
                }
              />
            ) : (
              <BottomCTA.Double
                leftButton={
                  <CTAButton
                    color="dark"
                    variant="weak"
                    onClick={() => setScheduleWizardStep(SCHEDULE_WIZARD_LAST_STEP - 1)}
                  >
                    이전
                  </CTAButton>
                }
                rightButton={
                  <CTAButton
                    onClick={
                      editingCalendarEventId != null
                        ? planIncludesSubscriptionOtt(scheduleEventCategories)
                          ? () => openSubscriptionManualAmountFlow(estimatedWon)
                          : saveEditedCalendarEventFromWizard
                        : planIncludesSubscriptionOtt(scheduleEventCategories)
                          ? () => openSubscriptionManualAmountFlow()
                          : requestSpendEstimateAndShow
                    }
                  >
                    {editingCalendarEventId != null ? "저장" : "추가하기"}
                  </CTAButton>
                }
              />
            )
          ) : (
            <BottomCTA.Double
              leftButton={
                <CTAButton
                  color="dark"
                  variant="weak"
                  onClick={() =>
                    editingSpendEntryId != null ? cancelSpendForm() : onModeChange("calendar")
                  }
                >
                  {editingSpendEntryId != null ? "취소" : "닫기"}
                </CTAButton>
              }
              rightButton={
                <CTAButton disabled={!spendSubmitEnabled} onClick={commitSpendEntry}>
                  {editingSpendEntryId != null ? "저장" : "추가하기"}
                </CTAButton>
              }
            />
          )}
        </section>
      )}

      {mode === "eventEstimate" && (
        <section className="screen event-estimate-screen">
          <div className="event-estimate-inner">
            <Spacing size={160} />
            <div className="event-estimate-emoji">
              <Asset.Image
                frameShape={Asset.frameShape.CleanW100}
                backgroundColor="transparent"
                src={SUN_EMOJI_3D}
                aria-hidden={true}
                style={{ aspectRatio: "1/1" }}
              />
            </div>
            <Spacing size={24} />
            <Text
              display="block"
              color={adaptive.grey800}
              typography="t2"
              fontWeight="bold"
              textAlign="center"
            >
              1인당 예상 소비 금액
            </Text>
            <Spacing size={8} />
            <Text
              display="block"
              color={adaptive.grey600}
              typography="t6"
              fontWeight="regular"
              textAlign="center"
            >
              {eventTitle.trim() || "제목 없음"} ·{" "}
              {formatYmdRangeLine(
                eventYear,
                eventMonth,
                eventDay,
                eventEndYear,
                eventEndMonth,
                eventEndDay,
              )}
              {eventTime.trim() ? ` · ${eventTime.trim()}` : ""}
              {eventHeadcount.trim() ? ` · ${eventHeadcount.trim()}` : ""}
            </Text>
            <Spacing size={16} />
            <Text
              display="block"
              color={adaptive.grey700}
              typography="t1"
              fontWeight="bold"
              textAlign="center"
            >
              {estimateLoading
                ? "계산 중…"
                : estimatedWon != null
                  ? `${priceFormat.transform(estimatedWon)}원`
                  : "—"}
            </Text>
            {import.meta.env.VITE_SPEND_ESTIMATE_API_URL ? (
              <>
                <Spacing size={12} />
                <Text
                  display="block"
                  color={adaptive.grey500}
                  typography="t7"
                  fontWeight="regular"
                  textAlign="center"
                >
                  AI 연동됨 · 값은 항상 1인당으로 저장돼요. 합계만 보낼 때는 estimatedUnit을
                  「total」로 주거나 isTotal: true 를 넣어 주세요.
                </Text>
              </>
            ) : null}
          </div>
          <FixedBottomCTA
            loading={estimateLoading}
            disabled={estimateLoading}
            onClick={() => finishEstimateAndReturnToCalendar()}
          >
            확인했어요
          </FixedBottomCTA>
        </section>
      )}

      {mode === "eventManualAmount" && (
        <section className="screen event-estimate-screen">
          <div className="event-estimate-inner">
            <Spacing size={72} />
            <Text
              display="block"
              color={adaptive.grey800}
              typography="t2"
              fontWeight="bold"
              textAlign="center"
            >
              구독·OTT 1인당 금액
            </Text>
            <Spacing size={8} />
            <Text
              display="block"
              color={adaptive.grey600}
              typography="t6"
              fontWeight="regular"
              textAlign="center"
            >
              {eventTitle.trim() || "제목 없음"} ·{" "}
              {formatYmdRangeLine(
                eventYear,
                eventMonth,
                eventDay,
                eventEndYear,
                eventEndMonth,
                eventEndDay,
              )}
            </Text>
            <Spacing size={28} />
            <TextField.Clearable
              variant="box"
              hasError={false}
              label="월 이용료 (1인 기준)"
              labelOption="sustain"
              value={manualPerPersonAmount}
              placeholder="금액 입력"
              suffix="원"
              format={priceFormat}
              onChange={e => setManualPerPersonAmount(e.target.value)}
            />
          </div>
          <FixedBottomCTA
            loading={false}
            disabled={!manualAmountSubmitEnabled}
            onClick={confirmManualPerPersonAmount}
          >
            캘린더에 추가하기
          </FixedBottomCTA>
        </section>
      )}

      {mode === "spendOverAlert" && (
        <section className="screen spend-alert-screen">
          <div className="spend-alert-inner">
            <Spacing size={160} />
            <div className="spend-alert-lottie">
              <Asset.Lottie
                frameShape={Asset.frameShape.CleanW100}
                backgroundColor="transparent"
                src={SIREN_LOTTIE_SRC}
                loop={true}
                speed={1}
                aria-hidden={true}
                style={{ aspectRatio: "1/1" }}
              />
            </div>
            <Spacing size={24} />
            <Text
              display="block"
              color={adaptive.grey800}
              typography="t2"
              fontWeight="bold"
              textAlign="center"
            >
              일침 경보 🐝
            </Text>
            <Spacing size={8} />
            <Text
              display="block"
              color={adaptive.grey700}
              typography="t1"
              fontWeight="bold"
              textAlign="center"
            >
              소비를 줄이세요!
            </Text>
            {spendFeedbackEvent && spendAlertCap != null ? (
              <>
                <Spacing size={16} />
                <Text
                  display="block"
                  color={adaptive.grey600}
                  typography="t6"
                  fontWeight="regular"
                  textAlign="center"
                >
                  {spendFeedbackEvent.title} · 예상 {priceFormat.transform(spendAlertCap)}원보다{" "}
                  {priceFormat.transform(spendAlertSpent)}원 썼어요
                </Text>
              </>
            ) : null}
          </div>
          <FixedBottomCTA loading={false} onClick={onDismissSpendFeedbackAlert}>
            확인했어요
          </FixedBottomCTA>
        </section>
      )}

      {mode === "spendPraiseAlert" && (
        <section className="screen spend-alert-screen">
          <div className="spend-alert-inner">
            <Spacing size={160} />
            <Asset.Icon
              frameShape={Asset.frameShape.CleanW100}
              backgroundColor="transparent"
              name="icon-u1F44F_u1F3FB"
              aria-hidden={true}
              ratio="1/1"
            />
            <Spacing size={24} />
            <Text
              display="block"
              color={adaptive.grey800}
              typography="t2"
              fontWeight="bold"
              textAlign="center"
            >
              이대로라면 건물주 확정이에요!
            </Text>
            <Text
              display="block"
              color={adaptive.grey700}
              typography="t5"
              fontWeight="regular"
              textAlign="center"
            >
              꿀벌집 + 1
            </Text>
            {spendFeedbackEvent && spendAlertCap != null ? (
              <>
                <Spacing size={16} />
                <Text
                  display="block"
                  color={adaptive.grey600}
                  typography="t6"
                  fontWeight="regular"
                  textAlign="center"
                >
                  {spendFeedbackEvent.title} · 예상 {priceFormat.transform(spendAlertCap)}원 안에서{" "}
                  {priceFormat.transform(spendAlertSpent)}원 썼어요
                </Text>
              </>
            ) : null}
          </div>
          <FixedBottomCTA loading={false} onClick={onDismissSpendFeedbackAlert}>
            확인했어요
          </FixedBottomCTA>
        </section>
      )}

    </>
  );
}

function SurveyQuizScreen({
  onBack,
  onComplete,
}: {
  onBack: () => void;
  onComplete: (path: string) => void;
}) {
  const [path, setPath] = useState("");
  const qIndex = path.length;
  const node = SURVEY_QUESTIONS[qIndex];
  const progressLabel = `${qIndex + 1} / ${SURVEY_QUESTION_COUNT}`;

  const choose = (bit: "A" | "B") => {
    const next = path + bit;
    if (next.length >= SURVEY_QUESTION_COUNT) {
      onComplete(next);
      return;
    }
    setPath(next);
  };

  const handleBack = () => {
    if (path.length > 0) {
      setPath(p => p.slice(0, -1));
      return;
    }
    onBack();
  };

  if (!node) {
    return null;
  }

  return (
    <section className="screen survey-quiz-screen">
      <div className="survey-quiz-head">
        <Text color={adaptive.grey500} typography="t7">
          소비 유형 설문 {progressLabel}
        </Text>
        <Spacing size={12} />
        <Text color={adaptive.grey900} typography="t5" fontWeight="semibold" className="survey-quiz-title">
          {node.title}
        </Text>
      </div>
      <Spacing size={28} />
      <div className="survey-quiz-options" role="list">
        <button type="button" className="survey-quiz-option" onClick={() => choose("A")}>
          <Text color={adaptive.grey800} typography="t6" fontWeight="medium">
            {node.optionA}
          </Text>
        </button>
        <button type="button" className="survey-quiz-option" onClick={() => choose("B")}>
          <Text color={adaptive.grey800} typography="t6" fontWeight="medium">
            {node.optionB}
          </Text>
        </button>
      </div>
      <Spacing size={24} />
      <button type="button" className="survey-quiz-backlink" onClick={handleBack}>
        <Text color={adaptive.grey600} typography="t7" fontWeight="medium">
          {path.length > 0 ? "이전 답으로" : "이전 화면으로"}
        </Text>
      </button>
    </section>
  );
}

function SurveyLoadingScreen({ onDone }: { onDone: () => void }) {
  return (
    <section className="screen survey-loading-screen">
      <Spacing size={160} />
      <Asset.Image
        frameShape={Asset.frameShape.CleanW100}
        backgroundColor="transparent"
        src={SURVEY_LOADING_COIN}
        aria-hidden={true}
        style={{ aspectRatio: "1/1" }}
      />
      <Spacing size={24} />
      <div className="survey-loading-copy">
        <Text color={adaptive.grey800} typography="t2" fontWeight="bold">
          당신의 소비 유형을 확인중입니다.
        </Text>
        <Spacing size={8} />
        <Text color={adaptive.grey700} typography="t5" fontWeight="regular">
          AI 스마트 캘린더 비코노미
        </Text>
      </div>
      <BottomCTA.Single onClick={onDone}>확인하기</BottomCTA.Single>
    </section>
  );
}

function SurveyResultScreen({
  path,
  nickname,
  onHome,
}: {
  path: string;
  nickname: string;
  onHome: () => void;
}) {
  const typeId = resolveConsumerType(path);
  const profile = CONSUMER_TYPES[typeId];
  const emojiSrc = `https://static.toss.im/2d-emojis/png/4x/${profile.emoji}.png`;
  const nameForLine = nickname.trim() || "회원";

  return (
    <section className="screen survey-result-screen">
      <div className="survey-result-hero">
        <Post.H2 paddingBottom={24}>나의 소비 유형</Post.H2>
        <Asset.Image
          frameShape={Asset.frameShape.CleanW250}
          backgroundColor="transparent"
          src={emojiSrc}
          aria-hidden={true}
          style={{ aspectRatio: "1/1" }}
        />
        <Spacing size={16} />
        <Text
          color={adaptive.grey700}
          typography="t2"
          fontWeight="bold"
          className="survey-result-type-title"
          aria-label={profile.label}
        >
          {profile.label}
        </Text>
      </div>
      <Spacing size={24} />
      <div className="survey-result-detail">
        <ListHeader
          title={
            <ListHeader.TitleParagraph
              color={adaptive.grey800}
              fontWeight="bold"
              typography="t5"
            >
              {nameForLine}님은 {profile.label}에요!
            </ListHeader.TitleParagraph>
          }
          descriptionPosition="bottom"
        />
        <Spacing size={8} />
        <Badge size="xsmall" variant="weak" color="blue">
          소비 유형
        </Badge>
        <Spacing size={24} />
        <Text
          display="block"
          color={adaptive.grey700}
          typography="t5"
          fontWeight="regular"
          className="survey-result-body"
        >
          {profile.description}
        </Text>
      </div>
      <BottomCTA.Single onClick={onHome}>확인했어요</BottomCTA.Single>
    </section>
  );
}

function SurveyScreen({ onNext }: { onNext: () => void }) {
  return (
    <section className="screen survey-screen">
      <div className="survey-copy">
        <Text color={adaptive.grey900} typography="t4" fontWeight="semibold" className="survey-headline">
          나의 소비 유형은?
        </Text>
        <Spacing size={16} />
        <Text color={adaptive.grey600} typography="t7" className="survey-lead">
          7개의 질문에 답하면 비코노미가 나에게 맞는 소비 성향(5가지 유형)을 정리해 드려요.
        </Text>
      </div>
      <Spacing size={56} />
      <div className="emoji-row survey-emoji">
        <Asset.Image
          frameShape={Asset.frameShape.CleanW100}
          backgroundColor="transparent"
          src="https://static.toss.im/2d-emojis/png/4x/u1F913.png"
          aria-hidden={true}
          style={{ aspectRatio: "1/1" }}
        />
      </div>
      <BottomCTA.Single onClick={onNext}>나의 소비유형 확인하기</BottomCTA.Single>
    </section>
  );
}

export default App;
