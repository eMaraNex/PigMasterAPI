import { describe, expect, jest, test } from '@jest/globals';

jest.unstable_mockModule('../src/config/database.js', () => ({ pool: { connect: jest.fn() } }));
jest.unstable_mockModule('../src/services/email.services.js', () => ({ default: class {} }));
const { reminderMessage, reminderStage } = await import('../src/services/subscription-reminders.service.js');

describe('subscription reminders', () => {
  test('stages follow 5 / 2 / 1 days before, ended, and one follow-up after', () => {
    expect(reminderStage(6, false)).toBeNull();
    expect(reminderStage(5, false)).toBe('before_5');
    expect(reminderStage(3, false)).toBe('before_5');
    expect(reminderStage(2, false)).toBe('before_2');
    expect(reminderStage(1, false)).toBe('before_1');
    expect(reminderStage(0, false)).toBe('before_1');
    expect(reminderStage(0, true)).toBe('ended');
    expect(reminderStage(-2, true)).toBe('ended');
    expect(reminderStage(-3, true)).toBe('after_3');
    expect(reminderStage(-7, true)).toBe('after_3');
    expect(reminderStage(-8, true)).toBeNull();
  });

  test('messages name the product, the end date and the renewal link', () => {
    process.env.DEV_CLIENT_BASE_URL = 'http://localhost:3000';
    const trial = reminderMessage({ name: 'Jane', kind: 'trial', plan: 'trial', stage: 'before_5', endsAt: '2026-11-01T00:00:00Z', daysLeft: 5 });
    expect(trial.subject).toBe('Your PigMaster free trial ends in 5 days');
    expect(trial.text).toContain('http://localhost:3000/pricing');
    const ended = reminderMessage({ name: 'Jane', kind: 'plan', plan: 'advanced', stage: 'ended', endsAt: '2026-11-01T00:00:00Z', daysLeft: 0 });
    expect(ended.subject).toBe('Your PigMaster advanced plan has ended');
    expect(ended.text).toContain('records are safe');
  });
});
