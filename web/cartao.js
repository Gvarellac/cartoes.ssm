// Monta o cartão preenchido para impressão
(function () {
  const MM = 96 / 25.4;
  const CW = 148, CH = 105;           // tamanho de desenho do cartão (mm)
  const CARIMBO_MM = 40;              // quadro de carimbo/assinatura no verso: 4 x 4 cm reais
  const id = new URLSearchParams(location.search).get('id');
  const area = document.getElementById('area');
  let frente = null, verso = null;

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const br = iso => { if (!iso) return ''; const [a, m, d] = iso.split('-'); return `${d}/${m}/${a}`; };

  // Formatos de impressão
  const FORMATOS = {
    // A4 em pé: frente em cima, verso embaixo (girado), para dobrar ao meio. Margem de 5 mm.
    a4:  { pagina: [210, 297], page: 'A4 portrait', escala: 200 / CW },
    // A4 deitado: cada lado ocupa a folha inteira. Margem de 5 mm.
    a4l: { pagina: [297, 210], page: 'A4 landscape', escala: 287 / CW },
    // A6: tamanho real do cartão
    a6:  { pagina: [148, 105], page: '148mm 105mm', escala: 1 },
  };

  function ajustarTextos(root) {
    root.querySelectorAll('.fit').forEach(el => {
      el.style.transform = 'none';
      const w = el.offsetWidth;   // largura de layout (ignora a ampliação do cartão)
      if (w) el.style.transform = 'scaleX(' + (parseFloat(el.dataset.w) * MM / w) + ')';
    });
    root.querySelectorAll('[data-f="nome"]').forEach(el => {
      el.style.fontSize = '';
      let s = parseFloat(getComputedStyle(el).fontSize);
      while (el.scrollWidth > el.clientWidth + 1 && s > 6) { s -= 0.25; el.style.fontSize = s + 'px'; }
    });
  }

  // Verso: abre espaço de 4x4 cm (medida real impressa) para carimbo e assinatura
  function montarVerso(card, escala) {
    const lado = CARIMBO_MM / escala;               // em mm do desenho
    const dir = 145 - 3, baixo = 102 - 3;           // limite interno da moldura do verso
    const box = card.querySelector('.carimbo-verso'), leg = card.querySelector('.carimbo-leg');
    const rules = card.querySelector('.rules');
    Object.assign(box.style, { left: (dir - lado) + 'mm', top: (baixo - lado) + 'mm', width: lado + 'mm', height: lado + 'mm' });
    const fonte = 6.5 / escala;                     // ~6,5 pt no papel
    Object.assign(leg.style, { left: (dir - lado - 4) + 'mm', width: (lado + 8) + 'mm', fontSize: fonte + 'pt',
                                top: (baixo - lado - fonte * 0.3528 * 1.6) + 'mm' });
    rules.style.width = (dir - lado - 4 - 8) + 'mm';   // coluna de texto à esquerda do quadro
    // assinatura eletrônica dentro do quadro (tamanhos em medida real impressa)
    box.style.padding = (1 / escala) + 'mm';
    const txt = card.querySelector('.ass-txt'), area = card.querySelector('.ass-area'), cur = card.querySelector('.ass-cursiva');
    if (txt) txt.style.fontSize = (5 / escala) + 'pt';
    if (cur) {
      let fs = 18 / escala; cur.style.fontSize = fs + 'pt';
      while (cur.scrollWidth > area.clientWidth && fs > 5 / escala) { fs -= 0.5 / escala; cur.style.fontSize = fs + 'pt'; }
    }
    // rodapé discreto: servidor responsável
    const rod = card.querySelector('.rodape-servidor');
    if (rod) Object.assign(rod.style, { left: '8mm', top: (baixo + 0.35) + 'mm', width: (dir - 8) + 'mm', fontSize: (5.5 / escala) + 'pt' });
    let size = 10; rules.style.fontSize = size + 'pt';
    while (rules.scrollHeight > rules.clientHeight + 1 && size > 5) { size -= 0.1; rules.style.fontSize = size.toFixed(1) + 'pt'; }
  }

  function montar(fmt) {
    const F = FORMATOS[fmt] || FORMATOS.a4, s = F.escala;
    const [PW, PH] = F.pagina, W = CW * s, H = CH * s;
    document.getElementById('pagina').textContent = `@page { size: ${F.page}; margin: 0; }`;
    area.innerHTML = '';
    const pagina = () => { const p = document.createElement('div'); p.className = 'pagina'; p.style.width = PW + 'mm'; p.style.height = PH + 'mm'; area.appendChild(p); return p; };
    const colocar = (pg, card, x, y, girar) => {
      const slot = document.createElement('div'); slot.className = 'slot';
      Object.assign(slot.style, { left: x + 'mm', top: y + 'mm', width: W + 'mm', height: H + 'mm' });
      const c = card.cloneNode(true);
      c.style.transform = girar ? `translate(${W}mm, ${H}mm) rotate(180deg) scale(${s})` : `scale(${s})`;
      slot.appendChild(c); pg.appendChild(slot);
      if (fmt !== 'a6') {
        const corte = document.createElement('div'); corte.className = 'corte-linha';
        Object.assign(corte.style, { left: x + 'mm', top: y + 'mm', width: W + 'mm', height: H + 'mm' }); pg.appendChild(corte);
      }
      return c;
    };
    let cartoes = [];
    if (fmt === 'a4') {
      const pg = pagina(), x = (PW - W) / 2, y = (PH - 2 * H) / 2;
      cartoes.push(colocar(pg, frente, x, y, false));
      cartoes.push(colocar(pg, verso, x, y + H, true));
      const d = document.createElement('div'); d.className = 'dobra';
      Object.assign(d.style, { left: x + 'mm', top: (y + H) + 'mm', width: W + 'mm' });
      d.innerHTML = '<span>dobrar aqui</span>'; pg.appendChild(d);
    } else {
      const x = (PW - W) / 2, y = (PH - H) / 2;
      cartoes.push(colocar(pagina(), frente, x, y, false));
      cartoes.push(colocar(pagina(), verso, x, y, false));
    }
    ajustarTextos(area);
    cartoes.filter(c => c.classList.contains('back')).forEach(c => montarVerso(c, s));
    try { localStorage.setItem('fmtCartao', fmt); } catch (e) {}
  }

  async function carregar() {
    if (!id) { area.innerHTML = '<div class="msg">Cartão não informado.</div>'; return; }
    const [rb, rc] = await Promise.all([fetch('/api/beneficiarios/' + id), fetch('/api/config')]);
    if (rb.status === 401) { location.href = '/'; return; }
    const b = await rb.json(), cfg = await rc.json();
    if (!rb.ok) { area.innerHTML = '<div class="msg">' + (b.erro || 'Erro ao carregar') + '</div>'; return; }
    if (b.situacao === 'cassado' || b.situacao === 'suspenso') {
      area.innerHTML = `<div class="msg"><b>Cartão ${b.situacao.toUpperCase()}.</b><br>Não é permitido imprimir um cartão nesta situação.</div>`;
      document.getElementById('imprimir').disabled = true; return;
    }
    const A = b.assinatura || {};
    if (b.exigir_assinatura !== false && !A.valida) {
      area.innerHTML = `<div class="msg"><b>Cartão aguardando assinatura eletrônica.</b><br>O Secretário precisa assinar este cartão (menu <b>Assinaturas</b>) antes da impressão.</div>`;
      document.getElementById('imprimir').disabled = true; return;
    }
    document.title = `Cartão nº ${b.registro} – ${b.nome}`;
    document.getElementById('titulo').textContent = `${b.tipo === 'idoso' ? 'Idoso' : 'PcD'} · Nº ${b.registro} · ${b.nome} · ${b.via}ª via`;

    const tpl = document.getElementById(b.tipo === 'idoso' ? 't-idoso' : 't-pcd').content.cloneNode(true);
    const valores = {
      registro: Number(b.registro).toLocaleString('pt-BR'), nome: b.nome, validade: br(b.validade), emissao: br(b.data_emissao),
      orgao: cfg.orgao_expedidor || 'SSM', municipio: cfg.municipio || 'BAGÉ', uf: cfg.uf || 'RS',
    };
    tpl.querySelectorAll('[data-f]').forEach(el => {
      const f = el.dataset.f;
      if (f === 'qr') el.innerHTML = QRSvg(b.link_qr, 'M', 1);
      else if (f === 'ass-img') el.innerHTML = !A.valida ? '' : A.imagem ? `<img src="${A.imagem}" alt="">` : `<span class="ass-cursiva">${esc(A.nome)}</span>`;
      else if (f === 'ass-txt') el.innerHTML = !A.valida ? '' :
        `Assinado eletronicamente por<br><b>${esc(A.nome)}</b>${A.cargo ? '<br>' + esc(A.cargo) : ''}<br>em ${br(String(A.em).slice(0, 10))} · Cód. ${esc(A.codigo)}`;
      else if (f === 'ass-leg') el.textContent = A.valida ? 'ASSINATURA ELETRÔNICA' : 'CARIMBO E ASSINATURA';
      else if (f === 'servidor') el.textContent = b.servidor_responsavel ?
        `Servidor responsável: ${b.servidor_responsavel.nome}${b.servidor_responsavel.matricula ? ' – Matrícula ' + b.servidor_responsavel.matricula : ''}` : '';
      else if (f in valores) el.textContent = valores[f];
    });
    tpl.querySelectorAll('[data-f="nome"]').forEach(el => { el.style.whiteSpace = 'nowrap'; el.style.overflow = 'hidden'; if (el.closest('.nome-frente')) el.style.display = 'block'; });
    const cards = tpl.querySelectorAll('.card');
    frente = cards[0]; verso = [...cards].find(c => c.classList.contains('back'));

    let fmt = 'a4'; try { fmt = localStorage.getItem('fmtCartao') || 'a4'; } catch (e) {}
    if (!FORMATOS[fmt]) fmt = 'a4';
    document.querySelector(`input[name=fmt][value=${fmt}]`).checked = true;
    await (document.fonts ? document.fonts.ready : Promise.resolve());
    montar(fmt);
  }

  const atual = () => (document.querySelector('input[name=fmt]:checked') || {}).value || 'a4';
  document.querySelectorAll('input[name=fmt]').forEach(r => r.addEventListener('change', () => montar(atual())));
  document.getElementById('cores').addEventListener('change', e => document.body.classList.toggle('cores', e.target.checked));
  document.getElementById('imprimir').addEventListener('click', () => {
    fetch('/api/beneficiarios/' + id + '/impressao', { method: 'POST' });
    window.print();
  });
  carregar();
})();
