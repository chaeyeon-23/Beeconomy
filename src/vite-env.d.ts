/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** POST JSON: { title, date, time, headcount, monthlyBudgetWon } — 응답은 1인당이면 estimatedWonPerPerson 등, 전체 합계면 estimatedWon(인원으로 나눔) */
  readonly VITE_SPEND_ESTIMATE_API_URL?: string;
  readonly VITE_SPEND_ESTIMATE_API_KEY?: string;
}

declare module "*.css" {
  const content: Record<string, string>;
  export default content;
}
