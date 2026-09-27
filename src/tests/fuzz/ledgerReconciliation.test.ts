import { describe, it, expect, beforeEach } from "@jest/globals";

export interface AccountState {
  accountCode: string;
  debits: number;
  credits: number;
}

export interface FuzzTransaction {
  id: string;
  type: "DEPOSIT" | "WITHDRAWAL" | "TRANSFER";
  amount: number;
  sourceAccount: string;
  destinationAccount: string;
}

export class LedgerSimulator {
  private accounts: Map<string, AccountState> = new Map();
  private transactionHistory: FuzzTransaction[] = [];

  constructor(accountCodes: string[]) {
    accountCodes.forEach((code) => {
      this.accounts.set(code, {
        accountCode: code,
        debits: 0,
        credits: 0,
      });
    });
  }

  public processTransaction(tx: FuzzTransaction): boolean {
    if (tx.amount <= 0) return false;

    const source = this.accounts.get(tx.sourceAccount);
    const dest = this.accounts.get(tx.destinationAccount);

    if (!source || !dest) return false;

    // Double-entry accounting rule:
    // Source account is credited (money leaves or decreases asset/increases liability)
    // Destination account is debited (money enters or increases asset/decreases liability)
    source.credits += tx.amount;
    dest.debits += tx.amount;

    this.transactionHistory.push(tx);
    return true;
  }

  public getTotals(): { totalDebits: number; totalCredits: number; difference: number } {
    let totalDebits = 0;
    let totalCredits = 0;

    for (const account of this.accounts.values()) {
      totalDebits += account.debits;
      totalCredits += account.credits;
    }

    // Rounding safety to 4 decimal places
    totalDebits = Math.round(totalDebits * 10000) / 10000;
    totalCredits = Math.round(totalCredits * 10000) / 10000;
    const difference = Math.abs(totalDebits - totalCredits);

    return {
      totalDebits,
      totalCredits,
      difference,
    };
  }

  public isReconciled(): boolean {
    const { difference } = this.getTotals();
    return difference < 0.0001;
  }

  public getHistoryCount(): number {
    return this.transactionHistory.length;
  }
}

// Fuzz generator helper
export function generateRandomTransactions(
  count: number,
  accountCodes: string[]
): FuzzTransaction[] {
  const types: ("DEPOSIT" | "WITHDRAWAL" | "TRANSFER")[] = [
    "DEPOSIT",
    "WITHDRAWAL",
    "TRANSFER",
  ];
  const transactions: FuzzTransaction[] = [];

  for (let i = 0; i < count; i++) {
    const type = types[Math.floor(Math.random() * types.length)];
    const amount = Math.round((Math.random() * 10000 + 1) * 100) / 100;
    const sourceIndex = Math.floor(Math.random() * accountCodes.length);
    let destIndex = Math.floor(Math.random() * accountCodes.length);

    while (destIndex === sourceIndex && accountCodes.length > 1) {
      destIndex = Math.floor(Math.random() * accountCodes.length);
    }

    transactions.push({
      id: `tx_${i}_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      type,
      amount,
      sourceAccount: accountCodes[sourceIndex],
      destinationAccount: accountCodes[destIndex],
    });
  }

  return transactions;
}

describe("Ledger Sync Reconciliation Fuzzing Simulator", () => {
  const accountCodes = ["ACC_CASH_1000", "ACC_USER_2000", "ACC_FEE_3000", "ACC_CLEARING_4000"];

  it("should process random deposits and withdrawals while ensuring zero balance discrepancy", () => {
    const simulator = new LedgerSimulator(accountCodes);
    const randomTxList = generateRandomTransactions(1000, accountCodes);

    randomTxList.forEach((tx) => {
      const success = simulator.processTransaction(tx);
      expect(success).toBe(true);
    });

    const { totalDebits, totalCredits, difference } = simulator.getTotals();

    expect(totalDebits).toBeGreaterThan(0);
    expect(totalCredits).toBeGreaterThan(0);
    expect(totalDebits).toEqual(totalCredits);
    expect(difference).toBe(0);
    expect(simulator.isReconciled()).toBe(true);
    expect(simulator.getHistoryCount()).toBe(1000);
  });

  it("should maintain reconciliation zero-sum across concurrent parallel fuzz iterations", async () => {
    const simulator = new LedgerSimulator(accountCodes);
    const parallelRuns = 10;
    const txPerRun = 200;

    const runSimulations = Array.from({ length: parallelRuns }).map(async (_, runIdx) => {
      const txs = generateRandomTransactions(txPerRun, accountCodes);
      return txs;
    });

    const results = await Promise.all(runSimulations);
    const allTxs = results.flat();

    allTxs.forEach((tx) => {
      simulator.processTransaction(tx);
    });

    const totals = simulator.getTotals();
    expect(totals.difference).toBe(0);
    expect(simulator.isReconciled()).toBe(true);
  });
});
