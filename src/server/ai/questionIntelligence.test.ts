import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzePlainTextWithIntelligence,
  reprocessSingleQuestionWithIntelligence,
} from './questionIntelligence';
import { safeEvaluatePureJsSnippet } from './answerVerifier';
import { isQuestionReadyForGame } from '../../game/rules';

test('Question Intelligence extracts inline MCQ, horizontal MCQ, T/F, end-of-doc key, worked solutions, and missing answers accurately', async () => {
  const sampleDoc = `
Q1: What is the output of print(2 ** 3) in Python?
A) 6
B) 8
C) 9
D) 16
Answer: B

Q2: Which loop runs at least once in C++?
A) for  B) while  C) do-while  D) foreach

Q3: Python tuples are immutable. (True/False)
Answer: True

Q4: What is the output of the following JavaScript snippet?
\`\`\`js
const nums = [1, 2, 3];
console.log(nums.map(n => n * 2).join(','));
\`\`\`

Q5: Complete the SQL clause to filter grouped rows: SELECT dept, COUNT(*) FROM employees GROUP BY dept ______ COUNT(*) > 5;
Solution: Output is HAVING

Q6: Explain the difference between stack and heap memory allocation.

Answer Key:
2. C
`;

  const res = await analyzePlainTextWithIntelligence(sampleDoc, 'mixed-exam.txt');
  assert.equal(res.questions.length, 6);

  const [q1, q2, q3, q4, q5, q6] = res.questions;

  // Q1: Inline MCQ + Python
  assert.equal(q1.type, 'multiple_choice');
  assert.equal(q1.programmingLanguage, 'Python');
  assert.equal(q1.correctAnswer, '8');
  assert.equal(q1.verificationStatus, 'source_verified');
  assert.equal(q1.approved, true);

  // Q2: Horizontal MCQ + End-of-doc Answer Key
  assert.equal(q2.type, 'multiple_choice');
  assert.equal(q2.options?.length, 4);
  assert.equal(q2.correctAnswer, 'do-while');
  assert.equal(q2.answerSource, 'answer_key_section');
  assert.equal(q2.approved, true);

  // Q3: True/False
  assert.equal(q3.type, 'true_false');
  assert.equal(q3.correctAnswer, 'True');
  assert.equal(q3.approved, true);

  // Q4: JS snippet with missing source answer -> sandbox suggests '2,4,6' WITHOUT auto-approving!
  assert.equal(q4.type, 'find_output');
  assert.equal(q4.programmingLanguage, 'JavaScript');
  assert.equal(q4.correctAnswer, 'NOT PROVIDED');
  assert.equal(q4.aiSuggestedAnswer, '2,4,6');
  assert.equal(q4.verificationStatus, 'needs_teacher_review');
  assert.equal(q4.approved, false);
  assert.equal(isQuestionReadyForGame(q4), false);

  // Q5: Worked solution + SQL
  assert.equal(q5.programmingLanguage, 'SQL');
  assert.equal(q5.correctAnswer, 'HAVING');
  assert.equal(q5.approved, true);

  // Q6: Open-ended missing answer -> NOT PROVIDED & unapproved
  assert.equal(q6.correctAnswer, 'NOT PROVIDED');
  assert.equal(q6.approved, false);
  assert.equal(isQuestionReadyForGame(q6), false);

  // Verify caching works on identical upload
  const cachedRes = await analyzePlainTextWithIntelligence(sampleDoc, 'mixed-exam.txt');
  assert.equal(cachedRes.summary.cacheHit, true);
});

test('Question Intelligence detects conflicting source answer vs verified JS sandbox execution without overwriting sourceAnswer', async () => {
  const conflictDoc = `
Q1: What is the output of this JavaScript code?
\`\`\`js
let total = 0;
for (let i = 1; i <= 4; i++) total += i;
console.log(total);
\`\`\`
Answer: 6
`;

  const res = await analyzePlainTextWithIntelligence(conflictDoc, 'conflict-test.txt');
  assert.equal(res.questions.length, 1);
  const q = res.questions[0];

  assert.equal(q.sourceAnswer, '6');
  assert.equal(q.correctAnswer, '6'); // NEVER silently overwrites sourceAnswer!
  assert.equal(q.aiSuggestedAnswer, '10'); // Sandbox computes 1+2+3+4 = 10
  assert.equal(q.verificationStatus, 'conflicting');
  assert.equal(q.flaggedForReview, true);
  assert.equal(q.approved, false);
  assert.equal(isQuestionReadyForGame(q), false);
});

test('safeEvaluatePureJsSnippet isolates dangerous Node APIs and enforces timeout', () => {
  const badRes = safeEvaluatePureJsSnippet('console.log(typeof process, typeof require);');
  assert.equal(badRes.executed, true);
  assert.equal(badRes.output, 'undefined undefined');

  const reprocessTarget = {
    id: 'q-reproc',
    questionText: 'What does this JS code print?',
    codeSnippet: 'console.log([10, 20, 30].reduce((a, b) => a + b, 0));',
    type: 'find_output' as const,
    difficulty: 'easy' as const,
    correctAnswer: 'NOT PROVIDED',
    points: 100,
    approved: false,
  };

  return reprocessSingleQuestionWithIntelligence(reprocessTarget).then(updated => {
    assert.equal(updated.aiSuggestedAnswer, '60');
    assert.equal(updated.correctAnswer, 'NOT PROVIDED');
    assert.equal(updated.verificationStatus, 'needs_teacher_review');
  });
});

test('Question Intelligence classifies "What does console.log(...) print" as find_output and catches conflict even if Answer is numeric 99', async () => {
  const sample = `
Q2: What does console.log(5 + 7) print in JavaScript?
\`\`\`js
console.log(5 + 7);
\`\`\`
Answer: 99
`;
  const res = await analyzePlainTextWithIntelligence(sample, 'q2-regression.txt');
  assert.equal(res.questions.length, 1);
  const q = res.questions[0];
  assert.equal(q.type, 'find_output');
  assert.equal(q.sourceAnswer, '99');
  assert.equal(q.aiSuggestedAnswer, '12');
  assert.equal(q.verificationStatus, 'conflicting');
  assert.equal(q.approved, false);
});

