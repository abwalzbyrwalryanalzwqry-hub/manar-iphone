/**
 * منار ايفون — مقاطع أصوات الإشعار (CAF) لـiOS.
 *
 * iOS يشغّل صوت الإشعار المحلي فقط إن كان:
 *   • ≤ ٣٠ ثانية (وإلا شغّل النغمة الافتراضية بدلاً منه بصمت)،
 *   • بصيغة يفكّها النظام مباشرة: Linear PCM أو IMA4 أو µLaw أو aLaw
 *     داخل aiff/wav/caf.
 * فنقصّ كل تسجيل إلى ٢٩٫٥ ثانية كحدّ أقصى بتلاشٍ ناعم في آخره، ونرمّزه
 * IMA4 أحادي القناة (ربع حجم PCM بجودة صوت بشري ممتازة).
 *
 * الأسماء بالتحويل نفسه الذي تستعمله الطبقة المشتركة (`rawResourceName`)،
 * فيطابق اسم المقطع ما تُرسله JavaScript في `sound` حرفياً.
 *
 * الناتج محفوظ في المستودع (ios/App/App/ManarSounds) حتى يكون البناء حتمياً
 * ولا يحتاج ffmpeg على جهاز Mac. أعد التشغيل عند تغيير أي تسجيل:
 *   node scripts/build-ios-sounds.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { IOS_AUDIO_SOURCES, IOS_AUDIO_EXT, rawResourceName } from "./ios-audio-sources.mjs";

const root = resolve(import.meta.dirname, "..");
const target = resolve(root, "ios/App/App/ManarSounds");
const MAX_SECONDS = 29.5;
const FADE = 1.5;

function duration(file) {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
    { encoding: "utf8" },
  );
  return Number(out.trim()) || 0;
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });

let count = 0;
let bytes = 0;
const seen = new Map();
for (const dir of IOS_AUDIO_SOURCES) {
  const source = resolve(root, dir);
  if (!existsSync(source)) continue;
  for (const file of readdirSync(source).sort()) {
    if (!IOS_AUDIO_EXT.test(file)) continue;
    const raw = rawResourceName(file);
    if (seen.has(raw)) {
      console.error(`[manar] اسم مكرّر: ${raw} من ${seen.get(raw)} و${dir}/${file}`);
      process.exit(1);
    }
    seen.set(raw, `${dir}/${file}`);
    const input = resolve(source, file);
    const len = duration(input);
    const cut = Math.min(len, MAX_SECONDS);
    const filters = [];
    if (len > MAX_SECONDS) filters.push(`afade=t=out:st=${(cut - FADE).toFixed(2)}:d=${FADE}`);
    const out = resolve(target, `${raw}.caf`);
    execFileSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-y",
        "-i",
        input,
        "-t",
        cut.toFixed(2),
        ...(filters.length ? ["-af", filters.join(",")] : []),
        "-ac",
        "1",
        "-ar",
        "32000",
        "-c:a",
        "adpcm_ima_qt",
        "-f",
        "caf",
        out,
      ],
      { stdio: "inherit" },
    );
    bytes += statSync(out).size;
    count += 1;
  }
}
console.log(
  `[manar] ${count} CAF clips → ios/App/App/ManarSounds (${(bytes / 1048576).toFixed(1)} MB)`,
);
