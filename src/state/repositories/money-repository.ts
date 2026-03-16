import { stateRepository } from './state-repository';

class MoneyRepository {
  getBalance(): number {
    return stateRepository.read((state) => state.balance);
  }

  getEarnings(): number {
    return stateRepository.read((state) => state.earnings);
  }

  async incrementBalance(amount: number): Promise<number> {
    const state = stateRepository.getState();
    state.balance += amount;
    await stateRepository.write();
    return state.balance;
  }

  async resetBalance(): Promise<{ previousBalance: number; balance: number }> {
    const state = stateRepository.getState();
    const previousBalance = state.balance;
    state.balance = 0;
    await stateRepository.write();
    return {
      previousBalance,
      balance: state.balance,
    };
  }

  async applyChargeAndResetBalance(requiredAmount: number): Promise<{
    previousBalance: number;
    earnings: number;
  }> {
    const state = stateRepository.getState();
    const previousBalance = state.balance;
    state.balance = 0;
    state.earnings += requiredAmount;
    await stateRepository.write();
    return {
      previousBalance,
      earnings: state.earnings,
    };
  }
}

export const moneyRepository = new MoneyRepository();
