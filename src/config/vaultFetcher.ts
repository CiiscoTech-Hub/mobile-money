import axios from "axios";

async function fetchSecrets(): Promise<Record<string, any>> {
  const provider = (process.env.VAULT_PROVIDER || "").toLowerCase();
  if (!provider || provider === "none" || provider === "local" || provider === "off") {
    return {};
  }

  if (provider === "vault") {
    const vaultAddr = process.env.VAULT_ADDR || "http://localhost:8200";
    const vaultToken = process.env.VAULT_TOKEN;
    const secretPath = process.env.VAULT_SECRET_PATH || "secret/data/mobile-money";

    if (!vaultToken) {
      throw new Error("VAULT_TOKEN env variable is required for HashiCorp Vault provider");
    }

    const url = `${vaultAddr.replace(/\/$/, "")}/v1/${secretPath}`;
    const response = await axios.get(url, {
      headers: {
        "X-Vault-Token": vaultToken,
      },
      timeout: 5000,
    });

    const data = response.data?.data;
    if (data && typeof data === "object") {
      return data.data || data;
    } else {
      throw new Error("Invalid response format from HashiCorp Vault");
    }
  } else if (provider === "aws-secrets") {
    const secretId = process.env.AWS_SECRET_ID || "mobile-money-secrets";
    const region = process.env.AWS_REGION || "us-east-1";

    const { SecretsManagerClient, GetSecretValueCommand } = await import("@aws-sdk/client-secrets-manager");
    const client = new SecretsManagerClient({ region });
    const response = await client.send(new GetSecretValueCommand({ SecretId: secretId }));

    if (response.SecretString) {
      return JSON.parse(response.SecretString);
    } else if (response.SecretBinary) {
      const decodedBinarySecret = Buffer.from(response.SecretBinary).toString("utf8");
      return JSON.parse(decodedBinarySecret);
    } else {
      throw new Error("AWS Secrets Manager response does not contain SecretString or SecretBinary");
    }
  } else {
    throw new Error(`Unsupported vault provider: ${provider}`);
  }
}

async function main() {
  try {
    const secrets = await fetchSecrets();
    console.log(JSON.stringify(secrets));
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

void main();
