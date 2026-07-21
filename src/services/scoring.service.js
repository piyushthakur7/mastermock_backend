/**
 * Compute score and percentage for a test attempt from the hack's answer key.
 *
 * Mutates the attempt in place (answers[].is_correct, answers[].marks_awarded,
 * score, total_marks, percentage, scored_at) but does not save it — callers
 * decide when to persist.
 */
export const scoreAttempt = (attempt, hack) => {
  const questions = hack.questions || [];

  const questionById = new Map(questions.map((q) => [q._id.toString(), q]));

  // Denominator is derived from the questions that actually exist, not from
  // the admin-typed hack.total_marks — that field was never reconciled when
  // questions were added, so a paper worth 20 marks could be scored out of an
  // arbitrary 100 and report a perfect run as 20%.
  const totalMarks = questions.reduce(
    (sum, q) => sum + (Number(q.marks) || 0),
    0,
  );

  let score = 0;

  (attempt.answers || []).forEach((answer) => {
    const question = questionById.get(answer.question_id.toString());
    let awarded = 0;

    if (question && answer.selected_option_id) {
      const selectedOption = (question.options || []).find(
        (o) => o._id.toString() === answer.selected_option_id.toString(),
      );

      if (selectedOption && selectedOption.is_correct) {
        answer.is_correct = true;
        awarded = Number(question.marks) || 0;
      } else if (selectedOption) {
        // Re-evaluating must be able to clear a previous true, otherwise a
        // stale flag survives and inflates the correct-answer counts.
        answer.is_correct = false;
        if (hack.negative_marking) {
          awarded = -(Number(hack.negative_marks_per_wrong) || 0);
        }
      } else {
        // The chosen option is not in the question any more — the answer key
        // moved after this attempt was taken. saveAnswer only ever stores an
        // option that existed at the time, so this is the test changing
        // underneath the student, not a bad submission. Score it as unattempted
        // rather than wrong; punishing it here (especially with negative
        // marking) silently destroyed completed results.
        answer.is_correct = false;
        awarded = 0;
      }
    } else {
      answer.is_correct = false;
    }

    answer.marks_awarded = awarded;
    score += awarded;
  });

  attempt.score = Math.max(0, score);
  attempt.total_marks = totalMarks;
  attempt.percentage = totalMarks > 0 ? (attempt.score / totalMarks) * 100 : 0;
  attempt.scored_at = new Date();

  return attempt;
};
