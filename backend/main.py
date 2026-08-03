"""
Sistema de Controle de Estudos - Backend
FastAPI + SQLite

Como rodar:
    pip install -r requirements.txt
    python main.py

Depois acesse: http://localhost:8000
"""

import sqlite3
import os
from datetime import date, timedelta, datetime
from typing import Optional, List
from contextlib import contextmanager

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "estudos.db")
FRONTEND_DIR = os.path.join(os.path.dirname(BASE_DIR), "frontend")

# Intervalos de revisão espaçada (dias), baseado no método usado em cadernos de
# erros para concursos (revisões em 1, 7 e 21 dias após o registro do erro)
INTERVALOS_REVISAO = [1, 7, 21]

app = FastAPI(title="Sistema de Controle de Estudos")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Banco de dados
# ---------------------------------------------------------------------------

@contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def _garantir_coluna(conn, tabela, coluna, definicao):
    """Adiciona uma coluna se ela ainda não existir (migração simples e segura)."""
    cols = [r["name"] for r in conn.execute(f"PRAGMA table_info({tabela})").fetchall()]
    if coluna not in cols:
        conn.execute(f"ALTER TABLE {tabela} ADD COLUMN {coluna} {definicao}")


def init_db():
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS materias (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nome TEXT NOT NULL UNIQUE,
                cor TEXT NOT NULL DEFAULT '#8a9a5b',
                meta_semanal_min INTEGER NOT NULL DEFAULT 0
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS sessoes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                materia_id INTEGER NOT NULL REFERENCES materias(id) ON DELETE CASCADE,
                data TEXT NOT NULL,
                duracao_min INTEGER NOT NULL,
                tipo TEXT NOT NULL DEFAULT 'teoria',
                topico TEXT NOT NULL DEFAULT '',
                observacoes TEXT NOT NULL DEFAULT '',
                criado_em TEXT NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS erros (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                materia_id INTEGER NOT NULL REFERENCES materias(id) ON DELETE CASCADE,
                topico TEXT NOT NULL DEFAULT '',
                questao TEXT NOT NULL DEFAULT '',
                motivo TEXT NOT NULL DEFAULT '',
                tipo_erro TEXT NOT NULL DEFAULT 'falta_conteudo',
                data_registro TEXT NOT NULL,
                fase INTEGER NOT NULL DEFAULT 0,
                proxima_revisao TEXT NOT NULL,
                consolidado INTEGER NOT NULL DEFAULT 0
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS meta_geral (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                horas_semana_min INTEGER NOT NULL DEFAULT 0,
                questoes_semana INTEGER NOT NULL DEFAULT 0,
                dias_semana INTEGER NOT NULL DEFAULT 0,
                data_prova TEXT
            )
        """)

        # migrações leves para bancos criados antes destes campos existirem
        _garantir_coluna(conn, "materias", "meta_questoes_semanal", "INTEGER NOT NULL DEFAULT 0")
        _garantir_coluna(conn, "sessoes", "questoes_total", "INTEGER NOT NULL DEFAULT 0")
        _garantir_coluna(conn, "sessoes", "questoes_corretas", "INTEGER NOT NULL DEFAULT 0")
        _garantir_coluna(conn, "erros", "consolidado_em", "TEXT")

        conn.execute(
            "INSERT OR IGNORE INTO meta_geral (id, horas_semana_min, questoes_semana, dias_semana) "
            "VALUES (1, 0, 0, 0)"
        )

        # matérias padrão (alinhadas ao edital do EsPCEx), só na primeira execução
        cur = conn.execute("SELECT COUNT(*) as c FROM materias")
        if cur.fetchone()["c"] == 0:
            padrao = [
                ("Matemática", "#c9a227"),
                ("Português", "#8a9a5b"),
                ("Física", "#4a6d8c"),
                ("Química", "#a15c3e"),
                ("Inglês", "#7a6b8f"),
                ("Geografia", "#5b8a72"),
                ("História", "#8f6b4a"),
            ]
            conn.executemany(
                "INSERT INTO materias (nome, cor) VALUES (?, ?)", padrao
            )


init_db()


# ---------------------------------------------------------------------------
# Modelos (Pydantic)
# ---------------------------------------------------------------------------

class MateriaIn(BaseModel):
    nome: str
    cor: str = "#8a9a5b"
    meta_semanal_min: int = 0
    meta_questoes_semanal: int = 0


class MateriaUpdate(BaseModel):
    nome: Optional[str] = None
    cor: Optional[str] = None
    meta_semanal_min: Optional[int] = None
    meta_questoes_semanal: Optional[int] = None


class SessaoIn(BaseModel):
    materia_id: int
    data: str  # YYYY-MM-DD
    duracao_min: int = Field(gt=0)
    tipo: str = "teoria"  # teoria | exercicios | revisao | simulado
    topico: str = ""
    observacoes: str = ""
    questoes_total: int = 0
    questoes_corretas: int = 0


class MetaGeralIn(BaseModel):
    horas_semana_min: int = 0
    questoes_semana: int = 0
    dias_semana: int = 0
    data_prova: Optional[str] = None  # YYYY-MM-DD ou None


class ErroIn(BaseModel):
    materia_id: int
    topico: str = ""
    questao: str = ""
    motivo: str = ""
    tipo_erro: str = "falta_conteudo"  # falta_conteudo | atencao | interpretacao | cansaco
    data_registro: Optional[str] = None  # default: hoje


# ---------------------------------------------------------------------------
# Matérias
# ---------------------------------------------------------------------------

@app.get("/api/materias")
def listar_materias():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM materias ORDER BY nome").fetchall()
        return [dict(r) for r in rows]


@app.post("/api/materias")
def criar_materia(m: MateriaIn):
    with get_db() as conn:
        try:
            cur = conn.execute(
                "INSERT INTO materias (nome, cor, meta_semanal_min) VALUES (?, ?, ?)",
                (m.nome.strip(), m.cor, m.meta_semanal_min),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(400, "Já existe uma matéria com esse nome.")
        return {"id": cur.lastrowid}


@app.put("/api/materias/{materia_id}")
def atualizar_materia(materia_id: int, m: MateriaUpdate):
    with get_db() as conn:
        atual = conn.execute("SELECT * FROM materias WHERE id = ?", (materia_id,)).fetchone()
        if not atual:
            raise HTTPException(404, "Matéria não encontrada.")
        novo = {
            "nome": m.nome if m.nome is not None else atual["nome"],
            "cor": m.cor if m.cor is not None else atual["cor"],
            "meta_semanal_min": m.meta_semanal_min if m.meta_semanal_min is not None else atual["meta_semanal_min"],
            "meta_questoes_semanal": m.meta_questoes_semanal if m.meta_questoes_semanal is not None else atual["meta_questoes_semanal"],
        }
        conn.execute(
            """UPDATE materias SET nome = ?, cor = ?, meta_semanal_min = ?, meta_questoes_semanal = ?
               WHERE id = ?""",
            (novo["nome"], novo["cor"], novo["meta_semanal_min"], novo["meta_questoes_semanal"], materia_id),
        )
        return {"ok": True}


@app.delete("/api/materias/{materia_id}")
def excluir_materia(materia_id: int):
    with get_db() as conn:
        conn.execute("DELETE FROM materias WHERE id = ?", (materia_id,))
    return {"ok": True}


# ---------------------------------------------------------------------------
# Sessões de estudo
# ---------------------------------------------------------------------------

@app.get("/api/sessoes")
def listar_sessoes(materia_id: Optional[int] = None, limite: int = 200):
    with get_db() as conn:
        if materia_id:
            rows = conn.execute(
                """SELECT s.*, m.nome AS materia_nome, m.cor AS materia_cor
                   FROM sessoes s JOIN materias m ON m.id = s.materia_id
                   WHERE s.materia_id = ? ORDER BY s.data DESC, s.id DESC LIMIT ?""",
                (materia_id, limite),
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT s.*, m.nome AS materia_nome, m.cor AS materia_cor
                   FROM sessoes s JOIN materias m ON m.id = s.materia_id
                   ORDER BY s.data DESC, s.id DESC LIMIT ?""",
                (limite,),
            ).fetchall()
        return [dict(r) for r in rows]


@app.post("/api/sessoes")
def criar_sessao(s: SessaoIn):
    with get_db() as conn:
        m = conn.execute("SELECT id FROM materias WHERE id = ?", (s.materia_id,)).fetchone()
        if not m:
            raise HTTPException(404, "Matéria não encontrada.")
        cur = conn.execute(
            """INSERT INTO sessoes (materia_id, data, duracao_min, tipo, topico, observacoes,
                                     questoes_total, questoes_corretas, criado_em)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (s.materia_id, s.data, s.duracao_min, s.tipo, s.topico, s.observacoes,
             s.questoes_total, s.questoes_corretas, datetime.now().isoformat()),
        )
        return {"id": cur.lastrowid}


@app.delete("/api/sessoes/{sessao_id}")
def excluir_sessao(sessao_id: int):
    with get_db() as conn:
        conn.execute("DELETE FROM sessoes WHERE id = ?", (sessao_id,))
    return {"ok": True}


# ---------------------------------------------------------------------------
# Caderno de erros (com revisão espaçada)
# ---------------------------------------------------------------------------

@app.get("/api/erros")
def listar_erros(materia_id: Optional[int] = None, apenas_pendentes: bool = False):
    with get_db() as conn:
        query = """SELECT e.*, m.nome AS materia_nome, m.cor AS materia_cor
                   FROM erros e JOIN materias m ON m.id = e.materia_id WHERE 1=1"""
        params: list = []
        if materia_id:
            query += " AND e.materia_id = ?"
            params.append(materia_id)
        if apenas_pendentes:
            query += " AND e.consolidado = 0 AND e.proxima_revisao <= ?"
            params.append(date.today().isoformat())
        query += " ORDER BY e.proxima_revisao ASC"
        rows = conn.execute(query, params).fetchall()
        return [dict(r) for r in rows]


@app.post("/api/erros")
def criar_erro(e: ErroIn):
    with get_db() as conn:
        m = conn.execute("SELECT id FROM materias WHERE id = ?", (e.materia_id,)).fetchone()
        if not m:
            raise HTTPException(404, "Matéria não encontrada.")
        data_reg = e.data_registro or date.today().isoformat()
        base = date.fromisoformat(data_reg)
        proxima = (base + timedelta(days=INTERVALOS_REVISAO[0])).isoformat()
        cur = conn.execute(
            """INSERT INTO erros (materia_id, topico, questao, motivo, tipo_erro,
                                   data_registro, fase, proxima_revisao, consolidado)
               VALUES (?, ?, ?, ?, ?, ?, 0, ?, 0)""",
            (e.materia_id, e.topico, e.questao, e.motivo, e.tipo_erro, data_reg, proxima),
        )
        return {"id": cur.lastrowid}


@app.post("/api/erros/{erro_id}/revisar")
def revisar_erro(erro_id: int):
    """Marca o erro como revisado hoje e agenda a próxima revisão da curva
    espaçada (1 -> 7 -> 21 dias). Depois da 3ª revisão, o item é consolidado."""
    with get_db() as conn:
        erro = conn.execute("SELECT * FROM erros WHERE id = ?", (erro_id,)).fetchone()
        if not erro:
            raise HTTPException(404, "Erro não encontrado.")
        nova_fase = erro["fase"] + 1
        if nova_fase >= len(INTERVALOS_REVISAO):
            conn.execute(
                "UPDATE erros SET fase = ?, consolidado = 1, consolidado_em = ? WHERE id = ?",
                (nova_fase, date.today().isoformat(), erro_id),
            )
        else:
            proxima = (date.today() + timedelta(days=INTERVALOS_REVISAO[nova_fase])).isoformat()
            conn.execute(
                "UPDATE erros SET fase = ?, proxima_revisao = ? WHERE id = ?",
                (nova_fase, proxima, erro_id),
            )
        return {"ok": True}


@app.delete("/api/erros/{erro_id}")
def excluir_erro(erro_id: int):
    with get_db() as conn:
        conn.execute("DELETE FROM erros WHERE id = ?", (erro_id,))
    return {"ok": True}


# ---------------------------------------------------------------------------
# Meta geral
# ---------------------------------------------------------------------------

@app.get("/api/meta-geral")
def obter_meta_geral():
    with get_db() as conn:
        row = conn.execute("SELECT * FROM meta_geral WHERE id = 1").fetchone()
        return dict(row)


@app.put("/api/meta-geral")
def atualizar_meta_geral(m: MetaGeralIn):
    with get_db() as conn:
        conn.execute(
            """UPDATE meta_geral SET horas_semana_min = ?, questoes_semana = ?,
                                      dias_semana = ?, data_prova = ? WHERE id = 1""",
            (m.horas_semana_min, m.questoes_semana, m.dias_semana, m.data_prova),
        )
        return {"ok": True}


# ---------------------------------------------------------------------------
# Evolução (progresso semana a semana)
# ---------------------------------------------------------------------------

def _segunda(d: date) -> date:
    return d - timedelta(days=d.weekday())


@app.get("/api/evolucao")
def evolucao(semanas: int = 12):
    semanas = max(1, min(semanas, 52))
    with get_db() as conn:
        hoje = date.today()
        segunda_atual = _segunda(hoje)
        resultado = []
        for i in range(semanas - 1, -1, -1):
            inicio = segunda_atual - timedelta(weeks=i)
            fim = inicio + timedelta(days=6)
            ini_s, fim_s = inicio.isoformat(), fim.isoformat()

            sess = conn.execute(
                """SELECT COALESCE(SUM(duracao_min),0) as min_total,
                          COALESCE(SUM(questoes_total),0) as q_total,
                          COALESCE(SUM(questoes_corretas),0) as q_certas,
                          COUNT(DISTINCT data) as dias
                   FROM sessoes WHERE data BETWEEN ? AND ?""",
                (ini_s, fim_s),
            ).fetchone()

            erros_reg = conn.execute(
                "SELECT COUNT(*) as c FROM erros WHERE data_registro BETWEEN ? AND ?",
                (ini_s, fim_s),
            ).fetchone()["c"]

            erros_consol = conn.execute(
                "SELECT COUNT(*) as c FROM erros WHERE consolidado_em BETWEEN ? AND ?",
                (ini_s, fim_s),
            ).fetchone()["c"]

            taxa_acerto = round(100 * sess["q_certas"] / sess["q_total"]) if sess["q_total"] > 0 else None

            resultado.append({
                "semana_inicio": ini_s,
                "semana_fim": fim_s,
                "minutos": sess["min_total"],
                "dias_estudados": sess["dias"],
                "questoes_total": sess["q_total"],
                "questoes_corretas": sess["q_certas"],
                "taxa_acerto": taxa_acerto,
                "erros_registrados": erros_reg,
                "erros_consolidados": erros_consol,
            })
        return resultado


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------

@app.get("/api/dashboard")
def dashboard():
    with get_db() as conn:
        total_min = conn.execute("SELECT COALESCE(SUM(duracao_min),0) as t FROM sessoes").fetchone()["t"]

        por_materia = conn.execute(
            """SELECT m.id, m.nome, m.cor, m.meta_semanal_min,
                      COALESCE(SUM(s.duracao_min),0) as total_min
               FROM materias m
               LEFT JOIN sessoes s ON s.materia_id = m.id
               GROUP BY m.id ORDER BY total_min DESC"""
        ).fetchall()

        hoje = date.today()
        inicio_semana = (hoje - timedelta(days=hoje.weekday())).isoformat()
        por_materia_semana = conn.execute(
            """SELECT materia_id, COALESCE(SUM(duracao_min),0) as t
               FROM sessoes WHERE data >= ? GROUP BY materia_id""",
            (inicio_semana,),
        ).fetchall()
        semana_map = {r["materia_id"]: r["t"] for r in por_materia_semana}

        # sequência de dias estudados (streak)
        dias = conn.execute(
            "SELECT DISTINCT data FROM sessoes ORDER BY data DESC"
        ).fetchall()
        dias_set = {r["data"] for r in dias}
        streak = 0
        cursor_dia = hoje
        # se hoje ainda não estudou, o streak conta a partir de ontem
        if hoje.isoformat() not in dias_set:
            cursor_dia = hoje - timedelta(days=1)
        while cursor_dia.isoformat() in dias_set:
            streak += 1
            cursor_dia -= timedelta(days=1)

        erros_pendentes_hoje = conn.execute(
            "SELECT COUNT(*) as c FROM erros WHERE consolidado = 0 AND proxima_revisao <= ?",
            (hoje.isoformat(),),
        ).fetchone()["c"]

        erros_total = conn.execute("SELECT COUNT(*) as c FROM erros").fetchone()["c"]
        erros_consolidados = conn.execute(
            "SELECT COUNT(*) as c FROM erros WHERE consolidado = 1"
        ).fetchone()["c"]

        # erros por tipo (pra ver onde estão as dificuldades)
        por_tipo = conn.execute(
            "SELECT tipo_erro, COUNT(*) as c FROM erros GROUP BY tipo_erro"
        ).fetchall()

        # últimos 14 dias de estudo (pra gráfico de evolução)
        ultimos_14 = []
        for i in range(13, -1, -1):
            d = (hoje - timedelta(days=i)).isoformat()
            t = conn.execute(
                "SELECT COALESCE(SUM(duracao_min),0) as t FROM sessoes WHERE data = ?", (d,)
            ).fetchone()["t"]
            ultimos_14.append({"data": d, "minutos": t})

        meta_geral = conn.execute("SELECT * FROM meta_geral WHERE id = 1").fetchone()
        meta_geral = dict(meta_geral)
        dias_para_prova = None
        if meta_geral["data_prova"]:
            dias_para_prova = (date.fromisoformat(meta_geral["data_prova"]) - hoje).days

        semana_atual = conn.execute(
            """SELECT COALESCE(SUM(duracao_min),0) as min_total,
                      COALESCE(SUM(questoes_total),0) as q_total,
                      COALESCE(SUM(questoes_corretas),0) as q_certas,
                      COUNT(DISTINCT data) as dias
               FROM sessoes WHERE data >= ?""",
            (inicio_semana,),
        ).fetchone()

        return {
            "total_min": total_min,
            "streak_dias": streak,
            "erros_pendentes_hoje": erros_pendentes_hoje,
            "erros_total": erros_total,
            "erros_consolidados": erros_consolidados,
            "por_materia": [
                {**dict(r), "min_semana": semana_map.get(r["id"], 0)} for r in por_materia
            ],
            "por_tipo_erro": [dict(r) for r in por_tipo],
            "ultimos_14_dias": ultimos_14,
            "meta_geral": meta_geral,
            "dias_para_prova": dias_para_prova,
            "semana_atual": {
                "minutos": semana_atual["min_total"],
                "dias_estudados": semana_atual["dias"],
                "questoes_total": semana_atual["q_total"],
                "questoes_corretas": semana_atual["q_certas"],
            },
        }


# ---------------------------------------------------------------------------
# Frontend estático
# ---------------------------------------------------------------------------

if os.path.isdir(FRONTEND_DIR):
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

    @app.get("/")
    def index():
        return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
