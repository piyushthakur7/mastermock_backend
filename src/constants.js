export const DB_NAME = 'mastermock';

// Max accepted request body. 16kb was too small to save a mock test, because
// the whole paper is submitted in one bulk request. Hindi costs ~3x per
// character in UTF-8, so a bilingual question (English stem + Hindi stem +
// five bilingual options) measures ~1.1kb: 10 questions came to 11.4kb and
// squeezed under the old cap, 15 came to 17.0kb and were rejected with
// "request entity too large" — hence the reports of saves failing partway
// through a paper. Comprehension passages run several times larger again.
//
// Questions are plain text only (no images or base64), so the payload scales
// predictably with question count and 2mb leaves room for roughly 800
// bilingual questions — still far under MongoDB's 16mb document ceiling.
export const BODY_LIMIT = '2mb';
