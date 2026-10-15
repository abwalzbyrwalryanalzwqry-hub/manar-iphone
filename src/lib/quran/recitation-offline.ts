// ============================================================
// Manar — Quran Module
// Offline recitations: download a surah once, play it forever
// ------------------------------------------------------------
// Files are stored inside the app's private data directory via
// Capacitor Filesystem, so nothing lands in the user's gallery
// and everything is removed when the app is uninstalled.
// Downloading is native-only; on the web the screen offers
// streaming instead.
// ============================================================

import { isIOSApp } from "@/lib/ios";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Capacitor } from "@capacitor/core";
import { ayahAudioUrl, ayahFileName, needsBasmalaIntro, type Reciter } from "./recitations";

const KEY = "manar.quran.recitation.downloads.v1";
const EVENT = "manar:recitation-downloads";
const ROOT = "manar-recitations";

/**
 * مجلد التلاوات المنزّلة. على iPhone: ‎Library/NoCloud‏ — يبقى بعد إغلاق
 * التطبيق ولا يُرفع إلى نسخة iCloud الاحتياطية (مئات الميغابايتات من صوتٍ
 * يُعاد تنزيله)، ولا يحذفه النظام عند امتلاء التخزين كما يحذف Caches.
 */
function recitationDirectory<D extends { Data: unknown; LibraryNoCloud: unknown }>(
  Directory: D,
): D["Data"] {
  return (isIOSApp() ? Directory.LibraryNoCloud : Directory.Data) as D["Data"];
}
/** عدد الملفات التي تُحمَّل في الوقت نفسه. */
export const DOWNLOAD_CONCURRENCY = 4;
/** نسخة البسملة المحفوظة داخل مجلد كل سورة. */
const BASMALA_FILE = "basmala.mp3";

export interface DownloadedSurah {
  /** Reciter folder — the audio identity of the files. */
  folder: string;
  surah: number;
  ayahs: number;
  /** Total bytes written. */
  bytes: number;
  /** Native directory URI, ready for `convertFileSrc`. */
  dirUri: string;
  at: number;
  /** هل يحوي المجلد نسخة البسملة (basmala.mp3)؟ */
  hasBasmala?: boolean;
}

type Manifest = Record<string, DownloadedSurah>;

export function downloadKey(folder: string, surah: number): string {
  return `${folder}:${surah}`;
}

export function offlineSupported(): boolean {
  return Capacitor.isNativePlatform();
}

function readManifest(): Manifest {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Manifest) : {};
  } catch {
    return {};
  }
}

function writeManifest(m: Manifest) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(m));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* ignore quota / privacy errors */
  }
}

export function listDownloads(): DownloadedSurah[] {
  return Object.values(readManifest()).sort((a, b) => b.at - a.at);
}

export function isDownloaded(folder: string, surah: number): boolean {
  return !!readManifest()[downloadKey(folder, surah)];
}

export function getDownload(folder: string, surah: number): DownloadedSurah | undefined {
  return readManifest()[downloadKey(folder, surah)];
}

/** Local playable source for one ayah, or null when it is not downloaded. */
export function localAyahSrc(folder: string, surah: number, ayah: number): string | null {
  const entry = getDownload(folder, surah);
  if (!entry || ayah > entry.ayahs) return null;
  return Capacitor.convertFileSrc(`${entry.dirUri}/${ayahFileName(surah, ayah)}`);
}

/**
 * مصدر محلي للبسملة التمهيدية: من الفاتحة المحمّلة، أو من نسخة مجلد السورة.
 * (التحميلات القديمة قبل هذه النسخة لا تحوي نسخة البسملة، فيُرجع null.)
 */
export function localBasmalaSrc(folder: string, surah: number): string | null {
  const fatiha = localAyahSrc(folder, 1, 1);
  if (fatiha) return fatiha;
  const entry = getDownload(folder, surah);
  if (!entry || entry.hasBasmala !== true) return null;
  return Capacitor.convertFileSrc(`${entry.dirUri}/${BASMALA_FILE}`);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("تعذّر قراءة الملف الصوتي"));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const at = result.indexOf(",");
      resolve(at >= 0 ? result.slice(at + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

export interface DownloadHandle {
  cancel: () => void;
}

export interface DownloadCallbacks {
  onProgress?: (done: number, total: number, bytes: number) => void;
  onDone?: (entry: DownloadedSurah) => void;
  onError?: (error: Error) => void;
}

/**
 * Downloads every ayah of a surah for one reciter.
 * Resumable: files already on disk are skipped on a second run.
 */
export function downloadSurah(
  reciter: Reciter,
  surah: number,
  ayahCount: number,
  cb: DownloadCallbacks = {},
): DownloadHandle {
  let cancelled = false;
  const abort = new AbortController();

  void (async () => {
    try {
      if (!offlineSupported()) {
        throw new Error("التحميل للاستماع بدون إنترنت متاح في تطبيق منار للآيفون فقط");
      }
      const { Filesystem, Directory } = await import("@capacitor/filesystem");
      const dir = `${ROOT}/${reciter.folder}/${String(surah).padStart(3, "0")}`;

      await Filesystem.mkdir({
        path: dir,
        directory: recitationDirectory(Directory),
        recursive: true,
      }).catch(() => {
        /* already exists */
      });

      // الملفات: آيات السورة، ومعها البسملة (001001) لسور تبدأ بها،
      // لتعمل البسملة التمهيدية بدون إنترنت أيضاً.
      // البسملة أولاً، فلا يبلغ العدّاد آخر آية والتحميل لم ينتهِ بعد.
      const files: { name: string; url: string }[] = [];
      if (needsBasmalaIntro(surah, 1)) {
        files.push({ name: BASMALA_FILE, url: ayahAudioUrl(reciter, 1, 1) });
      }
      const extra = files.length;
      for (let ayah = 1; ayah <= ayahCount; ayah++) {
        files.push({ name: ayahFileName(surah, ayah), url: ayahAudioUrl(reciter, surah, ayah) });
      }

      // تُحسب أحجام الملفات الموجودة مسبقاً أيضاً، فيبقى الحجم صحيحاً عند الاستئناف.
      let bytes = 0;
      let done = 0;
      let failure: Error | null = null;
      let next = 0;

      const run = async () => {
        while (!cancelled && !failure && next < files.length) {
          const file = files[next++];
          const path = `${dir}/${file.name}`;
          const existing = await Filesystem.stat({
            path,
            directory: recitationDirectory(Directory),
          }).catch(() => null);
          if (existing && existing.size > 1024) {
            bytes += existing.size;
          } else {
            const res = await fetch(file.url, { signal: abort.signal });
            if (!res.ok) {
              failure = new Error(`تعذّر تحميل ${file.name} (${res.status})`);
              return;
            }
            const blob = await res.blob();
            const data = await blobToBase64(blob);
            await Filesystem.writeFile({
              path,
              directory: recitationDirectory(Directory),
              data,
              recursive: true,
            });
            bytes += blob.size;
          }
          done += 1;
          if (!cancelled) cb.onProgress?.(Math.max(0, done - extra), ayahCount, bytes);
        }
      };

      const worker = async () => {
        try {
          await run();
        } catch (e) {
          // خطأ شبكة: يوقف بقية العمّال فوراً.
          failure ??= e instanceof Error ? e : new Error(String(e));
        }
      };

      // تحميل متوازٍ محدود: أسرع بكثير من ملف واحد في كل مرة دون إغراق الشبكة.
      await Promise.all(
        Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, files.length) }, worker),
      );
      if (failure) throw failure;

      if (cancelled) return;
      const { uri } = await Filesystem.getUri({
        path: dir,
        directory: recitationDirectory(Directory),
      });
      const entry: DownloadedSurah = {
        folder: reciter.folder,
        surah,
        ayahs: ayahCount,
        bytes,
        dirUri: uri,
        at: Date.now(),
        hasBasmala: needsBasmalaIntro(surah, 1),
      };
      writeManifest({ ...readManifest(), [downloadKey(reciter.folder, surah)]: entry });
      cb.onDone?.(entry);
    } catch (error) {
      if (!cancelled) {
        cb.onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    }
  })();

  return {
    cancel: () => {
      cancelled = true;
      abort.abort();
    },
  };
}

// ------------------------------------------------------------
// مدير التحميلات: يعيش خارج الشاشات، فيستمر التحميل بعد مغادرة
// شاشة التلاوات أو تمرير صف السورة خارج الشاشة، ويعود التقدم
// إلى الصف عند الرجوع.
// ------------------------------------------------------------

export type ActiveDownload =
  | {
      status: "active";
      folder: string;
      surah: number;
      done: number;
      total: number;
      bytes: number;
    }
  | { status: "error"; folder: string; surah: number; message: string };

const active = new Map<string, { state: ActiveDownload; handle: DownloadHandle | null }>();
const listeners = new Set<() => void>();
let snapshot: ActiveDownload[] = [];

function emit() {
  snapshot = [...active.values()].map((v) => v.state);
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export interface DownloadManagerEvents {
  onDone?: (entry: DownloadedSurah) => void;
  onError?: (surah: number, message: string) => void;
}

/** يُضبط مرة من الواجهة لإشعار المستخدم بانتهاء التحميل أينما كان. */
let managerEvents: DownloadManagerEvents = {};
export function setDownloadManagerEvents(e: DownloadManagerEvents): void {
  managerEvents = e;
}

/** يبدأ تحميل سورة إن لم يكن جارياً (ويستأنف من الملفات الموجودة). */
export function startDownload(reciter: Reciter, surah: number, ayahCount: number): void {
  const key = downloadKey(reciter.folder, surah);
  if (active.get(key)?.state.status === "active") return;
  const slot: { state: ActiveDownload; handle: DownloadHandle | null } = {
    state: { status: "active", folder: reciter.folder, surah, done: 0, total: ayahCount, bytes: 0 },
    handle: null,
  };
  active.set(key, slot);
  emit();
  slot.handle = downloadSurah(reciter, surah, ayahCount, {
    onProgress: (done, total, bytes) => {
      if (active.get(key) !== slot) return;
      slot.state = { status: "active", folder: reciter.folder, surah, done, total, bytes };
      emit();
    },
    onDone: (entry) => {
      if (active.get(key) === slot) active.delete(key);
      emit();
      managerEvents.onDone?.(entry);
    },
    onError: (e) => {
      if (active.get(key) !== slot) return;
      slot.state = { status: "error", folder: reciter.folder, surah, message: e.message };
      slot.handle = null;
      emit();
      managerEvents.onError?.(surah, e.message);
    },
  });
}

/** يلغي تحميلاً جارياً أو يمسح خطأه. الملفات المكتملة تبقى للاستئناف. */
export function cancelDownload(folder: string, surah: number): void {
  const key = downloadKey(folder, surah);
  const slot = active.get(key);
  if (!slot) return;
  slot.handle?.cancel();
  active.delete(key);
  emit();
}

/** يلغي كل التحميلات الجارية (للاختبارات ولحذف الكل). */
export function cancelAllDownloads(): void {
  for (const slot of active.values()) slot.handle?.cancel();
  active.clear();
  emit();
}

/** قائمة التحميلات الجارية أو المتعثّرة، تفاعلية. */
export function useActiveDownloads(): ActiveDownload[] {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );
}

/** حالة تحميل سورة واحدة لقارئ، أو undefined. */
export function useActiveDownload(folder: string, surah: number): ActiveDownload | undefined {
  const all = useActiveDownloads();
  return all.find((d) => d.folder === folder && d.surah === surah);
}

/** Deletes a downloaded surah and its manifest entry. */
export async function deleteDownload(folder: string, surah: number): Promise<void> {
  const key = downloadKey(folder, surah);
  const manifest = readManifest();
  const entry = manifest[key];
  if (offlineSupported()) {
    try {
      const { Filesystem, Directory } = await import("@capacitor/filesystem");
      await Filesystem.rmdir({
        path: `${ROOT}/${folder}/${String(surah).padStart(3, "0")}`,
        directory: recitationDirectory(Directory),
        recursive: true,
      });
    } catch {
      /* directory may already be gone */
    }
  }
  if (entry) {
    const next = { ...manifest };
    delete next[key];
    writeManifest(next);
  }
}

/** Deletes every downloaded recitation. */
export async function deleteAllDownloads(): Promise<void> {
  cancelAllDownloads();
  const all = listDownloads();
  for (const d of all) await deleteDownload(d.folder, d.surah);
  writeManifest({});
}

export function formatBytesAr(bytes: number): string {
  if (bytes < 1024) return `${bytes} بايت`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} ك.ب`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 1 : 0)} م.ب`;
}

/** Reactive list of downloaded surahs. */
export function useDownloads() {
  const [items, setItems] = useState<DownloadedSurah[]>([]);

  useEffect(() => {
    const sync = () => setItems(listDownloads());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const has = useCallback(
    (folder: string, surah: number) => items.some((d) => d.folder === folder && d.surah === surah),
    [items],
  );

  const totalBytes = items.reduce((n, d) => n + d.bytes, 0);

  return { items, has, totalBytes, remove: deleteDownload, clear: deleteAllDownloads } as const;
}
