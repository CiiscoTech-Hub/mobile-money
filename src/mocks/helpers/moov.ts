import crypto from "crypto";

export type MoovMockScenario = "success" | "failed" | "pending";

export interface MoovTestKeyPair {
  privateKey: string;
  publicKey: string;
}

export function generateMoovTestKeyPair(): MoovTestKeyPair {
  const keys = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  return {
    privateKey: keys.privateKey,
    publicKey: keys.publicKey,
  };
}

export function signMoovPayload(payload: string, privateKey: string): string {
  const sign = crypto.createSign("SHA256");
  sign.update(payload.trim());
  return sign.sign(privateKey, "base64");
}

export function buildMoovSoapResponse(
  bodyContent: string,
  privateKey: string,
): string {
  const cleanBody = bodyContent.trim();
  const signature = signMoovPayload(cleanBody, privateKey);

  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Header>
    <Signature xmlns="http://www.moov.com/security">${signature}</Signature>
  </soap:Header>
  <soap:Body>
    ${cleanBody}
  </soap:Body>
</soap:Envelope>`;
}

export function getMoovSoapStatus(
  scenario: MoovMockScenario,
): "SUCCESS" | "PENDING" | "FAILED" {
  if (scenario === "failed") return "FAILED";
  if (scenario === "pending") return "PENDING";
  return "SUCCESS";
}

export function getMoovRestStatus(
  scenario: MoovMockScenario,
): "SUCCESS" | "PENDING" | "FAILED" {
  return getMoovSoapStatus(scenario);
}

export function buildMoovDepositPushResponse(
  referenceId: string,
  scenario: MoovMockScenario,
): {
  transactionId: string;
  status: "SUCCESS" | "PENDING" | "FAILED";
  referenceId: string;
} {
  return {
    transactionId: `moov-txn-${referenceId}`,
    status: getMoovRestStatus(scenario),
    referenceId,
  };
}
