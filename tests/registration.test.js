import request from 'supertest';
import app from '../src/app.js';
import { User } from '../src/models/user.model.js';

let seq = 0;
const uniqEmail = () => `reg-${Date.now()}-${seq++}@example.com`;

const register = (overrides = {}) =>
  request(app)
    .post('/api/v1/auth/register')
    .send({
      full_name: 'Test Student',
      email: uniqEmail(),
      password: 'CorrectHorse1',
      phone_number: '9876543210',
      ...overrides,
    });

describe('POST /api/v1/auth/register — mobile number is mandatory', () => {
  it('rejects a registration with no mobile number', async () => {
    const res = await register({ phone_number: undefined });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/mobile number/i);
  });

  it('rejects a mobile number that is not a valid 10-digit Indian number', async () => {
    for (const bad of ['12345', '1234567890', 'abcdefghij', '98765432101234']) {
      const res = await register({ phone_number: bad });
      expect(res.status).toBe(400);
    }
  });

  it('accepts and stores a valid number', async () => {
    const res = await register({ phone_number: '9123456780' });

    expect(res.status).toBe(201);
    const user = await User.findById(res.body.data.user._id);
    expect(user.phone_number).toBe('9123456780');
  });

  it('normalises +91 / 0 prefixes and spacing to bare 10 digits', async () => {
    const res = await register({ phone_number: '+91 98765 43211' });

    expect(res.status).toBe(201);
    const user = await User.findById(res.body.data.user._id);
    expect(user.phone_number).toBe('9876543211');
  });

  it('rejects a number already registered with a clean 409, not a 500', async () => {
    const first = await register({ phone_number: '9876500001' });
    expect(first.status).toBe(201);

    // Same number, different formatting — normalisation must catch it.
    const second = await register({ phone_number: '+91-98765-00001' });

    expect(second.status).toBe(409);
    expect(second.body.message).toMatch(/mobile number/i);
  });
});
