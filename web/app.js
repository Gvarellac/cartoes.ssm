// Sistema de Cartões de Estacionamento – SSM Bagé
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const main = $('#conteudo');
  const avisoIni = document.getElementById('aviso-inicial'); if (avisoIni) avisoIni.remove();
  let EU = null, CFG = {};

  // ---------- utilidades
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const br = iso => { if (!iso) return '—'; const d = String(iso).slice(0, 10).split('-'); return d.length === 3 ? `${d[2]}/${d[1]}/${d[0]}` : iso; };
  const brh = s => s ? `${br(s)} ${String(s).slice(11, 16)}` : '—';
  const SIT = { ativo: 'VÁLIDO', vencido: 'VENCIDO', suspenso: 'SUSPENSO', cassado: 'CASSADO', invalido: 'NÃO RECONHECIDO' };
  const badge = s => `<span class="badge s-${esc(s)}">${SIT[s] || esc(s)}</span>`;
  const tipoB = t => `<span class="badge t-${t}">${t === 'idoso' ? 'Idoso 60+' : 'PcD'}</span>`;
  const pode = (...p) => EU && p.includes(EU.perfil);
  const reg = n => (n === null || n === undefined || n === '') ? '' : Number(n).toLocaleString('pt-BR');

  function toast(msg, erro) {
    const t = $('#toast'); t.textContent = msg; t.className = 'on' + (erro ? ' err' : '');
    clearTimeout(t._t); t._t = setTimeout(() => t.className = '', 3500);
  }

  async function api(metodo, caminho, corpo) {
    const r = await fetch('/api/' + caminho, {
      method: metodo, headers: corpo ? { 'Content-Type': 'application/json' } : {},
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    let d = {}; try { d = await r.json(); } catch (e) {}
    if (r.status === 401 && caminho !== 'login') { mostrarLogin(); throw new Error(d.erro || 'Sessão expirada'); }
    if (!r.ok) throw new Error(d.erro || 'Erro ' + r.status);
    return d;
  }

  function dialogo(titulo, corpoHtml, okTexto = 'Confirmar', okClasse = 'primario') {
    const dlg = $('#dlg');
    $('#dlg-titulo').textContent = titulo;
    $('#dlg-corpo').innerHTML = corpoHtml;
    $('#dlg-ok').textContent = okTexto; $('#dlg-ok').className = 'btn ' + okClasse;
    dlg.showModal();
    return new Promise(res => dlg.addEventListener('close', () => {
      const dados = {}; $$('#dlg-corpo [name]').forEach(i => dados[i.name] = i.value);
      res(dlg.returnValue === 'ok' ? dados : null);
    }, { once: true }));
  }

  // ---------- login / sessão
  function mostrarLogin() { $('#app').hidden = true; $('#tela-login').hidden = false; }

  $('#form-login').addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api('POST', 'login', { login: f.get('login'), senha: f.get('senha') });
      e.target.reset(); $('#erro-login').textContent = '';
      iniciar();
    } catch (err) { $('#erro-login').textContent = err.message; }
  });
  $('#sair').addEventListener('click', async e => { e.preventDefault(); await api('POST', 'logout'); location.hash = ''; mostrarLogin(); });

  async function iniciar() {
    try { EU = await api('GET', 'me'); } catch (e) { return mostrarLogin(); }
    CFG = await api('GET', 'config');
    $('#tela-login').hidden = true; $('#app').hidden = false;
    $('#usuario-nome').textContent = `${EU.nome} (${{ admin: 'Administrador', atendente: 'Atendente', fiscal: 'Fiscal' }[EU.perfil]})`;
    const itens = [
      ['painel', 'Painel', ['admin', 'atendente', 'fiscal']],
      ['novo', 'Novo cadastro', ['admin', 'atendente']],
      ['lista', 'Beneficiários', ['admin', 'atendente', 'fiscal']],
      ['fiscalizacao', 'Fiscalização', ['admin', 'atendente', 'fiscal']],
      ['usuarios', 'Usuários', ['admin']],
      ['config', 'Configurações', ['admin']],
    ];
    $('#nav').innerHTML = itens.filter(i => i[2].includes(EU.perfil)).map(i => `<a href="#/${i[0]}" data-r="${i[0]}">${i[1]}</a>`).join('');
    if (EU.trocar_senha) location.hash = '#/senha';
    rotear();
  }

  window.addEventListener('hashchange', rotear);
  function rotear() {
    if (!EU) return;
    const [, r = 'painel', id] = location.hash.split('/');
    if (EU.trocar_senha && r !== 'senha') { location.hash = '#/senha'; return; }
    $$('#nav a').forEach(a => a.classList.toggle('ativo', a.dataset.r === r || (r === 'b' && a.dataset.r === 'lista') || (r === 'editar' && a.dataset.r === 'lista')));
    const telas = { painel, novo: () => formulario(), editar: () => formulario(id), lista, b: () => detalhe(id), fiscalizacao, usuarios, config, senha };
    (telas[r] || painel)();
    window.scrollTo(0, 0);
  }

  // ---------- PAINEL
  async function painel() {
    main.innerHTML = '<h1>Painel</h1><p class="sub">Carregando…</p>';
    const [p, cons] = await Promise.all([api('GET', 'painel'), api('GET', 'consultas?limite=8')]);
    main.innerHTML = `
      <h1>Painel</h1><p class="sub">Cartões de Estacionamento – Vaga Especial · ${esc(CFG.orgao_expedidor)} ${esc(CFG.municipio)}/${esc(CFG.uf)}</p>
      <div class="cards">
        <div class="num"><b>${p.total}</b><span>Cartões cadastrados</span></div>
        <div class="num"><b>${p.idoso}</b><span>Idosos (60+)</span></div>
        <div class="num"><b>${p.pcd}</b><span>Pessoas com deficiência</span></div>
        <div class="num v"><b>${p.ativo}</b><span>Válidos</span></div>
        <div class="num l"><b>${p.vencendo}</b><span>Vencem em 30 dias</span></div>
        <div class="num r"><b>${p.vencido}</b><span>Vencidos</span></div>
        <div class="num l"><b>${p.suspenso}</b><span>Suspensos</span></div>
        <div class="num r"><b>${p.cassado}</b><span>Cassados</span></div>
        <div class="num"><b>${p.consultas_hoje}</b><span>Consultas de QR hoje</span></div>
        <div class="num r"><b>${p.invalidas_hoje}</b><span>Consultas irregulares hoje</span></div>
      </div>
      ${pode('admin', 'atendente') ? '<div class="acoes"><a class="btn primario" href="#/novo">+ Novo cadastro</a><a class="btn" href="#/lista">Buscar beneficiário</a></div>' : ''}
      <div class="painel"><h2>Últimas consultas de fiscalização</h2>${tabelaConsultas(cons)}</div>`;
  }

  function tabelaConsultas(lista, comNome = true) {
    if (!lista.length) return '<div class="vazio">Nenhuma consulta registrada ainda.</div>';
    return `<div class="tabela"><table><thead><tr><th>Data/hora</th>${comNome ? '<th>Beneficiário</th><th>Registro</th>' : ''}<th>Resultado</th><th>Agente</th><th>Origem</th></tr></thead><tbody>
      ${lista.map(c => `<tr><td>${brh(c.data)}</td>${comNome ? `<td>${esc(c.nome || '— QR não reconhecido —')}</td><td>${esc(reg(c.registro))}</td>` : ''}
      <td>${badge(c.resultado)}</td><td>${esc(c.agente || 'não identificado')}</td><td>${esc(c.origem || '')} ${esc(c.ip || '')}</td></tr>`).join('')}
      </tbody></table></div>`;
  }

  // ---------- LISTA
  async function lista() {
    main.innerHTML = `
      <h1>Beneficiários</h1><p class="sub">Busque por nome, CPF ou nº de registro.</p>
      <div class="barra">
        <input id="q" placeholder="Nome, CPF ou nº do registro" autofocus>
        <select id="ft"><option value="">Todos os tipos</option><option value="idoso">Idoso 60+</option><option value="pcd">PcD</option></select>
        <select id="fs"><option value="">Todas as situações</option><option value="ativo">Válidos</option><option value="vencido">Vencidos</option><option value="suspenso">Suspensos</option><option value="cassado">Cassados</option></select>
        ${pode('admin') ? '<a class="btn" href="/api/exportar.csv">Exportar planilha</a>' : ''}
      </div>
      <div id="res"></div>`;
    let t;
    const buscar = async () => {
      const q = encodeURIComponent($('#q').value.trim());
      const l = await api('GET', `beneficiarios?q=${q}&tipo=${$('#ft').value}&situacao=${$('#fs').value}`);
      $('#res').innerHTML = !l.length ? '<div class="painel vazio">Nenhum beneficiário encontrado.</div>' :
        `<div class="tabela"><table><thead><tr><th>Registro</th><th>Nome</th><th>CPF</th><th>Tipo</th><th>Validade</th><th>Situação</th></tr></thead><tbody>
        ${l.map(b => `<tr class="link" data-id="${b.id}"><td><b>${reg(b.registro)}</b></td><td>${esc(b.nome)}</td><td>${esc(b.cpf)}</td><td>${tipoB(b.tipo)}</td><td>${br(b.validade)}</td><td>${badge(b.situacao)}</td></tr>`).join('')}
        </tbody></table></div><p class="sub" style="margin-top:8px">${l.length} resultado(s)</p>`;
      $$('#res tr.link').forEach(tr => tr.addEventListener('click', () => location.hash = '#/b/' + tr.dataset.id));
    };
    $('#q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(buscar, 250); });
    $('#ft').addEventListener('change', buscar); $('#fs').addEventListener('change', buscar);
    buscar();
  }

  // ---------- FORMULÁRIO
  const ufs = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');
  async function formulario(id) {
    let b = { tipo: '', cidade: 'BAGÉ', uf: 'RS' };
    if (id) b = await api('GET', 'beneficiarios/' + id);
    const v = k => esc(b[k] ?? '');
    main.innerHTML = `
      <h1>${id ? 'Editar cadastro' : 'Novo cadastro'}</h1>
      <p class="sub">${id ? `Registro nº ${reg(b.registro)} · ${esc(b.nome)}` : 'O nº de registro, a data de emissão e o QR Code são gerados automaticamente ao salvar.'}</p>
      <form id="fb" autocomplete="off">
        <div class="painel"><h2>Tipo de cartão</h2>
          <div class="tipos">
            <label class="tipo"><input type="radio" name="tipo" value="idoso" ${b.tipo === 'idoso' ? 'checked' : ''} ${id ? 'disabled' : ''}>
              <div><b>Idoso (60 anos ou mais)</b><span>Resolução CONTRAN nº 303/08 · validade ${esc(CFG.validade_anos_idoso)} anos</span></div></label>
            <label class="tipo"><input type="radio" name="tipo" value="pcd" ${b.tipo === 'pcd' ? 'checked' : ''} ${id ? 'disabled' : ''}>
              <div><b>Pessoa com deficiência</b><span>Resolução CONTRAN nº 304/08 · exige laudo médico</span></div></label>
          </div>
        </div>
        <div class="painel"><h2>Dados pessoais</h2><div class="grade">
          <label class="c8 req">Nome completo<input name="nome" value="${v('nome')}" required></label>
          <label class="c4 req">CPF<input name="cpf" value="${v('cpf')}" placeholder="000.000.000-00" required></label>
          <label class="c4 req">Data de nascimento<input type="date" name="data_nascimento" value="${v('data_nascimento')}" required><small id="idade"></small></label>
          <label class="c4">Sexo<select name="sexo"><option></option>${['Feminino', 'Masculino', 'Outro'].map(s => `<option ${b.sexo === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
          <label class="c4">Telefone<input name="telefone" value="${v('telefone')}" placeholder="(53) 00000-0000"></label>
          <label class="c8">E-mail<input type="email" name="email" value="${v('email')}"></label>
        </div></div>
        <div class="painel"><h2>Endereço</h2><div class="grade">
          <label class="c3">CEP<input name="cep" value="${v('cep')}" placeholder="96400-000"></label>
          <label class="c6">Logradouro<input name="logradouro" value="${v('logradouro')}"></label>
          <label class="c3">Número<input name="numero" value="${v('numero')}"></label>
          <label class="c3">Complemento<input name="complemento" value="${v('complemento')}"></label>
          <label class="c4">Bairro<input name="bairro" value="${v('bairro')}"></label>
          <label class="c3">Cidade<input name="cidade" value="${v('cidade')}"></label>
          <label class="c2">UF<select name="uf">${ufs.map(u => `<option ${b.uf === u ? 'selected' : ''}>${u}</option>`).join('')}</select></label>
        </div></div>
        <div class="painel" id="bloco-pcd"><h2>Laudo médico (PcD)</h2><div class="grade">
          <label class="c6 req">Tipo de deficiência<select name="deficiencia_tipo"><option></option>
            ${['Física', 'Visual', 'Auditiva', 'Intelectual', 'Múltipla', 'Transtorno do Espectro Autista (TEA)', 'Mobilidade reduzida', 'Outra'].map(s => `<option ${b.deficiencia_tipo === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
          <label class="c3">CID<input name="cid" value="${v('cid')}" placeholder="Ex.: G80"></label>
          <label class="c3">Data do laudo<input type="date" name="data_laudo" value="${v('data_laudo')}"></label>
          <label class="c6">Médico responsável<input name="medico_nome" value="${v('medico_nome')}"></label>
          <label class="c3">CRM<input name="medico_crm" value="${v('medico_crm')}"></label>
          <label class="c3">Condição<select name="laudo_temporario"><option value="0">Permanente</option><option value="1" ${b.laudo_temporario ? 'selected' : ''}>Temporária</option></select></label>
          <label class="c12">Anexar laudo (PDF, JPG ou PNG, até 15 MB) ${b.laudo_arquivo ? '<small>– já existe um laudo anexado; envie outro só se quiser substituir</small>' : ''}<input type="file" name="laudo" accept=".pdf,.jpg,.jpeg,.png"></label>
        </div></div>
        <div class="painel"><h2>Responsável / representante legal <small style="font-weight:normal;color:#667085">(opcional)</small></h2><div class="grade">
          <label class="c5">Nome<input name="responsavel_nome" value="${v('responsavel_nome')}"></label>
          <label class="c3">CPF<input name="responsavel_cpf" value="${v('responsavel_cpf')}"></label>
          <label class="c2">Parentesco<input name="responsavel_parentesco" value="${v('responsavel_parentesco')}"></label>
          <label class="c2">Telefone<input name="responsavel_telefone" value="${v('responsavel_telefone')}"></label>
        </div></div>
        <div class="painel"><h2>Observações e validade</h2><div class="grade">
          <label class="c9">Observações internas<textarea name="observacoes">${v('observacoes')}</textarea></label>
          ${id ? '' : `<label class="c3">Validade do cartão<input type="date" name="validade"><small>Em branco = ${esc(CFG.validade_anos_idoso)} anos (idoso) / ${esc(CFG.validade_anos_pcd)} anos (PcD). Para deficiência temporária, informe a data.</small></label>`}
        </div></div>
        <div class="erro" id="erro-form"></div>
        <div class="acoes"><button class="btn primario" type="submit">${id ? 'Salvar alterações' : 'Salvar e gerar cartão'}</button>
        <a class="btn" href="${id ? '#/b/' + id : '#/painel'}">Cancelar</a></div>
      </form>`;

    const f = $('#fb');
    const atualizaTipo = () => {
      const t = (f.querySelector('[name=tipo]:checked') || {}).value;
      $$('.tipo').forEach(l => l.classList.toggle('sel', l.querySelector('input').checked));
      $('#bloco-pcd').hidden = t !== 'pcd';
    };
    $$('[name=tipo]', f).forEach(r => r.addEventListener('change', atualizaTipo)); atualizaTipo();
    const idade = () => {
      const d = f.data_nascimento.value; if (!d) return $('#idade').textContent = '';
      const n = new Date(d + 'T00:00'), h = new Date();
      let a = h.getFullYear() - n.getFullYear(); if (h < new Date(h.getFullYear(), n.getMonth(), n.getDate())) a--;
      $('#idade').textContent = a + ' anos';
    };
    f.data_nascimento.addEventListener('change', idade); idade();
    f.cpf.addEventListener('input', () => {
      let d = f.cpf.value.replace(/\D/g, '').slice(0, 11);
      f.cpf.value = d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4');
    });

    f.addEventListener('submit', async e => {
      e.preventDefault();
      const dados = {};
      $$('input,select,textarea', f).forEach(i => { if (i.name && i.type !== 'file' && i.type !== 'radio') dados[i.name] = i.value.trim(); });
      dados.tipo = id ? b.tipo : (f.querySelector('[name=tipo]:checked') || {}).value;
      const arq = f.laudo.files[0];
      if (arq) {
        if (arq.size > 15 * 1024 * 1024) return $('#erro-form').textContent = 'O laudo tem mais de 15 MB.';
        dados.laudo = { nome: arq.name, dados: await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(arq); }) };
      }
      const btn = f.querySelector('[type=submit]'); btn.disabled = true;
      try {
        if (id) { await api('PUT', 'beneficiarios/' + id, dados); toast('Cadastro atualizado.'); location.hash = '#/b/' + id; }
        else { const r = await api('POST', 'beneficiarios', dados); toast(`Cartão nº ${reg(r.registro)} gerado.`); location.hash = '#/b/' + r.id; }
      } catch (err) { $('#erro-form').textContent = err.message; btn.disabled = false; }
    });
  }

  // ---------- DETALHE
  async function detalhe(id) {
    const b = await api('GET', 'beneficiarios/' + id);
    const gestor = pode('admin', 'atendente');
    const linha = (k, val) => `<div><span>${k}</span><b>${esc(val) || '—'}</b></div>`;
    const avisos = [];
    if (b.situacao === 'vencido') avisos.push('<div class="aviso r">Cartão <b>vencido</b>. Para continuar usando a vaga, o beneficiário precisa renovar.</div>');
    if (b.situacao === 'suspenso' || b.situacao === 'cassado') avisos.push(`<div class="aviso r">Cartão <b>${b.situacao}</b>. Motivo: ${esc(b.motivo_status || '—')}</div>`);
    main.innerHTML = `
      <div class="cab">
        <div><h1>${esc(b.nome)}</h1>
        <p class="sub">${tipoB(b.tipo)} &nbsp; Registro nº <b>${reg(b.registro)}</b> · ${b.via}ª via · ${badge(b.situacao)}</p></div>
        ${b.link_qr ? `<div class="qrprev">${QRSvg(b.link_qr, 'M', 2)}<small>${esc(b.link_qr)}</small></div>` : ''}
      </div>
      ${avisos.join('')}
      <div class="acoes">
        ${gestor && b.situacao !== 'suspenso' && b.situacao !== 'cassado' ? `<a class="btn primario" href="/cartao.html?id=${b.id}" target="_blank">Imprimir cartão</a>` : ''}
        ${gestor ? `<a class="btn" href="#/editar/${b.id}">Editar dados</a>` : ''}
        ${gestor && b.status !== 'cassado' ? '<button class="btn" data-a="renovar">Renovar</button><button class="btn" data-a="segunda-via">Emitir 2ª via</button>' : ''}
        ${gestor && b.status === 'ativo' ? '<button class="btn alerta" data-a="suspenso">Suspender</button>' : ''}
        ${pode('admin') && b.status !== 'cassado' ? '<button class="btn perigo" data-a="cassado">Cassar</button>' : ''}
        ${(b.status === 'suspenso' && gestor) || (b.status === 'cassado' && pode('admin')) ? '<button class="btn" data-a="ativo">Reativar</button>' : ''}
        ${gestor && b.laudo_arquivo ? `<a class="btn" href="/api/beneficiarios/${b.id}/laudo" target="_blank">Ver laudo</a>` : ''}
      </div>
      <div class="painel"><h2>Cartão</h2><div class="dados">
        ${linha('Data de emissão', br(b.data_emissao))}${linha('Validade', br(b.validade))}${linha('Via', b.via + 'ª')}
        ${linha('Órgão expedidor', CFG.orgao_expedidor)}
      </div></div>
      ${b.cpf !== undefined ? `
      <div class="painel"><h2>Dados pessoais</h2><div class="dados">
        ${linha('CPF', b.cpf)}${linha('Nascimento', br(b.data_nascimento))}${linha('Sexo', b.sexo)}
        ${linha('Telefone', b.telefone)}${linha('E-mail', b.email)}
        ${linha('Endereço', [b.logradouro, b.numero, b.complemento].filter(Boolean).join(', '))}${linha('Bairro', b.bairro)}
        ${linha('Cidade/UF', [b.cidade, b.uf].filter(Boolean).join('/'))}${linha('CEP', b.cep)}
      </div></div>
      ${b.tipo === 'pcd' ? `<div class="painel"><h2>Laudo médico</h2><div class="dados">
        ${linha('Tipo de deficiência', b.deficiencia_tipo)}${linha('CID', b.cid)}${linha('Médico', b.medico_nome)}${linha('CRM', b.medico_crm)}
        ${linha('Data do laudo', br(b.data_laudo))}${linha('Condição', b.laudo_temporario ? 'Temporária' : 'Permanente')}${linha('Arquivo', b.laudo_arquivo ? 'anexado' : 'não anexado')}
      </div></div>` : ''}
      ${b.responsavel_nome ? `<div class="painel"><h2>Responsável</h2><div class="dados">
        ${linha('Nome', b.responsavel_nome)}${linha('CPF', b.responsavel_cpf)}${linha('Parentesco', b.responsavel_parentesco)}${linha('Telefone', b.responsavel_telefone)}</div></div>` : ''}
      ${b.observacoes ? `<div class="painel"><h2>Observações</h2><p style="margin:0;white-space:pre-wrap">${esc(b.observacoes)}</p></div>` : ''}
      <div class="painel"><h2>Histórico</h2>${!b.historico.length ? '<div class="vazio">Sem registros.</div>' :
        `<div class="tabela"><table><thead><tr><th>Data/hora</th><th>Ação</th><th>Detalhe</th><th>Usuário</th></tr></thead><tbody>
        ${b.historico.map(h => `<tr><td>${brh(h.data)}</td><td><b>${esc(h.acao)}</b></td><td>${esc(h.detalhe)}</td><td>${esc(h.usuario)}</td></tr>`).join('')}</tbody></table></div>`}</div>` : ''}
      <div class="painel"><h2>Consultas de fiscalização deste cartão</h2>${tabelaConsultas(b.consultas, false)}</div>`;

    $$('[data-a]').forEach(btn => btn.addEventListener('click', async () => {
      const a = btn.dataset.a;
      let dados;
      if (a === 'renovar') {
        dados = await dialogo('Renovar cartão', `<p>Gera nova data de emissão e nova validade. <b>O QR do cartão atual deixa de valer</b> – entregue o novo cartão impresso.</p>
          <label>Nova validade <small>(em branco = ${esc(b.tipo === 'idoso' ? CFG.validade_anos_idoso : CFG.validade_anos_pcd)} anos a partir de hoje)</small></label><input type="date" name="validade">`, 'Renovar');
        if (dados && !dados.validade) delete dados.validade;
      } else if (a === 'segunda-via') {
        dados = await dialogo('Emitir 2ª via', `<p>Use em caso de perda, roubo ou dano. <b>O QR da via anterior deixa de valer</b> e aparecerá como "não reconhecido" na fiscalização.</p>
          <label>Motivo</label><select name="motivo"><option>Perda</option><option>Roubo/furto</option><option>Dano/desgaste</option><option>Correção de dados</option></select>`, 'Emitir');
      } else {
        const t = { suspenso: 'Suspender cartão', cassado: 'Cassar cartão', ativo: 'Reativar cartão' }[a];
        const opc = ['2.1 – Empréstimo do cartão a terceiros', '2.2 – Uso de cópia do cartão', '2.3 – Porte do cartão com rasuras ou falsificado',
          '2.4 – Uso em desacordo (veículo não transportava o beneficiário)', 'Falecimento do beneficiário', 'Solicitação do beneficiário', 'Outro'];
        dados = await dialogo(t, a === 'ativo' ? '<label>Observação</label><input name="motivo" placeholder="Opcional">' :
          `<label>Enquadramento</label><select name="base">${opc.map(o => `<option>${o}</option>`).join('')}</select>
           <label>Descrição / nº do auto</label><textarea name="desc" placeholder="Descreva o ocorrido"></textarea>`, t.split(' ')[0], a === 'ativo' ? 'primario' : 'perigo');
        if (dados) dados = { status: a, motivo: a === 'ativo' ? dados.motivo : `${dados.base}${dados.desc ? ' – ' + dados.desc : ''}` };
      }
      if (!dados) return;
      try {
        await api('POST', `beneficiarios/${id}/${a === 'renovar' || a === 'segunda-via' ? a : 'status'}`, dados);
        toast('Feito.'); detalhe(id);
        if (a === 'renovar' || a === 'segunda-via') setTimeout(() => window.open('/cartao.html?id=' + id, '_blank'), 300);
      } catch (e) { toast(e.message, true); }
    }));
  }

  // ---------- FISCALIZAÇÃO
  async function fiscalizacao() {
    main.innerHTML = `
      <h1>Fiscalização</h1>
      <p class="sub">Aponte a câmera do celular para o QR do cartão – a página de consulta abre sozinha e a consulta fica registrada aqui.
      Sem QR legível, consulte pelo nº de registro.</p>
      <div class="painel"><h2>Consultar pelo nº de registro ou nome</h2>
        <div class="barra"><input id="fq" placeholder="Nº do registro ou nome"><select id="ftp"><option value="">Idoso e PcD</option><option value="idoso">Idoso</option><option value="pcd">PcD</option></select>
        <button class="btn primario" id="fb">Consultar</button></div><div id="fres"></div></div>
      <div class="painel"><h2>Consultas registradas</h2>
        <div class="barra"><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="irreg" style="width:auto"> só irregulares (vencido, suspenso, cassado, não reconhecido)</label></div>
        <div id="flog"></div></div>`;
    const buscar = async () => {
      const q = $('#fq').value.trim(); if (!q) return;
      const l = await api('GET', `beneficiarios?q=${encodeURIComponent(q)}&tipo=${$('#ftp').value}`);
      $('#fres').innerHTML = !l.length ? '<div class="aviso r">Nenhum cartão encontrado com esse registro/nome. Possível cartão falso.</div>' :
        `<div class="tabela"><table><thead><tr><th>Registro</th><th>Nome</th><th>Tipo</th><th>Validade</th><th>Situação</th></tr></thead><tbody>
        ${l.map(b => `<tr class="link" data-id="${b.id}"><td><b>${reg(b.registro)}</b></td><td>${esc(b.nome)}</td><td>${tipoB(b.tipo)}</td><td>${br(b.validade)}</td><td>${badge(b.situacao)}</td></tr>`).join('')}</tbody></table></div>`;
      $$('#fres tr.link').forEach(tr => tr.addEventListener('click', () => location.hash = '#/b/' + tr.dataset.id));
    };
    $('#fb').addEventListener('click', buscar);
    $('#fq').addEventListener('keydown', e => e.key === 'Enter' && buscar());
    const log = async () => {
      let l = await api('GET', 'consultas?limite=500');
      if ($('#irreg').checked) l = l.filter(c => c.resultado !== 'ativo');
      $('#flog').innerHTML = tabelaConsultas(l);
    };
    $('#irreg').addEventListener('change', log); log();
  }

  // ---------- USUÁRIOS
  async function usuarios() {
    const l = await api('GET', 'usuarios');
    const P = { admin: 'Administrador', atendente: 'Atendente', fiscal: 'Fiscal / agente' };
    main.innerHTML = `
      <h1>Usuários</h1><p class="sub"><b>Administrador</b>: tudo, inclusive cassar e configurar · <b>Atendente</b>: cadastra, imprime, renova e suspende · <b>Fiscal</b>: consulta e fiscaliza.</p>
      <div class="painel"><h2>Novo usuário</h2><form id="fu" class="grade">
        <label class="c4 req">Nome<input name="nome" required></label>
        <label class="c2">Matrícula<input name="matricula"></label>
        <label class="c2 req">Login<input name="login" required placeholder="ex.: joao.silva"></label>
        <label class="c2 req">Perfil<select name="perfil">${Object.entries(P).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        <label class="c2 req">Senha inicial<input name="senha" required minlength="8"></label>
        <div class="c12"><div class="erro" id="erro-u"></div><button class="btn primario">Criar usuário</button> <small style="color:#667085">No primeiro acesso a pessoa troca a senha.</small></div>
      </form></div>
      <div class="tabela"><table><thead><tr><th>Nome</th><th>Login</th><th>Matrícula</th><th>Perfil</th><th>Situação</th><th></th></tr></thead><tbody>
      ${l.map(u => `<tr><td>${esc(u.nome)}</td><td>${esc(u.login)}</td><td>${esc(u.matricula)}</td>
        <td><select data-perfil="${u.id}" style="width:auto">${Object.entries(P).map(([k, v]) => `<option value="${k}" ${u.perfil === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
        <td>${u.ativo ? '<span class="badge s-ativo">Ativo</span>' : '<span class="badge s-invalido">Inativo</span>'}</td>
        <td style="white-space:nowrap"><button class="btn" data-senha="${u.id}">Redefinir senha</button> <button class="btn ${u.ativo ? 'perigo' : ''}" data-ativo="${u.id}" data-v="${u.ativo ? 0 : 1}">${u.ativo ? 'Desativar' : 'Ativar'}</button></td></tr>`).join('')}
      </tbody></table></div>`;
    $('#fu').addEventListener('submit', async e => {
      e.preventDefault(); const d = Object.fromEntries(new FormData(e.target));
      try { await api('POST', 'usuarios', d); toast('Usuário criado.'); usuarios(); } catch (err) { $('#erro-u').textContent = err.message; }
    });
    const put = async (id, d) => { try { await api('PUT', 'usuarios/' + id, d); toast('Atualizado.'); } catch (e) { toast(e.message, true); } usuarios(); };
    $$('[data-perfil]').forEach(s => s.addEventListener('change', () => put(s.dataset.perfil, { perfil: s.value })));
    $$('[data-ativo]').forEach(b => b.addEventListener('click', () => put(b.dataset.ativo, { ativo: b.dataset.v === '1' })));
    $$('[data-senha]').forEach(b => b.addEventListener('click', async () => {
      const d = await dialogo('Redefinir senha', '<label>Nova senha (mín. 8 caracteres)</label><input name="senha" minlength="8">', 'Salvar');
      if (d && d.senha) put(b.dataset.senha, { senha: d.senha });
    }));
  }

  // ---------- CONFIGURAÇÕES
  async function config() {
    CFG = await api('GET', 'config');
    const v = k => esc(CFG[k]);
    main.innerHTML = `
      <h1>Configurações</h1><p class="sub">Somente administradores.</p>
      <form id="fc">
      <div class="painel"><h2>Endereço usado no QR Code</h2>
        <div class="aviso">É o endereço que o celular do agente vai abrir ao ler o QR. No sistema publicado na internet ele já vem preenchido
        com o endereço público. <b>Ao mudar, os cartões já impressos continuam com o endereço antigo</b> – só altere com a TI e antes de imprimir.</div>
        <div class="grade"><label class="c8">Endereço base<input name="endereco_base" value="${v('endereco_base')}"></label>
        <div class="c4" style="align-self:end"><small>Endereço aberto agora: <b>${esc(location.origin)}</b></small></div></div></div>
      <div class="painel"><h2>Numeração e validade</h2><div class="grade">
        <label class="c3">Próximo nº de registro – Idoso<input name="proximo_registro_idoso" type="number" min="1" value="${v('proximo_registro_idoso')}"><small>Número que o próximo cartão de idoso vai receber</small></label>
        <label class="c3">Próximo nº de registro – PcD<input name="proximo_registro_pcd" type="number" min="1" value="${v('proximo_registro_pcd')}"><small>Número que o próximo cartão de PcD vai receber</small></label>
        <label class="c3">Validade padrão – Idoso (anos)<input name="validade_anos_idoso" type="number" min="1" value="${v('validade_anos_idoso')}"></label>
        <label class="c3">Validade padrão – PcD (anos)<input name="validade_anos_pcd" type="number" min="1" value="${v('validade_anos_pcd')}"></label>
      </div></div>
      <div class="painel"><h2>Dados impressos no cartão</h2><div class="grade">
        <label class="c4">Órgão expedidor<input name="orgao_expedidor" value="${v('orgao_expedidor')}"></label>
        <label class="c4">Município<input name="municipio" value="${v('municipio')}"></label>
        <label class="c2">UF<input name="uf" value="${v('uf')}"></label>
      </div></div>
      <div class="erro" id="erro-c"></div>
      <div class="acoes"><button class="btn primario">Salvar configurações</button><a class="btn" href="/api/exportar.csv">Exportar beneficiários (planilha CSV)</a></div>
      </form>
      <div class="painel"><h2>Backup</h2><p style="margin:0 0 12px">O sistema faz uma cópia automática do banco por dia (as últimas 30) no servidor.
      <b>Toda semana, baixe o backup completo</b> (cadastros e laudos) e guarde fora do servidor, na rede da Prefeitura ou num pen drive.</p>
      <a class="btn primario" href="/api/backup">Baixar backup completo (.zip)</a></div>`;
    $('#fc').addEventListener('submit', async e => {
      e.preventDefault();
      try { await api('PUT', 'config', Object.fromEntries(new FormData(e.target))); CFG = await api('GET', 'config'); toast('Configurações salvas.'); }
      catch (err) { $('#erro-c').textContent = err.message; }
    });
  }

  // ---------- SENHA
  function senha() {
    main.innerHTML = `
      <h1>Alterar senha</h1>${EU.trocar_senha ? '<div class="aviso">Por segurança, defina uma senha pessoal antes de continuar.</div>' : '<p class="sub">&nbsp;</p>'}
      <form id="fs" class="painel grade" style="max-width:560px">
        <label class="c12">Senha atual<input type="password" name="atual" required autocomplete="current-password"></label>
        <label class="c6">Nova senha<input type="password" name="nova" required minlength="8" autocomplete="new-password"></label>
        <label class="c6">Repita a nova senha<input type="password" name="nova2" required minlength="8" autocomplete="new-password"></label>
        <div class="c12"><div class="erro" id="erro-s"></div><button class="btn primario">Salvar senha</button></div>
      </form>`;
    $('#fs').addEventListener('submit', async e => {
      e.preventDefault(); const d = Object.fromEntries(new FormData(e.target));
      if (d.nova !== d.nova2) return $('#erro-s').textContent = 'As senhas não conferem.';
      try { await api('POST', 'minha-senha', d); EU.trocar_senha = false; toast('Senha alterada.'); location.hash = '#/painel'; }
      catch (err) { $('#erro-s').textContent = err.message; }
    });
  }

  iniciar();
})();
