import { sendAdminBalanceAlert, type LowBalanceAlert } from "../notifications";

jest.mock("../email", () => {
  const mockEmailService = {
    sendAdminBalanceAlert: jest.fn(),
  };
  (global as any).mockEmailService = mockEmailService;
  return {
    emailService: mockEmailService,
  };
});

jest.mock("../sms", () => {
  const mockSmsService = {
    sendToPhone: jest.fn(),
  };
  (global as any).mockSmsService = mockSmsService;
  return {
    smsService: mockSmsService,
  };
});

const mockEmailService = (global as any).mockEmailService;
const mockSmsService = (global as any).mockSmsService;

const alerts: LowBalanceAlert[] = [
  {
    provider: "mtn",
    availableBalance: 250,
    currency: "XAF",
    threshold: 1000,
  },
];

describe("sendAdminBalanceAlert", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    mockEmailService.sendAdminBalanceAlert.mockResolvedValue(undefined);
    mockSmsService.sendToPhone.mockResolvedValue({ sent: true });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("does nothing when there are no alerts", async () => {
    await sendAdminBalanceAlert([]);

    expect(mockEmailService.sendAdminBalanceAlert).not.toHaveBeenCalled();
    expect(mockSmsService.sendToPhone).not.toHaveBeenCalled();
  });

  it("does nothing when no admin recipients are configured", async () => {
    delete process.env.ADMIN_ALERT_EMAILS;
    delete process.env.ADMIN_ALERT_PHONE_NUMBERS;

    await sendAdminBalanceAlert(alerts);

    expect(mockEmailService.sendAdminBalanceAlert).not.toHaveBeenCalled();
    expect(mockSmsService.sendToPhone).not.toHaveBeenCalled();
  });

  it("emails every configured admin recipient", async () => {
    process.env.ADMIN_ALERT_EMAILS = "ops@example.com, treasury@example.com";
    delete process.env.ADMIN_ALERT_PHONE_NUMBERS;

    await sendAdminBalanceAlert(alerts);

    expect(mockEmailService.sendAdminBalanceAlert).toHaveBeenCalledTimes(2);
    expect(mockEmailService.sendAdminBalanceAlert).toHaveBeenCalledWith(
      "ops@example.com",
      alerts,
    );
    expect(mockEmailService.sendAdminBalanceAlert).toHaveBeenCalledWith(
      "treasury@example.com",
      alerts,
    );
  });

  it("texts every configured admin phone number", async () => {
    delete process.env.ADMIN_ALERT_EMAILS;
    process.env.ADMIN_ALERT_PHONE_NUMBERS = "+237600000000,+237611111111";

    await sendAdminBalanceAlert(alerts);

    expect(mockSmsService.sendToPhone).toHaveBeenCalledTimes(2);
    expect(mockSmsService.sendToPhone).toHaveBeenCalledWith(
      "+237600000000",
      expect.stringContaining("MTN"),
    );
    expect(mockSmsService.sendToPhone).toHaveBeenCalledWith(
      "+237611111111",
      expect.stringContaining("MTN"),
    );
  });

  it("does not throw when a delivery channel fails", async () => {
    process.env.ADMIN_ALERT_EMAILS = "ops@example.com";
    process.env.ADMIN_ALERT_PHONE_NUMBERS = "+237600000000";
    mockEmailService.sendAdminBalanceAlert.mockRejectedValue(
      new Error("SendGrid down"),
    );
    mockSmsService.sendToPhone.mockRejectedValue(new Error("Twilio down"));

    await expect(sendAdminBalanceAlert(alerts)).resolves.toBeUndefined();
  });
});
