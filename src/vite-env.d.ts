/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * POST JSON: title, date, time, headcount, headcountPeople, monthlyBudgetWon
   * 응답(1인당으로 정규화): 합계는 totalEstimatedWon·estimatedWon 등 + 인원 나눔,
   * 1인당은 estimatedWonPerPerson. 합계를 perPerson 필드에 넣는 API는 estimatedUnit:"total" 또는 isTotal:true
   * 비우면: 개발 모드에서만 로컬 API(http://127.0.0.1:3001/api/spend-estimate) 사용
   */
  readonly VITE_SPEND_ESTIMATE_API_URL?: string;
  readonly VITE_SPEND_ESTIMATE_API_KEY?: string;
}

declare module "*.css" {
  const content: Record<string, string>;
  export default content;
}
