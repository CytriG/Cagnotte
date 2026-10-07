"""Cagnotte virtuelle : API + service du front statique. Stockage en CSV lisibles."""
import csv
import os
import threading
import datetime as dt
from decimal import Decimal
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, condecimal

DATA_DIR = Path(os.environ.get("DATA_DIR", "data"))
USERS_FILE = DATA_DIR / "utilisateurs.csv"
OPS_FILE = DATA_DIR / "operations.csv"

USERS_COLS = ["nom"]
OPS_COLS = ["id", "date", "type", "utilisateur", "montant_eur", "description", "effets_sur_dettes",
            "cagnotte_apres_eur", "dettes_apres", "saisi_le"]

PAGE_SIZE = 50

INCOME = "rentrée"
EXPENSE = "dépense"

lock = threading.Lock()
app = FastAPI(title="Cagnotte virtuelle")


# ---------- stockage CSV ----------
# Séparateur ";" + BOM utf-8 : s'ouvre directement dans Excel FR avec les accents.

def read_csv(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f, delimiter=";"))


def write_csv(path: Path, cols: list[str], rows: list[dict]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with tmp.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=cols, delimiter=";")
        w.writeheader()
        w.writerows(rows)
    tmp.replace(path)  # écriture atomique


# ---------- logique métier (en centimes, entiers) ----------

def to_cents(d: Decimal) -> int:
    return int(d * 100)


def fmt(cents: int, signed: bool = False) -> str:
    s = f"{abs(cents) / 100:.2f}"
    if signed:
        return ("-" if cents < 0 else "+") + s
    return ("-" if cents < 0 else "") + s


def parse_effects(text: str) -> dict[str, int]:
    """'Alice: -20.00 | Bob: +10.00' -> {'Alice': -2000, 'Bob': 1000}"""
    out: dict[str, int] = {}
    for part in filter(None, (p.strip() for p in text.split("|"))):
        name, val = part.rsplit(":", 1)
        out[name.strip()] = int(round(Decimal(val.strip()) * 100))
    return out


def format_effects(effects: dict[str, int]) -> str:
    return " | ".join(f"{n}: {fmt(c, signed=True)}" for n, c in effects.items() if c)


def compute_effects(op_type: str, user: str, cents: int, users: list[str], debts: dict[str, int]) -> dict[str, int]:
    """Règle métier : variation de dette (en centimes) par utilisateur.

    - rentrée : la dette de l'utilisateur augmente du montant.
    - dépense : réduit d'abord la dette de l'utilisateur ; ce qui dépasse
      (ou tout, s'il n'a pas de dette) est réparti en dette entre les autres.
    """
    if op_type == INCOME:
        return {user: cents}
    effects: dict[str, int] = {}
    reduction = min(max(debts.get(user, 0), 0), cents)
    if reduction:
        effects[user] = -reduction
    rest = cents - reduction
    others = [u for u in users if u != user]
    if rest and others:
        share, extra = divmod(rest, len(others))
        for i, u in enumerate(others):
            effects[u] = share + (1 if i < extra else 0)
    return effects


def fill_snapshots(ops: list[dict], users: list[str]) -> None:
    """Recalcule, pour chaque opération, la cagnotte et les dettes de chacun juste après elle.
    Appelé avant chaque écriture, donc toujours cohérent (même après une suppression)."""
    debts = {u: 0 for u in users}
    pot = 0
    for op in ops:
        effects = parse_effects(op["effets_sur_dettes"])
        pot += sum(effects.values())  # la cagnotte = somme des dettes
        for name, c in effects.items():
            if name in debts:
                debts[name] += c
        op["cagnotte_apres_eur"] = fmt(pot)
        op["dettes_apres"] = " | ".join(f"{u}: {fmt(d)}" for u, d in debts.items())


def load_state() -> dict:
    users = [r["nom"] for r in read_csv(USERS_FILE)]
    ops = read_csv(OPS_FILE)
    debts = {u: 0 for u in users}
    pot = 0
    for op in ops:
        effects = parse_effects(op["effets_sur_dettes"])
        pot += sum(effects.values())  # la cagnotte = somme des dettes
        for name, c in effects.items():
            debts[name] = debts.get(name, 0) + c
    return {"users": users, "ops": ops, "debts": debts, "pot": pot}


# ---------- API ----------

class UserIn(BaseModel):
    nom: str = Field(min_length=1, max_length=40)


class OperationIn(BaseModel):
    type: str = Field(pattern=f"^({INCOME}|{EXPENSE})$")
    utilisateur: str
    montant: condecimal(gt=0, max_digits=12, decimal_places=2)
    description: str = Field(min_length=1, max_length=200)
    date: dt.date | None = None


@app.get("/api/state")
def get_state(page: int = Query(1, ge=1)):
    with lock:
        s = load_state()
    total = len(s["ops"])
    pages = max(1, -(-total // PAGE_SIZE))
    page = min(page, pages)
    newest_first = list(reversed(s["ops"]))
    page_ops = newest_first[(page - 1) * PAGE_SIZE : page * PAGE_SIZE]
    ops = [
        {
            "id": int(o["id"]),
            "date": o["date"],
            "type": o["type"],
            "utilisateur": o["utilisateur"],
            "montant": float(o["montant_eur"]),
            "description": o["description"],
            "effets": o["effets_sur_dettes"],
        }
        for o in page_ops
    ]
    return {
        "page": page,
        "pages": pages,
        "total_operations": total,
        "cagnotte": s["pot"] / 100,
        "utilisateurs": [{"nom": u, "dette": s["debts"][u] / 100} for u in s["users"]],
        "operations": ops,
    }


@app.post("/api/users", status_code=201)
def add_user(body: UserIn):
    nom = " ".join(body.nom.split())
    if not nom or "|" in nom:
        raise HTTPException(400, "Nom invalide (le caractère « | » est interdit).")
    with lock:
        rows = read_csv(USERS_FILE)
        if any(r["nom"].casefold() == nom.casefold() for r in rows):
            raise HTTPException(409, "Cet utilisateur existe déjà.")
        rows.append({"nom": nom})
        write_csv(USERS_FILE, USERS_COLS, rows)
    return {"nom": nom}


@app.delete("/api/users/{nom}")
def delete_user(nom: str):
    with lock:
        s = load_state()
        if nom not in s["users"]:
            raise HTTPException(404, "Utilisateur introuvable.")
        if s["debts"].get(nom, 0) != 0:
            raise HTTPException(409, "Cet utilisateur a une dette en cours : impossible de le supprimer.")
        if any(o["utilisateur"] == nom for o in s["ops"]):
            raise HTTPException(409, "Cet utilisateur a des opérations : supprimez-les d'abord.")
        write_csv(USERS_FILE, USERS_COLS, [{"nom": u} for u in s["users"] if u != nom])
    return {"ok": True}


@app.post("/api/operations", status_code=201)
def add_operation(body: OperationIn):
    if not body.description.strip():
        raise HTTPException(400, "La description est obligatoire.")
    with lock:
        s = load_state()
        if body.utilisateur not in s["users"]:
            raise HTTPException(400, "Utilisateur inconnu.")
        cents = to_cents(body.montant)
        effects = compute_effects(body.type, body.utilisateur, cents, s["users"], s["debts"])
        next_id = max((int(o["id"]) for o in s["ops"]), default=0) + 1
        s["ops"].append({
            "id": next_id,
            "date": (body.date or dt.date.today()).isoformat(),
            "type": body.type,
            "utilisateur": body.utilisateur,
            "montant_eur": fmt(cents),
            "description": body.description.strip(),
            "effets_sur_dettes": format_effects(effects),
            "saisi_le": dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        })
        fill_snapshots(s["ops"], s["users"])
        write_csv(OPS_FILE, OPS_COLS, s["ops"])
    return {"id": next_id}


@app.delete("/api/operations/{op_id}")
def delete_operation(op_id: int):
    with lock:
        ops = read_csv(OPS_FILE)
        kept = [o for o in ops if int(o["id"]) != op_id]
        if len(kept) == len(ops):
            raise HTTPException(404, "Opération introuvable.")
        fill_snapshots(kept, [r["nom"] for r in read_csv(USERS_FILE)])
        write_csv(OPS_FILE, OPS_COLS, kept)
    return {"ok": True}


@app.get("/api/download/{name}")
def download(name: str):
    files = {"operations.csv": OPS_FILE, "utilisateurs.csv": USERS_FILE}
    path = files.get(name)
    if path is None:
        raise HTTPException(404)
    if not path.exists():
        cols = OPS_COLS if path == OPS_FILE else USERS_COLS
        with lock:
            write_csv(path, cols, [])
    return FileResponse(path, media_type="text/csv; charset=utf-8", filename=name)


app.mount("/", StaticFiles(directory=Path(__file__).parent / "static", html=True), name="static")
