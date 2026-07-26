/**
 * Compute score and percentage for a test attempt from the hack's answer key.
 *
 * Mutates the attempt in place (answers[].is_correct, answers[].marks_awarded,
 * score, percentage) but does not save it — callers decide when to persist.
 * Scoring is deterministic, so re-running it on an already-scored attempt is
 * safe.
 *
 * The total is SIGNED. With negative marking enabled a candidate who gets more
 * wrong than right finishes below zero, exactly as they would in JEE/NEET/CAT.
 * The score is deliberately not floored at 0: doing so silently erased the
 * penalty the test was configured to apply, so a student who answered one
 * question wrong and a student who answered nothing at all both showed 0.00
 * and appeared identical on the result page and the leaderboard.
 */
export const scoreAttempt = (attempt, hack) => {
  // The penalty is stored as a magnitude and subtracted. Guard the sign here:
  // an admin entering "-0.25" for a field labelled "negative marks" is a
  // completely natural thing to do, and without Math.abs that double negative
  // would ADD marks for every wrong answer.
  const penaltyPerWrong = hack.negative_marking
    ? Math.abs(Number(hack.negative_marks_per_wrong) || 0)
    : 0;

  let score = 0;

  attempt.answers.forEach((answer) => {
    const question = hack.questions.find(
      (q) => q._id.toString() === answer.question_id.toString(),
    );

    // What this single answer contributed to the total, signed. Recorded so
    // the result page can show a per-question breakdown that adds up to the
    // displayed total instead of re-deriving it from the live answer key.
    let awarded = 0;

    if (question && answer.selected_option_id) {
      const selectedOption = question.options.find(
        (o) => o._id.toString() === answer.selected_option_id.toString(),
      );
      if (selectedOption && selectedOption.is_correct) {
        answer.is_correct = true;
        awarded = Number(question.marks) || 0;
      } else {
        // Re-evaluating must be able to clear a previous true, otherwise a
        // stale flag survives and inflates the correct-answer counts.
        answer.is_correct = false;
        awarded = -penaltyPerWrong;
      }
    } else {
      // Unattempted (or a question that no longer exists). Never penalised —
      // only a wrong answer costs marks.
      answer.is_correct = false;
      awarded = 0;
    }

    answer.marks_awarded = awarded;
    score += awarded;
  });

  // Floating point: 0.1 + 0.2 style drift turns -0.25 into -0.25000000000004
  // and shows up the moment a UI formats it. Round to 2dp, which is finer
  // than any marking scheme in use.
  attempt.score = Math.round(score * 100) / 100;

  attempt.percentage =
    hack.total_marks > 0
      ? Math.round((attempt.score / hack.total_marks) * 100 * 100) / 100
      : 0;

  return attempt;
};
