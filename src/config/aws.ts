import { KMSClient } from "@aws-sdk/client-kms";

export const awsConfig = {
  region: process.env.AWS_REGION || "us-east-1",
  endpoint: process.env.AWS_KMS_ENDPOINT || undefined,
  credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY ? {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    sessionToken: process.env.AWS_SESSION_TOKEN,
  } : undefined,
};

let kmsClient: KMSClient | null = null;

export function getKmsClient(): KMSClient {
  if (!kmsClient) {
    kmsClient = new KMSClient(awsConfig);
  }
  return kmsClient;
}
