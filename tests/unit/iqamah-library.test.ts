import { existsSync, openSync, readSync, closeSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_IQAMAH,
  IQAMAH_IDS,
  IQAMAH_SOUNDS,
  LEGACY_IQAMA_MIGRATION,
  getIqamahSound,
  migrateIqamahId,
} from "@/lib/iqamah-library";
import { ADHAN_ASSETS, LEGACY_VARIANT_MIGRATION } from "@/lib/adhan-library-assets";
import { iqamaVariantUrl, adhanVariantUrl } from "@/lib/adhan-sound";
import { rawResourceName } from "@/lib/prayer-schedule";

const ROOT = resolve(__dirname, "../..");
const pub = (url: string) => resolve(ROOT, "public" + url);

function magic(file: string, n = 12): Buffer {
  const fd = openSync(file, "r");
  const buf = Buffer.alloc(n);
  readSync(fd, buf, 0, n, 0);
  closeSync(fd);
  return buf;
}

describe("مكتبة الإقامة", () => {
  it("اثنا عشر مقطعاً من الحرمين (٠٨–١٩) بمعرّفات ثابتة، ولا إقامة كاملة", () => {
    expect(IQAMAH_SOUNDS).toHaveLength(12);
    expect(IQAMAH_SOUNDS.map((s) => s.id)).toEqual([...IQAMAH_IDS]);
    expect(IQAMAH_IDS[0]).toBe("iqamah_08");
    expect(IQAMAH_IDS.at(-1)).toBe("iqamah_19");
    expect(IQAMAH_SOUNDS.filter((s) => s.group === "makkah")).toHaveLength(6);
    expect(IQAMAH_SOUNDS.filter((s) => s.group === "madinah")).toHaveLength(6);
    expect(getIqamahSound(DEFAULT_IQAMAH)).not.toBeNull();
    for (let n = 1; n <= 7; n++) expect(getIqamahSound(`iqamah_0${n}`)).toBeNull();
  });

  it("أسماء الأصوات تصف التسجيل ولا تتكرّر", () => {
    const names = IQAMAH_SOUNDS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    for (const s of IQAMAH_SOUNDS)
      expect(s.name).toMatch(/^الحرم (المكي|النبوي) · (الفجر|المغرب|العشاء) /);
  });

  it("كل ملف موجود محلياً بحجمه المُعلَن وصيغته الحقيقية", () => {
    for (const s of IQAMAH_SOUNDS) {
      const file = pub(s.url);
      expect(existsSync(file), s.url).toBe(true);
      expect(statSync(file).size, s.url).toBe(s.bytes);
      const head = magic(file);
      expect(head.subarray(4, 8).toString("latin1"), s.url).toBe("ftyp");
    }
  });

  it("أسماء الملفات صالحة لأندرويد: ASCII صغيرة بلا مسافات، واسم المورد هو المعرّف", () => {
    for (const s of IQAMAH_SOUNDS) {
      const file = s.url.split("/").pop()!;
      expect(file).toMatch(/^iqamah_\d{2}\.m4a$/);
      expect(rawResourceName(s.url)).toBe(s.id);
    }
  });

  it("لا ملفات زائدة في مجلد الإقامة، ومجلد الإقامة القديم أُزيل", () => {
    const files = readdirSync(resolve(ROOT, "public/audio/iqamah")).sort();
    expect(files).toEqual(IQAMAH_SOUNDS.map((s) => s.url.split("/").pop()).sort());
    expect(existsSync(resolve(ROOT, "public/audio/iqama"))).toBe(false);
  });

  it("لا يشترك أيّ صوت إقامة مع مكتبة الأذان — لا مساراً ولا اسم مورد", () => {
    const adhanUrls = new Set(ADHAN_ASSETS.map((a) => a.url));
    const adhanRaw = new Set(ADHAN_ASSETS.map((a) => rawResourceName(a.url)));
    for (const s of IQAMAH_SOUNDS) {
      expect(s.url.startsWith("/audio/iqamah/")).toBe(true);
      expect(adhanUrls.has(s.url)).toBe(false);
      expect(adhanRaw.has(s.id)).toBe(false);
    }
    // ولا يوجد ربط قديم من معرّف إقامة إلى مقطع أذان.
    for (const k of Object.keys(LEGACY_VARIANT_MIGRATION)) {
      expect(k.startsWith("iqama")).toBe(false);
    }
  });

  it("مسار الإقامة لا يُرجع ملفّ أذان أبداً، ولو مُرِّر له معرّف أذان", () => {
    for (const a of ADHAN_ASSETS) expect(iqamaVariantUrl(a.id)).toBeNull();
    for (const k of Object.keys(LEGACY_VARIANT_MIGRATION)) expect(iqamaVariantUrl(k)).toBeNull();
    expect(iqamaVariantUrl("silent")).toBeNull();
    // وفي الاتجاه الآخر: مسار الأذان لا يعرف أصوات الإقامة.
    for (const s of IQAMAH_SOUNDS) expect(adhanVariantUrl(s.id as never)).toBeNull();
  });

  it("كل معرّفات الإقامة القديمة تُرحَّل إلى تسجيل إقامة حقيقي", () => {
    for (const [legacy, id] of Object.entries(LEGACY_IQAMA_MIGRATION)) {
      expect(migrateIqamahId(legacy)).toBe(id);
      expect(getIqamahSound(id)).not.toBeNull();
    }
    expect(migrateIqamahId("asset:segment-hayya")).toBeNull();
    expect(migrateIqamahId(undefined)).toBeNull();
  });
});
