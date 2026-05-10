#!/usr/bin/env node
/**
 * 앱인토스 샌드박스 ↔ 로컬 Granite 연결 안내
 * @see https://developers-apps-in-toss.toss.im/development/local-server.html
 */
import os from "node:os";

let ips = [];
try {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === "IPv4" && !net.internal) {
        ips.push({ name, address: net.address });
      }
    }
  }
} catch {
  ips = [];
}

console.log(`
앱인토스 샌드박스에서 "로컬 서버를 찾을 수 없습니다"가 나올 때
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

① 이 프로젝트 폴더에서 반드시 실행:
   npm run dev

   → Granite가 http://0.0.0.0:8081 에 떠야 하고,
     그 다음에 Vite가 5173에서 떠야 합니다.
   → "vite만" 따로 켜면( npm run dev:vite 만) 8081이 없어서 샌드박스가 못 찹니다.

② 맥과 아이폰이 같은 Wi-Fi (게스트 Wi-Fi는 기기끼리 막혀 있으면 실패할 수 있음)

③ 맥 방화벽: Node / 터미널의 수신 연결 허용

④ 샌드박스 "서버 주소"에는 보통 맥의 Wi-Fi IP를 넣습니다.
   아래 후보로 접속 테스트: 아이폰 사파리에서
   http://주소:8081
   가 열리면 네트워크는 통하는 것입니다.
`);

if (ips.length === 0) {
  console.log("이 맥에서 Wi-Fi IPv4 주소를 자동으로 못 찾았어요.");
  console.log("터미널에서 직접 확인:  ipconfig getifaddr en0   (또는 en1)\n");
} else {
  console.log("⑤ 지금 맥에서 후보 주소 (샌드박스에 IP만 넣는 UI면 보통 포트 8081 고정):\n");
  for (const { name, address } of ips) {
    console.log(`   • ${address}   (인터페이스: ${name})`);
    console.log(`     사파리 테스트: http://${address}:8081\n`);
  }
}

console.log(`⑥ Android 실기기는 USB + adb reverse 가 필요할 수 있어요:
   adb reverse tcp:8081 tcp:8081
   adb reverse tcp:5173 tcp:5173
`);
