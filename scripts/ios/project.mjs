/**
 * منار ايفون — يولّد ios/App/App.xcodeproj من ios/App/project.yml (XcodeGen).
 *
 * رقم الإصدار من package.json وحده (المصدر الواحد)، ورقم البناء مشتقّ منه
 * حتمياً (major·10000 + minor·100 + patch) فيزيد مع كل إصدار ولا يتكرّر.
 * يمكن تجاوزه بـ MANAR_BUILD_NUMBER (مثلاً رقم تشغيل CI).
 *
 * يحتاج macOS و XcodeGen:  brew install xcodegen
 * الترتيب: npm run build:ios ثم npm run ios:project
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const m = /^(\d+)\.(\d+)\.(\d+)/.exec(pkg.version);
if (!m) {
  console.error(`[manar] إصدار غير صالح في package.json: ${pkg.version}`);
  process.exit(1);
}
const derived = Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);
const env = {
  ...process.env,
  MANAR_MARKETING_VERSION: `${m[1]}.${m[2]}.${m[3]}`,
  MANAR_BUILD_NUMBER: process.env.MANAR_BUILD_NUMBER || String(derived),
  MANAR_TEAM_ID: process.env.MANAR_TEAM_ID || "",
};
console.log(
  `[manar] XcodeGen: version ${env.MANAR_MARKETING_VERSION} (${env.MANAR_BUILD_NUMBER})` +
    (env.MANAR_TEAM_ID ? ` team ${env.MANAR_TEAM_ID}` : ""),
);
execFileSync("xcodegen", ["generate", "--spec", "project.yml"], {
  cwd: resolve(root, "ios/App"),
  env,
  stdio: "inherit",
});

// بعد وجود project.pbxproj يكتب Capacitor ملف Package.swift بإصدار iOS الصحيح
// (يقرؤه من المشروع). قبله يطبع خطأً غير مؤثّر في `cap sync`.
execFileSync("npx", ["cap", "update", "ios"], { cwd: root, stdio: "inherit" });
