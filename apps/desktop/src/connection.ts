import "./connection.css";

const form = document.querySelector<HTMLFormElement>("#form")!;
const field = (name: string) =>
  form.elements.namedItem(name) as HTMLInputElement;
const error = document.querySelector<HTMLElement>("#error")!;
const current = document.querySelector<HTMLElement>("#current")!;
const clear = document.querySelector<HTMLButtonElement>("#clear")!;
const save = document.querySelector<HTMLButtonElement>("#save")!;
const secretHint = document.querySelector<HTMLElement>("#secret-hint")!;

const show = (connection: { url: string; clientId: string } | null): void => {
  current.textContent = connection
    ? `いまの保存先: ${connection.url}`
    : "いまの保存先: このMac";
  clear.hidden = connection === null;
  secretHint.hidden = connection === null;
  field("clientSecret").required = connection === null;
  if (connection) {
    field("url").value = connection.url;
    field("clientId").value = connection.clientId;
  }
  field("clientSecret").value = "";
};

const run = async (work: () => Promise<void>): Promise<void> => {
  error.textContent = "";
  save.disabled = clear.disabled = true;
  try {
    await work();
  } catch (failure) {
    // IPC越しのエラーは先頭に経路の説明が付くので、本文だけを出す。
    error.textContent = String(
      failure instanceof Error ? failure.message : failure,
    ).replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, "");
  } finally {
    save.disabled = clear.disabled = false;
  }
};

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void run(async () => {
    show(
      await window.pkmConnection.save({
        url: field("url").value,
        clientId: field("clientId").value,
        clientSecret: field("clientSecret").value,
      }),
    );
    current.textContent += "（接続しました）";
  });
});
clear.addEventListener("click", () => {
  void run(async () => {
    await window.pkmConnection.clear();
    show(null);
  });
});

void window.pkmConnection.get().then(show);
