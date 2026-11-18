async function refresh() {
  const state = await api("/api/state");
  $("users").replaceChildren(
    ...(state.utilisateurs.length
      ? state.utilisateurs.map((u) => {
          const del = el("button", { className: "del", title: "Supprimer" }, "✕");
          del.onclick = async () => {
            if (!confirm(`Supprimer l'utilisateur « ${u.nom} » ?`)) return;
            try {
              await api(`/api/users/${encodeURIComponent(u.nom)}`, { method: "DELETE" });
              showError("");
              await refresh();
            } catch (e) { showError(e.message); }
          };
          return el("div", { className: "debt" }, el("span", {}, u.nom), del);
        })
      : [el("p", { className: "hint" }, "Aucun utilisateur.")])
  );
}

$("user-form").onsubmit = async (ev) => {
  ev.preventDefault();
  try {
    await post("/api/users", { nom: $("user-name").value });
    $("user-name").value = "";
    showError("");
    await refresh();
  } catch (e) { showError(e.message); }
};

refresh().catch((e) => showError(e.message));
