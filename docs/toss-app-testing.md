# 토스앱에서 미니앱 테스트하기

원문: [앱인토스 개발자센터 – 토스앱 테스트](https://developers-apps-in-toss.toss.im/development/test/toss.md)

샌드박스에서 동작을 확인한 뒤, **앱 번들(.ait)** 을 올리고 **토스앱**에서 QR/테스트 스킴으로 최종 확인하는 흐름입니다.

## 1. 앱 번들 생성

프로젝트 루트에서:

```bash
npm run build
```

빌드가 끝나면 루트에 **`<서비스명>.ait`** 파일이 생깁니다. (저장소에는 `*.ait` 가 `.gitignore` 되어 있어 커밋되지 않습니다.)

## 2. 업로드 및 토스앱에서 테스트

### 방법 A: 콘솔에서 업로드 + QR

1. [앱인토스 콘솔](https://apps-in-toss.toss.im/) → 워크스페이스 → 앱 → **앱 출시**
2. **앱 번들(.ait)** 업로드
3. **테스트하기** → **토스앱용 QR 코드** 스캔

**QR 테스트 조건**

- 토스앱에 로그인
- 해당 워크스페이스 **멤버**
- **만 19세 이상**

### 방법 B: CLI로 업로드

콘솔에서 **API 키** 발급 후:

```bash
npx ait deploy --api-key {API_키}
```

반복 입력을 줄이려면:

```bash
npx ait token add
npx ait deploy
```

메모와 함께 올리기:

```bash
npx ait deploy -m "출시 메모"
```

## 3. 출시 전 스킴 정리

- **`intoss://`** 스킴은 **정식 출시 이후**에만 사용하는 경로에 가깝습니다.
- 출시 전에는 콘솔에서 발급되는 **`intoss-private://`** + **`_deploymentId`** 가 포함된 **테스트 스킴**을 사용합니다.

예:

```text
intoss-private://appsintoss?_deploymentId=...
```

## 4. 로컬 개발(샌드박스)과의 차이

| 구분 | 샌드박스 + 로컬 |
|------|-----------------|
| 실행 | `npm run dev` (Granite **8081** + Vite **5183**) |
| 연결 | 앱인토스 샌드박스 앱에서 맥 IP 등 설정 ([개발 서버 연결](https://developers-apps-in-toss.toss.im/development/local-server.html)) |
| 안내 | `npm run dev:help` |

| 구분 | 실제 토스앱 |
|------|-------------|
| 실행 | `.ait` 업로드 후 QR / 테스트 스킴 |
| 준비 | 콘솔 멤버, 로그인, 만 19세 이상 |

## 5. 통신·CORS (API 연동 시)

백엔드 CORS에 다음 형태 도메인을 허용해야 할 수 있습니다.

- `https://<appName>.apps.tossmini.com` — 라이브
- `https://<appName>.private-apps.tossmini.com` — 콘솔 QR 테스트

샌드박스는 HTTP가 허용될 수 있으나, **라이브 WebView는 HTTPS** 위주로 동작합니다.

## 6. 문제 해결

- **흰 화면**: 런타임 에러(Sentry 등), 이미지/번들 용량·메모리 ([개발자센터 가이드](https://developers-apps-in-toss.toss.im/development/test/toss.md))
- **번들 업로드 실패**: `npm run build` 로 만든 정상 `.ait` 인지, 프로젝트 구조가 스캐폴딩과 맞는지 확인
