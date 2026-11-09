# Sistema de Cartões de Estacionamento – Vaga Especial
**SSM – Secretaria de Segurança e Mobilidade Urbana – Prefeitura de Bagé/RS**

Versão para a internet (Railway). Funciona em qualquer computador ou celular, só pelo navegador.
Manual de uso das telas: `LEIA-ME.md`.

## Variáveis de ambiente
| Variável | Para que serve |
|---|---|
| `DADOS_DIR` | Pasta do banco, laudos e backups. Na nuvem: `/data` (volume persistente). |
| `ENDERECO_PUBLICO` | Endereço gravado no QR. Se vazio, usa o domínio do Railway. |
| `ADMIN_SENHA_INICIAL` | Senha do `admin` criada no primeiro início (o sistema obriga a trocar). |
| `FUSO_HORARIO` | Fuso das datas: `-3` (Brasília). |
| `PORT` | Porta (o Railway define sozinho). |

## Segurança na internet
- HTTPS (Railway), cookie de sessão `Secure` e `HttpOnly`, sessão de 12 h.
- Login bloqueado por 15 min após 5 senhas erradas (por usuário e IP) ou 30 erros por IP.
- Senhas com no mínimo 8 caracteres; a senha inicial do admin precisa ser trocada.
- A consulta pública do QR (`/v/...`) mostra só nome, tipo, nº, emissão, validade e situação (LGPD).

## Backup
- Automático, um por dia, no volume (`/data/backups`, últimos 30).
- **Configurações > Baixar backup completo** gera um .zip com o banco e os laudos: baixe toda semana.

## Rodar no computador (sem internet)
`python servidor.py` e abra http://localhost:8080 (primeiro acesso: admin / admin123).
