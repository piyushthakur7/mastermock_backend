/**
 * Report resource records whose file is missing from storage.
 *
 *   node scripts/audit-resource-files.js              # report only
 *   node scripts/audit-resource-files.js --unpublish  # also hide them from students
 *
 * This replaces cleanMissingFiles.js, which DELETED the database record for
 * any file it could not find on disk. That is the wrong response: the record
 * carries the title, pricing and purchase history, and on a host that wipes
 * local disk on redeploy the file being absent says nothing about whether the
 * resource is still wanted — it just means it needs re-uploading. Deleting the
 * record also orphans any Purchase pointing at it.
 *
 * --unpublish sets is_active: false so students stop seeing a resource they
 * cannot download, while the record (and its purchase history) survives and an
 * admin can re-upload the file and republish.
 */
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { DB_NAME } from '../src/constants.js';
import { Resource } from '../src/models/resource.model.js';
import { Purchase } from '../src/models/purchase.model.js';
import { fileExists, activeProvider, isDurable } from '../src/utils/storage.js';

const UNPUBLISH = process.argv.includes('--unpublish');

const main = async () => {
  await mongoose.connect(env.MONGO_URI, { dbName: DB_NAME });
  console.log(
    `Connected to ${mongoose.connection.host}/${mongoose.connection.name}`,
  );
  console.log(`Storage provider: ${activeProvider()}`);

  if (!isDurable()) {
    console.warn(
      '\n⚠  Files are stored on LOCAL DISK. On a host that rebuilds the\n' +
        '   filesystem on deploy they are erased while the database records\n' +
        '   survive — which is what produces missing files. Configure\n' +
        '   CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET\n' +
        '   to store uploads durably.\n',
    );
  }

  const resources = await Resource.find({ isDeleted: false });
  const missing = [];

  for (const resource of resources) {
    if (!(await fileExists(resource))) missing.push(resource);
  }

  console.log(`\n${resources.length} active resource(s) checked.`);
  console.log(`${missing.length} have no file behind them.\n`);

  if (!missing.length) {
    await mongoose.disconnect();
    return;
  }

  for (const resource of missing) {
    const sold = await Purchase.countDocuments({
      item_id: resource._id,
      item_type: 'Resource',
      status: 'ACTIVE',
    });

    console.log(
      `  • "${resource.title}" [${resource.access_type}]` +
        `${sold ? ` — ${sold} active purchase(s)` : ''}`,
    );
    console.log(`      id:  ${resource._id}`);
    console.log(`      key: ${resource.file_url}`);
  }

  const paidAndSold = missing.filter((r) => r.access_type === 'paid');
  if (paidAndSold.length) {
    console.warn(
      `\n⚠  ${paidAndSold.length} of these are PAID resources. Re-upload them\n` +
        '   before anyone who bought one tries to download it.\n',
    );
  }

  if (UNPUBLISH) {
    const result = await Resource.updateMany(
      { _id: { $in: missing.map((r) => r._id) } },
      { $set: { is_active: false, file_missing_since: new Date() } },
    );
    console.log(
      `\nUnpublished ${result.modifiedCount} resource(s). Records and purchase\n` +
        'history are intact — re-upload the file and republish to restore them.',
    );
  } else {
    console.log(
      '\nRe-run with --unpublish to hide these from students until the files\n' +
        'are restored. Nothing has been modified.',
    );
  }

  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error('Audit failed:', error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
