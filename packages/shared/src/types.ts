/**
 * الأنواع والواجهات المشتركة بين تطبيق الويب (React/Next) وتطبيق الجوال (React Native)
 */

export interface TajweedRuleTag {
  code: string;
  name_ar: string;
  color: string;
  harakat: string;
  letter_hint: string;
  guide: string;
}

export interface QuranWord {
  id: number;
  ayah_id: number;
  surah_number: number;
  ayah_number: number;
  word_position: number;
  page_number: number;
  text_uthmani: string;
  display_uthmani: string;
  waqf_mark: string | null;
  text_imlaei: string;
  text_normalized: string;
  tajweed_rules: TajweedRuleTag[];
  qps_reference: string;
}

export interface QuranAyah {
  id: number;
  surah_number: number;
  ayah_number: number;
  page_number: number;
  juz_number: number;
  hizb_quarter: number;
  sajda: number;
  text_uthmani: string;
  text_imlaei: string;
  text_normalized: string;
  word_count: number;
  surah_name_ar: string;
  surah_name_uthmani: string;
  revelation_type: string;
  show_basmalah: boolean;
  is_surah_start: boolean;
  words: QuranWord[];
}

export interface SurahMeta {
  number: number;
  name_ar: string;
  name_uthmani: string;
  name_en: string;
  revelation_type: string;
  ayah_count: number;
  start_page: number;
  end_page: number;
}

export type HideMode = "NONE" | "BLUR_ALL" | "FIRST_LETTER" | "AYAH_HEADS";

export interface RecitationEvent {
  event:
    | "WORD_MATCHED"
    | "MISTAKE_DETECTED"
    | "TAJWEED_NOTE"
    | "BACKTRACK_DETECTED"
    | "VERSE_LOCATED"
    | "PARTIAL_LISTENING"
    | "IGNORED_HEADER_PHRASE";
  word_id?: number;
  uthmani?: string;
  spoken?: string;
  mistake_type?: "SKIPPED" | "SUBSTITUTED";
  expected_token?: string;
  spoken_token?: string;
  details?: string;
  rule_code?: string;
  rule_name?: string;
  message?: string;
  severity?: "warning" | "error";
  surah_number?: number;
  surah_name?: string;
  ayah_number?: number;
  page_number?: number;
}
