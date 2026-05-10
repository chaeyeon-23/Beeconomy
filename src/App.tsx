import { useCallback, useEffect, useMemo, useState } from "react";
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
import { resolveSpendEstimate } from "./spendEstimate";
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

type CalendarEventRecord = {
  id: string;
  year: number;
  monthIndex: number;
  day: number;
  title: string;
  timeLabel: string;
  headcountLabel: string;
  estimatedWonPerPerson: number | null;
};

function isCalendarEventRecord(x: unknown): x is CalendarEventRecord {
  if (x == null || typeof x !== "object") {
    return false;
  }
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.year === "number" &&
    typeof o.monthIndex === "number" &&
    typeof o.day === "number" &&
    typeof o.title === "string" &&
    typeof o.timeLabel === "string" &&
    typeof o.headcountLabel === "string" &&
    (o.estimatedWonPerPerson === null || typeof o.estimatedWonPerPerson === "number")
  );
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

function buildHoneyChallengeInviteUrl(inviteId: string): string {
  const url = new URL(window.location.href);
  url.searchParams.set("hive", inviteId);
  return url.toString();
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

const SPEND_ENTRIES_KEY = "bikonomy_spend_entries";
const HONEY_JAR_INDEX_KEY = "bikonomy_honey_jar_index";
const HONEY_JAR_INDEX_DEFAULT = 50;
/** 소비 칭찬/경고 알림 1회당 지수 변화 (0~100 누적) */
const HONEY_JAR_INDEX_DELTA = 6;

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

const SPEND_CATEGORIES = [
  "식비",
  "카페·간식",
  "교통",
  "쇼핑",
  "문화·여가",
  "의료",
  "기타",
] as const;

type SpendEntryRecord = {
  id: string;
  eventId: string;
  amountWon: number;
  category: string;
  rating: number;
};

function isSpendEntryRecord(x: unknown): x is SpendEntryRecord {
  if (x == null || typeof x !== "object") {
    return false;
  }
  const o = x as Record<string, unknown>;
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

function sortCalendarEventsByDateDesc(events: CalendarEventRecord[]): CalendarEventRecord[] {
  return [...events].sort((a, b) => {
    const ta = new Date(a.year, a.monthIndex, a.day).getTime();
    const tb = new Date(b.year, b.monthIndex, b.day).getTime();
    return tb - ta;
  });
}

const SIREN_LOTTIE_SRC = "https://static.toss.im/lotties-common/siren-2-spot.json";

function parseHeadcountFromLabel(s: string): number {
  const m = s.match(/(\d+)/);
  if (!m) {
    return 1;
  }
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 50) : 1;
}

/** AI 1인당 예상 × 인원(추정) = 이번 일정 예상 총액 */
function estimatedBudgetWonForEvent(ev: CalendarEventRecord): number | null {
  if (ev.estimatedWonPerPerson == null || !Number.isFinite(ev.estimatedWonPerPerson)) {
    return null;
  }
  const people = Math.max(1, parseHeadcountFromLabel(ev.headcountLabel));
  return Math.round(ev.estimatedWonPerPerson * people);
}

function totalSpentWonForEvent(eventId: string, entries: SpendEntryRecord[]): number {
  return entries.filter(e => e.eventId === eventId).reduce((sum, e) => sum + e.amountWon, 0);
}

type CalendarFlowMode =
  | "calendar"
  | "pickDate"
  | "addEvent"
  | "eventEstimate"
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

/** 3단 이진 설문 (A/B). 키 = 지금까지 선택한 경로 "" | "A" | "AB" … (마지막 질문 전까지). */
const SURVEY_TREE: Record<string, { title: string; optionA: string; optionB: string }> = {
  "": {
    title: "소비를 시작할 때 나의 마음가짐은?",
    optionA: "[A] 내 예산과 계획 안에서 통제해야 마음이 편하다.",
    optionB: "[B] 꽂히면 일단 사야 직성이 풀린다.",
  },
  A: {
    title: "비코노미가 내 소비 패턴을 분석해 완벽한 맞춤 혜택과 소비를 추천해 준다면?",
    optionA: '[A] "오, 꿀팁인데?" 적극적으로 참고하고 유행이나 추천을 수용한다.',
    optionB: '[B] "추천은 고맙지만 결제는 내 맘이야." 굳이 청개구리처럼 다른 걸 산다.',
  },
  B: {
    title: "비코노미가 내 소비 패턴을 분석해 완벽한 맞춤 혜택과 소비를 추천해 준다면?",
    optionA: '[A] "오, 꿀팁인데?" 적극적으로 참고하고 유행이나 추천을 수용한다.',
    optionB: '[B] "추천은 고맙지만 결제는 내 맘이야." 굳이 청개구리처럼 다른 걸 산다.',
  },
  AA: {
    title: "돈에 대한 나의 궁극적인 스탠스는?",
    optionA: "[A] 일단 쓰고 보자! 나를 위한 확실한 보상과 행복이 먼저.",
    optionB: "[B] 안 쓰는 게 버는 것! 미래를 위한 든든한 저축과 절약이 먼저.",
  },
  AB: {
    title: "돈에 대한 나의 궁극적인 스탠스는?",
    optionA: "[A] 일단 쓰고 보자! 나를 위한 확실한 보상과 행복이 먼저.",
    optionB: "[B] 안 쓰는 게 버는 것! 미래를 위한 든든한 저축과 절약이 먼저.",
  },
  BA: {
    title: "돈에 대한 나의 궁극적인 스탠스는?",
    optionA: "[A] 일단 쓰고 보자! 나를 위한 확실한 보상과 행복이 먼저.",
    optionB: "[B] 안 쓰는 게 버는 것! 미래를 위한 든든한 저축과 절약이 먼저.",
  },
  BB: {
    title: "돈에 대한 나의 궁극적인 스탠스는?",
    optionA: "[A] 일단 쓰고 보자! 나를 위한 확실한 보상과 행복이 먼저.",
    optionB: "[B] 안 쓰는 게 버는 것! 미래를 위한 든든한 저축과 절약이 먼저.",
  },
};

/** 8개 끝경로(AAA…BBB) → 5가지 소비 유형 */
const PATH_TO_CONSUMER_TYPE: Record<string, ConsumerTypeId> = {
  AAA: "honey_impulse",
  AAB: "honey_planner",
  ABA: "honey_balanced",
  ABB: "honey_saver",
  BAA: "honey_free",
  BAB: "honey_planner",
  BBA: "honey_balanced",
  BBB: "honey_saver",
};

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
  const id = PATH_TO_CONSUMER_TYPE[path];
  return id ?? "honey_balanced";
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
const priceFormat = {
  transform: (value: string | number) =>
    `${value}`.replace(/\D/g, "").replace(/\B(?=(\d{3})+(?!\d))/g, ","),
  reset: (value: string | number) => `${value}`.replace(/\D/g, ""),
};

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
  return parts.length > 0 ? parts.join(" · ") : "세부 정보 없음";
}

function formatCalendarListRowDetail(ev: CalendarEventRecord): string {
  const sub = formatCalendarEventSubtitle(ev);
  const head = `${ev.day}일 · ${ev.title}`;
  return sub !== "세부 정보 없음" ? `${head} · ${sub}` : head;
}

function calendarEventStartOfDayTs(ev: CalendarEventRecord): number {
  return new Date(ev.year, ev.monthIndex, ev.day).getTime();
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

/** 오늘 0시 이후(당일 포함) 가장 빠른 일정 */
function findNextCalendarEventFromToday(
  events: CalendarEventRecord[],
  today: Date,
): CalendarEventRecord | null {
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const upcoming = events.filter(ev => calendarEventStartOfDayTs(ev) >= startOfToday);
  if (upcoming.length === 0) {
    return null;
  }
  upcoming.sort((a, b) => {
    const ta = calendarEventStartOfDayTs(a);
    const tb = calendarEventStartOfDayTs(b);
    if (ta !== tb) {
      return ta - tb;
    }
    return a.id.localeCompare(b.id);
  });
  return upcoming[0];
}

function formatHomeNextEventDetail(ev: CalendarEventRecord): string {
  const sub = formatCalendarEventSubtitle(ev);
  const title = ev.title.trim() || "제목 없음";
  const head = `${ev.monthIndex + 1}월 ${ev.day}일 · ${title}`;
  return sub !== "세부 정보 없음" ? `${head} · ${sub}` : head;
}

function formatBudgetKrw(budget: string): string {
  const digits = priceFormat.reset(budget);
  if (digits === "") {
    return "0원";
  }
  return `${priceFormat.transform(digits)}원`;
}

function App() {
  const [screen, setScreen] = useState<Screen>("welcome");
  const [agreed, setAgreed] = useState(false);
  const [nickname, setNickname] = useState(() => readStoredNickname());
  const [budget, setBudget] = useState("");
  const [surveyResultPath, setSurveyResultPath] = useState<string | null>(null);
  const [calendarMode, setCalendarMode] = useState<CalendarFlowMode>("calendar");
  const [spendAlertEventId, setSpendAlertEventId] = useState<string | null>(null);
  const [openSpendEntryFromHome, setOpenSpendEntryFromHome] = useState(false);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEventRecord[]>(() =>
    readStoredCalendarEvents(),
  );
  const [spendEntries, setSpendEntries] = useState<SpendEntryRecord[]>(() => readStoredSpendEntries());
  const [honeyJarIndex, setHoneyJarIndex] = useState(() => readStoredHoneyJarIndex());

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
    if (screen !== "calendar") {
      setCalendarMode("calendar");
      setSpendAlertEventId(null);
    }
  }, [screen]);

  const dismissSpendFeedbackAlert = () => {
    setSpendAlertEventId(null);
    setCalendarMode("addEvent");
  };

  const headerBack =
    screen === "calendar"
      ? () => {
          if (calendarMode === "spendOverAlert" || calendarMode === "spendPraiseAlert") {
            dismissSpendFeedbackAlert();
          } else if (calendarMode === "eventEstimate") {
            setCalendarMode("addEvent");
          } else if (calendarMode === "addEvent") {
            setCalendarMode("pickDate");
          } else if (calendarMode === "pickDate") {
            setCalendarMode("calendar");
          } else {
            setScreen("home");
          }
        }
      : screen === "honeyChallenge"
        ? () => setScreen("home")
        : undefined;

  return (
    <main className="app-shell">
      <AppHeader onBack={headerBack} />

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
          onNext={() => setScreen("home")}
        />
      )}
      {screen === "home" && (
        <HomeScreen
          remainingBudgetLabel={formatBudgetKrw(budget)}
          calendarEvents={calendarEvents}
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
          consumerTypeLabel={
            surveyResultPath
              ? CONSUMER_TYPES[resolveConsumerType(surveyResultPath)].label
              : null
          }
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
          onAddCalendarEvent={event => setCalendarEvents(prev => [...prev, event])}
          onAddSpendEntry={entry => {
            setSpendEntries(prev => {
              const next = [...prev, entry];
              const ev = calendarEvents.find(e => e.id === entry.eventId);
              const cap = ev ? estimatedBudgetWonForEvent(ev) : null;
              if (ev && cap != null && cap > 0) {
                const spent = totalSpentWonForEvent(entry.eventId, next);
                const isOver = spent > cap;
                queueMicrotask(() => {
                  setSpendAlertEventId(entry.eventId);
                  setCalendarMode(isOver ? "spendOverAlert" : "spendPraiseAlert");
                  setHoneyJarIndex(prev => {
                    const delta = isOver ? -HONEY_JAR_INDEX_DELTA : HONEY_JAR_INDEX_DELTA;
                    return Math.min(100, Math.max(0, prev + delta));
                  });
                });
              }
              return next;
            });
          }}
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
            setSurveyResultPath(null);
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
      <button
        className="icon-button"
        type="button"
        aria-label="뒤로 가기"
        onClick={() => onBack?.()}
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
          center={<StepperRow.Texts type="A" title="일정과 소비를 입력하면" description="" />}
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
  onEditBudget,
  onCalendar,
  onSpendEntry,
  onSurvey,
  onHoneyChallenge,
}: {
  remainingBudgetLabel: string;
  calendarEvents: CalendarEventRecord[];
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

  return (
    <section className="screen home-screen">
      <div className="emoji-row">
        <Asset.Image
          frameShape={Asset.frameShape.CleanW100}
          backgroundColor="transparent"
          src={HONEY_EMOJI}
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
              top="다음 일정은?"
              topProps={{ color: adaptive.grey600 }}
              bottom={
                nextCalendarEvent
                  ? formatHomeNextEventDetail(nextCalendarEvent)
                  : "캘린더에 일정을 추가해보세요"
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
      </List>
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
  consumerTypeLabel,
}: {
  honeyJarIndex: number;
  /** 설문 완료 시에만 유형명, 없으면 안내 문구를 따로 표시 */
  consumerTypeLabel: string | null;
}) {
  const [copyHint, setCopyHint] = useState<string | null>(null);
  const inviteId = useMemo(() => readOrCreateHiveInviteId(), []);
  const shareUrl = useMemo(() => buildHoneyChallengeInviteUrl(inviteId), [inviteId]);

  const shareHoneyLink = async () => {
    const ok = await copyTextToClipboard(shareUrl);
    setCopyHint(
      ok ? "초대 링크를 복사했어요. 친구에게 붙여넣기만 하면 돼요!" : "복사에 실패했어요. 잠시 후 다시 눌러주세요.",
    );
    if (ok) {
      window.setTimeout(() => setCopyHint(null), 2800);
    }
  };

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
          <>
            <Text
              display="block"
              color={adaptive.grey600}
              typography="t7"
              fontWeight="medium"
              textAlign="center"
            >
              나의 소비 유형
            </Text>
            <Spacing size={6} />
            <Text
              display="block"
              color={adaptive.grey500}
              typography="t7"
              fontWeight="regular"
              textAlign="center"
            >
              홈에서 소비유형 MBTI를 하면 유형이 여기에 표시돼요
            </Text>
          </>
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

/** 무엇?=제목, 언제?=시간(날짜는 앞 단계에서 선택), 누구?=인원. `checkForFinish`와 맞춤. */
function scheduleFormActiveStepIndex(title: string, time: string, headcount: string) {
  if (!title.trim()) {
    return 0;
  }
  if (!time.trim()) {
    return 1;
  }
  if (!headcount.trim()) {
    return 2;
  }
  return 2;
}

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
  onAddCalendarEvent,
  onAddSpendEntry,
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
  onAddCalendarEvent: (event: CalendarEventRecord) => void;
  onAddSpendEntry: (entry: SpendEntryRecord) => void;
}) {
  const today = useMemo(() => new Date(), []);
  const [viewYear, setViewYear] = useState(() => today.getFullYear());
  const [viewMonth, setViewMonth] = useState(() => today.getMonth());
  const [calendarSelectedDay, setCalendarSelectedDay] = useState(() =>
    clampDayToMonth(today.getFullYear(), today.getMonth(), today.getDate()),
  );

  const [chipTab, setChipTab] = useState<"schedule" | "spend">("schedule");
  const [spendSelectedEventId, setSpendSelectedEventId] = useState<string | null>(null);
  const [spendAmount, setSpendAmount] = useState("");
  const [spendCategory, setSpendCategory] = useState<string | null>(null);
  const [spendRating, setSpendRating] = useState(4);
  const [eventTitle, setEventTitle] = useState("");
  const [eventTime, setEventTime] = useState("");
  const [eventHeadcount, setEventHeadcount] = useState("");
  const [eventYear, setEventYear] = useState(() => today.getFullYear());
  const [eventMonth, setEventMonth] = useState(() => today.getMonth());
  const [eventDay, setEventDay] = useState(() => today.getDate());

  const [estimatedWon, setEstimatedWon] = useState<number | null>(null);
  const [estimateLoading, setEstimateLoading] = useState(false);

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

  const scheduleStepIndex = useMemo(
    () => scheduleFormActiveStepIndex(eventTitle, eventTime, eventHeadcount),
    [eventTitle, eventTime, eventHeadcount],
  );

  const eventDaysInViewMonth = useMemo(() => {
    const days = new Set<number>();
    for (const ev of calendarEvents) {
      if (ev.year === viewYear && ev.monthIndex === viewMonth) {
        days.add(ev.day);
      }
    }
    return days;
  }, [calendarEvents, viewYear, viewMonth]);

  const monthEventsSorted = useMemo(() => {
    return calendarEvents
      .filter(e => e.year === viewYear && e.monthIndex === viewMonth)
      .sort((a, b) => a.day - b.day || a.id.localeCompare(b.id));
  }, [calendarEvents, viewYear, viewMonth]);

  const eventsOnSelectedDay = useMemo(() => {
    return calendarEvents
      .filter(
        e =>
          e.year === viewYear &&
          e.monthIndex === viewMonth &&
          e.day === calendarSelectedDay,
      )
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
      const t = new Date(ev.year, ev.monthIndex, ev.day).getTime();
      if (t >= startOfToday) {
        upcoming.push(ev);
      } else {
        past.push(ev);
      }
    }
    return {
      nextEventInMonth: upcoming[0] ?? null,
      lastPastEventInMonth: past.at(-1) ?? null,
    };
  }, [monthEventsSorted, today]);

  useEffect(() => {
    if (!openSpendEntryFromHome || mode !== "addEvent") {
      return;
    }
    setChipTab("spend");
    onConsumeOpenSpendEntryFromHome();
  }, [openSpendEntryFromHome, mode, onConsumeOpenSpendEntryFromHome]);

  useEffect(() => {
    if (mode !== "addEvent" || chipTab !== "spend") {
      return;
    }
    setSpendSelectedEventId(prev => {
      if (prev != null && calendarEvents.some(e => e.id === prev)) {
        return prev;
      }
      const sorted = sortCalendarEventsByDateDesc(calendarEvents);
      return sorted[0]?.id ?? null;
    });
  }, [mode, chipTab, calendarEvents]);

  const spendSubmitEnabled = useMemo(() => {
    if (calendarEvents.length === 0 || spendSelectedEventId == null || spendCategory == null) {
      return false;
    }
    const digits = priceFormat.reset(spendAmount);
    if (digits === "") {
      return false;
    }
    const n = Number(digits);
    return Number.isFinite(n) && n > 0;
  }, [calendarEvents.length, spendSelectedEventId, spendCategory, spendAmount]);

  const commitSpendEntry = () => {
    if (!spendSubmitEnabled || spendSelectedEventId == null || spendCategory == null) {
      return;
    }
    const digits = priceFormat.reset(spendAmount);
    const n = Number(digits);
    onAddSpendEntry({
      id: newSpendEntryId(),
      eventId: spendSelectedEventId,
      amountWon: Math.round(n),
      category: spendCategory,
      rating: spendRating,
    });
    setSpendAmount("");
    setSpendCategory(null);
    setSpendRating(4);
  };

  const startPickDateFlow = () => {
    setPickDateYear(viewYear);
    setPickDateMonth(viewMonth);
    const sameAsToday =
      viewYear === today.getFullYear() && viewMonth === today.getMonth();
    const initialDay = sameAsToday ? today.getDate() : 1;
    setPickDateDay(clampDayToMonth(viewYear, viewMonth, initialDay));
    setEventTitle("");
    setEventTime("");
    setEventHeadcount("");
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
    setEventYear(pickDateYear);
    setEventMonth(pickDateMonth);
    setEventDay(pickDateDay);
    onModeChange("addEvent");
  };

  const reopenPickDateFromForm = () => {
    setPickDateYear(eventYear);
    setPickDateMonth(eventMonth);
    setPickDateDay(clampDayToMonth(eventYear, eventMonth, eventDay));
    onModeChange("pickDate");
  };

  const requestSpendEstimateAndShow = () => {
    onModeChange("eventEstimate");
  };

  const finishEstimateAndReturnToCalendar = () => {
    setViewYear(eventYear);
    setViewMonth(eventMonth);
    onAddCalendarEvent({
      id: newCalendarEventId(),
      year: eventYear,
      monthIndex: eventMonth,
      day: eventDay,
      title: eventTitle.trim(),
      timeLabel: eventTime.trim(),
      headcountLabel: eventHeadcount.trim(),
      estimatedWonPerPerson: estimatedWon,
    });
    setEstimatedWon(null);
    onModeChange("calendar");
  };

  useEffect(() => {
    if (mode !== "eventEstimate") {
      return;
    }
    let cancelled = false;
    const iso = `${eventYear}-${String(eventMonth + 1).padStart(2, "0")}-${String(eventDay).padStart(2, "0")}`;
    (async () => {
      setEstimateLoading(true);
      setEstimatedWon(null);
      try {
        const won = await resolveSpendEstimate({
          title: eventTitle.trim(),
          eventDateIso: iso,
          timeLabel: eventTime.trim(),
          headcountLabel: eventHeadcount.trim(),
          monthlyBudgetWon,
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
    monthlyBudgetWon,
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
                  const hasEvents =
                    cell.inMonth && eventDaysInViewMonth.has(cell.day);
                  const isSelected = cell.inMonth && cell.day === calendarSelectedDay;

                  if (!cell.inMonth) {
                    return (
                      <div key={cell.key} className="calendar-day calendar-day--out">
                        <Text
                          color={color}
                          typography="t5"
                          fontWeight="medium"
                          textAlign="center"
                          display="block"
                        >
                          {cell.day}
                        </Text>
                      </div>
                    );
                  }

                  return (
                    <button
                      key={cell.key}
                      type="button"
                      className={`calendar-day${cell.isToday ? " calendar-day--today" : ""}${hasEvents ? " calendar-day--has-events" : ""}${isSelected ? " calendar-day--selected" : ""}`}
                      aria-pressed={isSelected}
                      aria-label={`${viewMonth + 1}월 ${cell.day}일`}
                      onClick={() => setCalendarSelectedDay(cell.day)}
                    >
                      <Text
                        color={color}
                        typography="t5"
                        fontWeight="medium"
                        textAlign="center"
                        display="block"
                      >
                        {cell.day}
                      </Text>
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
                  이 날 등록된 일정이 없어요
                </Text>
              ) : (
                <List>
                  {eventsOnSelectedDay.map(ev => (
                    <ListRow
                      key={ev.id}
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
                          top={ev.title.trim() || "제목 없음"}
                          topProps={{ color: adaptive.grey800, fontWeight: "bold" }}
                          bottom={formatCalendarListRowDetail(ev)}
                          bottomProps={{ color: adaptive.grey600 }}
                        />
                      }
                      verticalPadding="large"
                    />
                  ))}
                </List>
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
                      top="다음 일정"
                      topProps={{ color: adaptive.grey700, fontWeight: "bold" }}
                      bottom={
                        nextEventInMonth
                          ? formatCalendarListRowDetail(nextEventInMonth)
                          : "이번 달 예정된 일정이 없어요"
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
                      top="지난 일정"
                      topProps={{ color: adaptive.grey700, fontWeight: "bold" }}
                      bottom={
                        lastPastEventInMonth
                          ? formatCalendarListRowDetail(lastPastEventInMonth)
                          : "이번 달 지난 일정이 없어요"
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
                  날짜 선택
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
                        <Text
                          color={adaptive.grey300}
                          typography="t5"
                          fontWeight="medium"
                          textAlign="center"
                          display="block"
                        >
                          {cell.day}
                        </Text>
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
                      <Text
                        color={labelColor}
                        typography="t5"
                        fontWeight="medium"
                        textAlign="center"
                        display="block"
                      >
                        {cell.day}
                      </Text>
                    </button>
                  );
                })}
              </div>
            </div>
            <Spacing size={24} />
            <Text color={adaptive.grey600} typography="t6" fontWeight="regular" textAlign="center">
              {pickDateYear}년 {pickDateMonth + 1}월 {pickDateDay}일
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
                <TextField.Clearable
                  variant="box"
                  hasError={false}
                  label="무슨 일정이에요?"
                  labelOption="sustain"
                  value={eventTitle}
                  placeholder="예) 친구 생일, 병원"
                  onChange={e => setEventTitle(e.target.value)}
                />
                <Spacing size={17} />
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
                <Spacing size={8} />
                <ListRow
                  arrowType="right"
                  withTouchEffect={true}
                  onClick={reopenPickDateFromForm}
                  contents={
                    <ListRow.Texts
                      type="2RowTypeA"
                      top="일정 날짜"
                      topProps={{ color: adaptive.grey600 }}
                      bottom={`${eventYear}년 ${eventMonth + 1}월 ${eventDay}일`}
                      bottomProps={{ color: adaptive.grey700, fontWeight: "bold" }}
                    />
                  }
                  verticalPadding="large"
                />
                <Spacing size={17} />
                <TextField.Clearable
                  variant="box"
                  hasError={false}
                  label="몇 시에 만나나요?"
                  labelOption="sustain"
                  value={eventTime}
                  placeholder="예) 12:30, 18시"
                  onChange={e => setEventTime(e.target.value)}
                />
                <Spacing size={17} />
                <TextField.Clearable
                  variant="box"
                  hasError={false}
                  label="몇명이서 만나나요?"
                  labelOption="sustain"
                  value={eventHeadcount}
                  placeholder="예) 2명"
                  onChange={e => setEventHeadcount(e.target.value)}
                />
                <Spacing size={24} />
                <ProgressStepper variant="icon" activeStepIndex={scheduleStepIndex} checkForFinish={true}>
                  <ProgressStep title="무엇?" />
                  <ProgressStep title="언제?" />
                  <ProgressStep title="누구?" />
                </ProgressStepper>
              </>
            ) : (
              <>
                <Spacing size={16} />
                {calendarEvents.length === 0 ? (
                  <Text color={adaptive.grey600} typography="t5" fontWeight="regular">
                    먼저 「일정 추가」 탭에서 일정을 등록한 뒤, 여기서 그 일정에 맞는 소비를 남겨 주세요.
                  </Text>
                ) : (
                  <>
                    <Text color={adaptive.grey800} typography="t6" fontWeight="semibold" display="block">
                      어느 일정의 소비인가요?
                    </Text>
                    <Spacing size={10} />
                    <div className="calendar-spend-event-picker" role="listbox" aria-label="일정 선택">
                      {sortCalendarEventsByDateDesc(calendarEvents).map(ev => (
                        <button
                          key={ev.id}
                          type="button"
                          role="option"
                          aria-selected={spendSelectedEventId === ev.id}
                          className={`calendar-spend-event-option${spendSelectedEventId === ev.id ? " calendar-spend-event-option--selected" : ""}`}
                          onClick={() => setSpendSelectedEventId(ev.id)}
                        >
                          <Text color={adaptive.grey800} typography="t5" fontWeight="bold" display="block">
                            {ev.title}
                          </Text>
                          <Text color={adaptive.grey600} typography="t7" fontWeight="regular" display="block">
                            {ev.year}년 {ev.monthIndex + 1}월 {ev.day}일
                            {ev.timeLabel.trim() ? ` · ${ev.timeLabel.trim()}` : ""}
                          </Text>
                        </button>
                      ))}
                    </div>
                    <Spacing size={20} />
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
                      카테고리를 정해보세요!
                    </Text>
                    <Spacing size={14} />
                    <div className="spend-category-grid">
                      {SPEND_CATEGORIES.map(cat => (
                        <button
                          key={cat}
                          type="button"
                          className={`spend-category-chip${spendCategory === cat ? " spend-category-chip--selected" : ""}`}
                          onClick={() => setSpendCategory(cat)}
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
            <BottomCTA.Double
              leftButton={
                <CTAButton color="dark" variant="weak" onClick={() => onModeChange("calendar")}>
                  닫기
                </CTAButton>
              }
              rightButton={
                <CTAButton
                  onClick={requestSpendEstimateAndShow}
                  disabled={eventTitle.trim().length === 0}
                >
                  추가하기
                </CTAButton>
              }
            />
          ) : (
            <BottomCTA.Double
              leftButton={
                <CTAButton color="dark" variant="weak" onClick={() => onModeChange("calendar")}>
                  닫기
                </CTAButton>
              }
              rightButton={
                <CTAButton disabled={!spendSubmitEnabled} onClick={commitSpendEntry}>
                  추가하기
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
              {eventTitle.trim() || "일정"} · {eventYear}년 {eventMonth + 1}월 {eventDay}일
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
                  AI 서버 연동됨 · 전체 금액이면 인원으로 나눠 1인당으로 보여요. 실패 시 간단 추정을 써요.
                </Text>
              </>
            ) : null}
          </div>
          <FixedBottomCTA
            loading={estimateLoading}
            disabled={estimateLoading}
            onClick={finishEstimateAndReturnToCalendar}
          >
            확인했어요
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
  const node = SURVEY_TREE[path];
  const depth = path.length;
  const progressLabel = `${depth + 1} / 3`;

  const choose = (bit: "A" | "B") => {
    const next = path + bit;
    if (next.length >= 3) {
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
          짧은 질문에 답하면 비코노미가 나에게 맞는 소비 성향을 정리해 드려요.
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
