/**
 * DisputeWorkflowTool — Unit Tests
 *
 * Covers:
 *  - triage: priority scoring, SLA date assignment, auto-assignment
 *  - assignAgent: delegation + note creation
 *  - decide: action enforcement, delegation to DisputeService
 *  - reject: delegation to updateStatus
 *  - escalateOverdue: bulk escalation, terminal-state skipping, error handling
 *  - processUntriaged: bulk triage
 */

import { DisputeWorkflowTool } from "../disputeWorkflowTool";
import { DisputeService } from "../dispute";
import { DisputeModel } from "../../models/dispute";

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock("../dispute");
jest.mock("../../models/dispute");
jest.mock("../notificationRouter", () => ({
  notificationRouter: { sendDisputeNotification: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn().mockReturnThis(),
  },
}));

const MockDisputeService = DisputeService as jest.MockedClass<
  typeof DisputeService
>;
const MockDisputeModel = DisputeModel as jest.MockedClass<typeof DisputeModel>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDispute(overrides: Partial<any> = {}): any {
  return {
    id: "dispute-1",
    transactionId: "tx-1",
    status: "open",
    priority: "medium",
    category: null,
    slaDueDate: null,
    assignedTo: null,
    resolution: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DisputeWorkflowTool", () => {
  let svc: jest.Mocked<DisputeService>;
  let model: jest.Mocked<DisputeModel>;
  let tool: DisputeWorkflowTool;

  beforeEach(() => {
    jest.clearAllMocks();

    svc = new MockDisputeService() as jest.Mocked<DisputeService>;
    model = new MockDisputeModel() as jest.Mocked<DisputeModel>;
    tool = new DisputeWorkflowTool(svc as any, model as any);
  });

  // ── triage ─────────────────────────────────────────────────────────────────

  describe("triage", () => {
    it("assigns an SLA due date and returns a timeline", async () => {
      model.findById.mockResolvedValue(makeDispute());
      model.update.mockResolvedValue(makeDispute());

      const result = await tool.triage("dispute-1", 500);

      expect(result.disputeId).toBe("dispute-1");
      expect(result.slaDueDate).toBeDefined();
      expect(result.timeline.length).toBeGreaterThan(0);
      expect(result.timeline[0].step).toBe("triage");
    });

    it("gives a high priority score for large fraud disputes", async () => {
      model.findById.mockResolvedValue(makeDispute({ priority: "critical" }));
      model.update.mockResolvedValue(makeDispute());

      const result = await tool.triage("dispute-1", 5000, "fraud");

      // score = 4 (critical) + 2 (high amount >= 1000) + 3 (fraud category) = 9
      expect(result.priorityScore).toBeGreaterThanOrEqual(5);
    });

    it("gives a low priority score for a small low-priority dispute", async () => {
      model.findById.mockResolvedValue(makeDispute({ priority: "low" }));
      model.update.mockResolvedValue(makeDispute());

      const result = await tool.triage("dispute-1", 10);

      // score = -1 (low) = -1
      expect(result.priorityScore).toBeLessThan(2);
    });

    it("auto-assigns to agent when provided", async () => {
      model.findById.mockResolvedValue(makeDispute());
      model.update.mockResolvedValue(makeDispute());
      svc.assignToAgent.mockResolvedValue(
        makeDispute({ assignedTo: "agent-1" }),
      );

      const result = await tool.triage("dispute-1", 100, undefined, "agent-1");

      expect(svc.assignToAgent).toHaveBeenCalledWith("dispute-1", "agent-1");
      expect(result.assignedTo).toBe("agent-1");
      expect(result.timeline.some((s) => s.step === "auto_assign")).toBe(true);
    });

    it("throws when the dispute is not found", async () => {
      model.findById.mockResolvedValue(null);

      await expect(tool.triage("missing", 100)).rejects.toThrow(
        "Dispute missing not found",
      );
    });
  });

  // ── assignAgent ────────────────────────────────────────────────────────────

  describe("assignAgent", () => {
    it("delegates to DisputeService.assignToAgent and returns a step", async () => {
      svc.assignToAgent.mockResolvedValue(makeDispute({ assignedTo: "bob" }));

      const step = await tool.assignAgent("dispute-1", "bob");

      expect(svc.assignToAgent).toHaveBeenCalledWith("dispute-1", "bob");
      expect(step.step).toBe("assign_agent");
      expect(step.details?.agentId).toBe("bob");
    });

    it("adds a note when provided", async () => {
      svc.assignToAgent.mockResolvedValue(makeDispute());
      svc.addNote.mockResolvedValue({ id: "note-1" } as any);

      await tool.assignAgent("dispute-1", "bob", "Taking ownership");

      expect(svc.addNote).toHaveBeenCalledWith(
        "dispute-1",
        "bob",
        "Taking ownership",
      );
    });

    it("does not add a note when notes param is omitted", async () => {
      svc.assignToAgent.mockResolvedValue(makeDispute());

      await tool.assignAgent("dispute-1", "alice");

      expect(svc.addNote).not.toHaveBeenCalled();
    });
  });

  // ── decide ─────────────────────────────────────────────────────────────────

  describe("decide", () => {
    it("calls resolvePayment with correct args and returns a decision record", async () => {
      svc.resolvePayment.mockResolvedValue(makeDispute({ status: "reversed" }));

      const decision = await tool.decide(
        "dispute-1",
        "reverse",
        "Customer confirmed they did not authorise the transaction",
        "admin-99",
      );

      expect(svc.resolvePayment).toHaveBeenCalledWith(
        "dispute-1",
        "reverse",
        "Customer confirmed they did not authorise the transaction",
        "admin-99",
      );
      expect(decision.action).toBe("reverse");
      expect(decision.resolvedBy).toBe("admin-99");
    });

    it("throws when resolution text is empty", async () => {
      await expect(
        tool.decide("dispute-1", "uphold", "   ", "admin-1"),
      ).rejects.toThrow("non-empty resolution text");
    });

    it("trims whitespace from the resolution text", async () => {
      svc.resolvePayment.mockResolvedValue(makeDispute({ status: "upheld" }));

      const decision = await tool.decide(
        "dispute-1",
        "uphold",
        "  Merchant provided delivery proof.  ",
        "admin-2",
      );

      expect(decision.resolution).toBe("Merchant provided delivery proof.");
    });
  });

  // ── reject ─────────────────────────────────────────────────────────────────

  describe("reject", () => {
    it("calls updateStatus with 'rejected' and returns a step", async () => {
      svc.updateStatus.mockResolvedValue(makeDispute({ status: "rejected" }));

      const step = await tool.reject("dispute-1", "Duplicate claim", "agent-5");

      expect(svc.updateStatus).toHaveBeenCalledWith(
        "dispute-1",
        "rejected",
        "Duplicate claim",
        "agent-5",
      );
      expect(step.step).toBe("reject");
    });
  });

  // ── escalateOverdue ────────────────────────────────────────────────────────

  describe("escalateOverdue", () => {
    it("escalates overdue disputes and returns correct counts", async () => {
      const overdue = [
        makeDispute({ id: "d1", status: "open" }),
        makeDispute({ id: "d2", status: "investigating" }),
      ];
      svc.getOverdueDisputes.mockResolvedValue(overdue);
      svc.addNote.mockResolvedValue({ id: "note" } as any);
      svc.assignToAgent.mockResolvedValue(makeDispute());

      const result = await tool.escalateOverdue("senior-agent");

      expect(result.escalated).toEqual(["d1", "d2"]);
      expect(result.skipped).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it("skips disputes in terminal state", async () => {
      const overdue = [
        makeDispute({ id: "d1", status: "resolved" }),
        makeDispute({ id: "d2", status: "open" }),
      ];
      svc.getOverdueDisputes.mockResolvedValue(overdue);
      svc.addNote.mockResolvedValue({ id: "note" } as any);
      svc.assignToAgent.mockResolvedValue(makeDispute());

      const result = await tool.escalateOverdue("senior-agent");

      expect(result.skipped).toEqual(["d1"]);
      expect(result.escalated).toEqual(["d2"]);
    });

    it("records errors for disputes that fail during escalation", async () => {
      const overdue = [makeDispute({ id: "bad", status: "open" })];
      svc.getOverdueDisputes.mockResolvedValue(overdue);
      svc.addNote.mockRejectedValue(new Error("DB unavailable"));

      const result = await tool.escalateOverdue("senior-agent");

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].disputeId).toBe("bad");
      expect(result.errors[0].error).toContain("DB unavailable");
    });
  });

  // ── processUntriaged ───────────────────────────────────────────────────────

  describe("processUntriaged", () => {
    it("triages all untriaged disputes", async () => {
      model.findSlaWarningCandidates.mockResolvedValue([
        {
          id: "c1",
          priority: "medium",
          createdAt: new Date().toISOString(),
        } as any,
        {
          id: "c2",
          priority: "high",
          createdAt: new Date().toISOString(),
        } as any,
      ]);

      // For each triage call, findById + update must succeed
      model.findById
        .mockResolvedValueOnce(makeDispute({ id: "c1" }))
        .mockResolvedValueOnce(makeDispute({ id: "c2" }));
      model.update.mockResolvedValue(makeDispute());

      const result = await tool.processUntriaged();

      expect(result.processed).toBe(2);
      expect(result.failed).toBe(0);
    });

    it("counts failures when a dispute fails to triage", async () => {
      model.findSlaWarningCandidates.mockResolvedValue([
        {
          id: "bad",
          priority: "low",
          createdAt: new Date().toISOString(),
        } as any,
      ]);
      model.findById.mockResolvedValue(null); // triggers throw inside triage

      const result = await tool.processUntriaged();

      expect(result.processed).toBe(0);
      expect(result.failed).toBe(1);
    });
  });
});
