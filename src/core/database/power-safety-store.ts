import { getSqliteDb } from './sqlite-storage';

export interface PowerSafetyStateRecord {
  id: number;
  powerSourceInstanceId: string | null;
  powerSequence: number | null;
  statusJson: string | null;
  operationalState: string | null;
  acceptingTransactions: boolean;
  sourceTimestampUtc: string | null;
  receivedTimestampUtc: string | null;
}

export class PowerSafetySqliteStore {
  savePowerSafetyState(entry: {
    powerSourceInstanceId?: string | null;
    powerSequence?: number | null;
    statusJson?: string | null;
    operationalState?: string | null;
    acceptingTransactions?: boolean;
    sourceTimestampUtc?: string | null;
    receivedTimestampUtc?: string | null;
  }): void {
    const received = entry.receivedTimestampUtc ?? new Date().toISOString();
    const acceptingInt = entry.acceptingTransactions ? 1 : 0;
    getSqliteDb()
      .prepare(
        `INSERT INTO power_safety_state (
          id,
          power_source_instance_id,
          power_sequence,
          status_json,
          operational_state,
          accepting_transactions,
          source_timestamp_utc,
          received_timestamp_utc
        ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          power_source_instance_id = excluded.power_source_instance_id,
          power_sequence = excluded.power_sequence,
          status_json = excluded.status_json,
          operational_state = excluded.operational_state,
          accepting_transactions = excluded.accepting_transactions,
          source_timestamp_utc = excluded.source_timestamp_utc,
          received_timestamp_utc = excluded.received_timestamp_utc`,
      )
      .run(
        entry.powerSourceInstanceId ?? null,
        entry.powerSequence !== undefined && entry.powerSequence !== null
          ? Number(entry.powerSequence)
          : null,
        entry.statusJson ?? null,
        entry.operationalState ?? null,
        acceptingInt,
        entry.sourceTimestampUtc ?? null,
        received,
      );
  }

  getPowerSafetyState(): PowerSafetyStateRecord | null {
    const row = getSqliteDb()
      .prepare(
        `SELECT
          id,
          power_source_instance_id,
          power_sequence,
          status_json,
          operational_state,
          accepting_transactions,
          source_timestamp_utc,
          received_timestamp_utc
        FROM power_safety_state
        WHERE id = 1
        LIMIT 1`,
      )
      .get() as Record<string, unknown> | undefined;

    if (!row) return null;
    return {
      id: Number(row.id ?? 1),
      powerSourceInstanceId:
        typeof row.power_source_instance_id === 'string'
          ? row.power_source_instance_id
          : null,
      powerSequence:
        typeof row.power_sequence === 'number'
          ? row.power_sequence
          : row.power_sequence !== null && row.power_sequence !== undefined
            ? Number(row.power_sequence)
            : null,
      statusJson:
        typeof row.status_json === 'string' ? row.status_json : null,
      operationalState:
        typeof row.operational_state === 'string'
          ? row.operational_state
          : null,
      acceptingTransactions:
        row.accepting_transactions === 1 ||
        row.accepting_transactions === true ||
        row.accepting_transactions === '1',
      sourceTimestampUtc:
        typeof row.source_timestamp_utc === 'string'
          ? row.source_timestamp_utc
          : null,
      receivedTimestampUtc:
        typeof row.received_timestamp_utc === 'string'
          ? row.received_timestamp_utc
          : null,
    };
  }

  clear(): void {
    getSqliteDb().exec('DELETE FROM power_safety_state WHERE id = 1');
  }
}

export const powerSafetyStore = new PowerSafetySqliteStore();
