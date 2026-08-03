const API = "/api";

const TIPO_ERRO_LABEL = {
  falta_conteudo: "Falta de conteúdo",
  atencao: "Falta de atenção",
  interpretacao: "Erro de interpretação",
  cansaco: "Cansaço / pressa",
};
const TIPO_SESSAO_LABEL = {
  teoria: "Teoria",
  exercicios: "Exercícios",
  revisao: "Revisão",
  simulado: "Simulado",
};

let MATERIAS = [];

// --------------------------------------------------------------------- util

async function api(path, options = {}) {
  const res = await fetch(API + path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || "Erro na requisição");
  }
  return res.status === 204 ? null : res.json();
}

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2200);
}

function fmtHoras(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h${String(m).padStart(2, "0")}`;
}

function fmtData(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function hoje() {
  return new Date().toISOString().slice(0, 10);
}

// --------------------------------------------------------------------- tabs

document.getElementById("tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
  btn.classList.add("active");
  document.getElementById("panel-" + btn.dataset.tab).classList.add("active");
  if (btn.dataset.tab === "metas") carregarMetas();
  if (btn.dataset.tab === "evolucao") carregarEvolucao();
});

// --------------------------------------------------------------------- materias

async function carregarMaterias() {
  MATERIAS = await api("/materias");
  const selects = [
    document.getElementById("sessao-materia"),
    document.getElementById("erro-materia"),
    document.getElementById("filtro-sessao-materia"),
    document.getElementById("filtro-erro-materia"),
  ];
  selects.forEach((sel) => {
    const isFiltro = sel.id.startsWith("filtro");
    const atual = sel.value;
    sel.innerHTML = isFiltro ? '<option value="">Todas</option>' : "";
    MATERIAS.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.nome;
      sel.appendChild(opt);
    });
    if (atual) sel.value = atual;
  });
  renderMaterias();
}

function renderMaterias() {
  const wrap = document.getElementById("lista-materias");
  if (!MATERIAS.length) {
    wrap.innerHTML = '<div class="vazio">Nenhuma matéria cadastrada ainda.</div>';
    return;
  }
  wrap.innerHTML = MATERIAS.map(
    (m) => `
    <div class="materia-row">
      <span class="materia-dot" style="background:${m.cor}"></span>
      <span class="materia-row__nome">${m.nome}</span>
      <span class="materia-row__meta">meta: ${m.meta_semanal_min ? fmtHoras(m.meta_semanal_min) + "/semana" : "—"}</span>
      <button class="btn btn--danger btn--small" data-del-materia="${m.id}">Excluir</button>
    </div>`
  ).join("");
}

document.getElementById("form-materia").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await api("/materias", {
      method: "POST",
      body: JSON.stringify({
        nome: fd.get("nome"),
        cor: fd.get("cor"),
        meta_semanal_min: Number(fd.get("meta_semanal_min") || 0),
      }),
    });
    e.target.reset();
    toast("Matéria adicionada.");
    await carregarMaterias();
    await carregarDashboard();
  } catch (err) {
    toast(err.message);
  }
});

document.getElementById("lista-materias").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-del-materia]");
  if (!btn) return;
  if (!confirm("Excluir esta matéria? Sessões e erros ligados a ela também serão removidos.")) return;
  await api(`/materias/${btn.dataset.delMateria}`, { method: "DELETE" });
  toast("Matéria excluída.");
  await carregarMaterias();
  await carregarSessoes();
  await carregarErros();
  await carregarDashboard();
});

// --------------------------------------------------------------------- sessoes

document.getElementById("form-sessao").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await api("/sessoes", {
      method: "POST",
      body: JSON.stringify({
        materia_id: Number(fd.get("materia_id")),
        data: fd.get("data"),
        duracao_min: Number(fd.get("duracao_min")),
        tipo: fd.get("tipo"),
        topico: fd.get("topico") || "",
        observacoes: fd.get("observacoes") || "",
        questoes_total: Number(fd.get("questoes_total") || 0),
        questoes_corretas: Number(fd.get("questoes_corretas") || 0),
      }),
    });
    e.target.reset();
    document.querySelector('#form-sessao input[name="data"]').value = hoje();
    toast("Sessão registrada.");
    await carregarSessoes();
    await carregarDashboard();
  } catch (err) {
    toast(err.message);
  }
});

async function carregarSessoes() {
  const materiaId = document.getElementById("filtro-sessao-materia").value;
  const sessoes = await api("/sessoes" + (materiaId ? `?materia_id=${materiaId}` : ""));
  const tbody = document.querySelector("#tabela-sessoes tbody");
  if (!sessoes.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="vazio">Nenhuma sessão registrada ainda.</td></tr>';
    return;
  }
  tbody.innerHTML = sessoes.map((s) => `
    <tr>
      <td>${fmtData(s.data)}</td>
      <td><span class="chip" style="background:${s.materia_cor}">${s.materia_nome}</span></td>
      <td>${TIPO_SESSAO_LABEL[s.tipo] || s.tipo}</td>
      <td>${s.topico || "—"}</td>
      <td>${fmtHoras(s.duracao_min)}</td>
      <td>${s.questoes_total > 0 ? `${s.questoes_corretas}/${s.questoes_total}` : "—"}</td>
      <td><button class="btn btn--danger btn--small" data-del-sessao="${s.id}">Excluir</button></td>
    </tr>
  `).join("");
}

document.getElementById("filtro-sessao-materia").addEventListener("change", carregarSessoes);

document.querySelector("#tabela-sessoes tbody").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-del-sessao]");
  if (!btn) return;
  await api(`/sessoes/${btn.dataset.delSessao}`, { method: "DELETE" });
  toast("Sessão excluída.");
  await carregarSessoes();
  await carregarDashboard();
});

// --------------------------------------------------------------------- erros

document.getElementById("form-erro").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await api("/erros", {
      method: "POST",
      body: JSON.stringify({
        materia_id: Number(fd.get("materia_id")),
        topico: fd.get("topico") || "",
        questao: fd.get("questao") || "",
        motivo: fd.get("motivo") || "",
        tipo_erro: fd.get("tipo_erro"),
      }),
    });
    e.target.reset();
    toast("Erro adicionado ao caderno. Primeira revisão em 1 dia.");
    await carregarErros();
    await carregarDashboard();
  } catch (err) {
    toast(err.message);
  }
});

function erroCardHTML(er) {
  const fases = [0, 1, 2].map((i) => `<span class="fase-dot ${i < er.fase ? "filled" : ""}"></span>`).join("");
  const vencida = !er.consolidado && er.proxima_revisao <= hoje();
  return `
    <div class="erro-card ${er.consolidado ? "consolidado" : ""}">
      <div class="erro-card__main">
        <div class="erro-card__top">
          <span class="chip" style="background:${er.materia_cor}">${er.materia_nome}</span>
          <span class="erro-card__topico">${er.topico || "(sem tópico)"}</span>
          <span class="stamp">${TIPO_ERRO_LABEL[er.tipo_erro] || er.tipo_erro}</span>
        </div>
        ${er.questao ? `<div class="erro-card__questao">${er.questao}</div>` : ""}
        ${er.motivo ? `<div class="erro-card__motivo">${er.motivo}</div>` : ""}
        <div class="erro-card__meta">
          registrado em ${fmtData(er.data_registro)} ·
          ${er.consolidado ? "consolidado ✓" : (vencida ? `revisão vencida (${fmtData(er.proxima_revisao)})` : `próxima revisão: ${fmtData(er.proxima_revisao)}`)}
        </div>
      </div>
      <div class="erro-card__actions">
        <div class="fase-dots">${fases}</div>
        ${er.consolidado ? "" : `<button class="btn btn--ghost btn--small" data-revisar="${er.id}">Marcar revisado</button>`}
        <button class="btn btn--danger btn--small" data-del-erro="${er.id}">Excluir</button>
      </div>
    </div>`;
}

async function carregarErros() {
  const materiaId = document.getElementById("filtro-erro-materia").value;
  const pendentes = document.getElementById("filtro-erro-pendentes").checked;
  const params = new URLSearchParams();
  if (materiaId) params.set("materia_id", materiaId);
  if (pendentes) params.set("apenas_pendentes", "true");
  const erros = await api("/erros" + (params.toString() ? "?" + params.toString() : ""));
  const wrap = document.getElementById("lista-erros");
  wrap.innerHTML = erros.length
    ? erros.map(erroCardHTML).join("")
    : '<div class="vazio">Nenhum erro encontrado com esse filtro.</div>';
}

document.getElementById("filtro-erro-materia").addEventListener("change", carregarErros);
document.getElementById("filtro-erro-pendentes").addEventListener("change", carregarErros);

document.getElementById("lista-erros").addEventListener("click", async (e) => {
  const revBtn = e.target.closest("[data-revisar]");
  const delBtn = e.target.closest("[data-del-erro]");
  if (revBtn) {
    await api(`/erros/${revBtn.dataset.revisar}/revisar`, { method: "POST" });
    toast("Revisão registrada.");
    await carregarErros();
    await carregarDashboard();
  } else if (delBtn) {
    await api(`/erros/${delBtn.dataset.delErro}`, { method: "DELETE" });
    toast("Erro excluído do caderno.");
    await carregarErros();
    await carregarDashboard();
  }
});

// --------------------------------------------------------------------- dashboard

let chartDias, chartMaterias;

async function carregarDashboard() {
  const d = await api("/dashboard");

  document.getElementById("streak-value").textContent = d.streak_dias;
  document.getElementById("stat-total-horas").textContent = fmtHoras(d.total_min);
  document.getElementById("stat-erros-pendentes").textContent = d.erros_pendentes_hoje;
  document.getElementById("stat-erros-consolidados").textContent = d.erros_consolidados;
  document.getElementById("stat-erros-total").textContent = d.erros_total;

  // gráfico de linha: minutos estudados por dia (14 dias)
  const ctxDias = document.getElementById("chart-dias");
  const labelsDias = d.ultimos_14_dias.map((x) => fmtData(x.data).slice(0, 5));
  const valoresDias = d.ultimos_14_dias.map((x) => x.minutos);
  if (chartDias) chartDias.destroy();
  chartDias = new Chart(ctxDias, {
    type: "line",
    data: {
      labels: labelsDias,
      datasets: [{
        data: valoresDias,
        borderColor: "#b8912a",
        backgroundColor: "rgba(184,145,42,.15)",
        fill: true,
        tension: 0.25,
        pointRadius: 3,
        pointBackgroundColor: "#232e1d",
      }],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        y: { ticks: { callback: (v) => fmtHoras(v), font: { family: "JetBrains Mono", size: 10 } }, grid: { color: "#e3ddc6" } },
        x: { grid: { display: false }, ticks: { font: { size: 10 } } },
      },
    },
  });

  // gráfico de rosca: distribuição de minutos por matéria
  const ctxMat = document.getElementById("chart-materias");
  const comHoras = d.por_materia.filter((m) => m.total_min > 0);
  if (chartMaterias) chartMaterias.destroy();
  chartMaterias = new Chart(ctxMat, {
    type: "doughnut",
    data: {
      labels: comHoras.map((m) => m.nome),
      datasets: [{
        data: comHoras.map((m) => m.total_min),
        backgroundColor: comHoras.map((m) => m.cor),
        borderColor: "#f7f3e8",
        borderWidth: 2,
      }],
    },
    options: {
      plugins: { legend: { position: "bottom", labels: { font: { size: 11 }, boxWidth: 12 } } },
    },
  });
  if (!comHoras.length) {
    ctxMat.getContext("2d").font = "13px sans-serif";
  }

  // metas semanais
  const metasWrap = document.getElementById("metas-lista");
  const comMeta = d.por_materia.filter((m) => m.meta_semanal_min > 0);
  metasWrap.innerHTML = comMeta.length
    ? comMeta.map((m) => {
        const pct = Math.min(100, Math.round((m.min_semana / m.meta_semanal_min) * 100));
        return `
        <div class="meta-item">
          <span class="meta-item__nome">${m.nome}</span>
          <span class="meta-item__bar"><span class="meta-item__fill" style="width:${pct}%;background:${m.cor}"></span></span>
          <span class="meta-item__txt">${fmtHoras(m.min_semana)} / ${fmtHoras(m.meta_semanal_min)} (${pct}%)</span>
        </div>`;
      }).join("")
    : '<div class="vazio">Defina metas semanais nas matérias para acompanhar aqui.</div>';

  // revisões vencidas
  const erros = await api("/erros?apenas_pendentes=true");
  const revWrap = document.getElementById("dashboard-revisoes");
  revWrap.innerHTML = erros.length
    ? erros.slice(0, 8).map(erroCardHTML).join("")
    : '<div class="vazio">Nenhuma revisão pendente hoje. 🎯</div>';
}

document.getElementById("dashboard-revisoes").addEventListener("click", async (e) => {
  const revBtn = e.target.closest("[data-revisar]");
  if (!revBtn) return;
  await api(`/erros/${revBtn.dataset.revisar}/revisar`, { method: "POST" });
  toast("Revisão registrada.");
  await carregarDashboard();
  await carregarErros();
});

// --------------------------------------------------------------------- metas

async function carregarMetas() {
  await Promise.all([renderCountdown(), renderMetaGeralForm(), renderMetasMaterias()]);
}

async function renderCountdown() {
  const d = await api("/dashboard");
  const box = document.getElementById("prova-countdown");
  if (d.dias_para_prova === null || d.dias_para_prova === undefined) {
    box.innerHTML = '<div class="vazio">Defina a data da prova abaixo para ver a contagem regressiva.</div>';
    return;
  }
  const dias = d.dias_para_prova;
  const texto = dias > 0 ? `dia${dias === 1 ? "" : "s"} até a prova` : (dias === 0 ? "é hoje!" : "dias desde a prova");
  box.innerHTML = `
    <div class="countdown-box">
      <span class="countdown-box__num">${Math.abs(dias)}</span>
      <span class="countdown-box__label">${texto}</span>
      <span class="countdown-box__data">${fmtData(d.meta_geral.data_prova)}</span>
    </div>`;

  // progresso da semana atual (usa o mesmo /dashboard já buscado)
  const mg = d.meta_geral;
  const sa = d.semana_atual;
  const linhas = [];
  if (mg.horas_semana_min > 0) {
    const pct = Math.min(100, Math.round((sa.minutos / mg.horas_semana_min) * 100));
    linhas.push(metaLinhaHTML("Horas", fmtHoras(sa.minutos), fmtHoras(mg.horas_semana_min), pct, "#b8912a"));
  }
  if (mg.questoes_semana > 0) {
    const pct = Math.min(100, Math.round((sa.questoes_total / mg.questoes_semana) * 100));
    linhas.push(metaLinhaHTML("Questões", sa.questoes_total, mg.questoes_semana, pct, "#5c6e3f"));
  }
  if (mg.dias_semana > 0) {
    const pct = Math.min(100, Math.round((sa.dias_estudados / mg.dias_semana) * 100));
    linhas.push(metaLinhaHTML("Dias de estudo", sa.dias_estudados, mg.dias_semana, pct, "#4a6d8c"));
  }
  document.getElementById("metas-progresso-semana").innerHTML = linhas.length
    ? linhas.join("")
    : '<div class="vazio">Defina metas gerais abaixo para acompanhar seu progresso semanal.</div>';
}

function metaLinhaHTML(nome, atual, meta, pct, cor) {
  return `
    <div class="meta-item">
      <span class="meta-item__nome">${nome}</span>
      <span class="meta-item__bar"><span class="meta-item__fill" style="width:${pct}%;background:${cor}"></span></span>
      <span class="meta-item__txt">${atual} / ${meta} (${pct}%)</span>
    </div>`;
}

async function renderMetaGeralForm() {
  const mg = await api("/meta-geral");
  const form = document.getElementById("form-meta-geral");
  form.querySelector('[name="horas_semana"]').value = mg.horas_semana_min ? (mg.horas_semana_min / 60) : "";
  form.querySelector('[name="questoes_semana"]').value = mg.questoes_semana || "";
  form.querySelector('[name="dias_semana"]').value = mg.dias_semana || "";
  form.querySelector('[name="data_prova"]').value = mg.data_prova || "";
}

document.getElementById("form-meta-geral").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await api("/meta-geral", {
      method: "PUT",
      body: JSON.stringify({
        horas_semana_min: Math.round(Number(fd.get("horas_semana") || 0) * 60),
        questoes_semana: Number(fd.get("questoes_semana") || 0),
        dias_semana: Number(fd.get("dias_semana") || 0),
        data_prova: fd.get("data_prova") || null,
      }),
    });
    toast("Metas gerais salvas.");
    await carregarMetas();
    await carregarDashboard();
  } catch (err) {
    toast(err.message);
  }
});

async function renderMetasMaterias() {
  const materias = await api("/materias");
  const wrap = document.getElementById("metas-materias-lista");
  if (!materias.length) {
    wrap.innerHTML = '<div class="vazio">Cadastre matérias na aba Matérias primeiro.</div>';
    return;
  }
  wrap.innerHTML = materias.map((m) => `
    <div class="materia-meta-row" data-materia-id="${m.id}">
      <span class="materia-dot" style="background:${m.cor}"></span>
      <span class="materia-meta-row__nome">${m.nome}</span>
      <input type="number" min="0" step="5" class="meta-input-min" value="${m.meta_semanal_min ? m.meta_semanal_min / 60 : ""}" placeholder="horas/sem">
      <input type="number" min="0" class="meta-input-questoes" value="${m.meta_questoes_semanal || ""}" placeholder="questões/sem">
      <button class="btn btn--ghost btn--small" data-salvar-meta="${m.id}">Salvar</button>
    </div>
  `).join("");
}

document.getElementById("metas-materias-lista").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-salvar-meta]");
  if (!btn) return;
  const row = btn.closest(".materia-meta-row");
  const horas = Number(row.querySelector(".meta-input-min").value || 0);
  const questoes = Number(row.querySelector(".meta-input-questoes").value || 0);
  await api(`/materias/${btn.dataset.salvarMeta}`, {
    method: "PUT",
    body: JSON.stringify({
      meta_semanal_min: Math.round(horas * 60),
      meta_questoes_semanal: questoes,
    }),
  });
  toast("Meta da matéria salva.");
  await carregarDashboard();
});

// --------------------------------------------------------------------- evolução

let chartEvoHoras, chartEvoAcerto, chartEvoDias, chartEvoErros;

document.getElementById("evolucao-periodo").addEventListener("change", carregarEvolucao);

async function carregarEvolucao() {
  const semanas = document.getElementById("evolucao-periodo").value;
  const dados = await api(`/evolucao?semanas=${semanas}`);
  const labels = dados.map((s) => fmtData(s.semana_inicio).slice(0, 5));

  chartEvoHoras = redesenharLinha(chartEvoHoras, "chart-evolucao-horas", labels,
    dados.map((s) => s.minutos), "#b8912a", (v) => fmtHoras(v));

  chartEvoAcerto = redesenharLinha(chartEvoAcerto, "chart-evolucao-acerto", labels,
    dados.map((s) => s.taxa_acerto), "#5c6e3f", (v) => v + "%", true);

  const ctxDias = document.getElementById("chart-evolucao-dias");
  if (chartEvoDias) chartEvoDias.destroy();
  chartEvoDias = new Chart(ctxDias, {
    type: "bar",
    data: { labels, datasets: [{ data: dados.map((s) => s.dias_estudados), backgroundColor: "#4a6d8c" }] },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, max: 7, ticks: { stepSize: 1, font: { size: 10 } }, grid: { color: "#e3ddc6" } },
        x: { grid: { display: false }, ticks: { font: { size: 10 } } },
      },
    },
  });

  const ctxErros = document.getElementById("chart-evolucao-erros");
  if (chartEvoErros) chartEvoErros.destroy();
  chartEvoErros = new Chart(ctxErros, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Registrados", data: dados.map((s) => s.erros_registrados), backgroundColor: "#9c3f2c" },
        { label: "Consolidados", data: dados.map((s) => s.erros_consolidados), backgroundColor: "#5c6e3f" },
      ],
    },
    options: {
      plugins: { legend: { position: "bottom", labels: { font: { size: 11 }, boxWidth: 12 } } },
      scales: {
        y: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 10 } }, grid: { color: "#e3ddc6" } },
        x: { grid: { display: false }, ticks: { font: { size: 10 } } },
      },
    },
  });

  const tbody = document.querySelector("#tabela-evolucao tbody");
  tbody.innerHTML = dados.slice().reverse().map((s) => `
    <tr>
      <td>${fmtData(s.semana_inicio)} – ${fmtData(s.semana_fim)}</td>
      <td>${fmtHoras(s.minutos)}</td>
      <td>${s.dias_estudados}</td>
      <td>${s.questoes_total}</td>
      <td>${s.taxa_acerto === null ? "—" : s.taxa_acerto + "%"}</td>
      <td>${s.erros_registrados}</td>
      <td>${s.erros_consolidados}</td>
    </tr>
  `).join("");
}

function redesenharLinha(chartRef, canvasId, labels, valores, cor, formatador, pularNulos = false) {
  const ctx = document.getElementById(canvasId);
  if (chartRef) chartRef.destroy();
  return new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        data: valores,
        borderColor: cor,
        backgroundColor: cor + "26",
        fill: true,
        tension: 0.25,
        pointRadius: 3,
        pointBackgroundColor: "#232e1d",
        spanGaps: pularNulos,
      }],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { callback: formatador, font: { family: "JetBrains Mono", size: 10 } }, grid: { color: "#e3ddc6" } },
        x: { grid: { display: false }, ticks: { font: { size: 10 } } },
      },
    },
  });
}

// --------------------------------------------------------------------- init

(async function init() {
  document.querySelector('#form-sessao input[name="data"]').value = hoje();
  await carregarMaterias();
  await carregarSessoes();
  await carregarErros();
  await carregarDashboard();
})();
