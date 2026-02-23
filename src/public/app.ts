type SocketLike = {
  on: (event: string, cb: (...args: unknown[]) => void) => void;
};

const ioFactory = (
  window as unknown as { io?: (...args: unknown[]) => SocketLike }
).io;

if (typeof ioFactory === "function") {
  const socket = ioFactory();
  socket.on("balance", (amount: unknown) => {
    const el = document.getElementById("balance");
    if (el && typeof amount === "number") el.textContent = String(amount);
  });
}

function navigateTo(path: string) {
  window.location.href = path;
}

const openPrint = document.getElementById("openPrintBtn");
const openCopy = document.getElementById("openCopyBtn");
const openScan = document.getElementById("openScanBtn");
const powerOff = document.getElementById("powerOffBtn");

openPrint?.addEventListener("click", () => navigateTo("/print"));
openCopy?.addEventListener("click", () => navigateTo("/copy"));
openScan?.addEventListener("click", () => navigateTo("/scan"));

powerOff?.addEventListener("click", () => {
  const ok = confirm("Power off device?");
  if (!ok) return;
  alert("Powering off...");
});

export { navigateTo };
