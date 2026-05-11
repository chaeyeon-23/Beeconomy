import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class RootErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[RootErrorBoundary]", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error != null) {
      return (
        <div
          style={{
            padding: 24,
            fontFamily: "system-ui, sans-serif",
            maxWidth: 480,
            margin: "0 auto",
            minHeight: "100dvh",
            boxSizing: "border-box",
          }}
        >
          <h1 style={{ fontSize: 18, margin: "0 0 12px" }}>화면을 불러오지 못했어요</h1>
          <p style={{ fontSize: 14, color: "#555", margin: "0 0 16px" }}>
            아래 메시지를 개발자 도구(F12) 콘솔과 함께 알려 주시면 원인 파악에 도움이 됩니다.
          </p>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              fontSize: 12,
              background: "#f4f4f5",
              padding: 12,
              borderRadius: 8,
              overflow: "auto",
            }}
          >
            {this.state.error.message}
            {"\n\n"}
            {this.state.error.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
