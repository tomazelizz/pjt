# Ficha de Estudos — Sistema de Controle de Estudos (EsPCEx)

Sistema full stack para registrar horas de estudo, matérias e um caderno de
erros com revisão espaçada (1 → 7 → 21 dias), com painel visual de
acompanhamento.

## Estrutura

```
estudos-tracker/
├── backend/
│   ├── main.py            # API (FastAPI) + banco SQLite
│   └── requirements.txt
└── frontend/
    ├── index.html
    ├── style.css
    └── app.js
```

## Como rodar

Precisa de Python 3.9+ instalado. É só usar o backend — ele já serve o
frontend sozinho.

```bash
cd backend
pip install -r requirements.txt
python main.py
```

Depois abra no navegador: **http://localhost:8000**

O banco de dados (`estudos.db`) é criado automaticamente na primeira
execução, dentro da pasta `backend/`, já com as matérias do edital do EsPCEx
cadastradas (Matemática, Português, Física, Química, Inglês, Geografia,
História). Todos os dados ficam salvos localmente nesse arquivo — nada é
enviado para a internet.

## O que o sistema faz

**Painel (dashboard)**
- Total de horas estudadas, sequência de dias seguidos estudando (streak)
- Gráfico de estudo dos últimos 14 dias
- Distribuição de horas por matéria
- Progresso em relação à meta semanal de cada matéria
- Lista de revisões do caderno de erros que estão vencidas hoje

**Sessões de estudo**
- Registra matéria, data, duração, tipo (teoria / exercícios / revisão /
  simulado), tópico e observações
- Listagem filtrável por matéria

**Caderno de erros (com revisão espaçada)**
- Registra matéria, tópico, a questão/descrição do erro, o motivo/aprendizado
  e o tipo de erro (falta de conteúdo, atenção, interpretação, cansaço) —
  classificação baseada no método de caderno de erros usado em preparação
  para concursos e provas militares
- Cada erro entra num ciclo de revisão: 1 dia → 7 dias → 21 dias. Ao marcar
  "revisado", o item avança de fase; depois da 3ª revisão vira "consolidado"
- O painel sempre mostra o que está vencido para revisar hoje

**Matérias**
- Cadastro livre de matérias, cor de identificação e meta semanal em minutos

## Personalizar

- Para mudar as matérias padrão, edite a lista `padrao` em
  `backend/main.py` (função `init_db`) antes da primeira execução, ou apague
  `estudos.db` para recomeçar do zero.
- Para mudar os intervalos de revisão espaçada, edite
  `INTERVALOS_REVISAO = [1, 7, 21]` em `backend/main.py`.
