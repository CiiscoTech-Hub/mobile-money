import { requireAuth } from "../../src/middleware/auth";
import { queryRead } from "../../src/config/database";

jest.mock("../../src/config/database", () => ({
  queryRead: jest.fn(),
  queryWrite: jest.fn(),
}));

describe("requireAuth mTLS validation", () => {
  let req: any;
  let res: any;
  let next: any;

  beforeEach(() => {
    jest.clearAllMocks();
    req = {
      header: jest.fn().mockReturnValue("test-api-key"),
      socket: {
        getPeerCertificate: jest.fn(),
      },
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    next = jest.fn();
  });

  it("passes when no client cert is required by key", async () => {
    (queryRead as jest.Mock).mockResolvedValue({
      rows: [
        {
          permissions: 15,
          is_active: true,
          expires_at: new Date(Date.now() + 100000),
          client_cert_cn: null,
          client_cert_fingerprint: null,
        },
      ],
    });

    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("fails when cert is required but not provided", async () => {
    (queryRead as jest.Mock).mockResolvedValue({
      rows: [
        {
          permissions: 15,
          is_active: true,
          expires_at: new Date(Date.now() + 100000),
          client_cert_cn: "partner-cn",
          client_cert_fingerprint: null,
        },
      ],
    });

    req.socket.getPeerCertificate.mockReturnValue(null);

    await requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "Unauthorized",
        message: expect.stringContaining("Client certificate is required"),
      }),
    );
  });

  it("fails when CN does not match", async () => {
    (queryRead as jest.Mock).mockResolvedValue({
      rows: [
        {
          permissions: 15,
          is_active: true,
          expires_at: new Date(Date.now() + 100000),
          client_cert_cn: "expected-cn",
          client_cert_fingerprint: null,
        },
      ],
    });

    req.socket.getPeerCertificate.mockReturnValue({
      subject: { CN: "mismatch-cn" },
    });

    await requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("Common Name (CN) mismatch"),
      }),
    );
  });

  it("passes when CN matches", async () => {
    (queryRead as jest.Mock).mockResolvedValue({
      rows: [
        {
          permissions: 15,
          is_active: true,
          expires_at: new Date(Date.now() + 100000),
          client_cert_cn: "matching-cn",
          client_cert_fingerprint: null,
        },
      ],
    });

    req.socket.getPeerCertificate.mockReturnValue({
      subject: { CN: "matching-cn" },
    });

    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it("fails when fingerprint does not match", async () => {
    (queryRead as jest.Mock).mockResolvedValue({
      rows: [
        {
          permissions: 15,
          is_active: true,
          expires_at: new Date(Date.now() + 100000),
          client_cert_cn: null,
          client_cert_fingerprint: "expected-fingerprint",
        },
      ],
    });

    req.socket.getPeerCertificate.mockReturnValue({
      fingerprint: "mismatch-fingerprint",
    });

    await requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("fingerprint mismatch"),
      }),
    );
  });

  it("passes when fingerprint matches", async () => {
    (queryRead as jest.Mock).mockResolvedValue({
      rows: [
        {
          permissions: 15,
          is_active: true,
          expires_at: new Date(Date.now() + 100000),
          client_cert_cn: null,
          client_cert_fingerprint: "matching-fingerprint",
        },
      ],
    });

    req.socket.getPeerCertificate.mockReturnValue({
      fingerprint: "matching-fingerprint",
    });

    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});
