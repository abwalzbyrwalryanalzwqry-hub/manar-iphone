import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { tafsirGroup } from "@/lib/quran/tafsir-service";
import { SURAH_MAQASID, surahMaqasid } from "@/lib/quran/surah-maqasid";
import { SOURCES, TANZIL_NOTICE } from "@/lib/sources";

/* المرحلة ٧: الآيات المجمّعة في التفسير، ومقاصد السور، والمصادر. */

function tafsirFile(edition: string, surah: number): Record<string, string> {
  const url = new URL(`../../public/data/quran/tafsir/${edition}/${surah}.json`, import.meta.url);
  return (JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as { a: Record<string, string> }).a;
}

describe("الآيات المجمّعة في التفسير", () => {
  it("تجمع الآيات المتتالية ذات النص الواحد من أي آية فيها", () => {
    const data = { "1": "أ", "2": "ب", "3": "ب", "4": "ب", "5": "ج" };
    expect(tafsirGroup(data, 3)).toEqual({ from: 2, to: 4, text: "ب" });
    expect(tafsirGroup(data, 2)?.to).toBe(4);
    expect(tafsirGroup(data, 1)).toEqual({ from: 1, to: 1, text: "أ" });
    expect(tafsirGroup(data, 9)).toBeNull();
  });

  it("البقرة ٤٥–٤٦ في الميسّر تفسير واحد", () => {
    const g = tafsirGroup(tafsirFile("ar-tafsir-muyassar", 2), 46);
    expect(g?.from).toBe(45);
    expect(g?.to).toBe(46);
  });

  it("التنقل بالمجموعات يمرّ على كل آيات السورة دون تكرار", () => {
    const data = tafsirFile("ar-tafsir-muyassar", 2);
    const seen: number[] = [];
    for (let a = 1; a <= 286;) {
      const g = tafsirGroup(data, a)!;
      for (let n = g.from; n <= g.to; n++) seen.push(n);
      a = g.to + 1;
    }
    expect(seen).toEqual(Array.from({ length: 286 }, (_, i) => i + 1));
  });
});

describe("من مقاصد السورة", () => {
  it("متوفرة لكل السور الـ١١٤", () => {
    expect(SURAH_MAQASID).toHaveLength(114);
    for (let s = 1; s <= 114; s++) expect(surahMaqasid(s)?.length ?? 0).toBeGreaterThan(10);
    expect(surahMaqasid(115)).toBeUndefined();
  });
});

describe("المصادر والتراخيص", () => {
  it("تذكر Tanzil ورابطه وإشعار حقوقه كاملاً", () => {
    const all = SOURCES.flatMap((g) => g.items);
    const tanzil = all.find((s) => s.url === "https://tanzil.net");
    expect(tanzil?.notice).toBe(TANZIL_NOTICE);
    expect(TANZIL_NOTICE).toContain("CHANGING IT IS NOT ALLOWED");
    expect(TANZIL_NOTICE).toContain("Creative Commons Attribution 3.0");
  });

  it("لكل مصدر رابط", () => {
    for (const s of SOURCES.flatMap((g) => g.items)) expect(s.url).toMatch(/^(https:\/\/|\/)/);
  });
});
