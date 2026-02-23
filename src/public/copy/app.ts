export {};

const continueBtn = document.getElementById("continueBtn") as HTMLButtonElement | null;

continueBtn?.addEventListener("click", () => {
  sessionStorage.setItem("printbit.mode", "copy");
  sessionStorage.removeItem("printbit.sessionId");
  sessionStorage.removeItem("printbit.uploadedFile");
  window.location.href = "/config?mode=copy";
});
