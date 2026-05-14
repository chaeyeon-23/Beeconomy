import type { ReactNode } from "react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

const ITEM_H = 40;
const PAD = 80;
const VIEW_H = PAD * 2 + ITEM_H;

function hour24ToWheel(h24: number, minute: number): { amp: 0 | 1; h12: number; min: number } {
  const m = Math.min(59, Math.max(0, minute));
  if (h24 === 0) {
    return { amp: 0, h12: 12, min: m };
  }
  if (h24 < 12) {
    return { amp: 0, h12: h24, min: m };
  }
  if (h24 === 12) {
    return { amp: 1, h12: 12, min: m };
  }
  return { amp: 1, h12: h24 - 12, min: m };
}

function wheelToHour24(amp: 0 | 1, h12: number, minute: number): { hour: number; minute: number } {
  const m = Math.min(59, Math.max(0, minute));
  let h24: number;
  if (amp === 0) {
    h24 = h12 === 12 ? 0 : h12;
  } else {
    h24 = h12 === 12 ? 12 : h12 + 12;
  }
  return { hour: h24, minute: m };
}

function formatTimeLabel(hour: number, minute: number): string {
  return `${hour}:${String(minute).padStart(2, "0")}`;
}

type SnapColProps = {
  length: number;
  selectedIndex: number;
  onChangeIndex: (i: number) => void;
  renderItem: (index: number) => ReactNode;
};

function SnapColumn({ length, selectedIndex, onChangeIndex, renderItem }: SnapColProps) {
  const ref = useRef<HTMLDivElement>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragging = useRef(false);
  const syncingRef = useRef(false);

  const snapToIndex = useCallback(
    (idx: number) => {
      const el = ref.current;
      if (!el) {
        return;
      }
      const clamped = Math.max(0, Math.min(length - 1, idx));
      const top = clamped * ITEM_H;
      if (Math.abs(el.scrollTop - top) > 0.5) {
        syncingRef.current = true;
        el.scrollTo({ top, behavior: "smooth" });
        requestAnimationFrame(() => {
          syncingRef.current = false;
        });
      }
      onChangeIndex(clamped);
    },
    [length, onChangeIndex],
  );

  const onScrollSettle = useCallback(() => {
    if (syncingRef.current) {
      return;
    }
    const el = ref.current;
    if (!el) {
      return;
    }
    const idx = Math.round(el.scrollTop / ITEM_H);
    snapToIndex(idx);
  }, [snapToIndex]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const top = Math.max(0, Math.min(length - 1, selectedIndex)) * ITEM_H;
    syncingRef.current = true;
    el.scrollTop = top;
    const t = window.setTimeout(() => {
      syncingRef.current = false;
    }, 120);
    return () => clearTimeout(t);
  }, [length, selectedIndex]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const onScroll = () => {
      if (settleTimer.current != null) {
        clearTimeout(settleTimer.current);
      }
      settleTimer.current = setTimeout(() => {
        settleTimer.current = null;
        if (!dragging.current) {
          onScrollSettle();
        }
      }, 120);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    const onScrollEnd = () => {
      dragging.current = false;
      if (settleTimer.current != null) {
        clearTimeout(settleTimer.current);
        settleTimer.current = null;
      }
      onScrollSettle();
    };
    el.addEventListener("scrollend", onScrollEnd);
    const onTouchStart = () => {
      dragging.current = true;
    };
    const onTouchEnd = () => {
      dragging.current = false;
      setTimeout(onScrollEnd, 50);
    };
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("scrollend", onScrollEnd);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
      if (settleTimer.current != null) {
        clearTimeout(settleTimer.current);
      }
    };
  }, [onScrollSettle]);

  return (
    <div className="time-wheel-col" style={{ height: VIEW_H }}>
      <div ref={ref} className="time-wheel-scroll" tabIndex={0} role="listbox">
        <div style={{ height: PAD }} aria-hidden={true} />
        {Array.from({ length }, (_, i) => (
          <div
            key={i}
            className={`time-wheel-item${i === selectedIndex ? " time-wheel-item--selected" : ""}`}
            style={{ height: ITEM_H }}
            role="option"
            aria-selected={i === selectedIndex}
          >
            {renderItem(i)}
          </div>
        ))}
        <div style={{ height: PAD }} aria-hidden={true} />
      </div>
    </div>
  );
}

export type TimeWheelPickerProps = {
  /** null이면 편집 중 빈 시간 등 — 휠은 오후 7:00으로만 보이고, 스크롤할 때까지 부모 문자열은 안 바뀜 */
  hour24: number | null;
  minute: number | null;
  onChange: (label: string) => void;
};

/**
 * 오전/오후 · 시(1–12) · 분(0–59) 스크롤 휠. 저장 형식은 `H:MM` (24h).
 */
export function TimeWheelPicker({ hour24, minute, onChange }: TimeWheelPickerProps) {
  const [w, setW] = useState<{ amp: 0 | 1; h12: number; min: number }>(() =>
    hour24 != null && minute != null ? hour24ToWheel(hour24, minute) : hour24ToWheel(19, 0),
  );

  useLayoutEffect(() => {
    if (hour24 != null && minute != null) {
      setW(hour24ToWheel(hour24, minute));
    } else {
      setW(hour24ToWheel(19, 0));
    }
  }, [hour24, minute]);

  const commit = useCallback(
    (next: { amp: 0 | 1; h12: number; min: number }) => {
      setW(next);
      const { hour, minute: mm } = wheelToHour24(next.amp, next.h12, next.min);
      onChange(formatTimeLabel(hour, mm));
    },
    [onChange],
  );

  return (
    <div className="time-wheel-picker" aria-label="시간 선택">
      <div className="time-wheel-highlight" aria-hidden={true} />
      <SnapColumn
        length={2}
        selectedIndex={w.amp}
        onChangeIndex={i => commit({ amp: i as 0 | 1, h12: w.h12, min: w.min })}
        renderItem={i => (i === 0 ? "오전" : "오후")}
      />
      <SnapColumn
        length={12}
        selectedIndex={w.h12 - 1}
        onChangeIndex={i => commit({ amp: w.amp, h12: i + 1, min: w.min })}
        renderItem={i => String(i + 1)}
      />
      <SnapColumn
        length={60}
        selectedIndex={w.min}
        onChangeIndex={i => commit({ amp: w.amp, h12: w.h12, min: i })}
        renderItem={i => String(i).padStart(2, "0")}
      />
    </div>
  );
}
