# 비코노미 (Beeconomy)

앱인토스 웹 미니앱 프로젝트입니다.

## 시작하기

```bash
npm install
npm run dev
```

- 브라우저: [http://localhost:5173/](http://localhost:5173/)
- Granite 개발 서버: **8081** (앱인토스 샌드박스가 여기로 붙는 경우가 많음)

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
