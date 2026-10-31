import { createOwnedPostgresPool } from "./owned-pool.js";
import { createHash } from "node:crypto";

import type { Pool, PoolClient, QueryResultRow } from "pg";

import type { ContentDigest } from "../../../shared/runtime-scope/index.js";
import {
  createPostgresSchemaTarget,
  type PostgresSchemaTargetV1,
} from "../../../shared/runtime-scope/postgres-schema.js";
import {
  BEHAVIORAL_STORE_CAPABILITIES,
  BEHAVIORAL_STORE_CONTRACT_VERSION,
  BEHAVIORAL_STORE_ERROR_CODES,
  BehavioralStoreError,
  assertBehavioralCapability,
  behavioralApplicabilityMatches,
  behavioralBaselinesForBinding,
  behavioralContentDigest,
  canonicalBehavioralJson,
  immutableBehavioralBaselines,
  immutableBehavioralBinding,
  type BehavioralApplicabilityV1,
  type BehavioralBaselineRevisionV1,
  type BehavioralDetailedProvenanceV1,
  type BehavioralEvidenceInputV1,
  type BehavioralPromotionInputV1,
  type BehavioralRevisionWriteV1,
  type BehavioralRuleSeverityV1,
  type BehavioralSnapshotQueryV1,
  type BehavioralSnapshotV1,
  type BehavioralStoreBackendOptionsV1,
  type BehavioralStoreBinder,
  type BehavioralStoreBindingV1,
  type BehavioralWriteOperationV1,
  type BehavioralWriteReceiptV1,
  type PersonaRevisionInputV1,
  type PersonaRevisionV1,
  type RuleRevisionInputV1,
  type RuleRevisionV1,
  type ScopedBehavioralReadStore,
  type ScopedBehavioralWriteStore,
} from "../behavioral-store.js";
import { POSTGRES_BEHAVIORAL_STORE_SCHEMA_VERSION } from "./behavioral-migrations.js";

interface PostgresBehavioralStoreOptionsV1 extends BehavioralStoreBackendOptionsV1 {
  readonly schema: string;
  readonly enforceRuntimeRole?: boolean;
}

interface PersonaRow extends QueryResultRow {
  persona_id: string;
  revision: string;
  content_digest: ContentDigest;
  content_json: unknown;
  source_frame_ids: string[];
  creator_principal_id: string;
  recorded_at: string | Date;
}

interface RuleRow extends QueryResultRow {
  rule_id: string;
  revision: string;
  content_digest: ContentDigest;
  category: string;
  directive: string;
  severity: BehavioralRuleSeverityV1;
  applicability_json: BehavioralApplicabilityV1 | string;
  confidence_alpha: number;
  confidence_beta: number;
  source_frame_ids: string[];
  creator_principal_id: string;
  recorded_at: string | Date;
}

interface EvidenceCountRow extends QueryResultRow {
  rule_id: string;
  revision: string;
  observations: string | number;
  counterexamples: string | number;
}

interface PromotionRow extends QueryResultRow {
  target_layer: BehavioralApplicabilityV1["layer"];
  module_id: string | null;
  task_type: string | null;
}

interface ReceiptRow extends QueryResultRow {
  payload_digest: ContentDigest;
  receipt_json: BehavioralWriteReceiptV1 | string;
}

interface RuntimeBoundaryRow extends QueryResultRow {
  schema_version: number | null;
  role_is_superuser: boolean;
  role_bypasses_rls: boolean;
  role_can_create_in_schema: boolean;
  protected_count: string | number;
  rls_count: string | number;
  forced_count: string | number;
  owned_count: string | number;
}

const RELATIONS = Object.freeze([
  "lex_behavioral_persona_revisions",
  "lex_behavioral_rule_revisions",
  "lex_behavioral_evidence",
  "lex_behavioral_promotions",
  "lex_behavioral_write_receipts",
]);

const SCOPE_PREDICATE = `
  tenant_id = $1::uuid AND workspace_id = $2::uuid
  AND repository_id = $3::uuid AND repository_instance_id = $4::uuid
  AND current_setting('lex.principal_id', true) = $5
`;

function scopeValues(binding: BehavioralStoreBindingV1): string[] {
  return [
    binding.authorizedScope.tenantId,
    binding.authorizedScope.workspaceId,
    binding.repositoryId,
    binding.repositoryInstanceId,
    binding.authorizedScope.principalId,
  ];
}

function relation(target: PostgresSchemaTargetV1, name: (typeof RELATIONS)[number]): string {
  return target.relation(name);
}

function asIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function parseJson<T>(value: T | string): T {
  return typeof value === "string" ? (JSON.parse(value) as T) : value;
}

function validateText(value: string, field: string): void {
  if (!value?.trim()) {
    throw new BehavioralStoreError(
      BEHAVIORAL_STORE_ERROR_CODES.INVALID_INPUT,
      `${field} must be non-empty`
    );
  }
}

function stringList(value: readonly string[] | undefined, field: string): readonly string[] {
  const normalized = [...(value ?? [])].map((entry) => entry.trim());
  if (normalized.some((entry) => !entry)) {
    throw new BehavioralStoreError(
      BEHAVIORAL_STORE_ERROR_CODES.INVALID_INPUT,
      `${field} entries must be non-empty`
    );
  }
  return Object.freeze([...new Set(normalized)].sort());
}

function applicability(value: BehavioralApplicabilityV1): BehavioralApplicabilityV1 {
  if (!value || !["workspace", "repository", "module", "task"].includes(value.layer)) {
    throw new BehavioralStoreError(
      BEHAVIORAL_STORE_ERROR_CODES.INVALID_INPUT,
      "applicability.layer is invalid"
    );
  }
  const moduleIds = stringList(value.moduleIds, "moduleIds");
  const taskTypes = stringList(value.taskTypes, "taskTypes");
  const contextTags = stringList(value.contextTags, "contextTags");
  if (value.layer === "module" && moduleIds.length === 0) {
    throw new BehavioralStoreError(
      BEHAVIORAL_STORE_ERROR_CODES.INVALID_INPUT,
      "module applicability requires moduleIds"
    );
  }
  if (value.layer === "task" && taskTypes.length === 0) {
    throw new BehavioralStoreError(
      BEHAVIORAL_STORE_ERROR_CODES.INVALID_INPUT,
      "task applicability requires taskTypes"
    );
  }
  return Object.freeze({
    layer: value.layer,
    ...(moduleIds.length ? { moduleIds } : {}),
    ...(taskTypes.length ? { taskTypes } : {}),
    ...(contextTags.length ? { contextTags } : {}),
  });
}

function receipt(
  operation: BehavioralWriteOperationV1,
  status: BehavioralWriteReceiptV1["status"],
  idempotencyKey: string,
  payloadDigest: ContentDigest,
  resourceId: string,
  revision?: string,
  conflict?: BehavioralWriteReceiptV1["conflict"]
): BehavioralWriteReceiptV1 {
  const unsigned = {
    schemaVersion: BEHAVIORAL_STORE_CONTRACT_VERSION,
    operation,
    status,
    idempotencyKey,
    payloadDigest,
    resourceId,
    ...(revision ? { revision } : {}),
    ...(conflict ? { conflict } : {}),
  } as const;
  return Object.freeze({ ...unsigned, receiptDigest: behavioralContentDigest(unsigned) });
}

class PostgresBehavioralTransactionRunner {
  private ready: Promise<void> | null = null;

  constructor(
    private readonly pool: Pool,
    private readonly target: PostgresSchemaTargetV1,
    private readonly enforceRuntimeRole: boolean,
    private readonly now: () => Date
  ) {}

  currentTime(): Date {
    return this.now();
  }

  private async clearScope(client: PoolClient): Promise<void> {
    await client.query(
      "RESET lex.tenant_id; RESET lex.workspace_id; RESET lex.repository_id; RESET lex.repository_instance_id; RESET lex.principal_id"
    );
  }

  private async assertBoundary(client: PoolClient): Promise<void> {
    const result = await client.query<RuntimeBoundaryRow>(
      `SELECT
         (SELECT MAX(version) FROM ${this.target.relation("lex_behavioral_store_migrations")}) AS schema_version,
         role.rolsuper AS role_is_superuser,
         role.rolbypassrls AS role_bypasses_rls,
         pg_catalog.has_schema_privilege(CURRENT_USER, $1, 'CREATE') AS role_can_create_in_schema,
         COUNT(*)::text AS protected_count,
         COUNT(*) FILTER (WHERE object.relrowsecurity)::text AS rls_count,
         COUNT(*) FILTER (WHERE object.relforcerowsecurity)::text AS forced_count,
         COUNT(*) FILTER (WHERE object.relowner = role.oid)::text AS owned_count
       FROM pg_catalog.pg_roles AS role
       CROSS JOIN pg_catalog.pg_class AS object
       JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = object.relnamespace
       WHERE role.rolname = CURRENT_USER
         AND namespace.nspname = $1
         AND object.relname = ANY($2::text[])
       GROUP BY role.rolsuper, role.rolbypassrls`,
      [this.target.schema, RELATIONS]
    );
    const boundary = result.rows[0];
    if (boundary?.schema_version !== POSTGRES_BEHAVIORAL_STORE_SCHEMA_VERSION) {
      throw new Error(
        `PostgreSQL behavioral schema ${boundary?.schema_version ?? 0} is not the required schema ${POSTGRES_BEHAVIORAL_STORE_SCHEMA_VERSION}`
      );
    }
    const expected = RELATIONS.length;
    if (
      Number(boundary.protected_count) !== expected ||
      Number(boundary.rls_count) !== expected ||
      Number(boundary.forced_count) !== expected
    ) {
      throw new Error("PostgreSQL behavioral store requires forced RLS on every relation");
    }
    if (
      this.enforceRuntimeRole &&
      (boundary.role_is_superuser ||
        boundary.role_bypasses_rls ||
        boundary.role_can_create_in_schema ||
        Number(boundary.owned_count) !== 0)
    ) {
      throw new Error(
        "PostgreSQL behavioral runtime role must be non-owner, non-superuser, non-BYPASSRLS, and unable to CREATE in the protected schema"
      );
    }
  }

  private async ensureReady(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        const client = await this.pool.connect();
        try {
          await this.assertBoundary(client);
        } finally {
          client.release();
        }
      })().catch((error) => {
        this.ready = null;
        throw error;
      });
    }
    await this.ready;
  }

  async run<T>(
    binding: BehavioralStoreBindingV1,
    kind: "read" | "write",
    operation: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    await this.ensureReady();
    const client = await this.pool.connect();
    let open = false;
    let cleanupError: Error | undefined;
    try {
      if (
        binding.authorizedScope.expiresAt &&
        Date.parse(binding.authorizedScope.expiresAt) <= this.now().getTime()
      ) {
        throw new BehavioralStoreError(
          BEHAVIORAL_STORE_ERROR_CODES.SCOPE_EXPIRED,
          "Authorized behavioral scope has expired"
        );
      }
      await this.assertBoundary(client);
      await this.clearScope(client);
      await client.query("BEGIN");
      open = true;
      if (kind === "read") await client.query("SET TRANSACTION READ ONLY");
      await client.query(
        `SELECT
           set_config('lex.tenant_id', $1, true),
           set_config('lex.workspace_id', $2, true),
           set_config('lex.repository_id', $3, true),
           set_config('lex.repository_instance_id', $4, true),
           set_config('lex.principal_id', $5, true)`,
        scopeValues(binding)
      );
      const result = await operation(client);
      await client.query("COMMIT");
      open = false;
      return result;
    } catch (error) {
      if (open) await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      try {
        await this.clearScope(client);
      } catch (error) {
        cleanupError = error instanceof Error ? error : new Error(String(error));
      }
      client.release(cleanupError);
    }
  }
}

abstract class PostgresBehavioralView {
  #closed = false;
  readonly #now: () => Date;

  protected constructor(
    readonly binding: BehavioralStoreBindingV1,
    now: () => Date
  ) {
    this.#now = now;
  }

  protected assertActive(
    capability: (typeof BEHAVIORAL_STORE_CAPABILITIES)[keyof typeof BEHAVIORAL_STORE_CAPABILITIES]
  ): void {
    if (this.#closed) {
      throw new BehavioralStoreError(
        BEHAVIORAL_STORE_ERROR_CODES.STORE_CLOSED,
        "Scoped behavioral store view is closed"
      );
    }
    assertBehavioralCapability(this.binding, capability, this.#now());
  }

  protected currentTime(): Date {
    return this.#now();
  }

  async close(): Promise<void> {
    this.#closed = true;
  }
}

class PostgresBehavioralReadView
  extends PostgresBehavioralView
  implements ScopedBehavioralReadStore
{
  readonly #runner: PostgresBehavioralTransactionRunner;
  readonly #target: PostgresSchemaTargetV1;
  readonly #baselines: readonly BehavioralBaselineRevisionV1[];

  constructor(
    binding: BehavioralStoreBindingV1,
    runner: PostgresBehavioralTransactionRunner,
    target: PostgresSchemaTargetV1,
    baselines: readonly BehavioralBaselineRevisionV1[]
  ) {
    super(binding, () => runner.currentTime());
    this.#runner = runner;
    this.#target = target;
    this.#baselines = baselines;
  }

  private provenance(mode: "compact" | "detailed" | undefined): boolean {
    if (mode !== "detailed") return false;
    this.assertActive(BEHAVIORAL_STORE_CAPABILITIES.PROVENANCE);
    return true;
  }

  private detail(
    row: Pick<PersonaRow, "creator_principal_id" | "source_frame_ids" | "recorded_at">
  ): BehavioralDetailedProvenanceV1 {
    return Object.freeze({
      repositoryId: this.binding.repositoryId,
      repositoryInstanceId: this.binding.repositoryInstanceId,
      creatorPrincipalId:
        row.creator_principal_id as BehavioralDetailedProvenanceV1["creatorPrincipalId"],
      sourceFrameIds: Object.freeze([...row.source_frame_ids]),
      recordedAt: asIso(row.recorded_at),
    });
  }

  private persona(row: PersonaRow, provenance: boolean): PersonaRevisionV1 {
    return Object.freeze({
      personaId: row.persona_id,
      revision: row.revision,
      contentDigest: row.content_digest,
      content: parseJson(row.content_json),
      ...(provenance ? { provenance: this.detail(row) } : {}),
    });
  }

  private async promotion(
    client: PoolClient,
    ruleId: string,
    revision: string
  ): Promise<PromotionRow | undefined> {
    const result = await client.query<PromotionRow>(
      `SELECT target_layer, module_id, task_type
         FROM ${relation(this.#target, "lex_behavioral_promotions")}
        WHERE ${SCOPE_PREDICATE} AND rule_id = $6 AND rule_revision = $7
        ORDER BY recorded_at DESC, promotion_id DESC LIMIT 1`,
      [...scopeValues(this.binding), ruleId, revision]
    );
    return result.rows[0];
  }

  private async rule(
    client: PoolClient,
    row: RuleRow,
    counts: ReadonlyMap<string, EvidenceCountRow>,
    provenance: boolean
  ): Promise<RuleRevisionV1> {
    const evidence = counts.get(`${row.rule_id}\u0000${row.revision}`);
    const observations = Number(evidence?.observations ?? 0);
    const counterexamples = Number(evidence?.counterexamples ?? 0);
    const alpha = Number(row.confidence_alpha) + observations;
    const beta = Number(row.confidence_beta) + counterexamples;
    const promoted = await this.promotion(client, row.rule_id, row.revision);
    const original = parseJson(row.applicability_json);
    const effective: BehavioralApplicabilityV1 = promoted
      ? {
          layer: promoted.target_layer,
          ...(promoted.module_id ? { moduleIds: [promoted.module_id] } : {}),
          ...(promoted.task_type ? { taskTypes: [promoted.task_type] } : {}),
          ...(original.contextTags ? { contextTags: original.contextTags } : {}),
        }
      : original;
    return Object.freeze({
      ruleId: row.rule_id,
      revision: row.revision,
      contentDigest: row.content_digest,
      category: row.category,
      directive: row.directive,
      severity: row.severity,
      applicability: Object.freeze(effective),
      confidence: Object.freeze({
        alpha,
        beta,
        observations,
        counterexamples,
        value: alpha + beta === 0 ? 0.5 : alpha / (alpha + beta),
      }),
      ...(provenance ? { provenance: this.detail(row) } : {}),
    });
  }

  private async counts(client: PoolClient): Promise<Map<string, EvidenceCountRow>> {
    const result = await client.query<EvidenceCountRow>(
      `SELECT rule_id, rule_revision AS revision,
              COUNT(*) FILTER (WHERE kind IN ('observation', 'correction'))::text AS observations,
              COUNT(*) FILTER (WHERE kind IN ('counterexample', 'trust-gap'))::text AS counterexamples
         FROM ${relation(this.#target, "lex_behavioral_evidence")}
        WHERE ${SCOPE_PREDICATE}
        GROUP BY rule_id, rule_revision`,
      scopeValues(this.binding)
    );
    return new Map(result.rows.map((row) => [`${row.rule_id}\u0000${row.revision}`, row]));
  }

  async getPersona(
    personaId: string,
    options: { readonly provenance?: "compact" | "detailed" } = {}
  ): Promise<PersonaRevisionV1 | null> {
    this.assertActive(BEHAVIORAL_STORE_CAPABILITIES.READ);
    validateText(personaId, "personaId");
    const include = this.provenance(options.provenance);
    return this.#runner.run(this.binding, "read", async (client) => {
      const result = await client.query<PersonaRow>(
        `SELECT persona_id, revision, content_digest, content_json, source_frame_ids,
                creator_principal_id, recorded_at
           FROM ${relation(this.#target, "lex_behavioral_persona_revisions")}
          WHERE ${SCOPE_PREDICATE} AND persona_id = $6
          ORDER BY recorded_at DESC, revision DESC LIMIT 1`,
        [...scopeValues(this.binding), personaId]
      );
      return result.rows[0] ? this.persona(result.rows[0], include) : null;
    });
  }

  async getRule(
    ruleId: string,
    options: { readonly provenance?: "compact" | "detailed" } = {}
  ): Promise<RuleRevisionV1 | null> {
    this.assertActive(BEHAVIORAL_STORE_CAPABILITIES.READ);
    validateText(ruleId, "ruleId");
    const include = this.provenance(options.provenance);
    return this.#runner.run(this.binding, "read", async (client) => {
      const result = await client.query<RuleRow>(
        `SELECT rule_id, revision, content_digest, category, directive, severity,
                applicability_json, confidence_alpha, confidence_beta, source_frame_ids,
                creator_principal_id, recorded_at
           FROM ${relation(this.#target, "lex_behavioral_rule_revisions")}
          WHERE ${SCOPE_PREDICATE} AND rule_id = $6
          ORDER BY recorded_at DESC, revision DESC LIMIT 1`,
        [...scopeValues(this.binding), ruleId]
      );
      if (!result.rows[0]) return null;
      return this.rule(client, result.rows[0], await this.counts(client), include);
    });
  }

  async getSnapshot(query: BehavioralSnapshotQueryV1 = {}): Promise<BehavioralSnapshotV1> {
    this.assertActive(BEHAVIORAL_STORE_CAPABILITIES.READ);
    const include = this.provenance(query.provenance);
    return this.#runner.run(this.binding, "read", async (client) => {
      const personaResult = await client.query<PersonaRow>(
        `SELECT DISTINCT ON (persona_id)
                persona_id, revision, content_digest, content_json, source_frame_ids,
                creator_principal_id, recorded_at
           FROM ${relation(this.#target, "lex_behavioral_persona_revisions")}
          WHERE ${SCOPE_PREDICATE}
          ORDER BY persona_id ASC, recorded_at DESC, revision DESC`,
        scopeValues(this.binding)
      );
      const ruleResult = await client.query<RuleRow>(
        `SELECT DISTINCT ON (rule_id)
                rule_id, revision, content_digest, category, directive, severity,
                applicability_json, confidence_alpha, confidence_beta, source_frame_ids,
                creator_principal_id, recorded_at
           FROM ${relation(this.#target, "lex_behavioral_rule_revisions")}
          WHERE ${SCOPE_PREDICATE}
          ORDER BY rule_id ASC, recorded_at DESC, revision DESC`,
        scopeValues(this.binding)
      );
      const counts = await this.counts(client);
      const personas = personaResult.rows.map((row) => this.persona(row, include));
      const rules = (
        await Promise.all(ruleResult.rows.map((row) => this.rule(client, row, counts, include)))
      ).filter((rule) => behavioralApplicabilityMatches(rule.applicability, query));
      const baselines = behavioralBaselinesForBinding(this.#baselines, this.binding);
      const revisionInput = {
        personas: personas.map(({ personaId, revision, contentDigest }) => ({
          personaId,
          revision,
          contentDigest,
        })),
        rules: rules.map(
          ({ ruleId, revision, contentDigest, confidence, applicability: scope }) => ({
            ruleId,
            revision,
            contentDigest,
            confidence,
            applicability: scope,
          })
        ),
        baselines: baselines.map(({ source, tenantId, baselineId, revision, contentDigest }) => ({
          source,
          ...(tenantId ? { tenantId } : {}),
          baselineId,
          revision,
          contentDigest,
        })),
      };
      return Object.freeze({
        schemaVersion: BEHAVIORAL_STORE_CONTRACT_VERSION,
        snapshotRevision: behavioralContentDigest(revisionInput),
        contentDigest: behavioralContentDigest({
          personas: personas.map(({ provenance: _provenance, ...value }) => value),
          rules: rules.map(({ provenance: _provenance, ...value }) => value),
          baselines,
        }),
        personas: Object.freeze(personas),
        rules: Object.freeze(rules),
        baselines,
      });
    });
  }
}

class PostgresBehavioralWriteView
  extends PostgresBehavioralView
  implements ScopedBehavioralWriteStore
{
  readonly #runner: PostgresBehavioralTransactionRunner;
  readonly #target: PostgresSchemaTargetV1;

  constructor(
    binding: BehavioralStoreBindingV1,
    runner: PostgresBehavioralTransactionRunner,
    target: PostgresSchemaTargetV1
  ) {
    super(binding, () => runner.currentTime());
    this.#runner = runner;
    this.#target = target;
  }

  private async idempotent(
    operation: BehavioralWriteOperationV1,
    idempotencyKey: string,
    resourceId: string,
    revision: string | undefined,
    payload: unknown,
    apply: (client: PoolClient) => Promise<BehavioralWriteReceiptV1["conflict"] | undefined>
  ): Promise<BehavioralWriteReceiptV1> {
    this.assertActive(
      operation === "promotion"
        ? BEHAVIORAL_STORE_CAPABILITIES.PROMOTE
        : BEHAVIORAL_STORE_CAPABILITIES.WRITE
    );
    validateText(idempotencyKey, "idempotencyKey");
    const payloadDigest = behavioralContentDigest({ operation, payload });
    return this.#runner.run(this.binding, "write", async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        canonicalBehavioralJson([...scopeValues(this.binding).slice(0, 4), idempotencyKey]),
      ]);
      const previous = await client.query<ReceiptRow>(
        `SELECT payload_digest, receipt_json
           FROM ${relation(this.#target, "lex_behavioral_write_receipts")}
          WHERE ${SCOPE_PREDICATE} AND idempotency_key = $6`,
        [...scopeValues(this.binding), idempotencyKey]
      );
      if (previous.rows[0]) {
        if (previous.rows[0].payload_digest === payloadDigest) {
          const original = parseJson(previous.rows[0].receipt_json);
          return receipt(
            operation,
            "replayed",
            idempotencyKey,
            payloadDigest,
            original.resourceId,
            original.revision,
            original.conflict
          );
        }
        return receipt(
          operation,
          "conflict",
          idempotencyKey,
          payloadDigest,
          resourceId,
          revision,
          "idempotency-key-reused"
        );
      }
      const conflict = await apply(client);
      const result = receipt(
        operation,
        conflict ? "conflict" : "applied",
        idempotencyKey,
        payloadDigest,
        resourceId,
        revision,
        conflict
      );
      await client.query(
        `INSERT INTO ${relation(this.#target, "lex_behavioral_write_receipts")} (
           tenant_id, workspace_id, repository_id, repository_instance_id,
           idempotency_key, payload_digest, receipt_json, recorded_at
         ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7::jsonb, $8::timestamptz)`,
        [
          ...scopeValues(this.binding).slice(0, 4),
          idempotencyKey,
          payloadDigest,
          canonicalBehavioralJson(result),
          this.currentTime().toISOString(),
        ]
      );
      return result;
    });
  }

  async putPersonaRevision(
    input: BehavioralRevisionWriteV1<PersonaRevisionInputV1>
  ): Promise<BehavioralWriteReceiptV1> {
    validateText(input.value.personaId, "personaId");
    validateText(input.value.revision, "revision");
    const stored = {
      ...input.value,
      sourceFrameIds: stringList(input.value.sourceFrameIds, "sourceFrameIds"),
    };
    const digest = behavioralContentDigest(stored.content);
    return this.idempotent(
      "persona-revision",
      input.idempotencyKey,
      stored.personaId,
      stored.revision,
      stored,
      async (client) => {
        const existing = await client.query<{ content_digest: ContentDigest }>(
          `SELECT content_digest FROM ${relation(this.#target, "lex_behavioral_persona_revisions")}
          WHERE ${SCOPE_PREDICATE} AND persona_id = $6 AND revision = $7`,
          [...scopeValues(this.binding), stored.personaId, stored.revision]
        );
        if (existing.rows[0])
          return existing.rows[0].content_digest === digest
            ? undefined
            : "immutable-revision-exists";
        await client.query(
          `INSERT INTO ${relation(this.#target, "lex_behavioral_persona_revisions")} (
           tenant_id, workspace_id, repository_id, repository_instance_id,
           persona_id, revision, content_digest, content_json, source_frame_ids,
           creator_principal_id, recorded_at
         ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $6, $7, $8, $9::jsonb, $10::text[], $5::uuid, $11::timestamptz)`,
          [
            ...scopeValues(this.binding),
            stored.personaId,
            stored.revision,
            digest,
            canonicalBehavioralJson(stored.content),
            stored.sourceFrameIds,
            this.currentTime().toISOString(),
          ]
        );
        return undefined;
      }
    );
  }

  async putRuleRevision(
    input: BehavioralRevisionWriteV1<RuleRevisionInputV1>
  ): Promise<BehavioralWriteReceiptV1> {
    const value = input.value;
    for (const [field, text] of [
      ["ruleId", value.ruleId],
      ["revision", value.revision],
      ["category", value.category],
      ["directive", value.directive],
    ] as const)
      validateText(text, field);
    if (!["must", "should", "style"].includes(value.severity))
      throw new BehavioralStoreError(
        BEHAVIORAL_STORE_ERROR_CODES.INVALID_INPUT,
        "severity is invalid"
      );
    if (
      !Number.isFinite(value.confidencePrior.alpha) ||
      value.confidencePrior.alpha < 0 ||
      !Number.isFinite(value.confidencePrior.beta) ||
      value.confidencePrior.beta < 0
    )
      throw new BehavioralStoreError(
        BEHAVIORAL_STORE_ERROR_CODES.INVALID_INPUT,
        "confidence prior must be finite and non-negative"
      );
    const stored = {
      ...value,
      applicability: applicability(value.applicability),
      sourceFrameIds: stringList(value.sourceFrameIds, "sourceFrameIds"),
    };
    const digest = behavioralContentDigest(stored);
    return this.idempotent(
      "rule-revision",
      input.idempotencyKey,
      stored.ruleId,
      stored.revision,
      stored,
      async (client) => {
        const existing = await client.query<{ content_digest: ContentDigest }>(
          `SELECT content_digest FROM ${relation(this.#target, "lex_behavioral_rule_revisions")}
          WHERE ${SCOPE_PREDICATE} AND rule_id = $6 AND revision = $7`,
          [...scopeValues(this.binding), stored.ruleId, stored.revision]
        );
        if (existing.rows[0])
          return existing.rows[0].content_digest === digest
            ? undefined
            : "immutable-revision-exists";
        await client.query(
          `INSERT INTO ${relation(this.#target, "lex_behavioral_rule_revisions")} (
           tenant_id, workspace_id, repository_id, repository_instance_id,
           rule_id, revision, content_digest, category, directive, severity,
           applicability_json, confidence_alpha, confidence_beta, source_frame_ids,
           creator_principal_id, recorded_at
         ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $6, $7, $8, $9, $10, $11,
                   $12::jsonb, $13, $14, $15::text[], $5::uuid, $16::timestamptz)`,
          [
            ...scopeValues(this.binding),
            stored.ruleId,
            stored.revision,
            digest,
            stored.category,
            stored.directive,
            stored.severity,
            canonicalBehavioralJson(stored.applicability),
            stored.confidencePrior.alpha,
            stored.confidencePrior.beta,
            stored.sourceFrameIds,
            this.currentTime().toISOString(),
          ]
        );
        return undefined;
      }
    );
  }

  async recordEvidence(input: BehavioralEvidenceInputV1): Promise<BehavioralWriteReceiptV1> {
    validateText(input.ruleId, "ruleId");
    validateText(input.ruleRevision, "ruleRevision");
    if (!["observation", "counterexample", "correction", "trust-gap"].includes(input.kind)) {
      throw new BehavioralStoreError(
        BEHAVIORAL_STORE_ERROR_CODES.INVALID_INPUT,
        "evidence kind is invalid"
      );
    }
    const stored = {
      ...input,
      sourceFrameIds: stringList(input.sourceFrameIds, "sourceFrameIds"),
      note: input.note?.trim() || undefined,
    };
    const evidenceId = behavioralContentDigest({
      scope: scopeValues(this.binding),
      idempotencyKey: input.idempotencyKey,
    });
    return this.idempotent(
      "evidence",
      input.idempotencyKey,
      evidenceId,
      input.ruleRevision,
      stored,
      async (client) => {
        const exists = await client.query(
          `SELECT 1 FROM ${relation(this.#target, "lex_behavioral_rule_revisions")}
          WHERE ${SCOPE_PREDICATE} AND rule_id = $6 AND revision = $7`,
          [...scopeValues(this.binding), input.ruleId, input.ruleRevision]
        );
        if (!exists.rows[0]) return "missing-revision";
        await client.query(
          `INSERT INTO ${relation(this.#target, "lex_behavioral_evidence")} (
           tenant_id, workspace_id, repository_id, repository_instance_id,
           evidence_id, rule_id, rule_revision, kind, source_frame_ids, note,
           creator_principal_id, recorded_at
         ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $6, $7, $8, $9, $10::text[], $11, $5::uuid, $12::timestamptz)`,
          [
            ...scopeValues(this.binding),
            evidenceId,
            input.ruleId,
            input.ruleRevision,
            input.kind,
            stored.sourceFrameIds,
            stored.note ?? null,
            this.currentTime().toISOString(),
          ]
        );
        return undefined;
      }
    );
  }

  async promoteRule(input: BehavioralPromotionInputV1): Promise<BehavioralWriteReceiptV1> {
    validateText(input.ruleId, "ruleId");
    validateText(input.ruleRevision, "ruleRevision");
    if (input.target === "module" && !input.moduleId?.trim())
      throw new BehavioralStoreError(
        BEHAVIORAL_STORE_ERROR_CODES.INVALID_INPUT,
        "module promotion requires moduleId"
      );
    if (input.target === "task" && !input.taskType?.trim())
      throw new BehavioralStoreError(
        BEHAVIORAL_STORE_ERROR_CODES.INVALID_INPUT,
        "task promotion requires taskType"
      );
    const stored = {
      ...input,
      moduleId: input.moduleId?.trim() || undefined,
      taskType: input.taskType?.trim() || undefined,
    };
    const promotionId = behavioralContentDigest({
      scope: scopeValues(this.binding),
      idempotencyKey: input.idempotencyKey,
    });
    return this.idempotent(
      "promotion",
      input.idempotencyKey,
      promotionId,
      input.ruleRevision,
      stored,
      async (client) => {
        const exists = await client.query(
          `SELECT 1 FROM ${relation(this.#target, "lex_behavioral_rule_revisions")}
          WHERE ${SCOPE_PREDICATE} AND rule_id = $6 AND revision = $7`,
          [...scopeValues(this.binding), input.ruleId, input.ruleRevision]
        );
        if (!exists.rows[0]) return "missing-revision";
        await client.query(
          `INSERT INTO ${relation(this.#target, "lex_behavioral_promotions")} (
           tenant_id, workspace_id, repository_id, repository_instance_id,
           promotion_id, rule_id, rule_revision, target_layer, module_id, task_type,
           creator_principal_id, recorded_at
         ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $6, $7, $8, $9, $10, $11, $5::uuid, $12::timestamptz)`,
          [
            ...scopeValues(this.binding),
            promotionId,
            input.ruleId,
            input.ruleRevision,
            input.target,
            stored.moduleId ?? null,
            stored.taskType ?? null,
            this.currentTime().toISOString(),
          ]
        );
        return undefined;
      }
    );
  }
}

/** Internal adapter accepts an injected pool for deterministic and live tests. */
export class PostgresBehavioralStoreBackend implements BehavioralStoreBinder {
  readonly #pool: Pool;
  readonly #ownsPool: boolean;
  readonly #closeOwnedPool: (() => Promise<void>) | undefined;
  readonly #runner: PostgresBehavioralTransactionRunner;
  readonly #target: PostgresSchemaTargetV1;
  readonly #now: () => Date;
  readonly #baselines: readonly BehavioralBaselineRevisionV1[];
  #closed = false;

  constructor(connection: string | Pool, options: PostgresBehavioralStoreOptionsV1) {
    this.#target = createPostgresSchemaTarget(options.schema);
    if (typeof connection === "string") {
      const owner = createOwnedPostgresPool({
        connectionString: connection,
        allowExitOnIdle: true,
      });
      this.#pool = owner.pool;
      this.#closeOwnedPool = owner.close;
    } else {
      this.#pool = connection;
    }
    this.#ownsPool = typeof connection === "string";
    this.#now = options.now ?? (() => new Date());
    this.#runner = new PostgresBehavioralTransactionRunner(
      this.#pool,
      this.#target,
      options.enforceRuntimeRole ?? true,
      this.#now
    );
    this.#baselines = immutableBehavioralBaselines(options.baselines);
  }

  bindRead(binding: BehavioralStoreBindingV1): ScopedBehavioralReadStore {
    const immutable = immutableBehavioralBinding(binding);
    assertBehavioralCapability(immutable, BEHAVIORAL_STORE_CAPABILITIES.READ, this.#now());
    return new PostgresBehavioralReadView(immutable, this.#runner, this.#target, this.#baselines);
  }

  bindWrite(binding: BehavioralStoreBindingV1): ScopedBehavioralWriteStore {
    const immutable = immutableBehavioralBinding(binding);
    if (
      !immutable.authorizedScope.capabilities.includes(BEHAVIORAL_STORE_CAPABILITIES.WRITE) &&
      !immutable.authorizedScope.capabilities.includes(BEHAVIORAL_STORE_CAPABILITIES.PROMOTE)
    )
      assertBehavioralCapability(immutable, BEHAVIORAL_STORE_CAPABILITIES.WRITE, this.#now());
    return new PostgresBehavioralWriteView(immutable, this.#runner, this.#target);
  }

  close(): Promise<void> {
    this.#closed = true;
    return this.#ownsPool ? this.#closeOwnedPool!() : Promise.resolve();
  }
}

/** Public normal-operation factory accepts an explicit credential string, never a pool/client handle. */
export function openPostgresBehavioralStore(
  connectionString: string,
  options: PostgresBehavioralStoreOptionsV1
): BehavioralStoreBinder {
  return new PostgresBehavioralStoreBackend(connectionString, options);
}

export function postgresBehavioralBackendIdentity(
  connectionString: string,
  schema: string
): string {
  const url = new URL(connectionString);
  url.password = "";
  url.search = "";
  return `postgres-behavioral-v${POSTGRES_BEHAVIORAL_STORE_SCHEMA_VERSION}:${createHash("sha256")
    .update(
      `${url.protocol}//${url.username ? `${url.username}@` : ""}${url.hostname}${url.port ? `:${url.port}` : ""}${url.pathname}#schema=${schema}`
    )
    .digest("hex")
    .slice(0, 16)}`;
}

export type { PostgresBehavioralStoreOptionsV1 };
