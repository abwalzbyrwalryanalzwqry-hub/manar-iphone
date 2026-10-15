/**
 * منار ايفون — ينسخ التسجيلات الكاملة إلى حزمة iOS (ios/App/App/ManarAudio).
 *
 * يشغّلها المشغّل الأصلي (AVAudioPlayer) حين يصل الأذان والتطبيق مفتوح، أو
 * عند «استمع للأذان كاملاً» من الإشعار، ولمعاينة الأصوات في الإعدادات. الأسماء
 * بالتحويل `rawResourceName` نفسه فتطابق ما ترسله JavaScript. ويتحقّق أن لكل
 * تسجيل مقطعَ إشعار (CAF) في ios/App/App/ManarSounds، وإلا فشل البناء صراحةً
 * بدل أن يصل الأذان بنغمة النظام الافتراضية دون أن يلاحظ أحد.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { IOS_AUDIO_SOURCES, IOS_AUDIO_EXT, rawResourceName } from "./ios-audio-sources.mjs";

const root = resolve(import.meta.dirname, "..");
const target = resolve(root, "ios/App/App/ManarAudio");
const clips = resolve(root, "ios/App/App/ManarSounds");

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });

let bytes = 0;
let count = 0;
const missingClips = [];
const seen = new Map();
for (const dir of IOS_AUDIO_SOURCES) {
  const source = resolve(root, dir);
  if (!existsSync(source)) continue;
  for (const file of readdirSync(source)) {
    const ext = IOS_AUDIO_EXT.exec(file)?.[1]?.toLowerCase();
    if (!ext) continue;
    const raw = rawResourceName(file);
    if (seen.has(raw)) {
      console.error(`[manar] اسم مكرّر: ${raw} من ${seen.get(raw)} و${dir}/${file}`);
      process.exit(1);
    }
    seen.set(raw, `${dir}/${file}`);
    copyFileSync(resolve(source, file), resolve(target, `${raw}.${ext}`));
    bytes += statSync(resolve(source, file)).size;
    count += 1;
    if (!existsSync(resolve(clips, `${raw}.caf`))) missingClips.push(raw);
  }
}

if (!count) {
  console.error("[manar] لا توجد تسجيلات في مصادر الصوت");
  process.exit(1);
}
if (missingClips.length) {
  console.error(
    `[manar] ${missingClips.length} تسجيلاً بلا مقطع إشعار CAF: ${missingClips.join(", ")}\n` +
      "        شغّل: node scripts/build-ios-sounds.mjs",
  );
  process.exit(1);
}
console.log(
  `[manar] ${count} full recordings → ios/App/App/ManarAudio (${(bytes / 1048576).toFixed(1)} MB)`,
);
