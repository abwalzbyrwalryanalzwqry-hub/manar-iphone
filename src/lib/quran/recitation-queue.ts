// ============================================================
// Manar — ترتيب آيات التلاوة: المقطع المكرَّر، وتكرار كل آية فيه، والمؤقّت.
// ------------------------------------------------------------
// منطق خالص بلا عنصر صوت (يُختبر وحده)؛ يستعمله محرّك التلاوة.
// ============================================================

import { SURAH_META } from "./metadata";
import { ayahOrdinal } from "./page-math";

export interface PlayerTrack {
  surah: number;
  ayah: number;
}

/**
 * مقطع يُكرَّر: من `surah:from` إلى `toSurah:to` (السورة نفسها إن غابت `toSurah`)،
 * عدداً من المرات، مع تكرار كل آية `ayahTimes` مرة قبل الانتقال لما بعدها.
 */
export interface PlayerRange {
  surah: number;
  from: number;
  to: number;
  /** عدد مرات تلاوة المقطع كاملاً (٠ = بلا حدّ). */
  times: number;
  /** سورة نهاية المقطع إن امتد إلى ما بعد السورة الأولى. */
  toSurah?: number;
  /** مرات تكرار كل آية داخل المقطع (١ افتراضياً). */
  ayahTimes?: number;
}

export function ayahCount(surah: number): number {
  return SURAH_META[Math.min(114, Math.max(1, surah)) - 1].ayatCount;
}

const endSurah = (r: PlayerRange) => r.toSurah ?? r.surah;

/** يرتّب طرفي المقطع ويقيّدهما بحدود السور (البداية قبل النهاية دائماً). */
export function normalizeRange(r: PlayerRange): PlayerRange {
  const clampAyah = (s: number, a: number) =>
    Math.min(ayahCount(s), Math.max(1, Math.trunc(a) || 1));
  let start = { surah: r.surah, ayah: clampAyah(r.surah, r.from) };
  let end = { surah: endSurah(r), ayah: clampAyah(endSurah(r), r.to) };
  if (ayahOrdinal(end.surah, end.ayah) < ayahOrdinal(start.surah, start.ayah)) {
    [start, end] = [end, start];
  }
  return {
    surah: start.surah,
    from: start.ayah,
    to: end.ayah,
    toSurah: end.surah === start.surah ? undefined : end.surah,
    times: Math.max(0, Math.trunc(r.times) || 0),
    ayahTimes: Math.max(1, Math.trunc(r.ayahTimes ?? 1) || 1),
  };
}

export function inRange(cur: PlayerTrack, r: PlayerRange): boolean {
  const n = ayahOrdinal(cur.surah, cur.ayah);
  return n >= ayahOrdinal(r.surah, r.from) && n <= ayahOrdinal(endSurah(r), r.to);
}

export function isRangeEnd(cur: PlayerTrack, r: PlayerRange): boolean {
  return cur.surah === endSurah(r) && cur.ayah === r.to;
}

/**
 * الآية التالية بعد `cur` حسب المقطع المكرَّر والتلاوة المتصلة، أو null عند النهاية.
 * `loopsDone` عدد مرات إتمام المقطع حتى الآن.
 */
export function nextTrack(
  cur: PlayerTrack,
  opts: { continuous: boolean; range: PlayerRange | null; loopsDone: number },
): PlayerTrack | null {
  const { range } = opts;
  if (range && inRange(cur, range)) {
    if (!isRangeEnd(cur, range)) {
      return cur.ayah < ayahCount(cur.surah)
        ? { surah: cur.surah, ayah: cur.ayah + 1 }
        : { surah: cur.surah + 1, ayah: 1 };
    }
    if (range.times === 0 || opts.loopsDone + 1 < range.times) {
      return { surah: range.surah, ayah: range.from };
    }
    return null;
  }
  if (cur.ayah < ayahCount(cur.surah)) return { surah: cur.surah, ayah: cur.ayah + 1 };
  if (!opts.continuous || cur.surah >= 114) return null;
  return { surah: cur.surah + 1, ayah: 1 };
}

/* ---------- مؤقّت النوم ---------- */

/** إيقاف التلاوة بعد دقائق، أو عند نهاية السورة الحالية. */
export type SleepTimer =
  { kind: "minutes"; until: number; minutes: number } | { kind: "surah" } | null;

export const SLEEP_OPTIONS = [5, 10, 15, 30, 45, 60] as const;

/** هل يجب التوقف قبل الانتقال من `cur` إلى `next`؟ */
export function sleepStopsBefore(
  timer: SleepTimer,
  cur: PlayerTrack,
  next: PlayerTrack | null,
  now = Date.now(),
): boolean {
  if (!timer) return false;
  if (timer.kind === "minutes") return now >= timer.until;
  return !next || next.surah !== cur.surah || next.ayah <= cur.ayah;
}
