# Sistema de Cartões de Estacionamento – Vaga Especial
**SSM – Secretaria de Segurança e Mobilidade Urbana – Prefeitura de Bagé/RS**

Este sistema roda na rede local. Ele cadastra os beneficiários (idoso 60+ e pessoa com deficiência), gera o número de registro, imprime o cartão já preenchido com QR Code e controla a fiscalização.

> **Instalado pelo INSTALAR.bat (modo um computador só)?** O sistema liga sozinho ao entrar no Windows e é aberto pelo atalho **"Sistema de Cartões SSM"**. Ligar, desligar e backup ficam no atalho **"Painel do Sistema de Cartões"**. Não use o `iniciar.bat`. Veja o arquivo *LEIA-ME - INSTALACAO.txt* do instalador.
>
> Neste modo o sistema atende só o próprio computador: a consulta pelo QR no celular não funciona. Os itens abaixo sobre rede e QR valem apenas se o sistema for instalado em rede no futuro.

---

## 1. Instalação (uma vez só)

1. Escolha um computador da SSM que fique **ligado durante o expediente**. Ele será o servidor.
2. Instale o **Python 3**, que é gratuito: https://www.python.org/downloads/
   - Durante a instalação, marque **"Add Python to PATH"**.
3. Copie a pasta `sistema-cartoes` para esse computador, por exemplo em `C:\SistemaCartoes`.
4. Peça à TI para **reservar um IP fixo** para esse computador, por exemplo `192.168.0.10`.
   - Esse IP vai impresso dentro do QR de todos os cartões. Se ele mudar, os cartões antigos param de funcionar.

## 2. Ligar o sistema

- Dê dois cliques em **`iniciar.bat`**.
  - Abre uma janela preta, que é o servidor. **Deixe essa janela aberta.**
  - O navegador abre sozinho.
- Na primeira vez, o Windows pergunta se libera o acesso na rede. Clique em **Permitir**, marcando a opção de **rede privada**.
- Nos outros computadores e nos celulares da rede, acesse o endereço que aparece na janela, por exemplo `http://192.168.0.10:8080`.

**Primeiro acesso:** usuário `admin`, senha `admin123`. O sistema obriga a trocar a senha.

## 3. Configurar antes de imprimir o primeiro cartão

No menu **Configurações** (só administrador):

- **Endereço base do QR:** use o IP fixo do servidor, por exemplo `http://192.168.0.10:8080`.
- **Próximo nº de registro:** um campo para idoso e outro para PcD. Use para continuar a numeração que vocês já usam, por exemplo `11611`.
- **Validade padrão:** em anos, para cada tipo.
- **Órgão expedidor, município e UF:** são os dados impressos no cartão.

Depois, em **Usuários**, crie um login para cada servidor:

| Perfil | O que pode fazer |
|---|---|
| **Administrador** | Tudo, inclusive **cassar**, criar usuários e configurar |
| **Atendente** | Cadastrar, editar, imprimir, renovar, emitir 2ª via e suspender |
| **Fiscal / agente** | Consultar cartões. Cada consulta fica registrada com o nome do agente |

## 4. Uso no dia a dia

1. **Novo cadastro:** escolha o tipo (Idoso ou PcD) e preencha os dados.
   - No PcD, anexe o laudo em PDF ou foto.
   - O sistema confere o CPF, a idade mínima de 60 anos e se a pessoa já tem cartão.
2. **Salvar e gerar cartão:** o nº de registro, a data de emissão, a validade e o QR são gerados automaticamente.
3. **Imprimir cartão:**
   - **Folha A4:** frente e verso saem na mesma folha. Recorte pela linha pontilhada, dobre na linha tracejada e plastifique.
   - **Papel A6:** uma página para cada lado.
4. **Renovar:** gera nova emissão e nova validade.
5. **Emitir 2ª via:** em caso de perda, roubo ou dano.
6. **Suspender, cassar ou reativar:** sempre com o motivo, conforme os itens 2.1 a 2.5 do verso.

**Importante:** na renovação e na 2ª via, o QR antigo é **invalidado**. Se alguém usar a via antiga, a fiscalização mostra "NÃO RECONHECIDO".

## 5. Fiscalização com o QR

O agente aponta a **câmera do celular** para o QR, sem precisar de aplicativo. A página de consulta mostra:

- 🟢 **VÁLIDO**
- 🔴 **VENCIDO**, 🟠 **SUSPENSO**, 🔴 **CASSADO**, com o motivo
- ⚫ **NÃO RECONHECIDO**: cópia, via antiga ou cartão falso

A página também mostra nome, tipo, nº de registro, emissão e validade. **Não mostra CPF, endereço nem telefone** (LGPD).

Cada leitura fica registrada em **Fiscalização**, com data, hora e agente. Se o celular estiver logado no sistema, aparece o nome do agente.

⚠️ **O celular precisa estar na rede da SSM** (Wi-Fi interno ou VPN) para abrir a consulta. Sem rede, o agente confere o nº de registro com a central pelo menu Fiscalização.

Se no futuro a TI publicar a consulta na internet, basta trocar o **Endereço base do QR**. Atenção: os cartões já impressos continuam com o endereço antigo.

## 6. Backup e segurança

- **Tudo fica na pasta `dados`:** o banco `cadastro.db`, os laudos e os backups automáticos (um por dia, os últimos 30).
- **Copie a pasta `dados` toda semana** para outro lugar, como a rede da Prefeitura ou um pen drive guardado.
- **Para levar o sistema para outro computador:** copie a pasta inteira, incluindo `dados`, e mantenha o mesmo IP.
- **Senhas:** são guardadas com criptografia. Ninguém consegue ver a senha de outra pessoa.
- **Login:** a sessão expira em 12 horas.

## 7. Arquivos

```
sistema-cartoes/
├── iniciar.bat        ← liga o sistema (Windows)
├── iniciar.sh         ← liga o sistema (Linux)
├── servidor.py        ← servidor (Python, sem instalar nada extra)
├── web/               ← telas do sistema e modelo do cartão
└── dados/             ← criada no primeiro uso: banco, laudos e backups
```

A porta padrão é 8080. Para usar outra, rode `python servidor.py 9000`.
