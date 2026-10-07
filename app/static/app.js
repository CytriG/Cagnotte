let state = null;

function render() {
  $("pot").textContent = eur(state.cagnotte);

  const debts = $("debts");
  debts.replaceChildren(
    ...(state.utilisateurs.length
      ? state.utilisateurs.map((u) =>
          el("div", { className: "debt" + (u.dette > 0 ? " owes" : "") },
            el("span", {}, u.nom), el("strong", {}, eur(u.dette))))
      : [el("p", { className: "hint" }, "Aucun utilisateur : ajoutez-en pour commencer.")])
  );

  const select = $("op-user");
  const current = select.value;
  select.replaceChildren(...state.utilisateurs.map((u) => el("option", { value: u.nom }, u.nom)));
  if (state.utilisateurs.some((u) => u.nom === current)) select.value = current;

  $("history").replaceChildren(
    ...state.operations.map((o) => {
      const income = o.type === "rentrée";
      const del = el("button", { className: "del", title: "Supprimer" }, "✕");
      del.onclick = async () => {
        if (!await confirmDangerous(`Supprimer l'opération #${o.id} (${o.description || o.type}, ${eur(o.montant)}) ?`)) return;
        try { await api(`/api/operations/${o.id}`, { method: "DELETE" }); await refresh(); }
        catch (e) { showError(e.message); }
      };
      return el("tr", {},
        el("td", {}, o.date),
        el("td", { className: income ? "in" : "out" }, o.type),
        el("td", {}, o.utilisateur),
        el("td", { className: income ? "in" : "out" }, (income ? "+" : "−") + eur(o.montant)),
        el("td", {}, o.description),
        el("td", { className: "effects" }, o.effets),
        el("td", {}, del));
    })
  );
  updateHint();
}

function updateHint() {
  const type = $("op-type").value;
  $("hint").textContent = type === "rentrée"
    ? "L'argent entre dans la cagnotte et augmente la dette de l'utilisateur choisi."
    : "La dépense réduit d'abord la dette de l'utilisateur (la cagnotte baisse) ; le reste est réparti en dette entre les autres (la cagnotte augmente).";
}

let page = 1;

async function refresh() {
  state = await api(`/api/state?page=${page}`);
  page = state.page;
  $("page-info").textContent = `Page ${state.page} / ${state.pages} · ${state.total_operations} opération(s)`;
  $("prev").disabled = page <= 1;
  $("next").disabled = page >= state.pages;
  render();
}

$("prev").onclick = () => { page--; refresh().catch((e) => showError(e.message)); };
$("next").onclick = () => { page++; refresh().catch((e) => showError(e.message)); };

$("op-type").onchange = updateHint;

$("op-form").onsubmit = async (ev) => {
  ev.preventDefault();
  try {
    await post("/api/operations", {
      type: $("op-type").value,
      utilisateur: $("op-user").value,
      montant: $("op-amount").value,
      description: $("op-desc").value,
      date: $("op-date").value,
    });
    $("op-amount").value = "";
    $("op-desc").value = "";
    showError("");
    await refresh();
  } catch (e) { showError(e.message); }
};

$("op-date").valueAsDate = new Date();
refresh().catch((e) => showError(e.message));
