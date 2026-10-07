const $ = (id) => document.getElementById(id);
const eur = (n) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

function el(tag, { dataset, ...props } = {}, ...children) {
  const e = Object.assign(document.createElement(tag), props);
  Object.assign(e.dataset, dataset);
  e.append(...children);
  return e;
}

async function api(path, options) {
  const res = await fetch(path, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = Array.isArray(body.detail) ? "Données invalides." : body.detail;
    throw new Error(detail || `Erreur ${res.status}`);
  }
  return res.json();
}

const post = (path, data) =>
  api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });

const CONFIRM_PHRASE = "Je sais ce que je fais";

// Modale de confirmation : résout true seulement si la phrase exacte est saisie.
function confirmDangerous(message) {
  return new Promise((resolve) => {
    const input = el("input", { placeholder: CONFIRM_PHRASE, autocomplete: "off" });
    const ok = el("button", { type: "submit", disabled: true }, "Confirmer");
    const cancel = el("button", { type: "button", className: "secondary" }, "Annuler");
    const form = el("form", { method: "dialog" },
      el("h2", {}, "Confirmer la suppression"),
      el("p", {}, message),
      el("p", { className: "hint" }, "Pour continuer, tapez : ", el("strong", {}, CONFIRM_PHRASE)),
      input,
      el("div", { className: "actions" }, cancel, ok));
    const dialog = el("dialog", {}, form);

    input.oninput = () => { ok.disabled = input.value.trim() !== CONFIRM_PHRASE; };
    cancel.onclick = () => dialog.close("cancel");
    form.onsubmit = (ev) => {
      ev.preventDefault();
      if (!ok.disabled) dialog.close("confirm");
    };
    dialog.onclose = () => { resolve(dialog.returnValue === "confirm"); dialog.remove(); };

    document.body.append(dialog);
    dialog.showModal();
    input.focus();
  });
}

function showError(msg) {
  $("error").textContent = msg || "";
}
