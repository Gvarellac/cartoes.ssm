// Monta a credencial preenchida para impressão
// Modelo: Res. Contran 965/2022, alterada pela Res. 1.012/2024 (Anexo III) – 129 x 84,5 mm
(function () {
  const CW = 129, CH = 84.5;                // tamanho oficial da credencial (mm)
  const id = new URLSearchParams(location.search).get('id');
  const area = document.getElementById('area');
  let frente = null, verso = null;

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const br = iso => { if (!iso) return ''; const [a, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${a}`; };
  const indeterminada = v => !v || String(v).startsWith('9999');

  const TEXTO_ITEM2 = {
    idoso: 'Esta credencial somente é válida para o estacionamento nas vagas reservadas, devidamente sinalizadas com o “Símbolo ou legenda Idoso”.',
    pcd: 'Esta credencial somente é válida para o estacionamento nas vagas reservadas, devidamente sinalizadas com o “Símbolo Internacional de Acesso”.',
  };
  const SIMBOLO = {
    idoso: ['<img src="/img/icone-60-branco.png" alt="" style="width:8.6mm;height:8.6mm">', '<img src="/img/icone-60-branco.png" alt="" style="width:48mm;height:48mm">'],
    pcd: ['<svg style="width:8.6mm;height:8.6mm;color:#fff"><use href="#isa"/></svg>', '<svg style="width:46mm;height:46mm;color:#fff"><use href="#isa"/></svg>'],
  };

  // Impressão: a4 = frente em cima e verso embaixo (girado), para dobrar na linha tracejada; duplex = uma página por lado
  const FORMATOS = { a4: 'A4 portrait', duplex: 'A4 portrait' };

  function ajustarTextos(root) {
    // textos de uma linha: diminui a letra até caber
    root.querySelectorAll('.nw').forEach(el => {
      if (el.dataset.fs === undefined) el.dataset.fs = el.style.fontSize;   // guarda o tamanho original do modelo
      el.style.fontSize = el.dataset.fs;
      let s = parseFloat(getComputedStyle(el).fontSize);
      while (el.scrollWidth > el.clientWidth + 1 && s > 3) { s -= 0.2; el.style.fontSize = s + 'px'; }
    });
    // órgão expedidor: no máximo duas linhas
    root.querySelectorAll('.orgao').forEach(el => {
      if (el.dataset.fs === undefined) el.dataset.fs = el.style.fontSize;
      el.style.fontSize = el.dataset.fs; el.style.maxHeight = 'none';
      let s = parseFloat(getComputedStyle(el).fontSize);
      const limite = 7.4 * 96 / 25.4;
      while (el.scrollHeight > limite + 1 && s > 5) { s -= 0.2; el.style.fontSize = s + 'px'; }
      el.style.maxHeight = '7.4mm';
    });
    root.querySelectorAll('.ass-cursiva').forEach(el => {
      let s = parseFloat(getComputedStyle(el).fontSize); const box = el.parentElement;
      while (el.scrollWidth > box.clientWidth && s > 6) { s -= 0.3; el.style.fontSize = s + 'px'; }
    });
  }

  function montar(fmt) {
    if (!FORMATOS[fmt]) fmt = 'a4';
    document.getElementById('pagina').textContent = `@page { size: ${FORMATOS[fmt]}; margin: 0; }`;
    area.innerHTML = '';
    const PW = 210, PH = 297;
    const pagina = () => { const p = document.createElement('div'); p.className = 'pagina'; p.style.width = PW + 'mm'; p.style.height = PH + 'mm'; area.appendChild(p); return p; };
    const el = (pg, cls, css, html) => { const d = document.createElement('div'); d.className = cls; Object.assign(d.style, css); if (html) d.innerHTML = html; pg.appendChild(d); return d; };
    const colocar = (pg, card, x, y, girar) => {
      const slot = el(pg, 'slot' + (girar ? ' girado' : ''), { left: x + 'mm', top: y + 'mm' });
      slot.appendChild(card.cloneNode(true));
    };
    const x = (PW - CW) / 2;
    if (fmt === 'a4') {
      const pg = pagina(), y = (PH - 2 * CH) / 2;
      colocar(pg, frente, x, y, false);
      colocar(pg, verso, x, y + CH, true);
      el(pg, 'corte', { left: x + 'mm', top: y + 'mm', width: CW + 'mm', height: 2 * CH + 'mm' });
      el(pg, 'dobra', { left: x + 'mm', top: (y + CH) + 'mm', width: CW + 'mm' });
      el(pg, 'guia', { left: (x + CW + 2) + 'mm', top: (y + CH - 1.5) + 'mm' }, '← dobrar aqui');
      el(pg, 'guia', { left: x + 'mm', top: (y - 5) + 'mm' }, 'Recorte na linha pontilhada, dobre na tracejada (verso para trás) e plastifique. Imprima em tamanho real (100%).');
    } else {
      const y = (PH - CH) / 2;
      [frente, verso].forEach(card => {
        const pg = pagina(); colocar(pg, card, x, y, false);
        el(pg, 'corte', { left: x + 'mm', top: y + 'mm', width: CW + 'mm', height: CH + 'mm' });
      });
    }
    ajustarTextos(area);
    try { localStorage.setItem('fmtCredencial', fmt); } catch (e) {}
  }

  async function carregar() {
    if (!id) { area.innerHTML = '<div class="msg">Credencial não informada.</div>'; return; }
    const [rb, rc, rm] = await Promise.all([fetch('/api/beneficiarios/' + id), fetch('/api/config'), fetch('/api/me')]);
    if (rb.status === 401) { location.href = '/'; return; }
    const b = await rb.json(), cfg = await rc.json();
    if (!rb.ok) { area.innerHTML = '<div class="msg">' + esc(b.erro || 'Erro ao carregar') + '</div>'; return; }
    if (b.situacao === 'cassado' || b.situacao === 'suspenso') {
      area.innerHTML = `<div class="msg"><b>Credencial ${b.situacao === 'cassado' ? 'CASSADA' : 'SUSPENSA'}.</b><br>Não é permitido imprimir uma credencial nesta situação.</div>`;
      document.getElementById('imprimir').disabled = true; return;
    }
    const A = b.assinatura || {};
    const eu = rm.ok ? await rm.json() : {};
    const exigir = b.exigir_assinatura !== false;
    const pendente = exigir && !A.valida;
    document.body.classList.toggle('bloqueado', pendente);
    document.getElementById('imprimir').disabled = pendente;
    document.getElementById('aviso-ass').innerHTML = !pendente ? '' : `<div class="aviso-assinatura"><b>Credencial aguardando assinatura eletrônica.</b>
      ${eu.pode_assinar ? 'Confira a credencial abaixo e clique em <b>Assinar</b> (no alto). Depois da assinatura, o botão Imprimir é liberado.'
                        : 'A impressão é liberada depois que o Secretário assinar (menu Assinaturas).'}</div>`;
    document.getElementById('assinar-box').hidden = !(pendente && eu.pode_assinar);
    const reg = b.registro_txt || String(b.registro);
    document.title = `Credencial nº ${reg} – ${b.nome}`;
    document.getElementById('titulo').textContent = `${b.tipo === 'idoso' ? 'Pessoa idosa' : 'PcD'} · Nº ${reg} · ${b.nome} · ${b.via}ª via`;

    const S = b.servidor_responsavel;
    const codServidor = S ? (S.matricula ? 'mat. ' + S.matricula : 'cód. ' + S.id) : '—';
    const codImpressor = eu.id ? (eu.matricula ? 'mat. ' + eu.matricula : 'cód. ' + eu.id) : '—';
    const hojeBr = new Date().toLocaleDateString('pt-BR');
    const assTxt = A.valida
      ? `<div class="b" style="font-size:5.6pt">${esc(A.nome)}</div>` +
        (A.cargo ? `<div style="font-size:5pt">${esc(A.cargo)}</div>` : '') +
        `<div class="nw" style="font-size:4.4pt;color:#222">Assinado eletronicamente em ${br(A.em)} às ${String(A.em).slice(11, 16)} · Cód. ${esc(A.codigo)}</div>` +
        `<div class="nw" style="font-size:4.4pt;color:#222"><b>Emitido por:</b> ${esc(codServidor)} · <b>Impresso por:</b> ${esc(codImpressor)} em ${hojeBr}</div>`
      : `<div style="font-size:5pt;font-style:italic">Nome e cargo do emissor</div>` +
        (pendente ? '<div style="font-size:4.4pt;color:#b54708">aguardando assinatura eletrônica</div>' : '');
    const valores = {
      registro: reg, nome: b.nome, emissao: br(b.data_emissao),
      validade: b.tipo === 'pcd' && !indeterminada(b.validade) ? `<span class="lbl">VALIDADE:</span> ${br(b.validade)}` : '',
      orgao: esc(cfg.orgao_expedidor || 'SSM'),
      municipio: esc(`${cfg.municipio || 'BAGÉ'}/${cfg.uf || 'RS'}`),
      item2: TEXTO_ITEM2[b.tipo], simbolo: SIMBOLO[b.tipo][0], marca: SIMBOLO[b.tipo][1],
      'ass-img': A.valida ? (A.imagem ? `<img src="${A.imagem}" alt="">` : `<span class="ass-cursiva">${esc(A.nome)}</span>`)
                          : (pendente ? '<span class="ass-pendente">AGUARDANDO ASSINATURA</span>' : ''),
      'ass-txt': assTxt,
      servidor: '',   // identificação do servidor fica na frente, junto da assinatura (matrícula de quem emitiu e de quem imprimiu)
      qr: QRSvg(b.link_qr, 'M', 0).replace('<svg ', '<svg style="width:100%;height:100%;display:block" '),
    };
    const HTML = new Set(['validade', 'orgao', 'municipio', 'simbolo', 'marca', 'ass-img', 'ass-txt', 'servidor', 'qr']);
    const montarTpl = tid => {
      const t = document.getElementById(tid).content.cloneNode(true);
      t.querySelectorAll('[data-f]').forEach(el => {
        const v = valores[el.dataset.f] ?? '';
        if (HTML.has(el.dataset.f)) el.innerHTML = v; else el.textContent = v;
      });
      return t.querySelector('.card');
    };
    frente = montarTpl('t-frente'); verso = montarTpl('t-verso');

    let fmt = 'a4'; try { fmt = localStorage.getItem('fmtCredencial') || 'a4'; } catch (e) {}
    if (!FORMATOS[fmt]) fmt = 'a4';
    document.querySelector(`input[name=fmt][value=${fmt}]`).checked = true;
    await (document.fonts ? document.fonts.ready : Promise.resolve());
    montar(fmt);
    // a imagem da assinatura pode chegar depois: reajusta
    area.querySelectorAll('img').forEach(im => im.complete || im.addEventListener('load', () => ajustarTextos(area), { once: true }));
  }

  const atual = () => (document.querySelector('input[name=fmt]:checked') || {}).value || 'a4';
  document.querySelectorAll('input[name=fmt]').forEach(r => r.addEventListener('change', () => montar(atual())));

  // assinatura direto na tela da credencial (só aparece para quem pode assinar)
  const $id = x => document.getElementById(x);
  $id('assinar').addEventListener('click', () => { $id('assinar').hidden = true; $id('assinar-form').hidden = false; $id('assinar-msg').textContent = ''; $id('assinar-senha').focus(); });
  $id('assinar-cancela').addEventListener('click', () => { $id('assinar-form').hidden = true; $id('assinar').hidden = false; $id('assinar-senha').value = ''; });
  const confirmar = async () => {
    const senha = $id('assinar-senha').value; if (!senha) return $id('assinar-senha').focus();
    $id('assinar-ok').disabled = true;
    try {
      const r = await fetch(`/api/beneficiarios/${id}/assinar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ senha }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.erro || 'Não foi possível assinar.');
      $id('assinar-box').hidden = true; $id('assinar-form').hidden = true; $id('assinar').hidden = false; $id('assinar-senha').value = '';
      await carregar();
    } catch (e) { $id('assinar-msg').textContent = e.message; $id('assinar-senha').select(); }
    finally { $id('assinar-ok').disabled = false; }
  };
  $id('assinar-ok').addEventListener('click', confirmar);
  $id('assinar-senha').addEventListener('keydown', e => e.key === 'Enter' && confirmar());

  document.getElementById('imprimir').addEventListener('click', () => {
    fetch('/api/beneficiarios/' + id + '/impressao', { method: 'POST' });
    window.print();
  });
  carregar();
})();
