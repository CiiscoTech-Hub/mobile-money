import crypto from "crypto";
import elliptic from "elliptic";
import { Pool } from "pg";
import { z } from "zod";
import {
  commit,
  commitWithBlinding,
  proveEqualOpenings,
  verifyEqualOpenings,
  type Commitment,
  type EqualityProof,
} from "../../crypto/zkBalanceProof";
import {
  signCommitmentEnvelope,
  verifyCommitmentEnvelopeSignature,
  type CommitmentSignatureContext,
} from "../../crypto/zkKycProof";
import { createError } from "../../middleware/errorHandler";
import { ERROR_CODES } from "../../constants/errorCodes";
import { UserModel } from "../../models/users";
import { VaultModel } from "../../models/vault";
import {
  VaultProofArtifactModel,
  type VaultProofArtifact,
  type VaultProofArtifactStatus,
} from "../../models/vaultProofArtifact";
import { deriveKey, encryptAES, serializePayload } from "../../utils/encryption";

const ec = new elliptic.ec("secp256k1");

const PROOF_TYPE = "address_validity";
const PROOF_VERSION = "1.0";
const PROOF_VAULT_NAME = "KYC Proof Vault";
const PROOF_VAULT_DESCRIPTION =
  "Internal vault container for encrypted KYC proof artifacts.";
const ADDRESS_HMAC_INFO = "zk-kyc-address-scalar";

const IssueAddressProofSchema = z.object({
  applicant_id: z.string().min(1, "applicant_id is required"),
  filename: z.string().min(1, "filename is required"),
  mime_type: z.string().min(1, "mime_type is required"),
  utility_bill_data: z.string().min(1, "utility_bill_data is required"),
  provider_reference: z.string().optional(),
});

const VerifyAddressProofSchema = z.object({
  proof_id: z.string().uuid().optional(),
  applicant_id: z.string().optional(),
});

export interface ComplianceCheckResult {
  name: string;
  passed: boolean;
  weight: number;
  score: number;
  reason?: string;
}

export interface AddressProofSummary {
  proofId: string;
  vaultId: string;
  applicantId: string;
  proofType: string;
  proofVersion: string;
  status: VaultProofArtifactStatus;
  complianceScore: number;
  complianceChecks: ComplianceCheckResult[];
  providerReference?: string | null;
  issuedAt: string;
  verifiedAt?: string | null;
}

export class ZkProofService {
  private readonly userModel = new UserModel();
  private readonly vaultModel = new VaultModel();
  private readonly proofModel = new VaultProofArtifactModel();

  constructor(private readonly db: Pool) {}

  async issueAddressProof(
    userId: string,
    input: z.infer<typeof IssueAddressProofSchema>,
  ): Promise<AddressProofSummary> {
    const validated = IssueAddressProofSchema.parse(input);
    const authorityPrivateKey = this.getAuthorityPrivateKey();
    const user = await this.userModel.findById(userId, { id: userId, role: "user" });

    if (!user?.address) {
      throw createError(
        ERROR_CODES.INVALID_INPUT,
        "User address is required before issuing an address proof",
      );
    }

    const issuedAt = new Date().toISOString();
    const providerReference =
      validated.provider_reference || `utility-bill:${validated.applicant_id}`;
    const addressScalar = this.addressToScalar(user.address);
    const referenceCommitment = commitWithBlinding(addressScalar, 0n);
    const { commitment, opening } = commit(addressScalar);
    const equalityProof = proveEqualOpenings(
      commitment,
      referenceCommitment,
      opening.blinding,
      0n,
    );

    const signatureContext: CommitmentSignatureContext = {
      applicantId: validated.applicant_id,
      proofType: PROOF_TYPE,
      proofVersion: PROOF_VERSION,
      issuedAt,
      providerReference,
    };
    const signature = signCommitmentEnvelope(
      authorityPrivateKey,
      commitment.hex,
      signatureContext,
    );

    const documentHash = this.sha256(validated.utility_bill_data);
    const proofPayload = {
      attribute_type: PROOF_TYPE,
      equality_proof: equalityProof,
      reference_commitment: referenceCommitment.hex,
    };
    const artifactBundle = {
      commitment: commitment.hex,
      signature,
      signatureContext,
      proofPayload,
      normalizedAddressHash: this.sha256(this.normalizeAddress(user.address)),
      providerReference,
      documentHash,
      documentFilename: validated.filename,
      documentMimeType: validated.mime_type,
      issuedAt,
    };

    const artifactCiphertext = this.encryptArtifact(artifactBundle);
    const artifactHash = this.sha256(artifactCiphertext);
    const vault = await this.ensureProofVault(userId);
    const complianceChecks = this.buildIssueChecks({
      signatureCreated: true,
      addressPresent: true,
      artifactStored: true,
    });
    const complianceScore = this.sumScores(complianceChecks);

    const stored = await this.proofModel.create({
      vaultId: vault.id,
      userId,
      applicantId: validated.applicant_id,
      proofType: PROOF_TYPE,
      proofVersion: PROOF_VERSION,
      status: "issued",
      commitment: commitment.hex,
      signature,
      signatureContext: signatureContext as unknown as Record<
        string,
        unknown
      >,
      proofPayload: proofPayload as unknown as Record<string, unknown>,
      complianceScore,
      complianceChecks: complianceChecks as unknown as Array<
        Record<string, unknown>
      >,
      artifactCiphertext,
      artifactHash,
      providerReference,
      documentHash,
      documentFilename: validated.filename,
      documentMimeType: validated.mime_type,
      issuedAt,
    });

    const summary = this.toSummary(stored);
    await this.persistApplicantProofSnapshot(validated.applicant_id, summary);
    return summary;
  }

  async verifyAddressProof(
    userId: string,
    input: z.infer<typeof VerifyAddressProofSchema>,
  ): Promise<AddressProofSummary> {
    const validated = VerifyAddressProofSchema.parse(input);
    const proof = await this.resolveProofRecord(userId, validated);

    if (!proof) {
      throw createError(ERROR_CODES.NOT_FOUND, "Address proof not found");
    }

    const user = await this.userModel.findById(userId, { id: userId, role: "user" });
    if (!user?.address) {
      throw createError(
        ERROR_CODES.INVALID_INPUT,
        "User address is required before verifying an address proof",
      );
    }

    const proofPayload = proof.proofPayload || {};
    const signatureContext =
      proof.signatureContext as unknown as CommitmentSignatureContext;
    const authorityPublicKey = this.getAuthorityPublicKey();
    const signatureValid = verifyCommitmentEnvelopeSignature(
      authorityPublicKey,
      proof.commitment,
      signatureContext,
      proof.signature,
    );

    const expectedScalar = this.addressToScalar(user.address);
    const referenceCommitment = commitWithBlinding(expectedScalar, 0n);
    const equalityProof = proofPayload.equality_proof as EqualityProof | undefined;
    const equalityVerified = Boolean(
      equalityProof &&
        verifyEqualOpenings(
          this.decodeCommitment(proof.commitment),
          referenceCommitment,
          equalityProof,
        ),
    );

    const complianceChecks = this.buildVerificationChecks({
      signatureValid,
      equalityVerified,
      artifactIntact: proof.artifactHash === this.sha256(proof.artifactCiphertext),
      applicantBound: signatureContext.applicantId === proof.applicantId,
    });
    const complianceScore = this.sumScores(complianceChecks);
    const verifiedAt = new Date().toISOString();
    const status = this.resolveStatus(complianceChecks);

    const updated = await this.proofModel.updateVerification(proof.id, userId, {
      status,
      complianceScore,
      complianceChecks: complianceChecks as unknown as Array<
        Record<string, unknown>
      >,
      verifiedAt,
      proofPayload: {
        last_verification: {
          verifiedAt,
          reference_commitment: referenceCommitment.hex,
          equality_verified: equalityVerified,
          signature_valid: signatureValid,
        },
      },
    });

    if (!updated) {
      throw createError(ERROR_CODES.INTERNAL_ERROR, "Failed to update proof status");
    }

    const summary = this.toSummary(updated);
    await this.persistApplicantProofSnapshot(proof.applicantId, summary);
    return summary;
  }

  async getLatestProofStatus(
    applicantId: string,
    userId?: string,
  ): Promise<AddressProofSummary | null> {
    const proof = await this.proofModel.findLatestByApplicant(applicantId, userId);
    return proof ? this.toSummary(proof) : null;
  }

  private async resolveProofRecord(
    userId: string,
    input: z.infer<typeof VerifyAddressProofSchema>,
  ): Promise<VaultProofArtifact | null> {
    if (input.proof_id) {
      return this.proofModel.findById(input.proof_id, userId);
    }

    if (input.applicant_id) {
      return this.proofModel.findLatestByApplicant(input.applicant_id, userId);
    }

    throw createError(
      ERROR_CODES.INVALID_INPUT,
      "proof_id or applicant_id is required",
    );
  }

  private async ensureProofVault(userId: string) {
    const existing = await this.vaultModel.findByUserAndName(userId, PROOF_VAULT_NAME);
    if (existing) {
      return existing;
    }

    return this.vaultModel.create({
      userId,
      name: PROOF_VAULT_NAME,
      description: PROOF_VAULT_DESCRIPTION,
    });
  }

  private async persistApplicantProofSnapshot(
    applicantId: string,
    proof: AddressProofSummary,
  ): Promise<void> {
    await this.db.query(
      `UPDATE kyc_applicants
       SET applicant_data = COALESCE(applicant_data, '{}'::jsonb) || $1::jsonb,
           updated_at = CURRENT_TIMESTAMP
       WHERE applicant_id = $2`,
      [
        JSON.stringify({
          last_zk_proof: proof,
          last_compliance_score: proof.complianceScore,
          last_compliance_checks: proof.complianceChecks,
        }),
        applicantId,
      ],
    );
  }

  private getAuthorityPrivateKey(): string {
    const privateKey = process.env.KYC_AUTHORITY_PRIVATE_KEY;
    if (!privateKey) {
      throw createError(
        ERROR_CODES.INTERNAL_ERROR,
        "KYC authority private key is not configured",
      );
    }
    return privateKey;
  }

  private getAuthorityPublicKey(): string {
    const publicKey = process.env.KYC_AUTHORITY_PUBLIC_KEY;
    if (!publicKey) {
      throw createError(
        ERROR_CODES.INTERNAL_ERROR,
        "KYC authority public key is not configured",
      );
    }
    return publicKey;
  }

  private normalizeAddress(address: string): string {
    return address.trim().toLowerCase().replace(/\s+/g, " ");
  }

  private addressToScalar(address: string): bigint {
    const normalized = this.normalizeAddress(address);
    const digest = crypto
      .createHmac("sha256", this.getAddressPepper())
      .update(`${ADDRESS_HMAC_INFO}:${normalized}`)
      .digest("hex");

    return BigInt(`0x${digest}`);
  }

  private getAddressPepper(): string {
    return process.env.KYC_ADDRESS_PROOF_PEPPER || process.env.DB_ENCRYPTION_KEY || "";
  }

  private encryptArtifact(artifact: Record<string, any>): string {
    const keyMaterial = process.env.DB_ENCRYPTION_KEY;
    if (!keyMaterial) {
      throw createError(
        ERROR_CODES.INTERNAL_ERROR,
        "DB_ENCRYPTION_KEY is required for proof artifact encryption",
      );
    }

    const key = deriveKey(keyMaterial, "zk-proof-artifact");
    return serializePayload(encryptAES(JSON.stringify(artifact), key));
  }

  private sha256(value: string): string {
    return crypto.createHash("sha256").update(value).digest("hex");
  }

  private buildIssueChecks(flags: {
    signatureCreated: boolean;
    addressPresent: boolean;
    artifactStored: boolean;
  }): ComplianceCheckResult[] {
    return [
      {
        name: "address_claim_present",
        passed: flags.addressPresent,
        weight: 25,
        score: flags.addressPresent ? 25 : 0,
        reason: flags.addressPresent ? undefined : "No user address available for proofing",
      },
      {
        name: "authority_signature_issued",
        passed: flags.signatureCreated,
        weight: 35,
        score: flags.signatureCreated ? 35 : 0,
        reason: flags.signatureCreated ? undefined : "Commitment signature was not created",
      },
      {
        name: "proof_artifact_vaulted",
        passed: flags.artifactStored,
        weight: 40,
        score: flags.artifactStored ? 40 : 0,
        reason: flags.artifactStored ? undefined : "Proof artifact was not written to the proof vault",
      },
    ];
  }

  private buildVerificationChecks(flags: {
    signatureValid: boolean;
    equalityVerified: boolean;
    artifactIntact: boolean;
    applicantBound: boolean;
  }): ComplianceCheckResult[] {
    return [
      {
        name: "authority_signature_valid",
        passed: flags.signatureValid,
        weight: 35,
        score: flags.signatureValid ? 35 : 0,
        reason: flags.signatureValid ? undefined : "Commitment signature verification failed",
      },
      {
        name: "address_equality_verified",
        passed: flags.equalityVerified,
        weight: 35,
        score: flags.equalityVerified ? 35 : 0,
        reason: flags.equalityVerified ? undefined : "Address equality proof did not verify",
      },
      {
        name: "proof_artifact_intact",
        passed: flags.artifactIntact,
        weight: 15,
        score: flags.artifactIntact ? 15 : 0,
        reason: flags.artifactIntact ? undefined : "Encrypted proof artifact integrity check failed",
      },
      {
        name: "applicant_binding_valid",
        passed: flags.applicantBound,
        weight: 15,
        score: flags.applicantBound ? 15 : 0,
        reason: flags.applicantBound ? undefined : "Proof signature context did not match the applicant",
      },
    ];
  }

  private sumScores(checks: ComplianceCheckResult[]): number {
    return checks.reduce((sum, check) => sum + check.score, 0);
  }

  private resolveStatus(
    checks: ComplianceCheckResult[],
  ): VaultProofArtifactStatus {
    const signatureValid = checks.find(
      (check) => check.name === "authority_signature_valid",
    )?.passed;
    const equalityVerified = checks.find(
      (check) => check.name === "address_equality_verified",
    )?.passed;

    if (!signatureValid || !equalityVerified) {
      return "rejected";
    }

    const total = this.sumScores(checks);
    if (total >= 100) {
      return "verified";
    }

    return total >= 70 ? "review" : "rejected";
  }

  private toSummary(proof: VaultProofArtifact): AddressProofSummary {
    return {
      proofId: proof.id,
      vaultId: proof.vaultId,
      applicantId: proof.applicantId,
      proofType: proof.proofType,
      proofVersion: proof.proofVersion,
      status: proof.status,
      complianceScore: proof.complianceScore ?? 0,
      complianceChecks: (proof.complianceChecks ||
        []) as unknown as ComplianceCheckResult[],
      providerReference: proof.providerReference ?? null,
      issuedAt:
        proof.issuedAt instanceof Date
          ? proof.issuedAt.toISOString()
          : new Date(proof.issuedAt).toISOString(),
      verifiedAt: proof.verifiedAt
        ? proof.verifiedAt instanceof Date
          ? proof.verifiedAt.toISOString()
          : new Date(proof.verifiedAt).toISOString()
        : null,
    };
  }

  private decodeCommitment(commitmentHex: string): Commitment {
    const point = ec.curve.decodePoint(Buffer.from(commitmentHex, "hex"));
    return { point, hex: commitmentHex };
  }
}

export default ZkProofService;
