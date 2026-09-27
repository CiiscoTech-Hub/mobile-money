import { getSessionCookieOptions, getSessionTrustProxy } from "../session";

describe("session cookie configuration", () => {
  it("uses secure and strict cookies in production", () => {
    const options = getSessionCookieOptions({ NODE_ENV: "production" });

    expect(options).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "strict",
    });
  });

  it("keeps development cookies less strict by default", () => {
    const options = getSessionCookieOptions({ NODE_ENV: "development" });

    expect(options).toMatchObject({
      httpOnly: true,
      secure: false,
      sameSite: "lax",
    });
  });

  it("allows secure cookies when HTTPS is explicitly enabled in development", () => {
    const options = getSessionCookieOptions({
      NODE_ENV: "development",
      SESSION_COOKIE_SECURE: "true",
    });

    expect(options.secure).toBe(true);
  });

  it("trusts a single proxy by default for secure cookie handling", () => {
    expect(getSessionTrustProxy({})).toBe(1);
  });
});
