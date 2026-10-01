import { SmsService } from "../sms";

jest.mock("twilio", () => {
  return jest.fn().mockImplementation(() => {
    return {
      messages: {
        create: jest.fn().mockImplementation((options) => {
          if (options.body.includes("timeout")) {
            return new Promise((_, reject) => {
              setTimeout(() => reject(new Error("Timeout")), 100);
            });
          }
          if (options.body.includes("fail")) {
            return Promise.reject(new Error("Failed"));
          }
          return Promise.resolve({ sid: "twilio-sid-123" });
        }),
      },
    };
  });
});

jest.mock("africastalking", () => {
  return jest.fn().mockImplementation(() => {
    return {
      SMS: {
        send: jest.fn().mockImplementation((options) => {
          return Promise.resolve({
            SMSMessageData: {
              Recipients: [{ status: "Success", messageId: "at-sid-123" }],
            },
          });
        }),
      },
    };
  });
});

describe("SmsService Failover", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(() => {
    originalEnv = { ...process.env };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("should send via primary provider if successful", async () => {
    process.env.NODE_ENV = "test";
    process.env.SMS_TEST_FORCE = "true";
    process.env.SMS_PROVIDER = "twilio";
    process.env.SMS_PROVIDER_SECONDARY = "africastalking";
    process.env.TWILIO_ACCOUNT_SID = "ACtest";
    process.env.TWILIO_AUTH_TOKEN = "testtoken";
    process.env.TWILIO_PHONE_NUMBER = "+1234567";

    const service = new SmsService();
    const result = await service.sendToPhone("+237600000000", "hello");
    expect(result.sent).toBe(true);
    expect(result.providerUsed).toBe("twilio");
    expect(result.messageSid).toBe("twilio-sid-123");
  });

  it("should failover to secondary provider on primary timeout", async () => {
    process.env.NODE_ENV = "test";
    process.env.SMS_TEST_FORCE = "true";
    process.env.SMS_PROVIDER = "twilio";
    process.env.SMS_PROVIDER_SECONDARY = "africastalking";
    process.env.TWILIO_ACCOUNT_SID = "ACtest";
    process.env.TWILIO_AUTH_TOKEN = "testtoken";
    process.env.TWILIO_PHONE_NUMBER = "+1234567";
    process.env.SMS_TIMEOUT_MS = "50"; // low timeout for testing
    process.env.AFRICASTALKING_API_KEY = "testkey";
    process.env.AFRICASTALKING_USERNAME = "testuser";

    const service = new SmsService();
    const result = await service.sendToPhone("+237600000000", "timeout test");
    expect(result.sent).toBe(true);
    expect(result.providerUsed).toBe("africastalking");
    expect(result.messageSid).toBe("at-sid-123");
  });
});
