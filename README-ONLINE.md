# Versao Online - Prevencao de Perdas

Esta pasta e uma copia separada do projeto para publicar em um servico com link de acesso, como Render ou Railway.

## Importante

Esta versao esta preparada para usar PostgreSQL online quando a variavel `DATABASE_URL` estiver configurada no Render.

Se `DATABASE_URL` nao existir, o sistema usa SQLite apenas como modo local/teste. No Render, use PostgreSQL para os dados nao sumirem quando o servidor reiniciar.

## Render

1. Suba esta pasta para um repositorio no GitHub.
2. No Render, crie um **New Web Service**.
3. Conecte o repositorio.
4. Use:

```text
Build Command: npm run init-db
Start Command: npm start
```

5. Em **Environment**, adicione a variavel:

```text
DATABASE_URL=cole_aqui_a_string_do_postgresql
```

O arquivo `render.yaml` ja inclui uma configuracao basica.

## Acessos iniciais

| Perfil | Usuario | Senha |
| --- | --- | --- |
| Administrador | admin | adm123 |

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
