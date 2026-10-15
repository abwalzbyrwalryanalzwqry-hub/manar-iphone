/**
 * منار — حرّاس أمان ثابتة.
 *
 * - لا خدمة سحابية: لا Supabase ولا Lovable Cloud في الشجرة ولا في البناء.
 * - خطوة الإصدار في CI تشترط مفتاح التوقيع.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

describe("لا خدمة سحابية", () => {
  it("مجلّدا Supabase وتكامل Lovable Cloud محذوفان", () => {
    for (const d of ["supabase", "src/integrations"]) {
      expect(existsSync(resolve(root, d)), d).toBe(false);
    }
  });

  it("لا اعتماد على مكتبات السحابة", () => {
    const pkg = JSON.parse(read("package.json"));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(deps.filter((d) => /^@supabase\/|^@lovable\.dev\/cloud-auth/.test(d))).toEqual([]);
  });

  it("لا متغيرات Supabase في البناء", () => {
    expect(read(".github/workflows/ios.yml")).not.toMatch(/SUPABASE/);
    expect(read("src/start.ts")).not.toMatch(/supabase/i);
    expect(read("vite.config.capacitor.ts")).not.toMatch(/supabase/i);
  });
});

describe("توقيع الإصدار", () => {
  it("توقيع Ad Hoc في CI مشروط بوجود الشهادة، ولا أسرار في المستودع", () => {
    const wf = read(".github/workflows/ios.yml");
    expect(wf).toContain("IOS_CERT_P12_BASE64");
    expect(wf).toContain("HAS_IOS_SIGNING: ${{ secrets.IOS_CERT_P12_BASE64 != '' }}");
    expect(wf).toContain("if: env.HAS_IOS_SIGNING == 'true'");
    expect(read("scripts/ios/sign-ipa.sh")).toContain("security delete-keychain");
  });
});
