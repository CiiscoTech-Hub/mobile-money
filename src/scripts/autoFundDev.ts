import * as StellarSdk from "@stellar/stellar-sdk";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const network = process.env.STELLAR_NETWORK || "testnet";
if (network !== "testnet") {
  console.error("ERROR: Auto-funding script is only allowed on Stellar testnet.");
  process.exit(1);
}

const keysToFund = new Set<string>();

function addKey(keyOrSecret: string | undefined) {
  if (!keyOrSecret) return;
  const trimmed = keyOrSecret.trim();
  if (trimmed.startsWith("G") && trimmed.length === 56) {
    keysToFund.add(trimmed);
  } else if (trimmed.startsWith("S") && trimmed.length === 56) {
    try {
      const kp = StellarSdk.Keypair.fromSecret(trimmed);
      keysToFund.add(kp.publicKey());
    } catch (e) {
      console.warn(`Invalid secret key: ${trimmed.slice(0, 5)}...`);
    }
  }
}

// 1. Issuer
addKey(process.env.STELLAR_ISSUER_SECRET);
addKey(process.env.STELLAR_ASSET_ISSUER);

// 2. Fee Payer
addKey(process.env.STELLAR_FEE_PAYER_SECRET);
addKey(process.env.STELLAR_FEE_PAYER_PUBLIC_KEY);

// 3. Signing key & Receiving account
addKey(process.env.STELLAR_SIGNING_KEY);
addKey(process.env.STELLAR_RECEIVING_ACCOUNT);

// 4. Channel Accounts
const channelsJson = process.env.STELLAR_CHANNEL_ACCOUNTS;
if (channelsJson) {
  try {
    const channels = JSON.parse(channelsJson);
    if (Array.isArray(channels)) {
      for (const chan of channels) {
        addKey(chan.publicKey);
        addKey(chan.secretKey);
      }
    }
  } catch (e) {
    console.warn("Failed to parse STELLAR_CHANNEL_ACCOUNTS JSON:", e);
  }
}

const list = Array.from(keysToFund);
if (list.length === 0) {
  console.log("No development accounts found in environment to fund.");
  process.exit(0);
}

console.log(`Starting auto-funding for ${list.length} accounts on Stellar Testnet...`);

async function fundAccount(addr: string) {
  console.log(`Funding account: ${addr}`);
  try {
    await axios.get(`https://friendbot.stellar.org?addr=${addr}`);
    console.log(`✅ Funded successfully: ${addr}`);
  } catch (err: any) {
    console.error(`❌ Failed to fund ${addr}:`, err.response?.data || err.message);
  }
}

async function run() {
  for (const addr of list) {
    await fundAccount(addr);
    // Wait 1 second between requests to avoid rate limits
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  console.log("Auto-funding complete!");
}

run().catch(console.error);
