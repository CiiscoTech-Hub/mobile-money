import axios from "axios";
import {
  MpesaProvider,
  MPESA_CALLBACK_ACK,
  MpesaStkCallbackBody,
} from "../mpesaService";

jest.mock("axios");

const axiosMock = axios as jest.Mocked<typeof axios>;

describe("MpesaProvider", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env.MPESA_CONSUMER_KEY = "test-consumer-key";
    process.env.MPESA_CONSUMER_SECRET = "test-consumer-secret";
    process.env.MPESA_BASE_URL = "https://sandbox.safaricom.co.ke";
    process.env.MPESA_SHORTCODE = "174379";
    process.env.MPESA_PASSKEY = "test-passkey";
    process.env.MPESA_CALLBACK_URL = "https://example.com/mpesa/callback";
    process.env.MPESA_INITIATOR_NAME = "testapi";
    process.env.MPESA_SECURITY_CREDENTIAL = "encrypted-credential";
    process.env.MPESA_RESULT_URL = "https://example.com/mpesa/result";
    process.env.MPESA_QUEUE_TIMEOUT_URL = "https://example.com/mpesa/timeout";
  });

  describe("getAccessToken (OAuth2 client credentials)", () => {
    it("fetches and caches an access token using Basic auth", async () => {
      axiosMock.get.mockResolvedValueOnce({
        data: { access_token: "abc123", expires_in: "3599" },
      });

      const provider = new MpesaProvider();
      const token = await provider.getAccessToken();

      expect(token).toBe("abc123");
      expect(axiosMock.get).toHaveBeenCalledWith(
        expect.stringContaining("/oauth/v1/generate?grant_type=client_credentials"),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: expect.stringMatching(/^Basic /),
          }),
        }),
      );

      // Second call should use the cached token, not hit the network again
      const token2 = await provider.getAccessToken();
      expect(token2).toBe("abc123");
      expect(axiosMock.get).toHaveBeenCalledTimes(1);
    });

    it("throws when the token response is missing access_token", async () => {
      axiosMock.get.mockResolvedValueOnce({ data: {} });

      const provider = new MpesaProvider();
      await expect(provider.getAccessToken()).rejects.toThrow(
        "M-Pesa token response did not include access_token",
      );
    });
  });

  describe("initiateStkPush (C2B)", () => {
    it("configures and sends a Lipa Na M-Pesa STK push request", async () => {
      axiosMock.get.mockResolvedValueOnce({
        data: { access_token: "abc123", expires_in: "3599" },
      });
      axiosMock.post.mockResolvedValueOnce({
        data: {
          MerchantRequestID: "merchant-1",
          CheckoutRequestID: "checkout-1",
          ResponseCode: "0",
          ResponseDescription: "Success. Request accepted for processing",
        },
      });

      const provider = new MpesaProvider();
      const result = await provider.initiateStkPush(
        "0712345678",
        500,
        "ORDER-1",
      );

      expect(result.success).toBe(true);
      expect(result.merchantRequestId).toBe("merchant-1");
      expect(result.checkoutRequestId).toBe("checkout-1");

      const [url, body] = axiosMock.post.mock.calls[0];
      expect(url).toContain("/mpesa/stkpush/v1/processrequest");
      expect(body).toMatchObject({
        BusinessShortCode: "174379",
        Amount: 500,
        PartyA: "254712345678",
        PhoneNumber: "254712345678",
        AccountReference: "ORDER-1",
      });
    });

    it("returns a failure result when the request errors", async () => {
      axiosMock.get.mockResolvedValueOnce({
        data: { access_token: "abc123", expires_in: "3599" },
      });
      axiosMock.post.mockRejectedValueOnce(new Error("network error"));

      const provider = new MpesaProvider();
      const result = await provider.initiateStkPush(
        "0712345678",
        500,
        "ORDER-1",
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
    });

    it("normalizes phone numbers already in 2547XXXXXXXX format", async () => {
      axiosMock.get.mockResolvedValueOnce({
        data: { access_token: "abc123", expires_in: "3599" },
      });
      axiosMock.post.mockResolvedValueOnce({ data: {} });

      const provider = new MpesaProvider();
      await provider.initiateStkPush("254712345678", 100, "REF");

      const [, body] = axiosMock.post.mock.calls[0];
      expect((body as any).PartyA).toBe("254712345678");
    });
  });

  describe("sendB2CPayment (B2C payout)", () => {
    it("sends a BusinessPayment disbursement request", async () => {
      axiosMock.get.mockResolvedValueOnce({
        data: { access_token: "abc123", expires_in: "3599" },
      });
      axiosMock.post.mockResolvedValueOnce({
        data: {
          ConversationID: "conv-1",
          OriginatorConversationID: "origin-1",
          ResponseCode: "0",
          ResponseDescription: "Accept the service request successfully.",
        },
      });

      const provider = new MpesaProvider();
      const result = await provider.sendB2CPayment("0712345678", 2000);

      expect(result.success).toBe(true);
      expect(result.conversationId).toBe("conv-1");

      const [url, body] = axiosMock.post.mock.calls[0];
      expect(url).toContain("/mpesa/b2c/v1/paymentrequest");
      expect(body).toMatchObject({
        CommandID: "BusinessPayment",
        Amount: 2000,
        PartyB: "254712345678",
      });
    });

    it("returns a failure result when the disbursement request errors", async () => {
      axiosMock.get.mockResolvedValueOnce({
        data: { access_token: "abc123", expires_in: "3599" },
      });
      axiosMock.post.mockRejectedValueOnce(new Error("timeout"));

      const provider = new MpesaProvider();
      const result = await provider.sendB2CPayment("0712345678", 2000);

      expect(result.success).toBe(false);
    });
  });

  describe("getTransactionStatus", () => {
    it("maps ResultCode 0 to completed", async () => {
      axiosMock.get.mockResolvedValueOnce({
        data: { access_token: "abc123", expires_in: "3599" },
      });
      axiosMock.post.mockResolvedValueOnce({ data: { ResultCode: 0 } });

      const provider = new MpesaProvider();
      const result = await provider.getTransactionStatus("checkout-1");
      expect(result.status).toBe("completed");
    });

    it("maps a non-zero ResultCode to failed", async () => {
      axiosMock.get.mockResolvedValueOnce({
        data: { access_token: "abc123", expires_in: "3599" },
      });
      axiosMock.post.mockResolvedValueOnce({ data: { ResultCode: 1032 } });

      const provider = new MpesaProvider();
      const result = await provider.getTransactionStatus("checkout-1");
      expect(result.status).toBe("failed");
    });

    it("returns unknown when the status query throws", async () => {
      axiosMock.get.mockResolvedValueOnce({
        data: { access_token: "abc123", expires_in: "3599" },
      });
      axiosMock.post.mockRejectedValueOnce(new Error("down"));

      const provider = new MpesaProvider();
      const result = await provider.getTransactionStatus("checkout-1");
      expect(result.status).toBe("unknown");
    });
  });

  describe("processStkCallback", () => {
    it("parses a successful callback and extracts CallbackMetadata fields", () => {
      const body: MpesaStkCallbackBody = {
        Body: {
          stkCallback: {
            MerchantRequestID: "merchant-1",
            CheckoutRequestID: "checkout-1",
            ResultCode: 0,
            ResultDesc: "The service request is processed successfully.",
            CallbackMetadata: {
              Item: [
                { Name: "Amount", Value: 500 },
                { Name: "MpesaReceiptNumber", Value: "NLJ7RT61SV" },
                { Name: "TransactionDate", Value: 20260727121500 },
                { Name: "PhoneNumber", Value: 254712345678 },
              ],
            },
          },
        },
      };

      const result = MpesaProvider.processStkCallback(body);

      expect(result.success).toBe(true);
      expect(result.amount).toBe(500);
      expect(result.mpesaReceiptNumber).toBe("NLJ7RT61SV");
      expect(result.phoneNumber).toBe("254712345678");
    });

    it("parses a cancelled/failed callback with no CallbackMetadata", () => {
      const body: MpesaStkCallbackBody = {
        Body: {
          stkCallback: {
            MerchantRequestID: "merchant-2",
            CheckoutRequestID: "checkout-2",
            ResultCode: 1032,
            ResultDesc: "Request cancelled by user.",
          },
        },
      };

      const result = MpesaProvider.processStkCallback(body);

      expect(result.success).toBe(false);
      expect(result.amount).toBeUndefined();
      expect(result.resultDesc).toBe("Request cancelled by user.");
    });

    it("exposes the acknowledgement Safaricom expects in the HTTP response", () => {
      expect(MPESA_CALLBACK_ACK).toEqual({
        ResultCode: 0,
        ResultDesc: "Success",
      });
    });
  });
});
