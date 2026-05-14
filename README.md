# 비코노미 (Beeconomy)

앱인토스 웹 미니앱 프로젝트입니다.

## 시작하기

```bash
npm install
npm run dev
```

`npm run dev` 는 **API 서버(3001)** 와 **Granite+Vite(8081/5183)** 를 같이 띄웁니다. 웹만 켜려면 `npm run dev:web`, API만 켜려면 `npm run dev:api` 입니다.

- 브라우저: [http://localhost:5183/](http://localhost:5183/) (다른 프로젝트가 5173을 쓰는 경우를 피하려고 비코노미는 5183)
- 옆에 폰 프레임 데모: [http://localhost:5183/simulator-demo.html](http://localhost:5183/simulator-demo.html) (`npm run dev` 실행 중일 때)
- Granite 개발 서버: **8081** (앱인토스 샌드박스가 여기로 붙는 경우가 많음)
- **백엔드(API)**: [http://127.0.0.1:3001/health](http://127.0.0.1:3001/health) · `POST /api/spend-estimate` (일정 → 1인당 예상 원, 개발 시 프론트가 기본으로 호출)

### 백엔드만 따로 실행

```bash
npm run dev:api
```

배포 시에는 `server/` 를 Node 호스트에 올리고, 프론트 빌드 환경 변수 `VITE_SPEND_ESTIMATE_API_URL` 에 그 API 주소를 넣으면 됩니다. URL을 넣지 않은 **프로덕션** 빌드는 API 없이 클라이언트 휴리스틱만 사용합니다.

### 일정 예상 소비 · OpenAI 연동 (선택)

서버 환경 변수에 **`OPENAI_API_KEY`** 를 넣으면 `POST /api/spend-estimate` 가 **OpenAI**로 1인당 예상 금액을 먼저 구하고, 오류·미응답 시 **휴리스틱**으로 돌아갑니다. 모델은 **`OPENAI_MODEL`** (기본 `gpt-4o-mini`)로 바꿀 수 있습니다. 키는 **서버에만** 두고 Git에는 올리지 마세요. `/health` 응답의 `openai: true` 이면 키가 로드된 상태입니다.

### 샌드박스에서 “로컬 서버를 찾을 수 없습니다”일 때

```bash
npm run dev:help
```

반드시 **`npm run dev`** 만 사용하세요. `vite`만 단독으로 켜면 **8081**이 없어 샌드박스가 실패할 수 있습니다.

## 빌드 · 토스앱 테스트 · 배포

### 앱 번들(.ait) 만들기

```bash
npm run build
```

루트에 `<서비스명>.ait` 가 생성됩니다. (`*.ait` 는 git에 올라가지 않습니다.)

### 토스앱에서 QR 테스트

업로드·테스트 스킴·`deploymentId` 요약은 **[docs/toss-app-testing.md](./docs/toss-app-testing.md)** 를 보세요.  
원문: [토스앱 테스트 (공식)](https://developers-apps-in-toss.toss.im/development/test/toss.md)

### 콘솔 / CLI 배포

- API 키: [앱인토스 콘솔](https://apps-in-toss.toss.im/) → 워크스페이스 → **키** → 콘솔 API 키

```bash
npm run deploy
# 또는
npx ait deploy --api-key {API_키}
npx ait token add   # 한 번 등록 후
npx ait deploy
```

## 설정

- `granite.config.ts` 의 **`appName`** 은 콘솔에 등록한 앱 ID와 같아야 합니다.
- 선택 환경 변수: `.env.example` 참고 후 `.env` 로 복사.

## 유용한 링크

- [앱인토스 콘솔](https://apps-in-toss.toss.im/)
- [앱인토스 개발자센터](https://developers-apps-in-toss.toss.im/)
- [개발 서버 연결 (샌드박스)](https://developers-apps-in-toss.toss.im/development/local-server.html)
- [앱인토스 개발자 커뮤니티](https://techchat-apps-in-toss.toss.im/)

AI 보조용 문서: [llms.txt](https://developers-apps-in-toss.toss.im/development/llms.html)
