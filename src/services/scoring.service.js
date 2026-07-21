/**
 * Compute score and percentage for a test attempt from the hack's answer key.
 *
 * Mutates the attempt in place (answers[].is_correct, score, percentage) but
 * does not save it — callers decide when to persist. Scoring is deterministic,
 * so re-running it on an already-scored attempt is safe.
 */
export const scoreAttempt = (attempt, hack) => {
  let score = 0;

  attempt.answers.forEach((answer) => {
    const question = hack.questions.find(
      (q) => q._id.toString() === answer.question_id.toString(),
    );
    if (question && answer.selected_option_id) {
      const selectedOption = question.options.find(
        (o) => o._id.toString() === answer.selected_option_id.toString(),
      );
      if (selectedOption && selectedOption.is_correct) {
        answer.is_correct = true;
        score += question.marks;
      } else {
        // Re-evaluating must be able to clear a previous true, otherwise a
        // stale flag survives and inflates the correct-answer counts.
        answer.is_correct = false;
        if (hack.negative_marking) {
          score -= hack.negative_marks_per_wrong;
        }
      }
    } else {
      answer.is_correct = false;
    }
  });

  attempt.score = Math.max(0, score);
  attempt.percentage =
    hack.total_marks > 0 ? (attempt.score / hack.total_marks) * 100 : 0;

  return attempt;
};
