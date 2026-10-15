/**
 * منار ايفون — مصادر الأصوات الأصلية (المصدر الواحد لسكربتَي الصوت).
 *
 * كل مجلد هنا يجدوله منار أصلياً: الأذان (`library`)، نداءات الأذكار والوِرد
 * (`reminders`)، الإقامة (`iqamah`)، التنبيه قبل الصلاة (`prayer-approach`)،
 * المواسم (`seasons`)، ونسخ النغمات بدرجات صوت ثابتة (`assets/audio-levels`).
 */
export const IOS_AUDIO_SOURCES = [
  "public/audio/library",
  "public/audio/reminders",
  "public/audio/iqamah",
  "public/audio/prayer-approach",
  "public/audio/seasons",
  "assets/audio-levels",
];

/** صيغ يفكّها AVAudioPlayer على كل إصدارات iOS المدعومة. */
export const IOS_AUDIO_EXT = /\.(mp3|m4a)$/i;

/** التحويل نفسه في `src/lib/native-notifications.ts` (`rawResourceName`). */
export function rawResourceName(fileName) {
  return fileName
    .replace(/\.[a-z0-9]+$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "a$1");
}
