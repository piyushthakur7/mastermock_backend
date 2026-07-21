/**
 * One-off migration for the audit fixes.
 *
 * Run this ONCE against each environment BEFORE deploying the new code:
 *
 *   node scripts/migrate-audit-fixes.js            # report only, changes nothing
 *   node scripts/migrate-audit-fixes.js --apply    # make the changes
 *
 * Why it is needed:
 *
 *  - New partial unique indexes on Purchase, Payment and TestAttempt cannot be
 *    built while duplicate rows exist. Those duplicates are exactly what the
 *    missing indexes allowed, so real data may well contain them.
 *  - Payment.access_granted_at is new. Existing SUCCESS payments predate it,
 *    and without a backfill the reconciler would treat every historical
 *    payment as unprovisioned and re-run provisioning for all of them.
 *  - Hack.total_marks / total_questions are now derived. Existing rows keep
 *    whatever was typed in by hand until they are recomputed.
 *  - TestAttempt.total_marks is a new per-attempt snapshot used for percentage.
 *  - Inquiry replies moved from a single admin_reply string to a thread.
 */
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { DB_NAME } from '../src/constants.js';
import { Purchase } from '../src/models/purchase.model.js';
import { Payment } from '../src/models/payment.model.js';
import { TestAttempt } from '../src/models/testAttempt.model.js';
import { Hack } from '../src/models/hack.model.js';
import { User } from '../src/models/user.model.js';
import { Inquiry } from '../src/models/inquiry.model.js';

const APPLY = process.argv.includes('--apply');

const log = (...args) => console.log(APPLY ? '[APPLY]' : '[DRY-RUN]', ...args);

/** Collapse duplicate ACTIVE purchases down to the earliest one per item. */
const dedupeActivePurchases = async () => {
  const dupes = await Purchase.aggregate([
    { $match: { status: 'ACTIVE' } },
    {
      $group: {
        _id: {
          user: '$user',
          item_id: '$item_id',
          item_type: '$item_type',
        },
        ids: { $push: '$_id' },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]);

  if (!dupes.length) {
    log('Purchases: no duplicate ACTIVE rows.');
    return 0;
  }

  let superseded = 0;
  for (const group of dupes) {
    // Keep the earliest (ObjectIds are time-ordered); retire the rest. They
    // are kept as EXPIRED rather than deleted so the money trail survives.
    const [, ...extras] = group.ids.sort((a, b) => (a > b ? 1 : -1));
    superseded += extras.length;
    if (APPLY) {
      await Purchase.updateMany(
        { _id: { $in: extras } },
        { $set: { status: 'EXPIRED' } },
      );
    }
  }

  log(
    `Purchases: ${dupes.length} item(s) had duplicates; ${superseded} extra ACTIVE row(s) retired as EXPIRED.`,
  );
  return superseded;
};

/** Only one PENDING payment per user+item may remain. */
const dedupePendingPayments = async () => {
  const dupes = await Payment.aggregate([
    { $match: { status: 'PENDING' } },
    {
      $group: {
        _id: { user: '$user', item_id: '$item_id', item_type: '$item_type' },
        ids: { $push: '$_id' },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]);

  if (!dupes.length) {
    log('Payments: no duplicate PENDING orders.');
    return 0;
  }

  let cancelled = 0;
  for (const group of dupes) {
    // Keep the newest open order — that is the one the customer is most likely
    // still looking at — and cancel the older ones.
    const sorted = group.ids.sort((a, b) => (a > b ? 1 : -1));
    const extras = sorted.slice(0, -1);
    cancelled += extras.length;
    if (APPLY) {
      await Payment.updateMany(
        { _id: { $in: extras } },
        {
          $set: {
            status: 'CANCELLED',
            failure_reason: 'Superseded by a newer order (audit migration)',
          },
        },
      );
    }
  }

  log(
    `Payments: ${dupes.length} item(s) had multiple open orders; ${cancelled} older order(s) cancelled.`,
  );
  console.warn(
    '  ^ Review these before applying: if a customer actually paid one of the ' +
      'cancelled orders, reconcile it rather than cancelling.',
  );
  return cancelled;
};

/** At most one IN_PROGRESS attempt per user+hack. */
const dedupeInProgressAttempts = async () => {
  const dupes = await TestAttempt.aggregate([
    { $match: { status: 'IN_PROGRESS' } },
    {
      $group: {
        _id: { user: '$user', hack: '$hack' },
        ids: { $push: '$_id' },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]);

  if (!dupes.length) {
    log('Attempts: no duplicate IN_PROGRESS rows.');
    return 0;
  }

  let abandoned = 0;
  for (const group of dupes) {
    const sorted = group.ids.sort((a, b) => (a > b ? 1 : -1));
    const extras = sorted.slice(0, -1); // keep the newest
    abandoned += extras.length;
    if (APPLY) {
      await TestAttempt.updateMany(
        { _id: { $in: extras } },
        { $set: { status: 'ABANDONED' } },
      );
    }
  }

  log(
    `Attempts: ${abandoned} duplicate IN_PROGRESS attempt(s) marked ABANDONED.`,
  );
  return abandoned;
};

/** Mark historical SUCCESS payments as already provisioned. */
const backfillAccessGranted = async () => {
  const candidates = await Payment.find({
    status: 'SUCCESS',
    access_granted_at: { $exists: false },
  }).select('_id user item_id item_type createdAt');

  let provisioned = 0;
  let missing = 0;

  for (const payment of candidates) {
    const hasPurchase = await Purchase.exists({
      user: payment.user,
      item_id: payment.item_id,
      item_type: payment.item_type,
    });

    if (hasPurchase) {
      provisioned += 1;
      if (APPLY) {
        await Payment.updateOne(
          { _id: payment._id },
          { $set: { access_granted_at: payment.createdAt || new Date() } },
        );
      }
    } else {
      // Money taken, nothing granted — exactly the state that used to be
      // unrecoverable. Left unstamped so the reconciler repairs it on boot.
      missing += 1;
    }
  }

  log(
    `Payments: ${provisioned} historical SUCCESS payment(s) stamped as provisioned.`,
  );
  if (missing) {
    console.warn(
      `  ⚠ ${missing} SUCCESS payment(s) have NO purchase record. These customers paid and never got access. ` +
        'They are deliberately left unstamped so the reconciler grants access automatically once deployed.',
    );
  }
  return { provisioned, missing };
};

/** Recompute hack totals from the actual question list. */
const recomputeHackTotals = async () => {
  const hacks = await Hack.find({}).select(
    'questions total_marks total_questions',
  );
  let changed = 0;

  for (const hack of hacks) {
    const questions = hack.questions || [];
    const totalMarks = questions.reduce(
      (sum, q) => sum + (Number(q.marks) || 0),
      0,
    );
    if (
      hack.total_marks !== totalMarks ||
      hack.total_questions !== questions.length
    ) {
      changed += 1;
      if (APPLY) {
        await Hack.updateOne(
          { _id: hack._id },
          {
            $set: {
              total_marks: totalMarks,
              total_questions: questions.length,
            },
          },
        );
      }
    }
  }

  log(`Hacks: ${changed} of ${hacks.length} had incorrect totals.`);
  return changed;
};

/** Snapshot each completed attempt's denominator so percentages stop drifting. */
const backfillAttemptTotals = async () => {
  const attempts = await TestAttempt.find({
    status: 'COMPLETED',
    $or: [{ total_marks: { $exists: false } }, { total_marks: 0 }],
  }).select('_id hack score');

  const hackTotals = new Map();
  let updated = 0;

  for (const attempt of attempts) {
    const key = attempt.hack.toString();
    if (!hackTotals.has(key)) {
      const hack = await Hack.findById(attempt.hack).select('questions');
      hackTotals.set(
        key,
        hack
          ? (hack.questions || []).reduce(
              (sum, q) => sum + (Number(q.marks) || 0),
              0,
            )
          : 0,
      );
    }
    const totalMarks = hackTotals.get(key);
    if (!totalMarks) continue;

    updated += 1;
    if (APPLY) {
      await TestAttempt.updateOne(
        { _id: attempt._id },
        {
          $set: {
            total_marks: totalMarks,
            percentage: ((attempt.score || 0) / totalMarks) * 100,
          },
        },
      );
    }
  }

  log(
    `Attempts: ${updated} completed attempt(s) given a total_marks snapshot.`,
  );
  return updated;
};

/** Blank phone numbers must be absent, not empty strings. */
const normalisePhoneNumbers = async () => {
  // Goes through the raw collection deliberately. The schema now has a setter
  // mapping '' -> undefined, and Mongoose applies setters when casting query
  // filters too — so a model-level query for '' is rewritten to a query for
  // undefined and matches nothing.
  const collection = User.collection;
  const filter = { phone_number: { $in: ['', null] } };
  const count = await collection.countDocuments(filter);

  if (count && APPLY) {
    await collection.updateMany(filter, { $unset: { phone_number: '' } });
  }

  log(`Users: ${count} blank phone_number value(s) unset.`);
  return count;
};

/** Fold the legacy single admin_reply into the new thread. */
const migrateInquiryReplies = async () => {
  const legacy = await Inquiry.find({
    admin_reply: { $exists: true, $nin: [null, ''] },
    $or: [{ replies: { $size: 0 } }, { replies: { $exists: false } }],
  }).select('_id admin_reply replied_by replied_at updatedAt');

  if (legacy.length && APPLY) {
    for (const inquiry of legacy) {
      await Inquiry.updateOne(
        { _id: inquiry._id },
        {
          $push: {
            replies: {
              message: inquiry.admin_reply,
              author: inquiry.replied_by,
              author_role: 'ADMIN',
              created_at: inquiry.replied_at || inquiry.updatedAt || new Date(),
            },
          },
        },
      );
    }
  }

  log(
    `Inquiries: ${legacy.length} legacy reply/replies moved into the thread.`,
  );
  return legacy.length;
};

const syncIndexes = async () => {
  if (!APPLY) {
    log('Indexes: would sync Purchase, Payment, TestAttempt, User, Category.');
    return;
  }
  for (const model of [Purchase, Payment, TestAttempt, User, Inquiry]) {
    await model.syncIndexes();
    log(`Indexes synced for ${model.modelName}`);
  }
};

const main = async () => {
  await mongoose.connect(env.MONGO_URI, { dbName: DB_NAME });
  console.log(
    `Connected to ${mongoose.connection.host}/${mongoose.connection.name}\n`,
  );

  if (!APPLY) {
    console.log(
      'Dry run — nothing will be modified. Re-run with --apply to commit.\n',
    );
  }

  // Order matters: duplicates must be gone before the unique indexes build.
  await dedupeActivePurchases();
  await dedupePendingPayments();
  await dedupeInProgressAttempts();
  await backfillAccessGranted();
  await recomputeHackTotals();
  await backfillAttemptTotals();
  await normalisePhoneNumbers();
  await migrateInquiryReplies();
  await syncIndexes();

  console.log('\nDone.');
  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error('Migration failed:', error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
