import { defineConfig } from "@apps-in-toss/web-framework/config";

export default defineConfig({
  // 앱인토스 콘솔에 등록한 앱 ID와 반드시 동일해야 해요. 다르면 미니앱이 열리지 않을 수 있어요.
  appName: "beeconomy",
  brand: {
    displayName: "비코노미", // 화면에 노출될 앱의 한글 이름으로 바꿔주세요.
    primaryColor: "#fdd63c", // 화면에 노출될 앱의 기본 색상으로 바꿔주세요.
    icon: "", // 화면에 노출될 앱의 아이콘 이미지 주소로 바꿔주세요.
  },
  web: {
    // 실기기 샌드박스는 Mac의 LAN IP로 접속하므로, 127.0.0.1 전용 바인딩이면 연결 실패함
    host: "0.0.0.0",
    port: 5183,
    commands: {
      dev: "vite dev --host 0.0.0.0 --port 5183 --strictPort",
      build: "vite build",
    },
  },
  permissions: [
    /** 꿀단지 공유 등 — setClipboardText 사용 시 필수 */
    { name: "clipboard", access: "write" },
  ],
  outdir: "dist",
});
