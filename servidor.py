#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Sistema de Cartões de Estacionamento – Vaga Especial
SSM – Secretaria de Segurança e Mobilidade Urbana – Bagé/RS

Servidor local (rede interna). Só usa a biblioteca padrão do Python 3.9+.
Uso:  python servidor.py            (porta 8080)
      python servidor.py 9000       (outra porta)
"""
import base64, csv, datetime as dt, hashlib, hmac, html, io, json, mimetypes, os, re
import secrets, shutil, socket, sqlite3, sys, threading, time, zipfile
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from http.cookies import SimpleCookie
from urllib.parse import urlparse, parse_qs, quote

BASE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(BASE, "web")
DADOS = os.environ.get("DADOS_DIR") or os.path.join(BASE, "dados")
LAUDOS = os.path.join(DADOS, "laudos")
BACKUPS = os.path.join(DADOS, "backups")
ASSINATURAS = os.path.join(DADOS, "assinaturas")
DB = os.path.join(DADOS, "cadastro.db")
_args = [a for a in sys.argv[1:] if not a.startswith("--")]
PORTA = int(_args[0]) if _args else int(os.environ.get("PORT") or os.environ.get("PORTA") or "8080")
LOG_ARQUIVO = "--log" in sys.argv   # usado quando roda em segundo plano (início automático)
SO_LOCAL = "--local" in sys.argv    # modo um computador só: atende apenas este PC, sem usar a rede
HOST = "127.0.0.1" if SO_LOCAL else "0.0.0.0"
SESSAO_HORAS = 12
SENHA_MIN = 8                  # tamanho mínimo das senhas

# ---- modo internet (nuvem): ativado pelas variáveis de ambiente
ENDERECO_PUBLICO = (os.environ.get("ENDERECO_PUBLICO") or "").strip().rstrip("/")
if not ENDERECO_PUBLICO and os.environ.get("RAILWAY_PUBLIC_DOMAIN"):
    ENDERECO_PUBLICO = "https://" + os.environ["RAILWAY_PUBLIC_DOMAIN"].strip()
NA_INTERNET = bool(ENDERECO_PUBLICO) or os.environ.get("NA_INTERNET") == "1"
_FUSO = (os.environ.get("FUSO_HORARIO") or "").strip()      # ex.: -3 (horário de Brasília)
FUSO = dt.timezone(dt.timedelta(hours=float(_FUSO))) if _FUSO else None

# ---- proteção contra tentativas de adivinhar senha
TENTATIVAS_MAX, TENTATIVAS_IP_MAX, TENTATIVAS_JANELA = 5, 30, 15 * 60
_falhas = {}
_falhas_lock = threading.Lock()


def _falhas_recentes(chave):
    agora_s = time.time()
    lst = [t for t in _falhas.get(chave, []) if agora_s - t < TENTATIVAS_JANELA]
    if lst:
        _falhas[chave] = lst
    else:
        _falhas.pop(chave, None)
    return lst


def login_bloqueado(ip, login):
    with _falhas_lock:
        return (len(_falhas_recentes(f"l:{ip}:{login}")) >= TENTATIVAS_MAX or
                len(_falhas_recentes(f"i:{ip}")) >= TENTATIVAS_IP_MAX)


def login_falhou(ip, login):
    with _falhas_lock:
        for k in (f"l:{ip}:{login}", f"i:{ip}"):
            _falhas.setdefault(k, []).append(time.time())


def login_ok(ip, login):
    with _falhas_lock:
        _falhas.pop(f"l:{ip}:{login}", None)
MAX_UPLOAD = 15 * 1024 * 1024  # 15 MB

PERFIS = ("admin", "atendente", "fiscal")
TIPOS = ("idoso", "pcd")
STATUS = ("ativo", "suspenso", "cassado")

CAMPOS_BENEF = [
    "tipo", "nome", "cpf", "data_nascimento", "sexo", "telefone", "email",
    "cep", "logradouro", "numero", "complemento", "bairro", "cidade", "uf",
    "deficiencia_tipo", "cid", "medico_nome", "medico_crm", "data_laudo", "laudo_temporario",
    "responsavel_nome", "responsavel_cpf", "responsavel_parentesco", "responsavel_telefone",
    "observacoes",
]

_lock = threading.Lock()

TIPOS_ARQ = {
    ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml", ".ico": "image/x-icon", ".json": "application/json; charset=utf-8",
    ".pdf": "application/pdf", ".md": "text/plain; charset=utf-8",
}


# ------------------------------------------------------------------ banco
def conectar():
    c = sqlite3.connect(DB, timeout=15)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys = ON")
    return c


def agora_dt():
    """Data e hora local (na nuvem o servidor fica em UTC: usa FUSO_HORARIO)."""
    return dt.datetime.now(FUSO).replace(tzinfo=None) if FUSO else dt.datetime.now()


def hoje():
    return agora_dt().date()


def agora():
    return agora_dt().strftime("%Y-%m-%d %H:%M:%S")


def hash_senha(senha, sal=None):
    sal = sal or secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", senha.encode(), bytes.fromhex(sal), 200_000).hex()
    return f"{sal}${h}"


def confere_senha(senha, guardado):
    try:
        sal, _ = guardado.split("$", 1)
    except ValueError:
        return False
    return hmac.compare_digest(hash_senha(senha, sal), guardado)


def ip_local():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def copiar_banco(destino):
    """Cópia consistente do banco, mesmo com o sistema em uso."""
    src, dst = sqlite3.connect(DB, timeout=30), sqlite3.connect(destino)
    try:
        src.backup(dst)
    finally:
        dst.close(); src.close()


def backup_diario():
    """Um backup por dia em dados/backups (guarda os últimos 30)."""
    if not os.path.exists(DB):
        return
    destino = os.path.join(BACKUPS, f"cadastro-{hoje():%Y%m%d}.db")
    if not os.path.exists(destino):
        copiar_banco(destino)
    antigos = sorted(f for f in os.listdir(BACKUPS) if f.endswith(".db"))
    for f in antigos[:-30]:
        os.remove(os.path.join(BACKUPS, f))


def _ciclo_backup():
    while True:
        time.sleep(3600)
        try:
            backup_diario()
        except Exception as e:  # noqa
            print("Falha no backup automático:", e)


def iniciar_banco():
    os.makedirs(LAUDOS, exist_ok=True)
    os.makedirs(BACKUPS, exist_ok=True)
    os.makedirs(ASSINATURAS, exist_ok=True)
    backup_diario()
    c = conectar()
    c.executescript("""
    CREATE TABLE IF NOT EXISTS usuarios(
        id INTEGER PRIMARY KEY, nome TEXT NOT NULL, login TEXT UNIQUE NOT NULL,
        senha TEXT NOT NULL, perfil TEXT NOT NULL, matricula TEXT, ativo INTEGER DEFAULT 1,
        trocar_senha INTEGER DEFAULT 1, criado_em TEXT);
    CREATE TABLE IF NOT EXISTS sessoes(
        token TEXT PRIMARY KEY, usuario_id INTEGER REFERENCES usuarios(id), expira TEXT);
    CREATE TABLE IF NOT EXISTS beneficiarios(
        id INTEGER PRIMARY KEY, tipo TEXT NOT NULL, nome TEXT NOT NULL, cpf TEXT, rg TEXT,
        data_nascimento TEXT, sexo TEXT, telefone TEXT, email TEXT,
        cep TEXT, logradouro TEXT, numero TEXT, complemento TEXT, bairro TEXT, cidade TEXT, uf TEXT,
        deficiencia_tipo TEXT, cid TEXT, medico_nome TEXT, medico_crm TEXT, data_laudo TEXT,
        laudo_temporario INTEGER DEFAULT 0, laudo_arquivo TEXT,
        responsavel_nome TEXT, responsavel_cpf TEXT, responsavel_parentesco TEXT, responsavel_telefone TEXT,
        observacoes TEXT,
        registro INTEGER NOT NULL, data_emissao TEXT NOT NULL, validade TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ativo', motivo_status TEXT, token TEXT UNIQUE NOT NULL,
        via INTEGER DEFAULT 1, criado_por INTEGER, criado_em TEXT, atualizado_em TEXT,
        UNIQUE(tipo, registro));
    CREATE INDEX IF NOT EXISTS ix_benef_cpf ON beneficiarios(cpf);
    CREATE INDEX IF NOT EXISTS ix_benef_nome ON beneficiarios(nome);
    CREATE TABLE IF NOT EXISTS historico(
        id INTEGER PRIMARY KEY, beneficiario_id INTEGER REFERENCES beneficiarios(id),
        data TEXT, usuario_id INTEGER, acao TEXT, detalhe TEXT);
    CREATE TABLE IF NOT EXISTS consultas(
        id INTEGER PRIMARY KEY, beneficiario_id INTEGER, token TEXT, data TEXT, ip TEXT,
        usuario_id INTEGER, resultado TEXT, origem TEXT);
    CREATE TABLE IF NOT EXISTS config(chave TEXT PRIMARY KEY, valor TEXT);
    """)
    # colunas novas (assinatura eletrônica e servidor responsável) – bancos antigos são atualizados
    for tabela, col, tipo in (("usuarios", "cargo", "TEXT"), ("usuarios", "pode_assinar", "INTEGER DEFAULT 0"),
                              ("usuarios", "assinatura_arquivo", "TEXT"),
                              ("beneficiarios", "emitido_por", "INTEGER"), ("beneficiarios", "assinado_por", "INTEGER"),
                              ("beneficiarios", "assinado_em", "TEXT"), ("beneficiarios", "assinatura_hash", "TEXT")):
        if col not in [r[1] for r in c.execute(f"PRAGMA table_info({tabela})")]:
            c.execute(f"ALTER TABLE {tabela} ADD COLUMN {col} {tipo}")
    c.execute("UPDATE beneficiarios SET emitido_por=criado_por WHERE emitido_por IS NULL")
    padrao = {
        "endereco_base": ENDERECO_PUBLICO or f"http://{ip_local()}:{PORTA}",
        "proximo_registro_idoso": "12132",
        "proximo_registro_pcd": "1302",
        "validade_anos_idoso": "5",
        "validade_anos_pcd": "5",
        "orgao_expedidor": "SSM",
        "municipio": "BAGÉ",
        "uf": "RS",
        "exigir_assinatura": "1",
        "chave_assinatura": secrets.token_hex(32),   # segredo dos códigos de verificação (nunca sai do servidor)
    }
    for k, v in padrao.items():
        c.execute("INSERT OR IGNORE INTO config(chave, valor) VALUES (?,?)", (k, v))
    # Numeração inicial definida por variável de ambiente (só avança, nunca volta)
    for t in TIPOS:
        minimo = os.environ.get(f"REGISTRO_INICIAL_{t.upper()}", "").replace(".", "").strip()
        if minimo.isdigit():
            r = c.execute("SELECT valor FROM config WHERE chave=?", (f"proximo_registro_{t}",)).fetchone()
            if not r or not str(r[0]).isdigit() or int(r[0]) < int(minimo):
                c.execute("UPDATE config SET valor=? WHERE chave=?", (minimo, f"proximo_registro_{t}"))
    # Se o primeiro início foi sem rede (ex.: logo após ligar o PC), corrige o endereço do QR
    atual = c.execute("SELECT valor FROM config WHERE chave='endereco_base'").fetchone()["valor"]
    ip = ip_local()
    if "127.0.0.1" in atual and ip != "127.0.0.1" and \
            not c.execute("SELECT 1 FROM beneficiarios LIMIT 1").fetchone():
        c.execute("UPDATE config SET valor=? WHERE chave='endereco_base'", (f"http://{ip}:{PORTA}",))
    # Na internet: troca o endereço de rede local (IP) pelo endereço público
    if ENDERECO_PUBLICO and re.fullmatch(r"http://(\d{1,3}\.){3}\d{1,3}(:\d+)?", atual):
        c.execute("UPDATE config SET valor=? WHERE chave='endereco_base'", (ENDERECO_PUBLICO,))
    if not c.execute("SELECT 1 FROM usuarios").fetchone():
        senha_ini = os.environ.get("ADMIN_SENHA_INICIAL") or ""
        if not senha_ini:
            senha_ini = secrets.token_urlsafe(9) if NA_INTERNET else "admin123"
            if NA_INTERNET:
                print(f"  SENHA INICIAL DO ADMIN (anote): {senha_ini}")
        c.execute("INSERT INTO usuarios(nome, login, senha, perfil, trocar_senha, criado_em) VALUES (?,?,?,?,1,?)",
                  ("Administrador", "admin", hash_senha(senha_ini), "admin", agora()))
    # Usuários iniciais definidos pela variável USUARIOS_INICIAIS (JSON). Só cria quem ainda não existe.
    try:
        iniciais = json.loads(os.environ.get("USUARIOS_INICIAIS") or "[]")
    except ValueError:
        iniciais = []
        print("  AVISO: USUARIOS_INICIAIS não é um JSON válido.")
    for x in iniciais:
        login = (x.get("login") or "").strip().lower()
        if not login or not x.get("senha") or c.execute("SELECT 1 FROM usuarios WHERE login=?", (login,)).fetchone():
            continue
        c.execute("INSERT INTO usuarios(nome,login,senha,perfil,matricula,cargo,pode_assinar,trocar_senha,criado_em) VALUES (?,?,?,?,?,?,?,1,?)",
                  (x.get("nome", login), login, hash_senha(x["senha"]), x.get("perfil") if x.get("perfil") in PERFIS else "atendente",
                   x.get("matricula") or "", x.get("cargo") or "", 1 if x.get("pode_assinar") else 0, agora()))
        print(f"  Usuário criado: {login}")
    c.commit()
    c.close()


def cfg(c, chave):
    r = c.execute("SELECT valor FROM config WHERE chave=?", (chave,)).fetchone()
    return r["valor"] if r else ""


def somar_anos(d, anos):
    try:
        return d.replace(year=d.year + anos)
    except ValueError:  # 29/02
        return d.replace(year=d.year + anos, day=28)


def situacao(b):
    """Situação efetiva do cartão: ativo/vencido/suspenso/cassado."""
    if b["status"] != "ativo":
        return b["status"]
    if b["validade"] < hoje().isoformat():
        return "vencido"
    return "ativo"


def novo_token(c):
    while True:
        t = secrets.token_urlsafe(16)
        if not c.execute("SELECT 1 FROM beneficiarios WHERE token=?", (t,)).fetchone():
            return t


def fmt_reg(n):
    """Nº de registro com ponto de milhar: 12132 -> 12.132"""
    try:
        return f"{int(n):,}".replace(",", ".")
    except (TypeError, ValueError):
        return str(n)


def so_digitos(s):
    return re.sub(r"\D", "", s or "")


def cpf_valido(cpf):
    cpf = so_digitos(cpf)
    if len(cpf) != 11 or cpf == cpf[0] * 11:
        return False
    for n in (9, 10):
        soma = sum(int(cpf[i]) * (n + 1 - i) for i in range(n))
        dig = (soma * 10) % 11 % 10
        if dig != int(cpf[n]):
            return False
    return True


def fmt_cpf(cpf):
    d = so_digitos(cpf)
    return f"{d[:3]}.{d[3:6]}.{d[6:9]}-{d[9:]}" if len(d) == 11 else cpf


def registrar(c, bid, uid, acao, detalhe=""):
    c.execute("INSERT INTO historico(beneficiario_id, data, usuario_id, acao, detalhe) VALUES (?,?,?,?,?)",
              (bid, agora(), uid, acao, detalhe))


# ------------------------------------------------------------------ assinatura eletrônica
def conteudo_cartao(b):
    """Dados impressos no cartão que a assinatura protege."""
    return "|".join(str(b[k]) for k in ("tipo", "nome", "registro", "data_emissao", "validade", "via", "token"))


def codigo_assinatura(c, b, uid, quando):
    chave = bytes.fromhex(cfg(c, "chave_assinatura"))
    return hmac.new(chave, f"{conteudo_cartao(b)}|{uid}|{quando}".encode(), hashlib.sha256).hexdigest()


def assinatura_info(c, b):
    if not b["assinado_por"]:
        return {"assinado": False, "valida": False}
    u = c.execute("SELECT nome, cargo, assinatura_arquivo FROM usuarios WHERE id=?", (b["assinado_por"],)).fetchone()
    h = b["assinatura_hash"] or ""
    valida = bool(h) and hmac.compare_digest(codigo_assinatura(c, b, b["assinado_por"], b["assinado_em"]), h)
    return {"assinado": True, "valida": valida, "nome": u["nome"] if u else "—", "cargo": (u["cargo"] if u else "") or "",
            "em": b["assinado_em"], "codigo": f"{h[:4]}-{h[4:8]}".upper(),
            "imagem": f"/api/assinatura/{b['assinado_por']}" if u and u["assinatura_arquivo"] else ""}


def assinatura_ok(c, b):
    return assinatura_info(c, b)["valida"]


def limpar_assinatura(c, bid):
    c.execute("UPDATE beneficiarios SET assinado_por=NULL, assinado_em=NULL, assinatura_hash=NULL WHERE id=?", (bid,))


def assinar_cartao(c, b, u):
    quando = agora()
    h = codigo_assinatura(c, b, u["id"], quando)
    c.execute("UPDATE beneficiarios SET assinado_por=?, assinado_em=?, assinatura_hash=? WHERE id=?", (u["id"], quando, h, b["id"]))
    registrar(c, b["id"], u["id"], "Cartão assinado eletronicamente",
              f"{u['nome']}{' – ' + u['cargo'] if u['cargo'] else ''} · código {h[:4].upper()}-{h[4:8].upper()}")


def benef_dict(b, completo=True):
    d = dict(b)
    d["situacao"] = situacao(b)
    if not completo:
        d = {k: d[k] for k in ("id", "tipo", "nome", "cpf", "registro", "data_emissao", "validade",
                               "status", "situacao", "via", "bairro", "telefone", "assinado_por")}
    return d


class Erro(Exception):
    def __init__(self, codigo, msg):
        super().__init__(msg)
        self.codigo, self.msg = codigo, msg


# ------------------------------------------------------------------ HTTP
class Handler(BaseHTTPRequestHandler):
    server_version = "CartoesSSM/1.0"

    def log_message(self, fmt, *args):
        sys.stdout.write("[%s] %s %s\n" % (agora_dt().strftime("%d/%m %H:%M:%S"), self.ip_cliente(), fmt % args))

    # ---- utilidades
    def ip_cliente(self):
        """IP de quem acessa. Na nuvem a conexão chega pelo proxy, que informa o IP real."""
        if NA_INTERNET:
            real = (self.headers.get("X-Real-IP") or "").strip()
            if real:
                return real
            xff = self.headers.get("X-Forwarded-For") or ""
            if xff.strip():
                return xff.split(",")[-1].strip()
        return self.client_address[0]

    def enviar(self, codigo, corpo, tipo="application/json; charset=utf-8", extra=None):
        if isinstance(corpo, (dict, list)):
            corpo = json.dumps(corpo, ensure_ascii=False, default=str)
        if isinstance(corpo, str):
            corpo = corpo.encode("utf-8")
        self.send_response(codigo)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(corpo)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        self.send_header("Referrer-Policy", "same-origin")
        if NA_INTERNET:
            self.send_header("Strict-Transport-Security", "max-age=31536000")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(corpo)

    def corpo_json(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_UPLOAD * 1.4:
            raise Erro(413, "Arquivo muito grande (máx. 15 MB).")
        if not n:
            return {}
        try:
            return json.loads(self.rfile.read(n).decode("utf-8"))
        except Exception:
            raise Erro(400, "Requisição inválida.")

    def sessao(self, c):
        ck = SimpleCookie(self.headers.get("Cookie", ""))
        if "sid" not in ck:
            return None
        r = c.execute("""SELECT u.* FROM sessoes s JOIN usuarios u ON u.id=s.usuario_id
                         WHERE s.token=? AND s.expira>? AND u.ativo=1""", (ck["sid"].value, agora())).fetchone()
        return r

    def exigir(self, c, *perfis):
        u = self.sessao(c)
        if not u:
            raise Erro(401, "Faça login para continuar.")
        if perfis and u["perfil"] not in perfis:
            raise Erro(403, "Seu perfil não tem permissão para esta ação.")
        return u

    def exigir_assinante(self, c, senha):
        """Quem assina precisa ter permissão e confirmar a própria senha."""
        u = self.exigir(c)
        if not u["pode_assinar"]:
            raise Erro(403, "Seu usuário não tem permissão para assinar cartões.")
        ip = self.ip_cliente()
        if login_bloqueado(ip, u["login"]):
            raise Erro(429, "Muitas tentativas erradas. Aguarde 15 minutos e tente de novo.")
        if not confere_senha(senha or "", u["senha"]):
            login_falhou(ip, u["login"])
            raise Erro(400, "Senha incorreta. A assinatura não foi feita.")
        login_ok(ip, u["login"])
        return u

    # ---- roteamento
    def do_GET(self):
        self.rotear("GET")

    def do_HEAD(self):
        self.rotear("GET")

    def do_POST(self):
        self.rotear("POST")

    def do_PUT(self):
        self.rotear("PUT")

    def rotear(self, metodo):
        url = urlparse(self.path)
        caminho, qs = url.path, parse_qs(url.query)
        c = conectar()
        try:
            if caminho.startswith("/api/"):
                return self.api(c, metodo, caminho[5:].strip("/").split("/"), qs)
            if caminho.startswith("/v/"):
                return self.pagina_consulta(c, caminho[3:].strip("/"))
            return self.estatico(caminho)
        except Erro as e:
            self.enviar(e.codigo, {"erro": e.msg})
        except Exception as e:  # noqa
            import traceback; traceback.print_exc()
            self.enviar(500, {"erro": "Erro interno: " + str(e)})
        finally:
            c.close()

    def estatico(self, caminho):
        if caminho in ("", "/"):
            caminho = "/index.html"
        if caminho == "/favicon.ico":
            caminho = "/img/brasao-bage.png"
        alvo = os.path.normpath(os.path.join(WEB, caminho.lstrip("/")))
        if not alvo.startswith(WEB) or not os.path.isfile(alvo):
            return self.enviar(404, "Página não encontrada", "text/plain; charset=utf-8")
        # Tipos fixos: no Windows o registro pode informar tipos errados (ex.: .js como text/plain),
        # o que faz o navegador bloquear os scripts e a tela ficar em branco.
        ext = os.path.splitext(alvo)[1].lower()
        tipo = TIPOS_ARQ.get(ext) or mimetypes.guess_type(alvo)[0] or "application/octet-stream"
        with open(alvo, "rb") as f:
            self.enviar(200, f.read(), tipo)

    # ------------------------------------------------------------ API
    def api(self, c, m, p, qs):
        r = p[0] if p else ""

        if r == "login" and m == "POST":
            d = self.corpo_json()
            login, ip = (d.get("login") or "").strip().lower(), self.ip_cliente()
            if login_bloqueado(ip, login):
                raise Erro(429, "Muitas tentativas erradas. Aguarde 15 minutos e tente de novo.")
            u = c.execute("SELECT * FROM usuarios WHERE login=? AND ativo=1", (login,)).fetchone()
            if not u or not confere_senha(d.get("senha") or "", u["senha"]):
                login_falhou(ip, login)
                raise Erro(401, "Usuário ou senha incorretos.")
            login_ok(ip, login)
            tok = secrets.token_urlsafe(32)
            exp = (agora_dt() + dt.timedelta(hours=SESSAO_HORAS)).strftime("%Y-%m-%d %H:%M:%S")
            c.execute("DELETE FROM sessoes WHERE expira<?", (agora(),))
            c.execute("INSERT INTO sessoes VALUES (?,?,?)", (tok, u["id"], exp))
            c.commit()
            return self.enviar(200, {"ok": True, "trocar_senha": bool(u["trocar_senha"])},
                               extra={"Set-Cookie": f"sid={tok}; HttpOnly; SameSite=Lax; Path=/; Max-Age={SESSAO_HORAS*3600}" + ("; Secure" if NA_INTERNET else "")})

        if r == "logout":
            ck = SimpleCookie(self.headers.get("Cookie", ""))
            if "sid" in ck:
                c.execute("DELETE FROM sessoes WHERE token=?", (ck["sid"].value,)); c.commit()
            return self.enviar(200, {"ok": True}, extra={"Set-Cookie": "sid=; Path=/; Max-Age=0"})

        if r == "ping":  # usado pelo instalador para achar o servidor na rede (não expõe dados)
            return self.enviar(200, {"sistema": "cartoes-ssm", "maquina": socket.gethostname()})

        u0 = self.sessao(c)
        if u0 and u0["trocar_senha"] and r not in ("me", "minha-senha", "config"):
            raise Erro(403, "Troque sua senha antes de continuar.")

        if r == "me":
            u = self.exigir(c)
            return self.enviar(200, {"id": u["id"], "nome": u["nome"], "login": u["login"], "perfil": u["perfil"],
                                     "trocar_senha": bool(u["trocar_senha"]), "pode_assinar": bool(u["pode_assinar"]),
                                     "cargo": u["cargo"] or "", "assinatura": bool(u["assinatura_arquivo"])})

        if r == "minha-senha" and m == "POST":
            u = self.exigir(c)
            d = self.corpo_json()
            if not confere_senha(d.get("atual") or "", u["senha"]):
                raise Erro(400, "Senha atual incorreta.")
            nova = d.get("nova") or ""
            if len(nova) < SENHA_MIN:
                raise Erro(400, f"A nova senha precisa ter pelo menos {SENHA_MIN} caracteres.")
            if nova == "admin123" or confere_senha(nova, u["senha"]):
                raise Erro(400, "Escolha uma senha diferente da atual.")
            c.execute("UPDATE usuarios SET senha=?, trocar_senha=0 WHERE id=?", (hash_senha(nova), u["id"]))
            c.commit()
            return self.enviar(200, {"ok": True})

        if r == "painel":
            self.exigir(c)
            linhas = c.execute("SELECT * FROM beneficiarios").fetchall()
            cont = {"total": len(linhas), "idoso": 0, "pcd": 0, "ativo": 0, "vencido": 0, "suspenso": 0, "cassado": 0, "vencendo": 0,
                    "a_assinar": 0}
            lim = (hoje() + dt.timedelta(days=30)).isoformat()
            for b in linhas:
                cont[b["tipo"]] += 1
                s = situacao(b)
                cont[s] += 1
                if s == "ativo" and b["validade"] <= lim:
                    cont["vencendo"] += 1
                if b["status"] == "ativo" and not b["assinado_por"]:
                    cont["a_assinar"] += 1
            cont["consultas_hoje"] = c.execute("SELECT COUNT(*) FROM consultas WHERE data>=?", (hoje().isoformat(),)).fetchone()[0]
            cont["invalidas_hoje"] = c.execute("SELECT COUNT(*) FROM consultas WHERE data>=? AND resultado!='ativo'", (hoje().isoformat(),)).fetchone()[0]
            return self.enviar(200, cont)

        if r == "config":
            if m == "GET":
                self.exigir(c)
                return self.enviar(200, {x["chave"]: x["valor"] for x in c.execute("SELECT * FROM config WHERE chave NOT LIKE 'chave_%'")})
            self.exigir(c, "admin")
            d = self.corpo_json()
            for k, v in d.items():
                if k.startswith("chave_"):
                    continue
                if c.execute("SELECT 1 FROM config WHERE chave=?", (k,)).fetchone():
                    if k.startswith("proximo_registro") or k.startswith("validade_anos"):
                        if not str(v).isdigit() or int(v) < 1:
                            raise Erro(400, f"Valor inválido para {k}.")
                    c.execute("UPDATE config SET valor=? WHERE chave=?", (str(v).strip().rstrip("/"), k))
            c.commit()
            return self.enviar(200, {"ok": True})

        if r == "usuarios":
            self.exigir(c, "admin")
            if m == "GET":
                return self.enviar(200, [dict(x) for x in c.execute(
                    "SELECT id,nome,login,perfil,matricula,cargo,pode_assinar,ativo,criado_em,"
                    " (assinatura_arquivo IS NOT NULL) tem_assinatura FROM usuarios ORDER BY nome")])
            d = self.corpo_json()
            if m == "POST":
                login = (d.get("login") or "").strip().lower()
                if not re.fullmatch(r"[a-z0-9._-]{3,30}", login):
                    raise Erro(400, "Login deve ter 3 a 30 caracteres (letras, números, ponto, traço).")
                if d.get("perfil") not in PERFIS or not (d.get("nome") or "").strip():
                    raise Erro(400, "Informe nome e perfil.")
                if len(d.get("senha") or "") < SENHA_MIN:
                    raise Erro(400, f"Senha inicial com pelo menos {SENHA_MIN} caracteres.")
                try:
                    c.execute("INSERT INTO usuarios(nome,login,senha,perfil,matricula,cargo,pode_assinar,trocar_senha,criado_em) VALUES (?,?,?,?,?,?,?,1,?)",
                              (d["nome"].strip(), login, hash_senha(d["senha"]), d["perfil"], (d.get("matricula") or "").strip(),
                               (d.get("cargo") or "").strip(), 1 if d.get("pode_assinar") in (1, True, "1", "on") else 0, agora()))
                except sqlite3.IntegrityError:
                    raise Erro(400, "Já existe um usuário com esse login.")
                c.commit()
                return self.enviar(200, {"ok": True})
            if m == "PUT" and len(p) > 1:
                uid = int(p[1])
                if "ativo" in d:
                    c.execute("UPDATE usuarios SET ativo=? WHERE id=?", (1 if d["ativo"] else 0, uid))
                    if not d["ativo"]:
                        c.execute("DELETE FROM sessoes WHERE usuario_id=?", (uid,))
                if d.get("perfil") in PERFIS:
                    c.execute("UPDATE usuarios SET perfil=? WHERE id=?", (d["perfil"], uid))
                for campo in ("nome", "matricula", "cargo"):
                    if campo in d:
                        v = (d[campo] or "").strip()
                        if campo == "nome" and not v:
                            raise Erro(400, "Informe o nome.")
                        c.execute(f"UPDATE usuarios SET {campo}=? WHERE id=?", (v, uid))
                if "pode_assinar" in d:
                    c.execute("UPDATE usuarios SET pode_assinar=? WHERE id=?", (1 if d["pode_assinar"] in (1, True, "1", "on") else 0, uid))
                if d.get("remover_assinatura"):
                    c.execute("UPDATE usuarios SET assinatura_arquivo=NULL WHERE id=?", (uid,))
                arq = d.get("assinatura_imagem")
                if arq and arq.get("dados"):
                    ext = os.path.splitext(arq.get("nome") or "")[1].lower()
                    if ext not in (".png", ".jpg", ".jpeg"):
                        raise Erro(400, "A imagem da assinatura deve ser PNG ou JPG.")
                    bruto = base64.b64decode(arq["dados"].split(",")[-1])
                    if len(bruto) > 3 * 1024 * 1024:
                        raise Erro(413, "Imagem da assinatura muito grande (máx. 3 MB).")
                    fn = f"{uid}_{agora_dt():%Y%m%d%H%M%S}{ext}"
                    with open(os.path.join(ASSINATURAS, fn), "wb") as f:
                        f.write(bruto)
                    c.execute("UPDATE usuarios SET assinatura_arquivo=? WHERE id=?", (fn, uid))
                if d.get("senha"):
                    if len(d["senha"]) < SENHA_MIN:
                        raise Erro(400, f"Senha com pelo menos {SENHA_MIN} caracteres.")
                    c.execute("UPDATE usuarios SET senha=?, trocar_senha=1 WHERE id=?", (hash_senha(d["senha"]), uid))
                if not c.execute("SELECT 1 FROM usuarios WHERE perfil='admin' AND ativo=1").fetchone():
                    c.rollback()
                    raise Erro(400, "O sistema precisa de pelo menos um administrador ativo.")
                c.commit()
                return self.enviar(200, {"ok": True})

        if r == "assinatura" and m == "GET" and len(p) > 1:
            self.exigir(c)
            u = c.execute("SELECT assinatura_arquivo FROM usuarios WHERE id=?", (int(p[1]),)).fetchone()
            if not u or not u["assinatura_arquivo"]:
                raise Erro(404, "Sem imagem de assinatura.")
            caminho = os.path.join(ASSINATURAS, u["assinatura_arquivo"])
            with open(caminho, "rb") as f:
                return self.enviar(200, f.read(), TIPOS_ARQ.get(os.path.splitext(caminho)[1].lower(), "application/octet-stream"))

        if r == "assinar" and m == "POST":
            d = self.corpo_json()
            u = self.exigir_assinante(c, d.get("senha"))
            n = 0
            for bid in d.get("ids") or []:
                b = c.execute("SELECT * FROM beneficiarios WHERE id=?", (int(bid),)).fetchone()
                if b and b["status"] == "ativo" and not assinatura_ok(c, b):
                    assinar_cartao(c, b, u)
                    n += 1
            c.commit()
            return self.enviar(200, {"ok": True, "assinados": n})

        if r == "consultas":
            self.exigir(c, "admin", "atendente", "fiscal")
            lim = min(int((qs.get("limite") or ["200"])[0]), 2000)
            rows = c.execute("""SELECT q.data, q.ip, q.resultado, q.origem, b.nome, b.tipo, b.registro, u.nome agente
                                FROM consultas q LEFT JOIN beneficiarios b ON b.id=q.beneficiario_id
                                LEFT JOIN usuarios u ON u.id=q.usuario_id ORDER BY q.id DESC LIMIT ?""", (lim,)).fetchall()
            return self.enviar(200, [dict(x) for x in rows])

        if r == "exportar.csv":
            self.exigir(c, "admin")
            buf = io.StringIO()
            w = csv.writer(buf, delimiter=";")
            cols = ["tipo", "registro", "nome", "cpf", "data_nascimento", "telefone", "email", "logradouro", "numero",
                    "bairro", "cidade", "uf", "deficiencia_tipo", "cid", "data_emissao", "validade", "status", "via"]
            w.writerow(cols + ["situacao"])
            for b in c.execute("SELECT * FROM beneficiarios ORDER BY tipo, registro"):
                w.writerow([b[k] for k in cols] + [situacao(b)])
            return self.enviar(200, "﻿" + buf.getvalue(), "text/csv; charset=utf-8",
                               {"Content-Disposition": f'attachment; filename="beneficiarios-{hoje():%Y%m%d}.csv"'})

        if r == "backup":
            self.exigir(c, "admin")
            tmp = os.path.join(DADOS, f"tmp-backup-{secrets.token_hex(4)}.db")
            buf = io.BytesIO()
            try:
                copiar_banco(tmp)
                with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
                    z.write(tmp, "cadastro.db")
                    for f in sorted(os.listdir(LAUDOS)):
                        z.write(os.path.join(LAUDOS, f), "laudos/" + f)
            finally:
                if os.path.exists(tmp):
                    os.remove(tmp)
            return self.enviar(200, buf.getvalue(), "application/zip",
                               {"Content-Disposition": f'attachment; filename="backup-cartoes-{agora_dt():%Y%m%d-%H%M}.zip"'})

        if r == "beneficiarios":
            return self.api_benef(c, m, p[1:], qs)

        raise Erro(404, "Rota não encontrada.")

    # ------------------------------------------------------------ beneficiários
    def validar_benef(self, c, d, bid=None):
        if d.get("tipo") not in TIPOS:
            raise Erro(400, "Escolha o tipo de cartão (Idoso ou Pessoa com Deficiência).")
        if len((d.get("nome") or "").strip()) < 5:
            raise Erro(400, "Informe o nome completo.")
        if not cpf_valido(d.get("cpf")):
            raise Erro(400, "CPF inválido.")
        d["cpf"] = fmt_cpf(d["cpf"])
        d["nome"] = re.sub(r"\s+", " ", d["nome"]).strip().upper()
        nasc = d.get("data_nascimento") or ""
        try:
            dn = dt.date.fromisoformat(nasc)
        except ValueError:
            raise Erro(400, "Informe a data de nascimento.")
        if d["tipo"] == "idoso":
            idade = hoje().year - dn.year - ((hoje().month, hoje().day) < (dn.month, dn.day))
            if idade < 60:
                raise Erro(400, f"Beneficiário tem {idade} anos. O cartão de idoso exige 60 anos ou mais.")
        if d["tipo"] == "pcd" and not (d.get("cid") or d.get("deficiencia_tipo")):
            raise Erro(400, "Para PcD, informe o tipo de deficiência e/ou o CID do laudo.")
        dup = c.execute("SELECT id, registro FROM beneficiarios WHERE cpf=? AND tipo=? AND status!='cassado' AND id!=?",
                        (d["cpf"], d["tipo"], bid or 0)).fetchone()
        if dup:
            raise Erro(400, f"Já existe cartão deste tipo para este CPF (registro nº {fmt_reg(dup['registro'])}). Use renovação ou 2ª via.")
        d["laudo_temporario"] = 1 if d.get("laudo_temporario") in (1, True, "1", "true", "on") else 0
        return d

    def salvar_laudo(self, c, bid, uid, d):
        arq = d.get("laudo")
        if not arq or not arq.get("dados"):
            return
        nome = arq.get("nome") or "laudo"
        ext = os.path.splitext(nome)[1].lower()
        if ext not in (".pdf", ".jpg", ".jpeg", ".png"):
            raise Erro(400, "O laudo deve ser PDF, JPG ou PNG.")
        bruto = base64.b64decode(arq["dados"].split(",")[-1])
        if len(bruto) > MAX_UPLOAD:
            raise Erro(413, "Arquivo do laudo muito grande (máx. 15 MB).")
        fn = f"{bid}_{agora_dt():%Y%m%d%H%M%S}{ext}"
        with open(os.path.join(LAUDOS, fn), "wb") as f:
            f.write(bruto)
        c.execute("UPDATE beneficiarios SET laudo_arquivo=? WHERE id=?", (fn, bid))
        registrar(c, bid, uid, "Laudo anexado", nome)

    def api_benef(self, c, m, p, qs):
        if not p or p[0] == "":
            if m == "GET":
                self.exigir(c)
                q = (qs.get("q") or [""])[0].strip()
                if re.fullmatch(r"\d{1,3}(\.\d{3})+", q):   # "12.132" -> "12132"
                    q = q.replace(".", "")
                sql, args = "SELECT * FROM beneficiarios WHERE 1=1", []
                if q:
                    dig = so_digitos(q)
                    sql += " AND (nome LIKE ? OR CAST(registro AS TEXT)=? OR (?!='' AND REPLACE(REPLACE(cpf,'.',''),'-','') LIKE ?))"
                    args += [f"%{q.upper()}%", q, dig, f"%{dig}%"]
                if (qs.get("tipo") or [""])[0] in TIPOS:
                    sql += " AND tipo=?"; args.append(qs["tipo"][0])
                rows = [benef_dict(b, False) for b in c.execute(sql + " ORDER BY id DESC LIMIT 1000", args)]
                if (qs.get("pendentes") or [""])[0] == "1":
                    rows = [x for x in rows if x["status"] == "ativo" and not x["assinado_por"]]
                sit = (qs.get("situacao") or [""])[0]
                if sit:
                    rows = [x for x in rows if x["situacao"] == sit]
                return self.enviar(200, rows)
            if m == "POST":
                u = self.exigir(c, "admin", "atendente")
                d = self.validar_benef(c, self.corpo_json())
                with _lock:
                    chave = f"proximo_registro_{d['tipo']}"
                    reg = int(cfg(c, chave))
                    while c.execute("SELECT 1 FROM beneficiarios WHERE tipo=? AND registro=?", (d["tipo"], reg)).fetchone():
                        reg += 1
                    emissao = hoje()
                    if d.get("validade"):
                        try:
                            validade = dt.date.fromisoformat(d["validade"])
                        except ValueError:
                            raise Erro(400, "Data de validade inválida.")
                    else:
                        validade = somar_anos(emissao, int(cfg(c, f"validade_anos_{d['tipo']}")))
                    cols = CAMPOS_BENEF + ["registro", "data_emissao", "validade", "status", "token", "via", "criado_por", "criado_em", "atualizado_em", "emitido_por"]
                    vals = [d.get(k) for k in CAMPOS_BENEF] + [reg, emissao.isoformat(), validade.isoformat(), "ativo",
                                                                novo_token(c), 1, u["id"], agora(), agora(), u["id"]]
                    cur = c.execute(f"INSERT INTO beneficiarios({','.join(cols)}) VALUES ({','.join('?'*len(cols))})", vals)
                    bid = cur.lastrowid
                    c.execute("UPDATE config SET valor=? WHERE chave=?", (str(reg + 1), chave))
                    registrar(c, bid, u["id"], "Cadastro e emissão do cartão", f"Registro nº {fmt_reg(reg)} – validade {validade:%d/%m/%Y}")
                    self.salvar_laudo(c, bid, u["id"], d)
                    c.commit()
                return self.enviar(200, {"ok": True, "id": bid, "registro": reg})

        bid = int(p[0])
        b = c.execute("SELECT * FROM beneficiarios WHERE id=?", (bid,)).fetchone()
        if not b:
            raise Erro(404, "Beneficiário não encontrado.")
        acao = p[1] if len(p) > 1 else ""

        if m == "GET" and acao == "":
            u = self.exigir(c)
            d = benef_dict(b)
            d["link_qr"] = f"{cfg(c, 'endereco_base')}/v/{b['token']}"
            d["assinatura"] = assinatura_info(c, b)
            d["exigir_assinatura"] = cfg(c, "exigir_assinatura") != "0"
            e = c.execute("SELECT nome, matricula FROM usuarios WHERE id=?", (b["emitido_por"],)).fetchone()
            d["servidor_responsavel"] = {"nome": e["nome"], "matricula": e["matricula"] or ""} if e else None
            d["historico"] = [dict(x) for x in c.execute(
                "SELECT h.data, h.acao, h.detalhe, u.nome usuario FROM historico h LEFT JOIN usuarios u ON u.id=h.usuario_id WHERE beneficiario_id=? ORDER BY h.id DESC", (bid,))]
            d["consultas"] = [dict(x) for x in c.execute(
                "SELECT q.data, q.resultado, q.origem, q.ip, u.nome agente FROM consultas q LEFT JOIN usuarios u ON u.id=q.usuario_id WHERE beneficiario_id=? ORDER BY q.id DESC LIMIT 100", (bid,))]
            if u["perfil"] == "fiscal":  # fiscal vê o essencial e a consulta fica registrada
                c.execute("INSERT INTO consultas(beneficiario_id, token, data, ip, usuario_id, resultado, origem) VALUES (?,?,?,?,?,?,?)",
                          (bid, b["token"], agora(), self.ip_cliente(), u["id"], d["situacao"], "Sistema"))
                c.commit()
                d = {k: d[k] for k in ("id", "tipo", "nome", "registro", "data_emissao", "validade", "situacao", "status",
                                       "motivo_status", "via", "consultas", "assinatura")}
            return self.enviar(200, d)

        if m == "GET" and acao == "laudo":
            self.exigir(c, "admin", "atendente")
            if not b["laudo_arquivo"]:
                raise Erro(404, "Nenhum laudo anexado.")
            caminho = os.path.join(LAUDOS, b["laudo_arquivo"])
            with open(caminho, "rb") as f:
                return self.enviar(200, f.read(), TIPOS_ARQ.get(os.path.splitext(caminho)[1].lower(), "application/octet-stream"),
                                   {"Content-Disposition": f'inline; filename="{b["laudo_arquivo"]}"'})

        if m == "PUT" and acao == "":
            u = self.exigir(c, "admin", "atendente")
            d = self.corpo_json()
            d["tipo"] = b["tipo"]  # tipo não muda depois de emitido
            d = self.validar_benef(c, d, bid)
            sets = ",".join(f"{k}=?" for k in CAMPOS_BENEF if k != "tipo")
            c.execute(f"UPDATE beneficiarios SET {sets}, atualizado_em=? WHERE id=?",
                      [d.get(k) for k in CAMPOS_BENEF if k != "tipo"] + [agora(), bid])
            mud = [k for k in CAMPOS_BENEF if k != "tipo" and str(b[k] or "") != str(d.get(k) or "")]
            registrar(c, bid, u["id"], "Dados atualizados", ", ".join(mud) if mud else "sem alterações")
            b2 = c.execute("SELECT * FROM beneficiarios WHERE id=?", (bid,)).fetchone()
            if b2["assinado_por"] and not assinatura_ok(c, b2):
                limpar_assinatura(c, bid)
                registrar(c, bid, u["id"], "Assinatura cancelada", "Dados impressos no cartão foram alterados. É preciso assinar de novo.")
            self.salvar_laudo(c, bid, u["id"], d)
            c.commit()
            return self.enviar(200, {"ok": True})

        if m == "POST" and acao == "status":
            d = self.corpo_json()
            novo = d.get("status")
            if novo not in STATUS:
                raise Erro(400, "Situação inválida.")
            u = self.exigir(c, "admin") if novo == "cassado" or b["status"] == "cassado" else self.exigir(c, "admin", "atendente")
            motivo = (d.get("motivo") or "").strip()
            if novo != "ativo" and len(motivo) < 5:
                raise Erro(400, "Descreva o motivo (ex.: item 2.1 – empréstimo do cartão a terceiros).")
            c.execute("UPDATE beneficiarios SET status=?, motivo_status=?, atualizado_em=? WHERE id=?",
                      (novo, motivo if novo != "ativo" else None, agora(), bid))
            nomes = {"ativo": "Cartão reativado", "suspenso": "Cartão SUSPENSO", "cassado": "Cartão CASSADO"}
            registrar(c, bid, u["id"], nomes[novo], motivo)
            c.commit()
            return self.enviar(200, {"ok": True})

        if m == "POST" and acao in ("renovar", "segunda-via"):
            u = self.exigir(c, "admin", "atendente")
            if b["status"] == "cassado":
                raise Erro(400, "Cartão cassado não pode ser renovado nem reemitido.")
            d = self.corpo_json()
            tok = novo_token(c)
            if acao == "renovar":
                emissao = hoje()
                if d.get("validade"):
                    validade = dt.date.fromisoformat(d["validade"])
                else:
                    validade = somar_anos(emissao, int(cfg(c, f"validade_anos_{b['tipo']}")))
                c.execute("UPDATE beneficiarios SET data_emissao=?, validade=?, token=?, via=via+1, status='ativo', motivo_status=NULL, atualizado_em=?,"
                          " emitido_por=?, assinado_por=NULL, assinado_em=NULL, assinatura_hash=NULL WHERE id=?",
                          (emissao.isoformat(), validade.isoformat(), tok, agora(), u["id"], bid))
                registrar(c, bid, u["id"], "Cartão renovado", f"Nova validade {validade:%d/%m/%Y} – {b['via']+1}ª via. QR anterior invalidado.")
            else:
                motivo = (d.get("motivo") or "").strip() or "não informado"
                c.execute("UPDATE beneficiarios SET token=?, via=via+1, atualizado_em=?, emitido_por=?,"
                          " assinado_por=NULL, assinado_em=NULL, assinatura_hash=NULL WHERE id=?", (tok, agora(), u["id"], bid))
                registrar(c, bid, u["id"], f"Emitida {b['via']+1}ª via", f"Motivo: {motivo}. QR anterior invalidado.")
            c.commit()
            return self.enviar(200, {"ok": True})

        if m == "POST" and acao == "assinar":
            u = self.exigir_assinante(c, self.corpo_json().get("senha"))
            if b["status"] != "ativo":
                raise Erro(400, "Só é possível assinar cartão ativo (não suspenso nem cassado).")
            if not assinatura_ok(c, b):
                assinar_cartao(c, b, u)
                c.commit()
            return self.enviar(200, {"ok": True})

        if m == "POST" and acao == "impressao":
            u = self.exigir(c, "admin", "atendente")
            if cfg(c, "exigir_assinatura") != "0" and not assinatura_ok(c, b):
                raise Erro(400, "O cartão precisa ser assinado antes de imprimir.")
            registrar(c, bid, u["id"], "Cartão impresso", f"{b['via']}ª via")
            c.commit()
            return self.enviar(200, {"ok": True})

        raise Erro(404, "Rota não encontrada.")

    # ------------------------------------------------------------ consulta pública (QR)
    def pagina_consulta(self, c, token):
        token = re.sub(r"[^A-Za-z0-9_-]", "", token)[:64]
        b = c.execute("SELECT * FROM beneficiarios WHERE token=?", (token,)).fetchone() if token else None
        u = self.sessao(c)
        ip = self.ip_cliente()
        sit = situacao(b) if b else "invalido"
        c.execute("INSERT INTO consultas(beneficiario_id, token, data, ip, usuario_id, resultado, origem) VALUES (?,?,?,?,?,?,?)",
                  (b["id"] if b else None, token, agora(), ip, u["id"] if u else None, sit, "QR"))
        c.commit()
        info = {
            "ativo": ("VÁLIDO", "#0b7a3b", "Cartão regular. Estacionamento autorizado nas vagas especiais sinalizadas."),
            "vencido": ("VENCIDO", "#b42318", "A validade do cartão expirou (item 2.5). Não autoriza o uso da vaga."),
            "suspenso": ("SUSPENSO", "#b54708", "A autorização está suspensa pelo órgão de trânsito."),
            "cassado": ("CASSADO", "#7a0916", "A autorização foi cassada pelo órgão de trânsito."),
            "invalido": ("NÃO RECONHECIDO", "#475467", "Este QR não corresponde a nenhum cartão em vigor. "
                         "Pode ser uma via antiga substituída, cópia ou cartão falsificado (itens 2.2 e 2.3). Confira o nº de registro com a central."),
        }[sit]
        e = html.escape
        corpo = ""
        if b:
            tipo = "IDOSO (60+) – Res. 303/08" if b["tipo"] == "idoso" else "PESSOA COM DEFICIÊNCIA – Res. 304/08"
            linhas = [("Beneficiário", b["nome"]), ("Tipo", tipo), ("Nº do registro", fmt_reg(b["registro"])),
                      ("Emissão", dt.date.fromisoformat(b["data_emissao"]).strftime("%d/%m/%Y")),
                      ("Validade", dt.date.fromisoformat(b["validade"]).strftime("%d/%m/%Y")),
                      ("Via", f"{b['via']}ª via"), ("Órgão expedidor", cfg(c, "orgao_expedidor") + " – " + cfg(c, "municipio") + "/" + cfg(c, "uf"))]
            ai = assinatura_info(c, b)
            if ai["valida"]:
                quando = dt.datetime.strptime(ai["em"], "%Y-%m-%d %H:%M:%S").strftime("%d/%m/%Y")
                linhas.append(("Assinado eletronicamente por", f"{ai['nome']}{' – ' + ai['cargo'] if ai['cargo'] else ''}, em {quando}"))
                linhas.append(("Código de verificação", ai["codigo"]))
            elif ai["assinado"]:
                linhas.append(("Assinatura eletrônica", "NÃO CONFERE – dados alterados após a assinatura"))
            else:
                linhas.append(("Assinatura eletrônica", "aguardando assinatura"))
            if sit in ("suspenso", "cassado") and b["motivo_status"]:
                linhas.append(("Motivo", b["motivo_status"]))
            corpo = "".join(f"<div class='l'><span>{e(k)}</span><b>{e(v)}</b></div>" for k, v in linhas)
        quem = f"Consulta registrada por {e(u['nome'])}" if u else "Consulta registrada"
        pagina = f"""<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Consulta de cartão – SSM Bagé</title>
<style>
body{{margin:0;font-family:Arial,Helvetica,sans-serif;background:#f2f4f7;color:#101828}}
.top{{background:#1c1c1c;color:#fff;padding:14px 16px;display:flex;gap:12px;align-items:center}}
.top img{{height:44px;background:#fff;border-radius:4px;padding:2px}}
.top div{{font-size:13px;line-height:1.3}} .top b{{font-size:15px}}
.st{{background:{info[1]};color:#fff;text-align:center;padding:26px 16px}}
.st h1{{margin:0;font-size:34px;letter-spacing:1px}} .st p{{margin:8px auto 0;max-width:520px;font-size:15px;line-height:1.4}}
.box{{max-width:560px;margin:16px auto;background:#fff;border-radius:10px;padding:6px 16px;box-shadow:0 1px 3px rgba(0,0,0,.12)}}
.l{{display:flex;justify-content:space-between;gap:12px;padding:11px 0;border-bottom:1px solid #eaecf0;font-size:15px}}
.l:last-child{{border:0}} .l span{{color:#667085}} .l b{{text-align:right}}
.rod{{text-align:center;color:#667085;font-size:12px;padding:8px 16px 30px}}
</style></head><body>
<div class="top"><img src="/img/brasao-bage.png" alt=""><div><b>Prefeitura Municipal de Bagé</b><br>
Secretaria de Segurança e Mobilidade Urbana – SSM<br>Consulta de Cartão de Estacionamento – Vaga Especial</div></div>
<div class="st"><h1>{info[0]}</h1><p>{e(info[2])}</p></div>
{f'<div class="box">{corpo}</div>' if corpo else ''}
<div class="rod">{quem} em {agora_dt():%d/%m/%Y às %H:%M:%S}.<br>Confira o nome com um documento oficial do beneficiário.</div>
</body></html>"""
        self.enviar(200, pagina, "text/html; charset=utf-8")


def main():
    if LOG_ARQUIVO:
        os.makedirs(DADOS, exist_ok=True)
        log = open(os.path.join(DADOS, "servidor.log"), "a", encoding="utf-8", buffering=1)
        sys.stdout = sys.stderr = log
    else:
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    iniciar_banco()
    threading.Thread(target=_ciclo_backup, daemon=True).start()
    c = conectar()
    base = cfg(c, "endereco_base")
    c.close()
    try:
        srv = ThreadingHTTPServer((HOST, PORTA), Handler)
    except OSError:
        print("\n  ERRO: a porta %d já está em uso neste computador." % PORTA)
        print("  O sistema já pode estar aberto em outra janela preta (feche-a),")
        print("  ou outro programa usa essa porta. Para usar outra porta: python servidor.py 8081\n")
        return
    ip = ip_local()
    try:
        with open(os.path.join(DADOS, "endereco.txt"), "w", encoding="utf-8") as f:
            f.write(f"http://{ip}:{PORTA}\n")
    except Exception:
        pass
    print("=" * 66)
    print("  SISTEMA DE CARTÕES DE ESTACIONAMENTO – SSM BAGÉ")
    print("=" * 66)
    print(f"  Neste computador:    http://localhost:{PORTA}")
    if NA_INTERNET:
        print(f"  Na internet:         {ENDERECO_PUBLICO or '(endereço público não definido)'}")
    elif SO_LOCAL:
        print("  Modo:                somente este computador (sem rede)")
    else:
        print(f"  Na rede local:       http://{ip}:{PORTA}")
    print(f"  Endereço nos QR:     {base}   (altere em Configurações)")
    print(f"  Dados e backups:     {DADOS}")
    if not NA_INTERNET:
        print("  Primeiro acesso:     usuário admin / senha admin123")
    print("  Para encerrar: feche esta janela ou pressione Ctrl+C")
    print("=" * 66)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor encerrado.")


if __name__ == "__main__":
    main()
