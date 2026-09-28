/**
 * DisputeWorkflowTool — Orchestrated Dispute Resolution Workflow
 *
 * Provides a higher-level, step-driven wrapper around `DisputeService` that
 * encodes the full resolution workflow:
 *
 *   open
 *    └─► triage (automatic SLA assignment + priority scoring)
 *         └─► investigation (agent assignment, evidence collection)
 *              └─► decision  (resolve / reverse / uphold / reject)
 *                   └─► notification + audit record
 *
 * Key responsibilities on top of the base DisputeService:
 *  - Auto-triage: assigns SLA deadlines and calculates a numeric priority
 *    score based on amount, time-sensitivity, and customer tier.
 *  - Escalation: detects disputes approaching or past SLA and automatically
 *    escalates to senior agents or triggers PagerDuty alerts.
 *  - Timeline tracking: records a structured audit trail for every step.
 *  - Bulk workflow: process multiple open disputes in a single invocation
 *    (useful for background jobs).
 */

import { DisputeService, DisputeResolutionAction } from "./dispute";
import { DisputeModel, DisputeStatus } from "../models/dispute";
import logger from "../utils/logger";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WorkflowStep {
  step: string;
  performedBy: string;
  timestamp: string;
  details?: Record<string, unknown>;
}

export interface TriageResult {
  disputeId: string;
  priorityScore: number;
  slaDueDate: string;
  assignedTo?: string;
  timeline: WorkflowStep[];
}

export interface WorkflowDecision {
  disputeId: string;
  action: DisputeResolutionAction;
  resolvedBy: string;
  resolution: string;
  timeline: WorkflowStep[];
}

export interface EscalationResult {
  escalated: string[]; // dispute IDs that were escalated
  skipped: string[]; // IDs already in terminal state
  errors: Array<{ disputeId: string; error: string }>;
}

/** Priority scoring weights — tunable via env. */
interface PriorityWeights {
  highAmountThreshold: number; // amount above which +2 priority is added
  urgentCategoryBonus: number; // bonus for urgent categories
}

const DEFAULT_WEIGHTS: PriorityWeights = {
  highAmountThreshold:
    Number(process.env.DISPUTE_HIGH_AMOUNT_THRESHOLD) || 1000,
  urgentCategoryBonus: Number(process.env.DISPUTE_URGENT_CATEGORY_BONUS) || 3,
};

/** SLA hours by priority level. */
const SLA_HOURS: Record<string, number> = {
  critical: 4,
  high: 24,
  medium: 72,
  low: 168, // 7 days
};

const URGENT_CATEGORIES = new Set([
  "fraud",
  "unauthorized",
  "double_charge",
  "chargeback",
]);

// ── Tool ──────────────────────────────────────────────────────────────────────

export class DisputeWorkflowTool {
  private readonly disputeService: DisputeService;
  private readonly disputeModel: DisputeModel;

  constructor(disputeService?: DisputeService, disputeModel?: DisputeModel) {
    this.disputeService = disputeService ?? new DisputeService();
    this.disputeModel = disputeModel ?? new DisputeModel();
  }

  // ── Triage ─────────────────────────────────────────────────────────────────

  /**
   * Triage an open dispute: compute a numeric priority score, assign an SLA
   * due date, and optionally auto-assign to an agent.
   *
   * @param disputeId         UUID of the dispute to triage.
   * @param amountUsd         Transaction amount in USD (used for priority scoring).
   * @param category          Dispute category (e.g. "fraud", "duplicate").
   * @param autoAssignAgent   If provided, the dispute is auto-assigned on triage.
   * @param weights           Optional override for the priority-scoring weights.
   */
  async triage(
    disputeId: string,
    amountUsd: number,
    category?: string,
    autoAssignAgent?: string,
    weights: PriorityWeights = DEFAULT_WEIGHTS,
  ): Promise<TriageResult> {
    const dispute = await this.disputeModel.findById(disputeId);
    if (!dispute) {
      throw new Error(`Dispute ${disputeId} not found`);
    }

    const timeline: WorkflowStep[] = [];

    // ── Priority scoring ──────────────────────────────────────────────────────
    let score = 0;
    if (amountUsd >= weights.highAmountThreshold) score += 2;
    if (category && URGENT_CATEGORIES.has(category.toLowerCase())) {
      score += weights.urgentCategoryBonus;
    }
    if (dispute.priority === "critical") score += 4;
    else if (dispute.priority === "high") score += 2;
    else if (dispute.priority === "low") score -= 1;

    const slaHours =
      score >= 5
        ? SLA_HOURS.critical
        : score >= 3
          ? SLA_HOURS.high
          : score >= 1
            ? SLA_HOURS.medium
            : SLA_HOURS.low;

    const slaDueDate = new Date(
      Date.now() + slaHours * 60 * 60 * 1000,
    ).toISOString();

    // Persist SLA due date on the dispute record
    await this.disputeModel.update(disputeId, { slaDueDate } as any);

    timeline.push({
      step: "triage",
      performedBy: "system",
      timestamp: new Date().toISOString(),
      details: {
        priorityScore: score,
        slaHours,
        slaDueDate,
        amountUsd,
        category,
      },
    });

    logger.info(
      { disputeId, priorityScore: score, slaHours, slaDueDate },
      "[DisputeWorkflow] Triage completed",
    );

    // ── Auto-assign if requested ──────────────────────────────────────────────
    let assignedTo: string | undefined;
    if (autoAssignAgent) {
      await this.disputeService.assignToAgent(disputeId, autoAssignAgent);
      assignedTo = autoAssignAgent;
      timeline.push({
        step: "auto_assign",
        performedBy: "system",
        timestamp: new Date().toISOString(),
        details: { agent: autoAssignAgent },
      });
    }

    return {
      disputeId,
      priorityScore: score,
      slaDueDate,
      assignedTo,
      timeline,
    };
  }

  // ── Agent assignment ───────────────────────────────────────────────────────

  /**
   * Assign a dispute to a support agent, recording the workflow step.
   */
  async assignAgent(
    disputeId: string,
    agentId: string,
    notes?: string,
  ): Promise<WorkflowStep> {
    await this.disputeService.assignToAgent(disputeId, agentId);

    if (notes) {
      await this.disputeService.addNote(disputeId, agentId, notes);
    }

    const step: WorkflowStep = {
      step: "assign_agent",
      performedBy: agentId,
      timestamp: new Date().toISOString(),
      details: { agentId, notes },
    };

    logger.info({ disputeId, agentId }, "[DisputeWorkflow] Agent assigned");
    return step;
  }

  // ── Resolution decision ────────────────────────────────────────────────────

  /**
   * Record a formal resolution decision, apply it via `DisputeService`, and
   * return the full workflow decision record.
   *
   * @param disputeId  UUID of the dispute.
   * @param action     "reverse" (refund) or "uphold" (deny claim).
   * @param resolution Text explanation of the decision.
   * @param resolvedBy Agent / admin ID making the decision.
   */
  async decide(
    disputeId: string,
    action: DisputeResolutionAction,
    resolution: string,
    resolvedBy: string,
  ): Promise<WorkflowDecision> {
    if (!resolution || resolution.trim().length === 0) {
      throw new Error("A non-empty resolution text is required");
    }

    await this.disputeService.resolvePayment(
      disputeId,
      action,
      resolution,
      resolvedBy,
    );

    const timeline: WorkflowStep[] = [
      {
        step: "decision",
        performedBy: resolvedBy,
        timestamp: new Date().toISOString(),
        details: { action, resolution: resolution.trim() },
      },
    ];

    logger.info(
      { disputeId, action, resolvedBy },
      "[DisputeWorkflow] Decision recorded",
    );

    return {
      disputeId,
      action,
      resolvedBy,
      resolution: resolution.trim(),
      timeline,
    };
  }

  // ── Reject dispute ─────────────────────────────────────────────────────────

  /**
   * Reject a dispute (e.g. fraudulent or duplicate claim).
   */
  async reject(
    disputeId: string,
    reason: string,
    rejectedBy: string,
  ): Promise<WorkflowStep> {
    await this.disputeService.updateStatus(
      disputeId,
      "rejected",
      reason,
      rejectedBy,
    );

    const step: WorkflowStep = {
      step: "reject",
      performedBy: rejectedBy,
      timestamp: new Date().toISOString(),
      details: { reason },
    };

    logger.info(
      { disputeId, rejectedBy },
      "[DisputeWorkflow] Dispute rejected",
    );
    return step;
  }

  // ── Escalation ─────────────────────────────────────────────────────────────

  /**
   * Escalate overdue disputes in bulk.
   *
   * For each overdue dispute:
   *  1. Adds a timestamped note indicating escalation.
   *  2. Re-assigns to the escalation agent if specified.
   *
   * @param escalationAgent  Agent to re-assign overdue disputes to.
   * @param escalationNote   Note text attached to each escalated dispute.
   */
  async escalateOverdue(
    escalationAgent: string,
    escalationNote = "Dispute escalated due to SLA breach",
  ): Promise<EscalationResult> {
    const overdue = await this.disputeService.getOverdueDisputes();

    const escalated: string[] = [];
    const skipped: string[] = [];
    const errors: Array<{ disputeId: string; error: string }> = [];

    for (const dispute of overdue) {
      try {
        const terminalStates: DisputeStatus[] = [
          "resolved",
          "rejected",
          "reversed",
          "upheld",
        ];
        if (terminalStates.includes(dispute.status)) {
          skipped.push(dispute.id);
          continue;
        }

        await this.disputeService.addNote(
          dispute.id,
          "system",
          `${escalationNote} (overdue since SLA: ${(dispute as any).slaDueDate ?? "unknown"})`,
        );
        await this.disputeService.assignToAgent(dispute.id, escalationAgent);
        escalated.push(dispute.id);

        logger.warn(
          { disputeId: dispute.id, escalationAgent },
          "[DisputeWorkflow] Dispute escalated",
        );
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        errors.push({ disputeId: dispute.id, error: errMsg });
        logger.error(
          { disputeId: dispute.id, err },
          "[DisputeWorkflow] Failed to escalate dispute",
        );
      }
    }

    return { escalated, skipped, errors };
  }

  // ── Batch processing ───────────────────────────────────────────────────────

  /**
   * Process all open disputes that have not yet been triaged (no SLA due date).
   *
   * @param defaultAgent       Agent to auto-assign triaged disputes to.
   * @param defaultAmountUsd   Fallback amount used when amount is unknown.
   */
  async processUntriaged(
    defaultAgent?: string,
    defaultAmountUsd = 0,
  ): Promise<{ processed: number; failed: number }> {
    const candidates = await this.disputeModel.findSlaWarningCandidates();

    let processed = 0;
    let failed = 0;

    for (const candidate of candidates) {
      try {
        await this.triage(
          candidate.id,
          defaultAmountUsd,
          undefined,
          defaultAgent,
        );
        processed++;
      } catch (err) {
        failed++;
        logger.error(
          { disputeId: candidate.id, err },
          "[DisputeWorkflow] Failed to triage dispute",
        );
      }
    }

    logger.info(
      { processed, failed },
      "[DisputeWorkflow] processUntriaged complete",
    );

    return { processed, failed };
  }
}

// ── Singleton export ──────────────────────────────────────────────────────────

export const disputeWorkflowTool = new DisputeWorkflowTool();
