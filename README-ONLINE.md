# Versao Online - Prevencao de Perdas

Esta pasta e uma copia separada do projeto para publicar em um servico com link de acesso, como Render ou Railway.

## Importante

Esta versao continua usando SQLite. Para testes e uso simples, funciona bem. Para uso definitivo em producao, o ideal e migrar para PostgreSQL ou outro banco online gerenciado.

## Render

1. Suba esta pasta para um repositorio no GitHub.
2. No Render, crie um **New Web Service**.
3. Conecte o repositorio.
4. Use:

```text
Build Command: npm run init-db
Start Command: npm start
```

O arquivo `render.yaml` ja inclui uma configuracao basica.

## Acessos iniciais

| Perfil | Usuario | Senha |
| --- | --- | --- |
| Administrador | admin | adm123 |
| Prevencao | prevencao | prev123 |
| Encarregada | encarregada | enc123 |

Depois de acessar como administrador, crie os colaboradores e os acessos reais na aba **Acessos**.

## Rodar localmente

```powershell
.\start.ps1
```

ou:

```powershell
npm run init-db
npm start
```
