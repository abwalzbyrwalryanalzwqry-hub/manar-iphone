/**
 * منار — حرّاس المرحلة ٣٤ (تنظيف الكود وتصغير الحزمة).
 *
 * - لا مكوّنات قوالب ولا تبعيات بلا استعمال (knip يفحصها في CI، وهنا ما لا يجب أن يعود).
 * - sonner خارج حزمة الإقلاع: لا يستورده إلا غلاف `<Toaster>`، والإشعار ينتظر تركيبه.
 * - لا React Query: لم يكن فيه استعلام واحد.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const srcFiles = walk(resolve(root, "src")).filter((f) => /\.(ts|tsx)$/.test(f));

describe("الكود الميت", () => {
  it("مكوّنات الواجهة الجاهزة: المستعمل وحده (dialog وsonner)", () => {
    expect(readdirSync(resolve(root, "src/components/ui")).sort()).toEqual([
      "dialog.tsx",
      "sonner.tsx",
    ]);
  });

  it("التبعيات المحذوفة لا تعود", () => {
    const pkg = JSON.parse(read("package.json"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const d of [
      "@capacitor/device",
      "@tanstack/react-query",
      "recharts",
      "react-hook-form",
      "zod",
      "date-fns",
      "cmdk",
      "vaul",
      "embla-carousel-react",
      "react-day-picker",
      "@radix-ui/react-select",
    ]) {
      expect(deps[d], d).toBeUndefined();
    }
  });

  it("المتغيّرات والمعاملات غير المستعملة أخطاء أنواع، وknip في CI", () => {
    const ts = read("tsconfig.json");
    expect(ts).toMatch(/"noUnusedLocals":\s*true/);
    expect(ts).toMatch(/"noUnusedParameters":\s*true/);
    expect(existsSync(resolve(root, "knip.json"))).toBe(true);
    expect(read(".github/workflows/ci.yml")).toContain("npm run knip");
  });

  it("لا React Query", () => {
    for (const f of srcFiles) expect(readFileSync(f, "utf8"), f).not.toMatch(/react-query/);
  });
});

describe("sonner كسول", () => {
  it("لا يستورده ملفٌّ استيراداً ثابتاً إلا غلاف <Toaster>", () => {
    for (const f of srcFiles) {
      if (f.endsWith("src/components/ui/sonner.tsx")) continue;
      const src = readFileSync(f, "utf8");
      const imports = src.match(/^import\s+(?!type\b)[^;]*from\s+["']sonner["']/gm) ?? [];
      expect(imports, f).toEqual([]);
    }
  });

  describe("الإشعار ينتظر تركيب <Toaster>", () => {
    const calls: string[] = [];
    beforeEach(async () => {
      calls.length = 0;
      vi.resetModules();
      vi.stubGlobal("window", globalThis); // بيئة الاختبار node بلا window
      vi.doMock("sonner", () => {
        const t = Object.assign((m: string) => calls.push(`default:${m}`), {
          success: (m: string) => calls.push(`success:${m}`),
          error: (m: string) => calls.push(`error:${m}`),
          info: (m: string) => calls.push(`info:${m}`),
          message: (m: string) => calls.push(`message:${m}`),
        });
        return { toast: t };
      });
    });

    afterEach(() => vi.unstubAllGlobals());

    it("لا يُطلق قبل التركيب، ثم يُطلق بالترتيب", async () => {
      const mod = await import("@/lib/toast");
      let requested = 0;
      mod.onToasterRequested(() => requested++);
      expect(mod.toasterRequested()).toBe(false);

      mod.toast.success("أ");
      mod.toast("ب");
      expect(mod.toasterRequested()).toBe(true);
      expect(requested).toBe(1);
      await new Promise((r) => setTimeout(r, 10));
      expect(calls).toEqual([]);

      mod.markToasterMounted();
      await new Promise((r) => setTimeout(r, 10));
      expect(calls).toEqual(["success:أ", "default:ب"]);

      mod.toast.error("ج");
      await new Promise((r) => setTimeout(r, 10));
      expect(calls.at(-1)).toBe("error:ج");
      expect(requested).toBe(1);
    });
  });
});
