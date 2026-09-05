'use strict';

// PHF HR — Competition V1.1 · lightweight, deterministic, NO-AI similarity
// heuristic for duplicate/near-duplicate content suggestions.
//
// LOCKED PRINCIPLE (do not weaken): this module NEVER decides anything. It
// only produces a SUGGESTION label a human (sender or reviewer) can read.
// No automatic rejection, no automatic score change, no external request —
// pure in-process string comparison over already-fetched candidate rows.
//
// METHOD (documented, not scattered magic numbers):
//   1. token Jaccard similarity on normalized, stop-word-filtered words.
//   2. character-trigram Dice similarity on normalized text (catches
//      reordering/insertion noise the token view misses, e.g. "sầu riêng
//      bổ ra bị sượng" appearing as a shared substring inside two longer,
//      differently-worded sentences).
//   3. token Jaccard again on diacritics-stripped text (catches typing/
//      accent drift — "sượng" vs "suong" — as a SECOND comparison form).
//   The final score is the MAX of the three. Rationale: this is a
//   suggestion, not a verdict (LOCKED business rule) — a false positive
//   costs the reader one extra glance at a warning; a false negative hides
//   a real duplicate entirely. MAX is the conservative (recall-favouring)
//   choice given that asymmetry, and it stays legible ("these two matched
//   on at least one honest measure") rather than a blended score nobody
//   can explain.
//
// THRESHOLDS — single source of truth, tuned against the PHF-style test
// pairs in scripts/test-competition-similarity-v1-1-2026-09.js:
//   HIGH   (>= 0.50): near-duplicate wording — worth a strong warning.
//   MEDIUM (>= 0.28): same general topic, meaningfully overlapping wording —
//     worth a quiet mention, not a strong warning.
//   below MEDIUM: DIFFERENT — no useful similarity signal.
//   Vietnamese sentences are short, so raw Jaccard on a ~10-token sentence
//   moves in large steps (each shared/differing word is ~10% of the score);
//   thresholds were picked empirically against real-shaped PHF question
//   pairs, not copied from an English-text convention.
const THRESHOLDS = Object.freeze({ HIGH: 0.50, MEDIUM: 0.28 });

// Small, safe Vietnamese stop-word set — function words that carry no topic
// signal and would otherwise dilute genuine overlap between two sentences of
// different length. Intentionally short: only unambiguous grammatical words.
const STOPWORDS = new Set([
  'là', 'và', 'của', 'có', 'cho', 'khi', 'thì', 'này', 'đó', 'các', 'những',
  'một', 'bị', 'được', 'đã', 'sẽ', 'rất', 'như', 'với', 'vì', 'nên', 'mà',
  'ở', 'tại', 'trên', 'dưới', 'ra', 'vào', 'lại', 'còn', 'nếu', 'để', 'theo',
  'vẫn', 'hay', 'hoặc', 'cũng', 'đang', 'bạn', 'tôi', 'em', 'anh', 'chị',
  'là', 'sao', 'à', 'ạ', 'về',
]);

function stripDiacritics(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

// lowercase, punctuation/noise stripped, whitespace collapsed.
function normalize(text) {
  let s = String(text == null ? '' : text).toLowerCase();
  s = s.replace(/[.,!?;:"'`()[\]{}<>/\\|_+=*&^%$#@~-]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function tokenize(text, opts) {
  const norm = (opts && opts.stripDiacritics) ? stripDiacritics(normalize(text)) : normalize(text);
  if (!norm) return [];
  // STOPWORDS carries diacritics, so it only applies to the primary
  // (non-stripped) pass — the diacritics-stripped pass is deliberately left
  // as a pure second comparison form, unfiltered.
  const stop = (opts && opts.stripDiacritics) ? null : STOPWORDS;
  return norm.split(' ').filter((t) => t && (!stop || !stop.has(t)));
}

function charTrigrams(text) {
  const norm = normalize(text).replace(/ /g, '_');
  const grams = new Set();
  if (norm.length < 3) { if (norm) grams.add(norm); return grams; }
  for (let i = 0; i <= norm.length - 3; i++) grams.add(norm.slice(i, i + 3));
  return grams;
}

function jaccard(aTokens, bTokens) {
  const A = new Set(aTokens);
  const B = new Set(bTokens);
  if (!A.size && !B.size) return 0;
  let inter = 0;
  A.forEach((t) => { if (B.has(t)) inter++; });
  const union = A.size + B.size - inter;
  return union ? inter / union : 0;
}

function dice(aGrams, bGrams) {
  if (!aGrams.size && !bGrams.size) return 0;
  let inter = 0;
  aGrams.forEach((g) => { if (bGrams.has(g)) inter++; });
  const denom = aGrams.size + bGrams.size;
  return denom ? (2 * inter) / denom : 0;
}

function round4(n) { return Number(n.toFixed(4)); }

// Compares two free-text fields (e.g. two "question" strings, or two
// "answer" strings). Returns the 3 component scores + the combined score.
function scoreTexts(a, b) {
  const j1 = jaccard(tokenize(a), tokenize(b));
  const d1 = dice(charTrigrams(a), charTrigrams(b));
  const j2 = jaccard(tokenize(a, { stripDiacritics: true }), tokenize(b, { stripDiacritics: true }));
  const score = Math.max(j1, d1, j2);
  return {
    jaccard: round4(j1), dice: round4(d1), jaccardNoDiacritics: round4(j2),
    score: round4(score),
  };
}

function labelFor(score) {
  if (score >= THRESHOLDS.HIGH) return 'HIGH';
  if (score >= THRESHOLDS.MEDIUM) return 'MEDIUM';
  return 'DIFFERENT';
}

// Compares a candidate (question+answer) against the current draft's
// question+answer. Returns per-field scores/labels plus a single `relevance`
// number used only for RANKING candidates against each other (never shown to
// the end user, never used to decide anything).
function comparePair(question, answer, candidateQuestion, candidateAnswer) {
  const q = scoreTexts(question, candidateQuestion);
  const a = scoreTexts(answer, candidateAnswer);
  return {
    questionScore: q.score, questionLabel: labelFor(q.score),
    answerScore: a.score, answerLabel: labelFor(a.score),
    // question similarity is the primary duplicate signal ("same situation");
    // answer similarity alone (different situation, coincidentally similar
    // wording of the resolution) is a much weaker duplicate indicator, so it
    // is discounted when ranking — it still keeps its own honest label.
    relevance: Math.max(q.score, a.score * 0.85),
  };
}

// candidates: [{ ...anything, question, answer }]. Returns the top N with
// question/answer scores+labels merged in, sorted by relevance, EXCLUDING
// candidates where both fields are pure DIFFERENT (nothing worth surfacing).
function rankCandidates(question, answer, candidates, topN) {
  const scored = (candidates || []).map((c) => Object.assign(
    {}, c, comparePair(question, answer, c.question, c.answer)));
  const useful = scored.filter((c) => c.questionLabel !== 'DIFFERENT' || c.answerLabel !== 'DIFFERENT');
  useful.sort((x, y) => y.relevance - x.relevance);
  return useful.slice(0, topN || 3);
}

module.exports = {
  THRESHOLDS, STOPWORDS,
  normalize, stripDiacritics, tokenize, charTrigrams, jaccard, dice,
  scoreTexts, labelFor, comparePair, rankCandidates,
};
