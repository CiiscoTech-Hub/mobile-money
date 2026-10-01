import { MtnUgandaProvider } from '../mtnUganda';
import axios from 'axios';
import db from '../../../models';

// Mock the external dependencies
jest.mock('axios');
jest.mock('../../../models', () => ({
  Transaction: {
    update: jest.fn(),
  }
}));

describe('MTN Uganda Provider Integration', () => {
  let provider: MtnUgandaProvider;

  beforeEach(() => {
    provider = new MtnUgandaProvider();
    jest.clearAllMocks();
  });

  it('should generate an auth token during handshake', async () => {
    (axios.post as jest.Mock).mockResolvedValueOnce({
      data: { access_token: 'mock_token_123', expires_in: 3600 }
    });

    // We can test this indirectly by triggering a payout and checking if auth was called
    (axios.post as jest.Mock).mockResolvedValueOnce({ status: 202 });

    await provider.executePayout('tx-101', 5000, '256771234567');
    
    // Check auth call
    expect(axios.post).toHaveBeenNthCalledWith(1, expect.stringContaining('/disbursement/token/'), {}, expect.any(Object));
    // Check payout call
    expect(axios.post).toHaveBeenNthCalledWith(2, expect.stringContaining('/disbursement/v1_0/transfer'), expect.any(Object), expect.any(Object));
  });

  it('should validate UGX phone numbers correctly', () => {
    expect(provider.validatePhoneNumber('256771234567')).toBe(true);
    expect(provider.validatePhoneNumber('256391234567')).toBe(true);
    expect(provider.validatePhoneNumber('12345')).toBe(false); // Invalid length/prefix
  });

  it('should sync payout statuses with the database successfully', async () => {
    // Mock the Auth Token retrieval
    (axios.post as jest.Mock).mockResolvedValueOnce({
      data: { access_token: 'mock_token', expires_in: 3600 }
    });
    // Mock the Status GET request
    (axios.get as jest.Mock).mockResolvedValueOnce({
      data: { status: 'SUCCESSFUL' }
    });

    const status = await provider.checkAndSyncStatus('tx-101', 'ref-101');

    expect(status).toBe('SUCCESSFUL');
    expect(db.Transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'SUCCESSFUL', providerReference: 'ref-101' }),
      expect.objectContaining({ where: { id: 'tx-101' } })
    );
  });
});