export interface RefactorGuardrails {
  preserveEndpointContracts: boolean;
  preserveDbJsonCompatibility: boolean;
  incrementalMigrationOnly: boolean;
}

export const BACKEND_REFACTOR_GUARDRAILS: RefactorGuardrails = Object.freeze({
  preserveEndpointContracts: true,
  preserveDbJsonCompatibility: true,
  incrementalMigrationOnly: true,
});
