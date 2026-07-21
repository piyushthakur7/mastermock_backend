/**
 * DEPRECATED — do not use.
 *
 * This script used to DELETE the database record of any resource whose file it
 * could not find on local disk. That is destructive and almost always wrong:
 *
 *   - The record holds the title, pricing and purchase history. Deleting it
 *     orphans every Purchase that points at the resource.
 *   - On a host that rebuilds the filesystem on deploy, local uploads are wiped
 *     while the records survive. A missing file therefore means "needs
 *     re-uploading", not "this resource was never meant to exist".
 *
 * Use the non-destructive audit instead, which reports what is missing and can
 * unpublish those resources without destroying anything:
 *
 *   npm run audit:files
 *   npm run audit:files:unpublish
 */
console.error(
  'cleanMissingFiles.js is deprecated because it deleted resource records ' +
    '(including paid ones with purchase history).\n\n' +
    'Use the safe audit instead:\n' +
    '  npm run audit:files             # report what is missing\n' +
    '  npm run audit:files:unpublish   # hide missing files from students\n',
);
process.exit(1);
