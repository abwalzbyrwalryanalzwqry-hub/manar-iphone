// ============================================================
// منار — الأذكار الشخصية (نموذج البيانات، دوال نقية بلا window)
// ------------------------------------------------------------
// ذكر يكتبه المستخدم بنفسه، سجلّ واحد بمعرّف فريد يُستعمل في:
//   · ورد الصباح و/أو ورد المساء (ارتباط واحد بالوِردين بدل نسختين)،
//   · مكتبة «أذكاري الخاصة» في المسبحة.
// المحتوى الأصلي (حصن المسلم وأذكار الوِرد) ثابت في الحزمة ولا يمرّ من هنا
// أبدًا: كل عملية تعديل أو حذف تشترط معرّفًا شخصيًا موجودًا في هذا المخزن.
// ============================================================

import type { WirdSessionKey } from "@/lib/wird/data";

/** بادئة معرّفات الأذكار الشخصية — لا يحملها أي ذكر أصلي. */
export const PERSONAL_ID_PREFIX = "u-";

/** حدود عملية: نص الذكر قد يكون دعاءً طويلًا، والعدد يبقى رقمًا صحيحًا آمنًا. */
export const TEXT_MAX = 1500;
export const NAME_MAX = 60;
export const NOTE_MAX = 300;
export const REPEAT_MAX = 100_000;

/** التسمية حين يترك المستخدم الاسم فارغًا. */
export const DEFAULT_PERSONAL_NAME = "ذكر مخصص";

export interface PersonalWirdLink {
  /** الوِردان المرتبط بهما الذكر (قد يكون فارغًا: الذكر في المسبحة فقط). */
  sessions: WirdSessionKey[];
  /** عدد التكرار في الوِرد. `null` = عدد مفتوح بلا حد. */
  repeat: number | null;
  /**
   * موضع الذكر في كل وِرد: ترتيب الذكر الأصلي الذي يأتي بعده (`0` = أول الوِرد).
   * غيابه أو `null` = آخر الوِرد. لا يُغيّر ترتيب الأذكار الأصلية أبدًا.
   */
  after: Partial<Record<WirdSessionKey, number | null>>;
}

export interface PersonalZikr {
  id: string;
  /** نص الذكر كما كتبه المستخدم (بلا تعديل سوى إزالة الفراغ في طرفيه). */
  text: string;
  /** اسم اختياري؛ الفارغ يُعرض «ذكر مخصص». */
  name: string;
  /** ملاحظة شخصية أو مصدر يذكره المستخدم — لا يُعرض أبدًا بوصفه مصدرًا موثقًا. */
  note: string;
  /** مميّز للوصول السريع. */
  pinned: boolean;
  wird: PersonalWirdLink;
  /** إعداد المسبحة مستقل عن عدد الوِرد: `null` = عدّاد مفتوح افتراضيًا. */
  tasbih: { target: number | null };
  createdAt: number;
  updatedAt: number;
}

export interface PersonalAzkarStore {
  v: 1;
  items: PersonalZikr[];
}

export const emptyPersonalStore = (): PersonalAzkarStore => ({ v: 1, items: [] });

export const WIRD_KEYS: readonly WirdSessionKey[] = ["morning", "evening"];

/* ------------------------------------------------------------------ */
/*  التحقق من المدخلات                                                 */
/* ------------------------------------------------------------------ */

/** محارف لا تُرى (مسافات عرض صفري، علامات اتجاه، BOM). */
const INVISIBLE = /[\s\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF\u0640]/g;

export type Check<T> = { ok: true; value: T } | { ok: false; error: string };

/** نص الذكر: مطلوب، وليس فراغًا فقط، وضمن الحد. لا يُمسّ التشكيل ولا الأسطر الداخلية. */
export function checkText(raw: string): Check<string> {
  const text = String(raw ?? "").replace(/^\s+|\s+$/g, "");
  if (!text.replace(INVISIBLE, "")) return { ok: false, error: "اكتب نص الذكر أولًا." };
  if (text.length > TEXT_MAX) {
    return { ok: false, error: `النص أطول من الحد (${toAr(TEXT_MAX)} حرف).` };
  }
  return { ok: true, value: text };
}

export function checkName(raw: string): Check<string> {
  const name = String(raw ?? "").trim();
  if (name.length > NAME_MAX) {
    return { ok: false, error: `الاسم أطول من الحد (${toAr(NAME_MAX)} حرفًا).` };
  }
  return { ok: true, value: name.replace(INVISIBLE, "") ? name : "" };
}

export function checkNote(raw: string): Check<string> {
  const note = String(raw ?? "").trim();
  if (note.length > NOTE_MAX) {
    return { ok: false, error: `الملاحظة أطول من الحد (${toAr(NOTE_MAX)} حرف).` };
  }
  return { ok: true, value: note.replace(INVISIBLE, "") ? note : "" };
}

/** يحوّل الأرقام العربية والفارسية إلى لاتينية لقراءة حقل العدد فقط. */
function latinDigits(s: string): string {
  return s
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/**
 * حقل العدد: الفارغ = عدد مفتوح (`null`)، وإلا رقم صحيح من ١ إلى `max`.
 * الصفر والسالب والكسور والنصوص والأرقام الضخمة مرفوضة برسالة واضحة.
 */
export function parseCount(
  raw: string | number | null | undefined,
  max = REPEAT_MAX,
): Check<number | null> {
  if (raw == null) return { ok: true, value: null };
  const s = latinDigits(String(raw)).replace(/[\s\u066C,]/g, "");
  if (!s) return { ok: true, value: null };
  if (!/^-?\d+$/.test(s)) {
    return { ok: false, error: "العدد يجب أن يكون رقمًا صحيحًا، أو اتركه فارغًا لعدد مفتوح." };
  }
  const n = Number(s);
  if (n <= 0) {
    return { ok: false, error: "العدد يبدأ من ١ — أو اتركه فارغًا لعدد مفتوح بلا حد." };
  }
  if (!Number.isSafeInteger(n) || n > max) {
    return { ok: false, error: `أكبر عدد مسموح ${toAr(max)}.` };
  }
  return { ok: true, value: n };
}

function toAr(n: number): string {
  return String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);
}

/* ------------------------------------------------------------------ */
/*  المعرّفات والحماية                                                 */
/* ------------------------------------------------------------------ */

/** هل المعرّف لذكر شخصي (شكلًا)؟ الأذكار الأصلية أرقام أو مفاتيح بلا هذه البادئة. */
export function isPersonalId(id: unknown): id is string {
  return typeof id === "string" && id.startsWith(PERSONAL_ID_PREFIX) && id.length > 4;
}

export function newPersonalId(now = Date.now()): string {
  let rand = "";
  try {
    rand = globalThis.crypto?.randomUUID?.().replace(/-/g, "").slice(0, 12) ?? "";
  } catch {
    rand = "";
  }
  if (!rand) rand = Math.random().toString(36).slice(2, 14);
  return `${PERSONAL_ID_PREFIX}${now.toString(36)}-${rand}`;
}

/** معرّف عنصر بطاقة الذكر الشخصي في الصفحة (للتمرير إليه بعد الإضافة). */
export const personalCardId = (id: string) => `personal-${id}`;

export function displayName(z: Pick<PersonalZikr, "name">): string {
  return z.name || DEFAULT_PERSONAL_NAME;
}

/* ------------------------------------------------------------------ */
/*  قراءة المخزن بأمان (بيانات قديمة أو تالفة أو من نسخة احتياطية)      */
/* ------------------------------------------------------------------ */

function cleanCount(v: unknown): number | null {
  const n = Number(v);
  return v != null && Number.isSafeInteger(n) && n >= 1 && n <= REPEAT_MAX ? n : null;
}

function cleanAfter(v: unknown): number | null {
  const n = Number(v);
  return v != null && Number.isSafeInteger(n) && n >= 0 ? n : null;
}

export function normalizeZikr(raw: unknown): PersonalZikr | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isPersonalId(r.id)) return null;
  const text = checkText(typeof r.text === "string" ? r.text : "");
  if (!text.ok) return null;
  const w = (r.wird && typeof r.wird === "object" ? r.wird : {}) as Record<string, unknown>;
  const sessions = Array.isArray(w.sessions)
    ? WIRD_KEYS.filter((k) => (w.sessions as unknown[]).includes(k))
    : [];
  const afterRaw = (w.after && typeof w.after === "object" ? w.after : {}) as Record<
    string,
    unknown
  >;
  const after: PersonalWirdLink["after"] = {};
  for (const k of WIRD_KEYS) if (k in afterRaw) after[k] = cleanAfter(afterRaw[k]);
  const t = (r.tasbih && typeof r.tasbih === "object" ? r.tasbih : {}) as Record<string, unknown>;
  const created = Number(r.createdAt);
  const updated = Number(r.updatedAt);
  return {
    id: r.id,
    text: text.value,
    name: typeof r.name === "string" ? r.name.slice(0, NAME_MAX).trim() : "",
    note: typeof r.note === "string" ? r.note.slice(0, NOTE_MAX).trim() : "",
    pinned: r.pinned === true,
    wird: { sessions, repeat: cleanCount(w.repeat), after },
    tasbih: { target: cleanCount(t.target) },
    createdAt: Number.isFinite(created) ? created : 0,
    updatedAt: Number.isFinite(updated) ? updated : Number.isFinite(created) ? created : 0,
  };
}

export function normalizePersonalStore(raw: unknown): PersonalAzkarStore {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const seen = new Set<string>();
  const items: PersonalZikr[] = [];
  for (const it of Array.isArray(r.items) ? r.items : []) {
    const z = normalizeZikr(it);
    if (!z || seen.has(z.id)) continue;
    seen.add(z.id);
    items.push(z);
  }
  return { v: 1, items };
}

/* ------------------------------------------------------------------ */
/*  العمليات (نقية: تعيد مخزنًا جديدًا أو خطأً)                         */
/* ------------------------------------------------------------------ */

export interface PersonalInput {
  text: string;
  name?: string;
  note?: string;
  /** نص حقل عدد الوِرد كما أدخله المستخدم (فارغ = مفتوح). */
  wirdRepeat?: string | number | null;
  sessions?: WirdSessionKey[];
  after?: Partial<Record<WirdSessionKey, number | null>>;
  /** نص حقل العدد الافتراضي في المسبحة (فارغ = مفتوح). */
  tasbihTarget?: string | number | null;
  pinned?: boolean;
}

export type OpResult =
  { ok: true; store: PersonalAzkarStore; zikr: PersonalZikr } | { ok: false; error: string };

export const PROTECTED_ERROR = "هذا ذكر أصلي من منار، ولا يمكن تعديله أو حذفه.";
export const NOT_FOUND_ERROR = "لم يُعثر على هذا الذكر — ربما حُذف.";

function buildFields(
  input: PersonalInput,
  base?: PersonalZikr,
): Check<Omit<PersonalZikr, "id" | "createdAt" | "updatedAt">> {
  const text = checkText(input.text ?? base?.text ?? "");
  if (!text.ok) return text;
  const name = checkName(input.name ?? base?.name ?? "");
  if (!name.ok) return name;
  const note = checkNote(input.note ?? base?.note ?? "");
  if (!note.ok) return note;
  const repeat =
    input.wirdRepeat === undefined
      ? ({ ok: true, value: base?.wird.repeat ?? null } as const)
      : parseCount(input.wirdRepeat);
  if (!repeat.ok) return { ok: false, error: `عدد التكرار في الوِرد: ${repeat.error}` };
  const target =
    input.tasbihTarget === undefined
      ? ({ ok: true, value: base?.tasbih.target ?? null } as const)
      : parseCount(input.tasbihTarget);
  if (!target.ok) return { ok: false, error: `عدد المسبحة: ${target.error}` };
  const sessions = input.sessions
    ? WIRD_KEYS.filter((k) => input.sessions!.includes(k))
    : (base?.wird.sessions ?? []);
  const afterIn = input.after ?? base?.wird.after ?? {};
  const after: PersonalWirdLink["after"] = {};
  for (const k of sessions) if (k in afterIn) after[k] = cleanAfter(afterIn[k]);
  return {
    ok: true,
    value: {
      text: text.value,
      name: name.value,
      note: note.value,
      pinned: input.pinned ?? base?.pinned ?? false,
      wird: { sessions, repeat: repeat.value, after },
      tasbih: { target: target.value },
    },
  };
}

export function createPersonal(
  store: PersonalAzkarStore,
  input: PersonalInput,
  now = Date.now(),
  id = newPersonalId(now),
): OpResult {
  if (!isPersonalId(id)) return { ok: false, error: PROTECTED_ERROR };
  if (store.items.some((z) => z.id === id)) return { ok: false, error: "معرّف مكرر." };
  const f = buildFields(input);
  if (!f.ok) return f;
  const zikr: PersonalZikr = { id, ...f.value, createdAt: now, updatedAt: now };
  return { ok: true, store: { v: 1, items: [...store.items, zikr] }, zikr };
}

/** يجد الذكر الشخصي، أو يرفض المعرّف الأصلي/المجهول. */
function locate(store: PersonalAzkarStore, id: unknown): Check<number> {
  if (!isPersonalId(id)) return { ok: false, error: PROTECTED_ERROR };
  const i = store.items.findIndex((z) => z.id === id);
  return i < 0 ? { ok: false, error: NOT_FOUND_ERROR } : { ok: true, value: i };
}

export function updatePersonal(
  store: PersonalAzkarStore,
  id: unknown,
  patch: Partial<PersonalInput>,
  now = Date.now(),
): OpResult {
  const at = locate(store, id);
  if (!at.ok) return at;
  const base = store.items[at.value];
  const f = buildFields({ text: base.text, ...patch } as PersonalInput, base);
  if (!f.ok) return f;
  const zikr: PersonalZikr = { ...base, ...f.value, updatedAt: now };
  const items = store.items.slice();
  items[at.value] = zikr;
  return { ok: true, store: { v: 1, items }, zikr };
}

export function removePersonal(store: PersonalAzkarStore, id: unknown): OpResult {
  const at = locate(store, id);
  if (!at.ok) return at;
  const zikr = store.items[at.value];
  return { ok: true, store: { v: 1, items: store.items.filter((_, i) => i !== at.value) }, zikr };
}

/** يزيل ارتباط الذكر بوِرد واحد ويُبقيه في الوِرد الآخر وفي «أذكاري الخاصة». */
export function unlinkFromWird(
  store: PersonalAzkarStore,
  id: unknown,
  session: WirdSessionKey,
  now = Date.now(),
): OpResult {
  const at = locate(store, id);
  if (!at.ok) return at;
  const base = store.items[at.value];
  const after = { ...base.wird.after };
  delete after[session];
  return updatePersonal(
    store,
    id,
    { sessions: base.wird.sessions.filter((s) => s !== session), after },
    now,
  );
}

export function togglePinned(store: PersonalAzkarStore, id: unknown, now = Date.now()): OpResult {
  const at = locate(store, id);
  if (!at.ok) return at;
  return updatePersonal(store, id, { pinned: !store.items[at.value].pinned }, now);
}

/** أذكار الوِرد الشخصية لوِرد معيّن. */
export function personalForWird(
  items: readonly PersonalZikr[],
  session: WirdSessionKey,
): PersonalZikr[] {
  return items.filter((z) => z.wird.sessions.includes(session));
}

/** ترتيب العرض في «أذكاري الخاصة»: المميّز أولًا ثم الأقدم إنشاءً. */
export function sortPersonal(items: readonly PersonalZikr[]): PersonalZikr[] {
  return items
    .slice()
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        a.createdAt - b.createdAt ||
        a.id.localeCompare(b.id),
    );
}

/** دمج نسختين من المخزن (استيراد نسخة احتياطية بخيار «دمج»): اتحاد بالمعرّف، والأحدث تعديلًا يفوز. */
export function mergePersonalStores(local: unknown, incoming: unknown): PersonalAzkarStore {
  const a = normalizePersonalStore(local);
  const b = normalizePersonalStore(incoming);
  const byId = new Map(a.items.map((z) => [z.id, z]));
  for (const z of b.items) {
    const mine = byId.get(z.id);
    if (!mine || z.updatedAt > mine.updatedAt) byId.set(z.id, z);
  }
  return { v: 1, items: [...byId.values()].sort((x, y) => x.createdAt - y.createdAt) };
}
