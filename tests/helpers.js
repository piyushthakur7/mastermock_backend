import { User } from '../src/models/user.model.js';
import { Hack } from '../src/models/hack.model.js';

let seq = 0;
const uniq = () => `${Date.now()}-${seq++}`;

export const makeUser = async (overrides = {}) => {
  const n = uniq();
  const password = overrides.password || 'CorrectHorse1!';
  const user = await User.create({
    full_name: overrides.full_name || `User ${n}`,
    email: overrides.email || `user-${n}@example.com`,
    password_hash: password,
    status: overrides.status || 'active',
    role: overrides.role || 'STUDENT',
  });
  return { user, password, token: user.generateAccessToken() };
};

export const makeAdmin = (overrides = {}) =>
  makeUser({ ...overrides, role: 'ADMIN' });

/**
 * A hack with one question whose SECOND option is the correct one.
 */
export const makeHack = async (createdBy, overrides = {}) => {
  return Hack.create({
    title: overrides.title || `Hack ${uniq()}`,
    access_type: overrides.access_type || 'free',
    price: overrides.price ?? 0,
    total_questions: 1,
    passing_marks: 1,
    total_marks: 2,
    duration_minutes: overrides.duration_minutes ?? 30,
    negative_marking: overrides.negative_marking ?? false,
    negative_marks_per_wrong: overrides.negative_marks_per_wrong ?? 0,
    start_time: overrides.start_time,
    end_time: overrides.end_time,
    created_by: createdBy,
    is_active: overrides.is_active ?? true,
    isDeleted: overrides.isDeleted ?? false,
    questions: overrides.questions || [
      {
        text: 'What is 2 + 2?',
        marks: 2,
        options: [
          { text: '3', is_correct: false },
          { text: '4', is_correct: true },
        ],
      },
    ],
  });
};

export const auth = (token) => ({ Authorization: `Bearer ${token}` });

export const hoursFromNow = (h) => new Date(Date.now() + h * 3600 * 1000);
