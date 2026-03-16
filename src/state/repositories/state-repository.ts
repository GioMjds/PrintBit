import { db } from '@/services/db';
import type { Schema } from '@/state';

class StateRepository {
  getState(): Schema {
    if (!db.data) {
      throw new Error(
        'Database is not initialized. Call initDB() before reads.',
      );
    }
    return db.data;
  }

  read<T>(selector: (state: Schema) => T): T {
    return selector(this.getState());
  }

  async write(): Promise<void> {
    await db.write();
  }

  async mutate(mutator: (state: Schema) => void): Promise<void> {
    mutator(this.getState());
    await this.write();
  }
}

export const stateRepository = new StateRepository();
