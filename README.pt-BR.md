# Servidor MCP do Persist Notes

[English](README.md)

Um servidor [MCP](https://modelcontextprotocol.io) que dá ao Claude (Claude Code, Claude Desktop ou qualquer cliente MCP) acesso **somente leitura** às suas reuniões do [Persist Notes](https://persistnotes.com): busca nos resumos e transcrições, leitura do resumo de uma reunião, ações pendentes e decisões, projetos e a síntese viva de cada um, e os resumos de período (semana, mês).

O Persist Notes salva cada reunião como um arquivo Markdown comum (frontmatter + resumo + suas anotações + transcrição). Este servidor lê esses arquivos diretamente. Não precisa do app aberto, nem instalado: basta ter a pasta de notas.

## Privacidade

- **Só local.** O servidor roda no seu computador, por stdio. Não abre conexões de rede e não envia nada a lugar nenhum por conta própria.
- **Só leitura.** Nunca cria, altera ou apaga arquivos. No processo do servidor, todas as funções de escrita em disco ficam bloqueadas.
- **O que o Claude vê.** Só o texto que uma ferramenta devolve (trechos, resumos, ações) vai para o Claude, como parte da sua conversa. Os áudios nunca são lidos.

## Requisitos

- Node.js 18 ou mais novo (`node --version`).
- Uma pasta de notas do Persist Notes (o padrão do app é `~/Documents/Persist Notes`; a sua aparece nas Configurações do app).

## Configuração

O servidor procura a pasta de notas nesta ordem:

1. `--notes-dir "<pasta>"`
2. a variável de ambiente `PERSIST_NOTES_DIR`
3. `notesDir` nas configurações do app (`~/Library/Application Support/Persist Notes/settings.json` no macOS, `%APPDATA%\Persist Notes\settings.json` no Windows, `~/.config/Persist Notes/settings.json` no Linux)
4. `~/Documents/Persist Notes`

### Claude Code

```bash
claude mcp add persist-notes -- npx -y @persistnotes/mcp --notes-dir "/Users/voce/Documents/Persist Notes"
```

Com `--scope user` o servidor fica disponível em todos os projetos. Confira com `claude mcp list`.

### Claude Desktop

Edite o `claude_desktop_config.json` (Configurações → Desenvolvedor → Editar configuração) e reinicie o Claude Desktop:

```json
{
  "mcpServers": {
    "persist-notes": {
      "command": "npx",
      "args": ["-y", "@persistnotes/mcp", "--notes-dir", "/Users/voce/Documents/Persist Notes"]
    }
  }
}
```

No Windows, use um caminho como `"C:\\Users\\voce\\Documents\\Persist Notes"`.

### Opções

| Opção | O que faz |
|---|---|
| `--notes-dir <pasta>` | Pasta de notas (veja a ordem acima) |
| `--lang en\|pt-BR\|es` | Idioma das mensagens de erro (padrão: o do sistema) |
| `--legacy-tools` | Lista também os nomes em português do servidor que vem com o app |
| `--version`, `--help` | Versão e ajuda |

## Ferramentas

| Ferramenta | O que faz |
|---|---|
| `search_meetings` | Busca (BM25) nos resumos, anotações, transcrições e resumos de período; devolve trechos com reunião, data e seção |
| `list_meetings` | Reuniões, mais recentes primeiro; filtro por projeto e período |
| `read_meeting` | As seções do resumo de uma reunião; `full: true` devolve o arquivo inteiro (com a transcrição), `include_notes: true` inclui suas anotações |
| `list_actions` | Ações dos "Próximos passos" dos resumos, com responsável, prazo e status (`open`, `done`, `all`) |
| `list_decisions` | Decisões registradas nos resumos, com data e reunião |
| `list_projects` | Projetos (pastas), número de reuniões e se há síntese |
| `read_project_synthesis` | A síntese viva de um projeto (`_synthesis.md`) |
| `list_period_summaries` | Resumos de período salvos em `summaries/` |
| `read_period_summary` | Um resumo de período (o mais recente, por padrão) |

Todas as ferramentas são só de leitura (`readOnlyHint`). Os títulos das seções são reconhecidos em português, inglês e espanhol.

Para compatibilidade com o servidor que vem com o app, os nomes em português (`buscar`, `listar_reunioes`, `ler_reuniao`, `commitments`, `decisoes`, `listar_projetos`, `sintese_projeto`) também são aceitos, com a mesma saída.

## Problemas comuns

- **"Notes folder not found"**: indique a pasta certa com `--notes-dir` (entre aspas, se tiver espaços) e reinicie o cliente.
- **"Permission denied" / `EPERM` no macOS**: a pasta Documentos é protegida. Autorize o app que inicia o servidor (Claude, Terminal, seu editor) em Ajustes do Sistema → Privacidade e Segurança → Arquivos e Pastas (ou Acesso Total ao Disco) e reinicie esse app.
- **`npx` não encontrado no Claude Desktop**: o Claude Desktop pode não enxergar o `PATH` do seu terminal. Use o caminho completo do `npx` (`which npx`) em `command`.
- **Resultados vazios**: confira se a pasta tem os `.md` das reuniões (reuniões na raiz, projetos como subpastas). Rode `npx -y @persistnotes/mcp --notes-dir "<pasta>"` num terminal: a primeira linha (stderr) mostra a pasta em uso. Pare com Ctrl+C.
- **Logs**: Claude Code: `claude mcp list` / `claude --debug`. Claude Desktop: `~/Library/Logs/Claude/mcp-server-persist-notes.log` (macOS), `%APPDATA%\Claude\logs` (Windows).

## Desenvolvimento

O servidor reaproveita os módulos de leitura do app Persist Notes. `npm run build` (executado também por `npm pack`/`npm publish`) copia esses módulos sem alteração para `dist/`; `src/server.js` é a entrada.

## Licença

MIT
