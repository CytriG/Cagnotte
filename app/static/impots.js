// Calculateur du gain d'impôt lié au PACS (calcul 100 % côté navigateur).
// Cagnotte = (impôt de MD seul au versement libératoire + impôt de CT seul) − impôt du foyer pacsé.

// Taux pré-remplis selon l'activité de l'auto-entrepreneur (modifiables ensuite).
const REGIMES = {
  bnc:       { md_abatt_taux: 34, md_abatt_min: 305, md_vl_taux: 2.2, md_plafond_ca: 77700 },
  bic_serv:  { md_abatt_taux: 50, md_abatt_min: 305, md_vl_taux: 1.7, md_plafond_ca: 77700 },
  bic_vente: { md_abatt_taux: 71, md_abatt_min: 305, md_vl_taux: 1, md_plafond_ca: 188700 },
};

// Valeurs par défaut : montants personnels à 0 (les vraies saisies sont dans data/impots.json, non versionné),
// paramètres fiscaux publics du barème 2026 (revenus 2025).
const DEFAULTS = {
  md_ca: 0, md_regime: "bnc", ...REGIMES.bnc, md_rfr: "", vl_plafond_rfr: 29315,
  ct_salaires: 0, ct_frais_reels: "", frais_taux: 10, frais_min: 509, frais_max: 14555,
  fonc_md: 0, fonc_ct: 0, fonc_taux: 30, fonc_taux_md: 0, fonc_taux_ct: 30,
  cap_md: 0, cap_ct: 0, cap_taux: 12.8, cap_taux_md: 12.8, cap_taux_ct: 12.8,
  pv_md: 0, pv_ct: 0, pv_taux: 19, pv_taux_md: 19, pv_taux_ct: 19,
  paye_md_pv: 0, paye_ct_pv: 0,
  av_md: 0, av_ct: 0, av_abatt: 9200, av_abatt_md: 4600, av_abatt_ct: 4600, av_taux: 7.5, av_taux_md: 7.5, av_taux_ct: 7.5,
  dons_md: 0, dons_ct: 0, dons_taux: 66,
  paye_md_pas: 0, paye_md_acomptes: 0, paye_md_vl: 0, paye_md_pfu: 0, paye_md_avance: 0,
  paye_ct_pas: 0, paye_ct_acomptes: 0, paye_ct_vl: 0, paye_ct_pfu: 0, paye_ct_avance: 0,
  paye_md_solde: 0, paye_ct_solde: 0,
  parts_couple: 2, parts_md: 1, parts_ct: 1,
  t1: 11600, r1: 11, t2: 29579, r2: 30, t3: 84577, r3: 41, t4: 181917, r4: 45,
  decote_seul: 897, decote_couple: 1483, decote_coef: 45.25, plafond_qf: 1807,
};
const TEXT_FIELDS = ["md_regime", "ct_frais_reels", "md_rfr"];

// Code couleur des champs : données du foyer en rouge, paramètres fiscaux en gris.
const REVENUS = ["md_ca", "md_rfr", "ct_salaires", "ct_frais_reels", "fonc_md", "fonc_ct", "cap_md", "cap_ct", "av_md", "av_ct", "pv_md", "pv_ct",
  "dons_md", "dons_ct"];
// Types de paiements déjà effectués (l'avance perçue vient en déduction).
const PAIEMENTS = [
  ["pas", "Retenue à la source", 1],
  ["acomptes", "Acomptes prélevés", 1],
  ["vl", "Versements libératoires", 1],
  ["pfu", "Prélèvement forfaitaire capitaux", 1],
  ["pv", "Impôt plus-values foncières payé", 1],
  ["avance", "Avance perçue sur réductions", -1],
  ["solde", "Solde de l'avis", 1],
];
for (const [k] of PAIEMENTS) REVENUS.push(`paye_md_${k}`, `paye_ct_${k}`);

const form = $("tax-form");

// Les saisies sont enregistrées sur le serveur (data/impots.json) : elles survivent au rechargement
// de la page, au redémarrage de l'app et sont les mêmes depuis n'importe quel appareil.
async function load() {
  let saved = {};
  try {
    saved = await api("/api/impots");
  } catch (e) {
    setStatus("Impossible de charger les valeurs enregistrées : " + e.message, true);
  }
  fill({ ...DEFAULTS, ...saved });
}

function setStatus(msg, isError = false) {
  $("save-status").textContent = msg;
  $("save-status").className = "hint " + (isError ? "out" : "");
}

let saveTimer;
function scheduleSave(values) {
  clearTimeout(saveTimer);
  setStatus("Modifications en cours…");
  saveTimer = setTimeout(async () => {
    try {
      await api("/api/impots", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
      setStatus("✓ Enregistré");
    } catch (e) {
      setStatus("Échec de l'enregistrement : " + e.message, true);
    }
  }, 500);
}

function fill(values) {
  for (const [k, v] of Object.entries(values)) {
    if (form.elements[k]) form.elements[k].value = v;
  }
}

function read() {
  const v = {};
  for (const k of Object.keys(DEFAULTS)) {
    const raw = form.elements[k].value;
    v[k] = TEXT_FIELDS.includes(k) ? raw : Number(raw) || 0;
  }
  return v;
}

// Impôt au barème pour une part.
function baremeUnePart(q, p) {
  const tranches = [[p.t1, p.r1], [p.t2, p.r2], [p.t3, p.r3], [p.t4, p.r4]];
  let impot = 0;
  tranches.forEach(([seuil, taux], i) => {
    const haut = i + 1 < tranches.length ? tranches[i + 1][0] : Infinity;
    if (q > seuil) impot += (Math.min(q, haut) - seuil) * taux / 100;
  });
  return impot;
}

// Impôt au barème avec quotient familial, plafonnement et décote.
function bareme(revenu, parts, couple, p) {
  const base = couple ? 2 : 1;
  let impot = baremeUnePart(revenu / parts, p) * parts;
  if (parts > base) {
    const sansEnfants = baremeUnePart(revenu / base, p) * base;
    impot = Math.max(impot, sansEnfants - p.plafond_qf * (parts - base) * 2);
  }
  // Décote = forfait − coefficient × impôt brut (nulle si négative).
  const forfait = couple ? p.decote_couple : p.decote_seul;
  const decote = Math.max(0, forfait - p.decote_coef / 100 * impot);
  return Math.max(0, impot - decote);
}

function compute(v) {
  const abattement = Math.min(v.md_ca, Math.max(v.md_abatt_min, v.md_ca * v.md_abatt_taux / 100));
  const mdNet = v.md_ca - abattement;
  const vl = v.md_ca * v.md_vl_taux / 100;

  const frais = v.ct_frais_reels !== ""
    ? Number(v.ct_frais_reels)
    : Math.min(v.frais_max, Math.max(v.frais_min, v.ct_salaires * v.frais_taux / 100));
  const ctNet = Math.max(0, v.ct_salaires - frais);

  // La réduction pour dons ne peut pas dépasser l'impôt (barème + fonciers), elle n'est pas remboursable.
  // Assurance vie : (gains − abattement) × taux.
  const assuranceVie = (gains, abatt, taux) => Math.max(0, gains - abatt) * taux / 100;
  const scenario = (activite, reductible, foncMontant, tauxFonc, capMontant, tauxCap, av, pv, dons) => {
    const f = foncMontant * tauxFonc / 100, c = capMontant * tauxCap / 100;
    const reduc = Math.min(dons * v.dons_taux / 100, reductible + f);
    return { activite, fonc: f, cap: c, av, pv, reduc, total: activite + f + c + av + pv - reduc };
  };

  const impotCouple = bareme(mdNet + ctNet, v.parts_couple, true, v);
  const impotCT = bareme(ctNet, v.parts_ct, false, v);

  // Droit au VL pour MD seul(e) : RFR N-2 ≤ plafond × parts et CA ≤ plafond micro.
  // Sans RFR saisi, on l'estime avec les revenus de l'année : activité nette + sa part de fonciers et de capitaux.
  const rfrMD = v.md_rfr !== ""
    ? Number(v.md_rfr)
    : mdNet + v.fonc_md + v.cap_md + v.av_md + v.pv_md;
  const vlOk = { rfr: rfrMD <= v.vl_plafond_rfr * v.parts_md, ca: v.md_ca <= v.md_plafond_ca };
  vlOk.all = vlOk.rfr && vlOk.ca;
  // Sans droit au VL, MD seul(e) passe au barème sur son revenu net.
  const impotMD = vlOk.all ? vl : bareme(mdNet, v.parts_md, false, v);

  const couple = scenario(impotCouple, impotCouple, v.fonc_md + v.fonc_ct, v.fonc_taux, v.cap_md + v.cap_ct, v.cap_taux,
    assuranceVie(v.av_md + v.av_ct, v.av_abatt, v.av_taux), (v.pv_md + v.pv_ct) * v.pv_taux / 100,
    v.dons_md + v.dons_ct);
  const md = scenario(impotMD, vlOk.all ? 0 : impotMD, v.fonc_md, v.fonc_taux_md, v.cap_md, v.cap_taux_md,
    assuranceVie(v.av_md, v.av_abatt_md, v.av_taux_md), v.pv_md * v.pv_taux_md / 100, v.dons_md);
  const ct = scenario(impotCT, impotCT, v.fonc_ct, v.fonc_taux_ct, v.cap_ct, v.cap_taux_ct,
    assuranceVie(v.av_ct, v.av_abatt_ct, v.av_taux_ct), v.pv_ct * v.pv_taux_ct / 100, v.dons_ct);
  const seuls = {};
  for (const k of Object.keys(couple)) seuls[k] = md[k] + ct[k];

  return { couple, md, ct, seuls, gain: seuls.total - couple.total, mdNet, abattement, vl, ctNet, frais,
    rfrMD, rfrEstime: v.md_rfr === "", vlOk };
}

const round = (n) => eur(Math.round(n)).replace(/,00/, "");
const pct = (n) => n.toLocaleString("fr-FR") + " %";

function render() {
  const v = read();
  const r = compute(v);

  // Totaux affichés dans la colonne « Pacsés / Total » des saisies côte à côte.
  $("tot-fonc").textContent = round(v.fonc_md + v.fonc_ct);
  $("tot-cap").textContent = round(v.cap_md + v.cap_ct);
  $("tot-av").textContent = round(v.av_md + v.av_ct);
  $("tot-pvf").textContent = round(v.pv_md + v.pv_ct);
  $("tot-dons").textContent = round(v.dons_md + v.dons_ct);
  for (const [k] of PAIEMENTS) $(`tot-${k}`).textContent = round(v[`paye_md_${k}`] + v[`paye_ct_${k}`]);

  // Ce que chacun a réellement payé (avance perçue en déduction) ; leur somme = impôt réel du foyer.
  const detail = (who) => PAIEMENTS.map(([k, , sign]) => sign * v[`paye_${who}_${k}`]);
  const somme = (a) => a.reduce((s, x) => s + x, 0);
  const paye = { md: somme(detail("md")), ct: somme(detail("ct")) };
  const impotReel = paye.md + paye.ct;
  // Versement dans la cagnotte : chacun met ce qu'il aurait payé seul, moins ce qu'il a réellement payé.
  const verse = { md: r.md.total - paye.md, ct: r.ct.total - paye.ct };
  const versement = verse.md + verse.ct;

  $("gain").textContent = round(versement);
  $("gain").className = "amount " + (versement >= 0 ? "in" : "out");
  $("gain-detail").textContent =
    `Impôts seuls : ${round(r.seuls.total)}  ·  Impôt réellement payé : ${round(impotReel)}  ·  ` +
    `MD verse ${round(verse.md)}, CT verse ${round(verse.ct)}`;

  $("md-hint").textContent =
    `Abattement ${pct(v.md_abatt_taux)} : ${round(r.abattement)} → revenu net ${round(r.mdNet)} (utilisé pour le foyer pacsé). ` +
    `Versement libératoire ${pct(v.md_vl_taux)} du CA : ${round(r.vl)} (utilisé pour MD seul(e)).`;
  const ok = r.vlOk;
  $("vl-status").className = "hint " + (ok.all ? "in" : "out");
  $("vl-status").textContent =
    `RFR ${r.rfrEstime ? "estimé" : "saisi"} : ${round(r.rfrMD)} ${ok.rfr ? "≤" : ">"} plafond ${round(v.vl_plafond_rfr * v.parts_md)} · ` +
    `CA ${round(v.md_ca)} ${ok.ca ? "≤" : ">"} plafond ${round(v.md_plafond_ca)} → ` +
    (ok.all ? "versement libératoire autorisé." : "pas de droit au versement libératoire : MD seul(e) est imposé(e) au barème.");

  $("ct-hint").textContent =
    `Frais : ${round(r.frais)} → salaires nets imposables ${round(r.ctNet)}.`;

  const rows = [
    ["Impôt sur l'activité (barème ou VL)", "activite"],
    ["Revenus fonciers (taux moyen)", "fonc"],
    ["Revenus de capitaux (forfaitaire)", "cap"],
    ["Assurance vie", "av"],
    ["Plus-values foncières", "pv"],
    ["Réduction pour dons", "reduc", -1],
    ["Impôt total", "total"],
  ];
  const cols = [r.couple, r.md, r.ct, r.seuls];
  const heads = ["Pacsés", "MD seul(e)", "CT seul(e)", "MD + CT seuls"];
  $("results").replaceChildren(...rows.map(([label, key, sign = 1]) =>
    el("tr", { className: key === "total" ? "total" : "" },
      el("td", {}, label),
      ...cols.map((c, i) => el("td", { dataset: { label: heads[i] } }, round(sign * c[key]))))));

  // Présentation façon « calcul du solde » de l'avis : paiements en −, avance perçue en +.
  const neg = (a) => a.map((x) => -x);
  const pay = {
    md: [r.md.total, ...neg(detail("md")), verse.md],
    ct: [r.ct.total, ...neg(detail("ct")), verse.ct],
  };
  const payRows = ["Impôt s'il/elle était seul(e)", ...PAIEMENTS.map(([, label]) => label), "Versement dans la cagnotte"];
  const signed = (n, i) => (i > 0 && i < payRows.length - 1 && n > 0 ? "+ " : "") + round(n).replace("-", "− ");
  $("payments").replaceChildren(...payRows.map((label, i) =>
    el("tr", { className: i === payRows.length - 1 ? "total" : "" },
      el("td", {}, label),
      el("td", { dataset: { label: "MD" } }, signed(pay.md[i], i)),
      el("td", { dataset: { label: "CT" } }, signed(pay.ct[i], i)),
      el("td", { dataset: { label: "Total" } }, signed(pay.md[i] + pay.ct[i], i)))));

  $("payments-explain").textContent =
    `Impôt réellement payé par le foyer : ${round(impotReel)} (impôt pacsé calculé : ${round(r.couple.total)}, ` +
    `écart ${round(impotReel - r.couple.total)}). ` +
    `Versement dans la cagnotte = ${round(r.seuls.total)} d'impôts seuls − ${round(impotReel)} réellement payés = ${round(versement)}. ` +
    `Un montant négatif signifie que la personne a payé plus que si elle était seule : la cagnotte lui doit la différence.`;

  $("explain").textContent =
    `Pacsés : barème sur ${round(r.mdNet + r.ctNet)} avec ${v.parts_couple} parts. ` +
    (r.vlOk.all
      ? `MD seul(e) : versement libératoire, ses revenus d'activité ne passent pas au barème. `
      : `MD seul(e) : pas de droit au versement libératoire, barème sur ${round(r.mdNet)}. `) +
    `CT seul(e) : barème sur ${round(r.ctNet)} avec ${v.parts_ct} part(s). ` +
    `Gain théorique calculé = ${round(r.seuls.total)} − ${round(r.couple.total)} = ${round(r.gain)} ` +
    `(le versement réel, en haut, utilise ce qui a vraiment été payé).`;
}

for (const name of Object.keys(DEFAULTS)) {
  const field = form.elements[name];
  if (REVENUS.includes(name)) field.classList.add("revenu");
  else field.classList.add("param");
}

form.addEventListener("input", (ev) => {
  if (ev.target.name === "md_regime") fill(REGIMES[ev.target.value]);
  render();
  scheduleSave(read());
});
$("reset").onclick = async () => {
  if (!await confirmDangerous("Toutes les valeurs saisies seront effacées du serveur et remises à zéro.")) return;
  clearTimeout(saveTimer);
  try {
    await api("/api/impots", { method: "DELETE" });
    setStatus("Formulaire réinitialisé");
  } catch (e) {
    setStatus("Échec de la réinitialisation : " + e.message, true);
  }
  fill(DEFAULTS);
  render();
};
load().then(render);
