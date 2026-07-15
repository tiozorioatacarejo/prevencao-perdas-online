# Sistema Web - Relatorio Diario de Atividades

Sistema local para digitalizar o **RELATORIO DIARIO DE ATIVIDADES - PREVENCAO DE PERDAS** do Atacarejo Antonio de Ozorio.

## Como rodar

Opcao mais simples no Windows:

```text
Clique duas vezes em Iniciar Sistema.cmd
```

Para parar:

```text
Clique duas vezes em Parar Sistema.cmd
```

Opcao pelo PowerShell, dentro da pasta do projeto:

```powershell
.\start.ps1
```

Depois acesse:

```text
http://localhost:3000
```

Se voce ja tiver Node.js e Python instalados, tambem pode rodar:

```powershell
npm run init-db
npm start
```

## Subir para o GitHub

Se o Git estiver instalado no seu computador:

```powershell
git init
git add .
git commit -m "Sistema de prevencao de perdas"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/NOME-DO-REPOSITORIO.git
git push -u origin main
```

Antes disso, crie um repositorio vazio no GitHub e troque `SEU-USUARIO` e `NOME-DO-REPOSITORIO` pelos seus dados.

## Criar link de acesso

Este sistema tem backend em Node.js e banco SQLite local. Por isso, ele nao funciona apenas no GitHub Pages.

Para ter um link de acesso publico, hospede como aplicacao web Node.js em uma plataforma como Render, Railway, Fly.io, VPS ou similar.

Configuracao basica:

```text
Build command: npm run init-db
Start command: npm start
Porta: usar a variavel PORT da plataforma
```

O servidor ja esta preparado para usar `process.env.PORT`.

## Acesso inicial

| Perfil | Usuario | Senha |
| --- | --- | --- |
| Administrador | admin | adm123 |

## Criar acesso para colaboradores

1. Entre como administrador: `admin` / `adm123`.
2. Cadastre o colaborador em **Colaboradores**.
3. Entre em **Acessos**.
4. Informe nome exibido, usuario e senha.
5. Selecione o perfil **Colaborador**.
6. Vincule o acesso ao colaborador cadastrado.
7. Repasse usuario e senha para a pessoa.

Usuarios dos perfis prevencao e colaborador veem **Painel**, **Checklist** e **Pendencias**.
Usuario encarregada ve **Painel**, **Checklist**, **Resumo** e **Pendencias**.
Usuarios de reposicao veem apenas o modulo **Reposicao**.
Usuarios comerciais veem apenas o modulo **Reposicao**, com foco no retorno comercial.
Somente o administrador ve todos os menus do sistema.

## Recursos entregues

- Login por perfil.
- Cadastro de acessos com usuario/senha definidos pelo administrador.
- Cadastro de colaboradores ativos/inativos.
- Checklist diario com data, hora, atividade, sim/nao e observacao.
- Checklist inclui produtos com divergencia de precos e produtos vencidos encontrados.
- Checklist inclui portas/acessos, cancelamentos/estornos, passagem correta no caixa e devolucoes acompanhadas.
- Usuario vinculado a colaborador entra direto no checklist.
- Usuarios dos perfis prevencao e colaborador veem painel, checklist e pendencias.
- Encarregada ve painel, checklist, resumo e pendencias.
- Apenas administrador ve relatorios, colaboradores e acessos.
- Colaborador pode editar preenchimento enviado por ele em caso de erro.
- Administrador pode excluir preenchimentos.
- Administrador e encarregada podem corrigir registros.
- Resumo operacional diario.
- Dashboard gerencial com indicadores e ocorrencias por colaborador.
- Painel liberado para visualizacao por colaboradores/prevenção.
- Painel permite filtrar por periodo e exportar relatorio.
- Engajamento mensal por colaborador no dashboard, com base na participacao nos preenchimentos realizados.
- Percentual mensal de realizacao por atividade no dashboard.
- Relatorios com filtros por data, periodo, colaborador e atividade.
- Exportacao em PDF e Excel.
- Controle de pendencias com responsavel, status e solucao.
- Modulo de reposicao da loja no mesmo sistema.
- Registro de atividades de reposicao por colaborador e setor.
- Controle de rupturas, validades curtas, avarias e retorno comercial.
- Painel de reposicao com indicadores por periodo e setor.
- Banco SQLite local em `data/app.sqlite`.
- Na versao online, use PostgreSQL configurando `DATABASE_URL` no Render.
- A primeira execucao cria apenas o acesso administrador inicial.

## Observacoes

O sistema foi criado para uso local inicial. As senhas e sessoes usam uma abordagem simples para testes internos; para producao, recomenda-se trocar por autenticacao com hash de senha, HTTPS e controle de auditoria mais robusto.
