import { jest } from '@jest/globals';

const executeQueryMock = jest.fn();
const executeTransactionMock = jest.fn();
const getConnectionMock = jest.fn();

jest.unstable_mockModule('../src/config/database.js', () => ({
  DatabaseHelper: {
    executeQuery: executeQueryMock,
    executeTransaction: executeTransactionMock,
    getConnection: getConnectionMock,
  },
  pool: {
    connect: jest.fn(),
  },
}));

jest.unstable_mockModule('../src/services/mpesa.services.js', () => ({
  default: {
    processCallback: jest.fn(() => ({
      success: true,
      checkoutRequestID: 'test-checkout-id',
      merchantRequestID: 'merchant-id',
      amount: 100,
      mpesaReceiptNumber: 'ABC123',
      transactionDate: '20240201120000',
      phoneNumber: '254700000000',
      resultDesc: 'The service request is processed successfully.',
    })),
  },
}));

const initializeDatabaseMock = jest.fn();
jest.unstable_mockModule('../src/database/runSetup.js', () => ({
  initializeDatabase: initializeDatabaseMock,
}));

jest.unstable_mockModule('../src/services/email.services.js', () => ({
  default: class EmailService {
    constructor() {
      this.logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    }
    async sendEmail() {
      return { success: true, message: 'mocked email' };
    }
  },
}));

const { default: PaymentService } = await import('../src/services/payment.service.js');
const { default: AuthService } = await import('../src/services/auth.services.js');

describe('subscription and payment flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    initializeDatabaseMock.mockResolvedValue(true);
    executeQueryMock.mockImplementation((query) => {
      if (query.includes('INSERT INTO roles')) {
        return { rowCount: 1, rows: [] };
      }
      if (query.includes('SELECT id, name, permissions FROM roles WHERE id')) {
        return { rows: [{ id: 1, name: 'free', permissions: [] }] };
      }
      if (query.includes('SELECT id FROM roles WHERE name')) {
        return { rows: [{ id: 1 }] };
      }
      if (query.includes('SELECT id FROM users WHERE email')) {
        return { rows: [] };
      }
      if (query.includes('INSERT INTO users')) {
        return { rows: [{ id: 'user-1', email: 'new@example.com', name: 'New User', role_id: 1, farm_id: null, email_verified: false, is_active: 1, is_deleted: 0, created_at: new Date() }] };
      }
      if (query.includes('INSERT INTO subscription_plans')) {
        return { rowCount: 1, rows: [] };
      }
      if (query.includes('SELECT s.*, sp.name AS plan_name')) {
        return { rows: [] };
      }
      if (query.includes('INSERT INTO subscriptions')) {
        return { rows: [{ id: 'subscription-1' }] };
      }
      return { rows: [] };
    });
  });

  test('register creates a trial subscription for a new user', async () => {
    const result = await AuthService.register({
      email: 'new@example.com',
      password: 'Password123!',
      name: 'New User',
      phone: '254700000000',
      role_id: 1,
      farm_id: null,
    });

    expect(result).toBeDefined();
    expect(initializeDatabaseMock).toHaveBeenCalledTimes(1);
    expect(executeQueryMock).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO subscriptions'),
      expect.any(Array)
    );
  });

  test('duplicate callbacks are ignored and do not double activate the subscription', async () => {
    let selectCount = 0;
    const connection = {
      query: jest.fn((queryText) => {
        if (typeof queryText === 'string' && queryText.includes('BEGIN')) {
          return Promise.resolve({});
        }
        if (typeof queryText === 'string' && queryText.includes('SELECT * FROM payments')) {
          selectCount += 1;
          return Promise.resolve({
            rows: [{
              id: 'payment-1',
              user_id: 'user-1',
              plan: 'standard',
              amount: 100,
              phone_number: '254700000000',
              status: selectCount === 1 ? 'pending' : 'success',
              metadata: {},
              transaction_id: 'test-checkout-id',
            }],
          });
        }
        if (typeof queryText === 'string' && queryText.includes('UPDATE payments')) {
          return Promise.resolve({ rows: [{ id: 'payment-1', status: 'success' }] });
        }
        if (typeof queryText === 'string' && queryText.includes('SELECT * FROM subscription_plans')) {
          return Promise.resolve({ rows: [{ id: 'plan-1', name: 'standard' }] });
        }
        if (typeof queryText === 'string' && queryText.includes('SELECT id FROM roles WHERE name')) {
          return Promise.resolve({ rows: [{ id: 'role-1' }] });
        }
        if (typeof queryText === 'string' && queryText.includes('INSERT INTO subscriptions')) {
          return Promise.resolve({ rows: [{ id: 'subscription-1' }] });
        }
        if (typeof queryText === 'string' && queryText.includes('UPDATE users')) {
          return Promise.resolve({ rowCount: 1, rows: [] });
        }
        if (typeof queryText === 'string' && queryText.includes('COMMIT')) {
          return Promise.resolve({});
        }
        return Promise.resolve({ rows: [] });
      }),
      release: jest.fn(),
    };
    getConnectionMock.mockResolvedValue(connection);

    const first = await PaymentService.handleMpesaCallback({ Body: { stkCallback: {} } });
    const second = await PaymentService.handleMpesaCallback({ Body: { stkCallback: {} } });

    expect(first.success).toBe(true);
    expect(second.success).toBe(false);
    expect(second.message).toContain('already processed');
  });
});
