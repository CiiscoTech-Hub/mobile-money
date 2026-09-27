import path from "path";
import { PactV3, MatchersV3 } from "@pact-foundation/pact";
import { MTNProvider } from "../../services/mobilemoney/providers/mtn";

const { like, regex, string } = MatchersV3;

const provider = new PactV3({
  consumer: "MobileMoneyService",
  provider: "MTNMoMoAPI",
  dir: path.resolve(__dirname, "../../../pacts"),
  logLevel: "warn",
});

const MTN_SUBSCRIPTION_KEY = "test-subscription-key";
const FAKE_TOKEN = "fake-access-token-for-pact-test";
const TEST_PHONE = "+256123456789";
const TEST_AMOUNT = "100";
const REFERENCE_ID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

function withEnv(mockServerUrl: string, fn: () => Promise<void>) {
  const prev = {
    MTN_BASE_URL: process.env.MTN_BASE_URL,
    MTN_API_KEY: process.env.MTN_API_KEY,
    MTN_API_SECRET: process.env.MTN_API_SECRET,
    MTN_SUBSCRIPTION_KEY: process.env.MTN_SUBSCRIPTION_KEY,
    MTN_TARGET_ENVIRONMENT: process.env.MTN_TARGET_ENVIRONMENT,
  };
  process.env.MTN_BASE_URL = mockServerUrl;
  process.env.MTN_API_KEY = "test-api-key";
  process.env.MTN_API_SECRET = "test-api-secret";
  process.env.MTN_SUBSCRIPTION_KEY = MTN_SUBSCRIPTION_KEY;
  process.env.MTN_TARGET_ENVIRONMENT = "sandbox";
  const restore = () => {
    process.env.MTN_BASE_URL = prev.MTN_BASE_URL;
    process.env.MTN_API_KEY = prev.MTN_API_KEY;
    process.env.MTN_API_SECRET = prev.MTN_API_SECRET;
    process.env.MTN_SUBSCRIPTION_KEY = prev.MTN_SUBSCRIPTION_KEY;
    process.env.MTN_TARGET_ENVIRONMENT = prev.MTN_TARGET_ENVIRONMENT;
  };
  return fn().finally(restore);
}

describe("MTN MoMo API Contract (via MTNProvider)", () => {
  describe("POST /collection/v1_0/requesttopay — initiate payment", () => {
    it("accepts a valid payment request through the provider class", async () => {
      await provider
        .given("MTN collection service is available")
        .uponReceiving("a payment request via MTNProvider.requestPayment")
        .withRequest({
          method: "POST",
          path: "/collection/v1_0/requesttopay",
          headers: {
            "Ocp-Apim-Subscription-Key": string(MTN_SUBSCRIPTION_KEY),
            "X-Target-Environment": like("sandbox"),
          },
          body: {
            amount: like(TEST_AMOUNT),
            currency: like("EUR"),
            externalId: like("ext-001"),
            payer: {
              partyIdType: "MSISDN",
              partyId: like(TEST_PHONE),
            },
            payerMessage: like("Payment for Stellar deposit"),
            payeeNote: like("Deposit"),
          },
        })
        .willRespondWith({
          status: 202,
        })
        .executeTest(async (mockServer) =>
          withEnv(mockServer.url, async () => {
            const mtnProvider = new MTNProvider();
            const result = await mtnProvider.requestPayment(TEST_PHONE, TEST_AMOUNT);
            expect(result.success).toBe(true);
          }),
        );
    });
  });

  describe("GET /collection/v1_0/requesttopay/:referenceId — get transaction status", () => {
    it("returns SUCCESSFUL status for a completed transaction", async () => {
      await provider
        .given("MTN transaction exists and is successful")
        .uponReceiving("a successful status request via MTNProvider.getTransactionStatus")
        .withRequest({
          method: "GET",
          path: `/collection/v1_0/requesttopay/${REFERENCE_ID}`,
          headers: {
            Authorization: regex(`^Bearer .+$`, `Bearer ${FAKE_TOKEN}`),
            "Ocp-Apim-Subscription-Key": string(MTN_SUBSCRIPTION_KEY),
            "X-Target-Environment": like("sandbox"),
          },
        })
        .willRespondWith({
          status: 200,
          headers: { "Content-Type": "application/json" },
          body: {
            amount: like("100"),
            currency: like("EUR"),
            financialTransactionId: like("363440463"),
            externalId: like("ext-001"),
            payer: {
              partyIdType: "MSISDN",
              partyId: like("46733123450"),
            },
            status: "SUCCESSFUL",
          },
        })
        .executeTest(async (mockServer) =>
          withEnv(mockServer.url, async () => {
            const mtnProvider = new MTNProvider();
            jest.spyOn(mtnProvider as any, "getAccessToken").mockResolvedValue(FAKE_TOKEN);
            const result = await mtnProvider.getTransactionStatus(REFERENCE_ID);
            expect(result).toEqual({ status: "completed" });
          }),
        );
    });

    it("returns FAILED status for a failed transaction", async () => {
      await provider
        .given("MTN transaction exists and has failed")
        .uponReceiving("a failed status request via MTNProvider.getTransactionStatus")
        .withRequest({
          method: "GET",
          path: `/collection/v1_0/requesttopay/${REFERENCE_ID}`,
          headers: {
            Authorization: regex(`^Bearer .+$`, `Bearer ${FAKE_TOKEN}`),
            "Ocp-Apim-Subscription-Key": string(MTN_SUBSCRIPTION_KEY),
            "X-Target-Environment": like("sandbox"),
          },
        })
        .willRespondWith({
          status: 200,
          headers: { "Content-Type": "application/json" },
          body: {
            status: "FAILED",
            reason: like("PAYER_NOT_FOUND"),
          },
        })
        .executeTest(async (mockServer) =>
          withEnv(mockServer.url, async () => {
            const mtnProvider = new MTNProvider();
            jest.spyOn(mtnProvider as any, "getAccessToken").mockResolvedValue(FAKE_TOKEN);
            const result = await mtnProvider.getTransactionStatus(REFERENCE_ID);
            expect(result).toEqual({ status: "failed" });
          }),
        );
    });
  });

  describe("GET /disbursement/v1_0/account/balance — get operational balance", () => {
    it("returns available balance through the provider class", async () => {
      await provider
        .given("MTN disbursement account has funds")
        .uponReceiving("a balance request via MTNProvider.getOperationalBalance")
        .withRequest({
          method: "GET",
          path: "/disbursement/v1_0/account/balance",
          headers: {
            Authorization: regex(`^Bearer .+$`, `Bearer ${FAKE_TOKEN}`),
            "Ocp-Apim-Subscription-Key": string(MTN_SUBSCRIPTION_KEY),
            "X-Target-Environment": like("sandbox"),
          },
        })
        .willRespondWith({
          status: 200,
          headers: { "Content-Type": "application/json" },
          body: {
            availableBalance: like("1000.00"),
            currency: like("EUR"),
          },
        })
        .executeTest(async (mockServer) =>
          withEnv(mockServer.url, async () => {
            const mtnProvider = new MTNProvider();
            jest.spyOn(mtnProvider as any, "getAccessToken").mockResolvedValue(FAKE_TOKEN);
            const result = await mtnProvider.getOperationalBalance();
            expect(result.success).toBe(true);
            expect(result.data).toBeDefined();
            expect(result.data.availableBalance).toBeDefined();
            expect(result.data.currency).toBeDefined();
          }),
        );
    });
  });
});
