/**
 * أداة تطبيع النص القرآني على جانب العميل (مشتركة بين الويب والجوال)
 */
export function normalizeArabicToken(text: string): string {
  if (!text) return "";
  return text
    .replace(/[\u0610-\u061A\u064B-\u065F\u06D6-\u06ED\u0640\ufeff]/g, "")
    .replace(/\u0670/g, "ا")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\u0621-\u064A\s]/g, "")
    .replace(/ا{2,}/g, "ا")
    .trim();
}
