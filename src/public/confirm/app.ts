export {};

type SocketLike = {
  on: (event: string, cb: (...args: unknown[]) => void) => void;
};

type ConfirmConfig = {
  mode: "print" | "copy";
  sessionId: string | null;
  colorMode: "colored" | "grayscale";
  copies: number;
  orientation: "portrait" | "landscape";
  paperSize: "A4" | "Letter" | "Legal";
};

const modeValue = document.getElementById("modeValue");
const fileValue = document.getElementById("fileValue");
const colorValue = document.getElementById("colorValue");
const copiesValue = document.getElementById("copiesValue");
const orientationValue = document.getElementById("orientationValue");
const paperSizeValue = document.getElementById("paperSizeValue");
const priceValue = document.getElementById("priceValue");
const balanceValue = document.getElementById("balanceValue");
const statusMessage = document.getElementById("statusMessage");
const coinEventMessage = document.getElementById("coinEventMessage");
const confirmBtn = document.getElementById("confirmBtn") as HTMLButtonElement;
const resetBalanceBtn = document.getElementById(
  "resetBalanceBtn",
) as HTMLButtonElement;

const rawConfig = sessionStorage.getItem("printbit.config");
const uploadedFile = sessionStorage.getItem("printbit.uploadedFile");

if (!rawConfig) {
  window.location.href = "/config";
  throw new Error("Missing print configuration");
}

const config = JSON.parse(rawConfig ?? "{}") as ConfirmConfig;
const basePrice = config.mode === "copy" ? 3 : 5;
const colorSurcharge = config.colorMode === "colored" ? 2 : 0;
const totalPrice = (basePrice + colorSurcharge) * Math.max(1, config.copies);

if (confirmBtn) {
  confirmBtn.textContent =
    config.mode === "print" ? "Confirm and Print" : "Confirm and Copy";
}

if (modeValue) modeValue.textContent = config.mode.toUpperCase();
if (fileValue)
  fileValue.textContent =
    config.mode === "print"
      ? (uploadedFile ?? "No uploaded file")
      : "Physical document copy";
if (colorValue) colorValue.textContent = config.colorMode;
if (copiesValue) copiesValue.textContent = String(config.copies);
if (orientationValue) orientationValue.textContent = config.orientation;
if (paperSizeValue) paperSizeValue.textContent = config.paperSize;
if (priceValue) priceValue.textContent = `PHP ${totalPrice.toFixed(2)}`;

function updateBalanceUI(balance: number): void {
  if (balanceValue) balanceValue.textContent = `PHP ${balance.toFixed(2)}`;
  if (!statusMessage || !confirmBtn) return;

  if (balance >= totalPrice) {
    statusMessage.textContent =
      "Sufficient balance detected. You can confirm now.";
    confirmBtn.disabled = false;
  } else {
    const needed = totalPrice - balance;
    statusMessage.textContent = `Insert more coins: PHP ${needed.toFixed(2)} remaining.`;
    confirmBtn.disabled = true;
  }
}

function setCoinEventMessage(message: string): void {
  if (coinEventMessage) coinEventMessage.textContent = message;
}

async function fetchInitialBalance(): Promise<void> {
  const response = await fetch("/api/balance");
  const data = (await response.json()) as { balance: number };
  updateBalanceUI(data.balance ?? 0);
}

async function resetBalanceForTesting(): Promise<void> {
  if (!resetBalanceBtn) return;
  resetBalanceBtn.disabled = true;
  if (statusMessage) statusMessage.textContent = "Resetting coin balance...";

  const response = await fetch("/api/balance/reset", { method: "POST" });
  const payload = (await response.json()) as {
    balance?: number;
    error?: string;
  };

  if (!response.ok) {
    if (statusMessage)
      statusMessage.textContent = payload.error ?? "Failed to reset balance.";
    resetBalanceBtn.disabled = false;
    return;
  }

  updateBalanceUI(payload.balance ?? 0);
  if (statusMessage)
    statusMessage.textContent =
      "Coin balance reset to PHP 0.00 (testing mode).";
  setCoinEventMessage("Balance reset manually for testing.");
  resetBalanceBtn.disabled = false;
}

confirmBtn?.addEventListener("click", async () => {
  confirmBtn.disabled = true;
  if (statusMessage) statusMessage.textContent = "Processing payment...";

  const response = await fetch("/api/confirm-payment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: totalPrice,
      mode: config.mode,
      sessionId: config.sessionId,
    }),
  });

  if (!response.ok) {
    const payload = (await response.json()) as { error?: string };
    if (statusMessage)
      statusMessage.textContent =
        payload.error ?? "Payment confirmation failed.";
    return;
  }

  if (statusMessage) {
    statusMessage.textContent =
      config.mode === "print"
        ? "Payment accepted. Print job sent."
        : "Payment accepted. You can now run the copy operation.";
  }
  sessionStorage.removeItem("printbit.config");
  sessionStorage.removeItem("printbit.uploadedFile");
  sessionStorage.removeItem("printbit.sessionId");
});

resetBalanceBtn?.addEventListener("click", () => {
  void resetBalanceForTesting();
});

const ioFactory = (
  window as unknown as { io?: (...args: unknown[]) => SocketLike }
).io;

if (typeof ioFactory === "function") {
  const socket = ioFactory();
  socket.on("balance", (amount: unknown) => {
    if (typeof amount === "number") {
      updateBalanceUI(amount);
    }
  });

  socket.on("coinAccepted", (payload: unknown) => {
    if (
      payload &&
      typeof payload === "object" &&
      "value" in payload &&
      typeof (payload as { value: unknown }).value === "number"
    ) {
      const value = (payload as { value: number }).value;
      setCoinEventMessage(`Last accepted coin: PHP ${value.toFixed(2)}`);
    }
  });

  socket.on("coinParserWarning", (payload: unknown) => {
    if (
      payload &&
      typeof payload === "object" &&
      "message" in payload &&
      typeof (payload as { message: unknown }).message === "string"
    ) {
      setCoinEventMessage(
        `Serial note: ${(payload as { message: string }).message}`,
      );
    }
  });
}

void fetchInitialBalance();
