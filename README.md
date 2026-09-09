# Bot Discord Multifuncional

Bot de gerenciamento com tickets, moderação, **AutoMod configurável**, sorteios, boas-vindas, logs, self-roles, verificação, emojis configuráveis e controle de status — Node.js + discord.js v14 + SQLite (better-sqlite3).

## Setup

1. Crie a aplicação em https://discord.com/developers/applications, ative os **Privileged Gateway Intents**: `SERVER MEMBERS` e `MESSAGE CONTENT` (este é obrigatório: é como o AutoMod lê o conteúdo das mensagens e como o `/config-emojis` lê o emoji que você manda no chat).
2. Copie `.env.example` para `.env` e preencha `DISCORD_TOKEN`, `CLIENT_ID` e (opcional) `GUILD_ID` para testes.
3. Registre os comandos e inicie:

```bash
npm run deploy
```

```bash
npm start
```

Convide o bot com o scope `bot applications.commands` e permissão de Administrador (ou as permissões mínimas: Manage Channels, Manage Roles, Ban/Kick/Moderate Members, Manage Messages, Create Invite).

Os testes da lógica pura (normalização de texto, curingas, detectores, janelas de tempo, escada de pontos) rodam sem Discord e sem dependência extra:

```bash
npm test
```

## Comandos

São 31 comandos. A coluna **Permissão** é a exigência padrão do Discord para o membro ver e usar o comando (dá para sobrescrever em _Configurações do servidor → Integrações_).

### Moderação

| Comando | O que faz | Permissão |
|---|---|---|
| `/ban usuario motivo apagar_dias` | Bane um membro do servidor | Banir membros |
| `/kick usuario motivo` | Expulsa um membro do servidor | Expulsar membros |
| `/mute usuario duracao motivo` | Silencia um membro (timeout nativo do Discord) | Moderar membros |
| `/warn usuario motivo` | Aplica uma advertência a um membro | Moderar membros |
| `/warnings usuario` | Lista as advertências de um membro | Moderar membros |
| `/clear quantidade` | Apaga mensagens do canal atual | Gerenciar mensagens |
| `/infractions usuario limpar desfazer motivo avisar` | Pontos, degrau da escada e histórico de infrações do AutoMod — e o perdão, que zera os pontos e desfaz mute/ban (motivo obrigatório, DM opcional) | Moderar membros |
| `/automod-test texto canal como` | Testa um texto contra as regras sem punir ninguém | Gerenciar servidor |

### Tickets

| Comando | O que faz | Permissão |
|---|---|---|
| `/ticket-panel canal titulo descricao` | Publica o painel de abertura de tickets | Administrador |
| `/ticket-add-category label emoji categoria cargo` | Adiciona uma categoria de ticket | Administrador |
| `/ticket-remove-category id` | Remove uma categoria de ticket | Administrador |
| `/ticket-stats pagina` | Ranking dos atendentes: nota média, tickets e TMA | Gerenciar mensagens |

### Sorteios

| Comando | O que faz | Permissão |
|---|---|---|
| `/giveaway-start premio duracao vencedores` | Inicia um sorteio | Gerenciar servidor |
| `/giveaway-end giveaway` | Encerra agora, sorteando e anunciando os vencedores | Gerenciar servidor |
| `/giveaway-stop giveaway` | Cancela um sorteio sem sortear ninguém | Gerenciar servidor |
| `/giveaway-reroll id quantidade` | Sorteia novos vencedores de um sorteio encerrado | Gerenciar servidor |

### Cargos

| Comando | O que faz | Permissão |
|---|---|---|
| `/setup-autorole cargo` | Define o cargo automático para novos membros | Gerenciar cargos |
| `/reactionrole-setup cargo canal mensagem emoji` | Cria uma mensagem de auto-atribuição (botão toggle) | Gerenciar cargos |

### Utilidade

| Comando | O que faz | Permissão |
|---|---|---|
| `/say mensagem canal` | Envia uma mensagem pelo bot | Gerenciar mensagens |
| `/embed titulo descricao canal cor anexo midia_url miniatura miniatura_url rodape` | Cria um embed com pré-visualização antes de enviar (imagem grande + miniatura no canto) | Gerenciar mensagens |
| `/nuke confirmar` | Recria o canal atual do zero (apaga todas as mensagens) | Gerenciar canais |
| `/ping` | Latência do gateway, tempo de resposta e uptime | Todos |

### Configuração

| Comando | O que faz | Permissão |
|---|---|---|
| `/automod` | Painel do AutoMod: filtros, limites, punições, isenções e escada | Administrador |
| `/setup-welcome` | Painel das mensagens de boas-vindas | Administrador |
| `/setup-logs canal` | Define o canal de logs do servidor | Administrador |
| `/setup-ticket-logs canal` | Canal de logs exclusivo dos tickets (transcripts e avaliações) | Administrador |
| `/setup-verify` | Painel da verificação por captcha: canal, cargo e aparência do embed e do botão | Administrador |
| `/pull-user usuario` | Readiciona ao servidor quem conectou a conta via OAuth | Administrador |
| `/bot-status` | Painel do status e da atividade do bot (global) | Administrador |
| `/config-emojis` | Painel para trocar os emojis usados pelo bot | Administrador |
| `/emoji-add emoji arquivo nome` | Importa um emoji de outro servidor, de um ID ou de uma imagem | Gerenciar expressões |

`/nuke confirmar:true` clona o canal atual (nome, tópico, NSFW, slowmode, categoria, posição e todas as permissões), apaga o original e registra a ação nos logs. É irreversível: as mensagens não são recuperáveis.

## AutoMod

O motor roda **no próprio bot**, não no AutoMod nativo do Discord. Em troca de janelas de tempo, reincidência e isenções finas, ficam duas consequências: a mensagem infratora aparece por uma fração de segundo antes de ser apagada, e nada é filtrado enquanto o bot estiver offline.

`/automod` abre o painel (sem parâmetros). Tudo é salvo na hora, sem botão "salvar". São três telas:

- **Início** — menu com as 19 regras (✅/▫️ indicando ligada), select do canal de logs do AutoMod e os botões `[Ligar/Desligar o AutoMod] [Isenções globais] [Escada] [Isentar mods: sim/não] [Fechar]`. O resumo destaca as regras **ligadas mas sem efeito** (sem apagar, sem ação e sem pontos) — é o erro de configuração mais fácil de cometer.
- **Regra** — quatro selects (ação imediata, pontos de 0–10, quem vê o aviso, quanto tempo o aviso fica) e os botões `[Ligar/Desligar] [Apagar: sim/não] [Limites…] [Isenções] [Voltar]`. "Limites…" abre um modal com os campos daquela regra; listas (palavras, domínios, extensões) vêm uma por linha.
- **Isenções** — `RoleSelect` + `ChannelSelect` (múltiplos), tanto no escopo global quanto por regra.

O AutoMod só age depois de `[Ligar o AutoMod]`: ligar uma regra sozinha não basta, o que permite configurar tudo com calma antes de valer.

### As 19 regras

| Regra | Família | O que barra | Limites |
|---|---|---|---|
| @everyone e @here | Excessos | `@everyone`/`@here` de qualquer um, tenha ou não a permissão | — |
| Menções em massa | Excessos | Muitas menções de usuário/cargo na mesma mensagem | máximo de menções |
| CAIXA ALTA | Excessos | Maiúsculas demais | % de maiúsculas, mínimo de caracteres |
| Excesso de emojis | Excessos | Emojis normais + personalizados | máximo de emojis |
| Excesso de linhas | Excessos | O "muro de texto" | máximo de linhas |
| Excesso de spoilers | Excessos | Muitos blocos `\|\|spoiler\|\|` | máximo de spoilers |
| Zalgo | Excessos | Pilhas de acentos combinantes que esticam a linha | densidade máxima (%) |
| Tipos de arquivo | Excessos | Anexos por extensão | extensões bloqueadas |
| Convites do Discord | Links | `discord.gg` e afins | permitir convite deste servidor |
| Domínios bloqueados | Links | Lista sempre barrada, mesmo se estiver na de permitidos | domínios bloqueados |
| Links em geral | Links | Qualquer URL (lista de permitidos vazia = barra todos) | domínios permitidos |
| Lista de palavras | Palavras | Palavras/frases proibidas | palavras, só palavra inteira, detectar disfarces |
| Padrões com curinga | Palavras | Padrões com `*`, ex.: `ganhe*nitro*grátis` | padrões |
| Rajada de mensagens | Flood | Muitas mensagens em pouco tempo | mensagens, janela em segundos |
| Mensagem repetida | Flood | O mesmo texto várias vezes | repetições, janela |
| Spam entre canais | Flood | O mesmo texto espalhado por vários canais | canais diferentes, janela |
| Spam de anexos | Flood | Rajada de imagens, arquivos ou figurinhas | anexos, janela |
| Entrada em massa | Raid | Muitas entradas em pouco tempo ligam um alerta temporário | entradas, janela, duração do alerta, não dar autorole |
| Conta suspeita | Raid | Idade da conta, ausência de avatar, nome padrão do Discord | idade mínima (dias), exigir avatar, barrar nome padrão, não dar autorole |

O motor avalia da regra mais barata para a mais cara e **para na primeira violação** — punir a mesma mensagem por três regras triplicaria os pontos sem o admin ter pedido isso. As duas regras de raid rodam na entrada do membro, antes do autorole e das boas-vindas, e podem suprimir os dois. O alerta de entrada em massa **não altera permissão de canal nenhuma**: ele só faz quem entrar durante o alerta receber a ação configurada.

A edição de mensagem também passa pelo filtro (senão a burla seria mandar "oi" e editar para o link), mas não conta no histórico de flood — corrigir um typo três vezes não é mandar três mensagens.

### Ação imediata, pontos e escada

Cada regra tem, de forma independente: apagar a mensagem (sim/não), uma **ação imediata** (nenhuma, advertir, silenciar, expulsar, banir), duração do mute, quantos **pontos** vale (0–10) e como o infrator é avisado (ver abaixo).

Os pontos alimentam a **escada**, configurada no botão `[Escada]` com um degrau por linha:

```
3 mute 10m
5 mute 1h
8 kick
12 ban
```

Aplica-se o degrau mais alto que os pontos cruzarem. Pontos vencem — 7 dias por padrão, ajustável no mesmo modal — e vencer significa **sair da soma, não ser apagado**: o `/infractions` continua mostrando a linha marcada com ⏳.

`/infractions @usuario` mostra pontos válidos, total de infrações, quando vencem, o degrau atual, o próximo degrau e as 10 últimas linhas.

### Perdoar

O AutoMod pune sozinho, então precisa dar para voltar atrás sozinho também. As duas metades do perdão são opções independentes do `/infractions`, e podem vir juntas:

- **`limpar:true`** — apaga o histórico de infrações do membro e a pontuação volta a zero, o que também tira o membro do degrau em que ele estava. Irreversível.
- **`desfazer:true`** — remove o **silenciamento** ativo e o **banimento**, se existirem.

**`motivo` é obrigatório** para qualquer uma das duas: sem ele o comando não executa nada e responde pedindo o motivo. É o que torna o perdão rastreável — meses depois se procura o *por quê*, não o *o quê*. O motivo vai para três lugares: o canal de logs do bot, o audit log do Discord (junto do unmute e do unban, para quem auditar pelo painel do servidor achar lá também) e, se você pedir, a DM do membro.

- **`avisar:true`** — manda uma DM ao membro contando do perdão, com o motivo e o que foi feito. Padrão: **não** — uma DM é um efeito visível fora do servidor, então só sai quando pedida. A DM pode falhar sem que nada esteja errado: DM fechada, ou — o caso mais comum aqui — usuário recém-desbanido, com quem o bot não divide mais nenhum servidor. Falhando ou não, a resposta diz qual dos dois aconteceu.

`/infractions @usuario limpar:true desfazer:true motivo:"engano na moderação" avisar:true` é o perdão completo: sem pontos, sem mute, sem ban, com aviso.

O que **não** é desfeito: expulsão (não há o que desfazer — o membro só precisa voltar) e advertências, que são registro e não restrição, e continuam no `/warnings`. A resposta diz uma linha por item, inclusive quando não havia nada a remover, quando a hierarquia de cargos impede, ou quando desbanir exigiria a permissão de *Banir membros* que quem pediu não tem. Só um perdão que mudou algo de fato vira linha no canal de logs.

A ação `Advertir` grava na mesma tabela do `/warn`, com o bot como moderador, então `/warnings` continua contando a história inteira. Mute respeita o teto de 28 dias do Discord; mute, kick e ban conferem a hierarquia antes (`moderatable`, `kickable`, `bannable`) e, quando o bot não alcança o membro, isso vira uma linha no log em vez de uma exceção engolida.

### Aviso ao infrator

Duas escolhas independentes, por regra, nos dois selects de baixo do painel:

**Quem vê** — `Não avisar`, `No canal, todos veem` (padrão) ou `Na DM, só o infrator vê`. Não existe um terceiro alcance: uma mensagem comum de bot não pode ser efêmera, então "só ele vê" no Discord é a DM, não um recado invisível no canal.

**Quanto tempo fica** — `Não apagar` (padrão), ou um prazo de 5 s a 15 min. **O aviso no canal não se apaga sozinho** a menos que você escolha um prazo: uma mensagem que desaparece sem ninguém ter pedido não dá para reler nem para conferir depois. O select fica desabilitado quando o aviso vai para a DM ou está desligado — a DM é do usuário e o bot não a apaga.

Num flood de 20 mensagens o bot apaga as 20 e **avisa uma vez** (cooldown de aviso por usuário e canal) — sem isso o remédio viraria o spam. Todo aviso vai com `allowedMentions` restrito. Regras de flood vêm com o aviso na DM por padrão, justamente para não somar barulho ao barulho.

### Isenções

Valem em dois níveis, e a soma dos dois é o que conta: **globais** (cargos e canais para o AutoMod inteiro) e **por regra**. Isentar um canal isenta também os tópicos dele, e isentar uma categoria isenta os canais dentro dela.

**Nenhum filtro deduz isenção de permissão do Discord.** Ter `Mencionar @everyone` não livra ninguém do filtro de `@everyone`, e o mesmo vale para as outras regras: se alguém deve poder fazer aquilo, o cargo ou o canal dele entra numa das listas acima. A permissão do Discord diz o que o membro *consegue* fazer; as isenções do bot dizem o que o AutoMod *deixa passar* — e é só a segunda lista que o AutoMod consulta.

A única exceção é explícita e **desligada por padrão**: o botão `[Isentar mods]`, que poupa quem tem `Gerenciar mensagens`. Ligue se não quiser que a equipe seja filtrada.

> Se você ligar, isso vale para **você** também — é a explicação mais comum para "configurei tudo e nada aconteceu". O painel avisa em cima quando quem está lendo está isento, e o `/automod-test` diz o mesmo.

Fora das isenções, o AutoMod vale em **todo** canal que o bot consegue ver — não existe lista de canais onde ele age, só a lista de onde ele não age.

`/automod-test texto:"..."` confere um texto contra as regras ligadas sem punir ninguém, e diz o que aconteceria: qual regra pegou, por quê, se apagaria, qual ação, quantos pontos e onde avisaria. Aceita `canal:` e `como:` para simular outro canal ou outro membro — inclusive para descobrir que a resposta é "nada, esse membro está isento". Regras de flood e repetição dependem do histórico real e não são simuladas.

### Log

O select de canal na tela inicial define onde ficam os registros do AutoMod. Sem ele, tudo cai no canal de `/setup-logs`.

> Os comandos `/automod`, `/infractions` e `/automod-test` são novos: rode `npm run deploy` depois de atualizar, senão eles não aparecem no Discord.

## Sorteios

`/giveaway-start premio:"Nitro" duracao:1h vencedores:1` publica o sorteio com o botão **🎉 Participar**. Ao vencer o prazo, uma varredura periódica encerra e anuncia automaticamente.

Para agir antes do prazo, `/giveaway-end` e `/giveaway-stop` têm autocomplete: ao digitar, o Discord lista os sorteios **em andamento** do servidor no formato `#id — prêmio (N participantes)`.

- `/giveaway-end giveaway:<sorteio>` — encerra na hora: sorteia, edita a mensagem original e anuncia o(s) vencedor(es) no canal do sorteio.
- `/giveaway-stop giveaway:<sorteio>` — **cancela** o sorteio. Nenhum vencedor é sorteado nem revelado; a mensagem passa a exibir o aviso de cancelamento, o botão de participação é removido e a ação vai para o canal de logs. Um sorteio cancelado não pode ser encerrado nem sofrer `/giveaway-reroll` depois.

`/giveaway-reroll id:<id> quantidade:<n>` sorteia novos vencedores de um sorteio já encerrado normalmente.

## Fluxo de tickets

1. `/ticket-add-category label:"Bug" emoji:🐛 categoria:#Tickets cargo:@Suporte` (repita para cada tipo).
2. `/setup-ticket-logs canal:#logs-tickets` define onde ficam os registros e transcripts. Sem isso, tudo cai no canal de `/setup-logs`.
3. `/ticket-panel canal:#suporte` publica o painel com o botão **Abrir Ticket**.
4. No clique em **Abrir Ticket** o bot já valida o limite de tickets abertos por usuário (`config/settings.js` → `ticket.maxOpenPerUser`), antes de mostrar as categorias.
5. O usuário escolhe a categoria no dropdown → o bot cria o canal privado com botões **Reivindicar** e **Fechar**.
6. **Reivindicar** é só para a equipe: quem abriu o ticket não pode assumir o próprio atendimento.
7. Ao fechar, o bot registra no canal de logs quem reivindicou, quem fechou, a espera até o primeiro atendimento, o tempo de atendimento e a duração total, junto do **transcript em HTML** (tema escuro, com avatares, embeds e anexos).
8. Em seguida o autor recebe uma DM pedindo a avaliação: 5 botões de ⭐. Ao clicar, abre um formulário com um comentário opcional. A nota fica creditada ao atendente que reivindicou o ticket.

### KPIs de atendimento

`/ticket-stats` lista os atendentes ordenados por nota média, 10 por página, com botões de navegação. Para cada um: nota média e quantidade de avaliações, tickets reivindicados, tickets fechados e **TMA** (tempo médio de atendimento, do momento da reivindicação até o fechamento). O rodapé traz os números do servidor inteiro.

Só existe pedido de avaliação quando o ticket foi reivindicado — sem atendente responsável não há a quem creditar a nota. Cada ticket aceita uma única avaliação.

## Emojis configuráveis

Todo emoji que o bot mostra aos membros vive num registro central (`utils/emojis.js`) e pode ser trocado **por servidor** — 27 chaves em 6 categorias: gerais, tickets, sorteios, entrada/verificação, moderação e logs.

`/config-emojis` abre o painel. O primeiro menu escolhe a **categoria** e o segundo lista só as chaves dela: um select do Discord aceita 25 opções e o registro já passa disso, então o limite passa a valer por categoria — o próprio módulo recusa subir se alguma categoria estourar 25 chaves. Você escolhe a chave no menu e o bot pede para **mandar o emoji novo ali no chat mesmo** — vale o teclado de emojis do Discord ou um emoji personalizado de qualquer servidor em que o bot esteja. Ele lê a mensagem, apaga e salva na hora. Na conversa também dá para escrever `padrao` para restaurar ou `cancelar` para desistir; a janela é de 60 s.

Só as diferenças em relação ao padrão são gravadas (JSON em `guild_config.emoji_config`), então o painel sempre marca com `✏️` o que foi personalizado e com `·` o que está no padrão. Se um emoji personalizado sair do ar, o painel avisa e o bot volta ao padrão em vez de quebrar a mensagem.

`/emoji-add` importa um emoji para o servidor atual a partir de:

- um emoji personalizado colado de outro servidor (`<:nome:123...>`);
- o ID cru do emoji (o bot descobre sozinho se é animado);
- um link `https://` de imagem;
- ou um anexo (`png`, `jpg`, `gif`, `webp`).

O download é validado antes de ir para a API: só `https`, endereços internos bloqueados, redirecionamentos reconferidos e o limite de **256 KB** do Discord aplicado. O comando também confere as vagas de emoji do servidor (estáticas e animadas contam separado) e responde com o motivo em português quando a API recusa.

## Status do bot

`/bot-status` abre um painel com rascunho: você monta o status, vê o preview e só então confirma. É uma configuração **global** (vale para o bot inteiro, não por servidor) e fica salva no banco, então sobrevive a reinícios.

Dá para escolher a bolinha (online, ausente, não perturbe, invisível) e o tipo de atividade: nenhuma, personalizado, jogando, assistindo, ouvindo, competindo em e **transmitindo** — este último deixa o bot roxo e o título clicável, mas o Discord exige uma URL de Twitch ou YouTube (qualquer outro domínio é ignorado, inclusive `discord.gg`).

O status é aplicado de forma redundante porque o gateway o zera em cada reconexão: ele vai dentro do IDENTIFY (nasce certo em todo login) e é reconferido nos eventos de reconexão. A conferência é "olha antes de agir" — se o status já está correto, nada é enviado; se divergir, o bot corrige e confere de novo, até 3 tentativas. Não há verificação periódica em segundo plano.

Reler o status real depende da intent privilegiada `PRESENCE INTENT` (`GuildPresences`), que o bot pede no IDENTIFY. Ligá-la no portal do Discord **não basta** — ela também tem de ser pedida pelo código, e é isso que faz a conferência funcionar em vez de o bot reaplicar às cegas a cada reconexão.

> Se você não quiser ligá-la no portal, ponha `PRESENCE_INTENT=false` no `.env`: o bot deixa de pedir a intent, o status passa a ser aplicado sem conferência (o que basta, já que ele também vai no IDENTIFY) e o log diz isso uma vez. Pedir uma intent privilegiada que está desligada no portal derruba o login — nesse caso o bot agora explica exatamente o que fazer em vez de morrer num stack trace.

## Verificação por captcha

Clicar no botão **não libera nada** — clique é a única coisa que um bot de auto-join faz bem. O que solta o cargo é resolver um desafio:

1. O membro clica no botão do painel publicado por `/setup-verify` (**Verificar**, por padrão — nome, cor e emoji são configuráveis).
2. O bot responde **só para ele** (efêmero) com um PNG contendo um código de 6 caracteres, distorcido: cada letra tem rotação, tamanho e cor próprios, e a imagem inteira passa por uma onda em nível de pixel, sobre ruído de linhas e pontos. O código **nunca aparece em texto** na mensagem, então não há o que copiar — só o que ler.
3. Em **Inserir código** abre um modal para digitar a resposta (não diferencia maiúsculas de minúsculas e ignora espaços). Se a imagem ficou ruim, **Gerar outra imagem** troca o desafio.
4. Acertando, o cargo é aplicado e a verificação vai para o canal de logs com as tentativas usadas.

Limites, todos em `config/settings.js` → `verify`:

| Chave | Padrão | O que faz |
|---|---|---|
| `codeLength` | 6 | Caracteres do código |
| `maxAttempts` | 3 | Tentativas por pessoa antes do cooldown |
| `challengeTtlMs` | 3 min | Validade do desafio |
| `cooldownMs` | 5 min | Espera após esgotar as tentativas |
| `imageWidth` / `imageHeight` | 420 × 140 | Tamanho do PNG |
| `noiseLines` / `noiseDots` | 4 / 180 | Ruído da imagem |

Gerar outra imagem **não zera o contador de tentativas** — senão o limite não limitaria nada. Esgotando as tentativas, o desafio é descartado e o cooldown entra em vigor; o bloqueio também é registrado nos logs. Desafios e cooldowns vivem em memória, então um reinício do bot os descarta (a pessoa só precisa clicar no painel de novo).

O alfabeto exclui caracteres ambíguos na tela (`0/O`, `1/I/L`, `2/Z`, `5/S`, `8/B`, `6/G`) e o código vem do CSPRNG do Node, não de `Math.random`.

### Painel do `/setup-verify`

`/setup-verify` não pede parâmetros: abre um painel só para você, com o **preview do painel público logo abaixo**, exatamente como o membro vai ver. Tudo é salvo na hora (JSON em `guild_config.verify_panel`), então dá para fechar e voltar depois sem perder nada — só o envio ao canal exige o clique em **Publicar**.

Dá para configurar:

| Onde | O que muda |
|---|---|
| Menu de canal | Canal onde o painel é publicado (o bot confere as permissões antes de aceitar) |
| Menu de cargo | Cargo entregue a quem passa no captcha (recusa `@everyone`, cargos de integração e cargos acima do bot) |
| Menu de cor do embed | 23 cores nomeadas ou **Hex personalizado…** para digitar algo como `#5865F2` |
| Menu de cor do botão | Verde, Azul, Cinza ou Vermelho — são as únicas quatro que o Discord tem |
| **Textos** | Título, descrição (com `\n` para quebra de linha) e rodapé |
| **Imagens** | Imagem grande e miniatura do canto, por URL |
| **Botão** | Texto do botão, e o emoji: um emoji qualquer, `nenhum` para ficar sem, ou vazio para usar o do `/config-emojis` |

Campo de texto vazio volta ao padrão (título e rodapé somem; a descrição volta ao texto original). Emoji inválido ou cor não reconhecida são **recusados com aviso**, mantendo o valor anterior — um emoji quebrado derrubaria o envio da mensagem inteira.

Republicar no mesmo canal **edita a mensagem já publicada** em vez de empilhar painéis, então o link que a staff divulgou continua valendo. Se você trocar de canal, o painel antigo continua funcionando onde está e o bot avisa — apagar mensagem por conta própria não é papel de um "publicar".

> Aqui as imagens entram só por **URL**, diferente do `/embed`, que aceita anexo. Anexo do Discord ganha uma URL assinada que expira, e a configuração salva apontaria para um link morto na primeira reinicialização.

> As opções `canal` e `cargo` continuam existindo como atalho opcional (`/setup-verify canal:#verificar cargo:@Membro`), mas passam pelas mesmas validações e podem ser trocadas no painel depois. Como elas deixaram de ser obrigatórias, rode `npm run deploy` para o Discord atualizar o comando.

> **Requisito de host:** o desenho usa `@napi-rs/canvas` (binário pré-compilado, sem toolchain) e precisa de **alguma fonte instalada no sistema**. O bot confere isso no boot e o `/setup-verify` se recusa a ativar a verificação sem fonte, com a instrução de instalar (em containers Debian/Ubuntu: `apt-get install fonts-dejavu-core`).

### Conexão de conta com OAuth (opcional)

Se você preencher `CLIENT_SECRET`, `OAUTH_REDIRECT_URI` e `OAUTH_PORT` no `.env` (e cadastrar a Redirect URL na aba OAuth2 do Developer Portal), após verificar o usuário também recebe um botão opcional **Conectar conta** (escopos `identify guilds.join`, com consentimento explícito na tela oficial do Discord). Usuários conectados podem ser readicionados ao servidor pela staff com `/pull-user`.

> O servidor de callback roda em `http://localhost:PORTA/callback`. Para uso real, exponha com um domínio/HTTPS (ex: reverse proxy) e atualize a Redirect URL.

## Placeholders de boas-vindas

`{user}` menção · `{username}` nome · `{server}` nome do servidor · `{membercount}` total de membros.

## Estrutura

- `index.js` — entrypoint (monta o client já com a presença salva) · `deploy-commands.js` — registro de slash commands
- `database/db.js` — schema SQLite e helpers de config
- `handlers/` — loaders e a lógica dos painéis: tickets, giveaways, embed, verificação, boas-vindas, status, emojis e AutoMod
- `handlers/automodHandler.js` — o motor (`inspectMessage`) · `handlers/automodSetupHandler.js` — painel do `/automod`
- `events/` — ready, interactionCreate (roteia botões/selects por prefixo do customId), message create/update, member add/remove, logs
- `commands/<módulo>/` — um arquivo por comando
- `config/automodRules.js` — catálogo declarativo das 19 regras (o painel e os detectores leem daqui)
- `utils/automod/` — `config.js` (JSON normalizado + isenções) · `textNormalize.js` (desdisfarce) · `wildcard.js` (curinga `*` sem regex do usuário) · `tracker.js` (janelas em memória) · `infractions.js` (pontos e escada) · `enforce.js` (ações e log) · `raid.js` · `detectors/`
- `test/automod.test.js` — testes da lógica pura (`npm test`)
- `utils/emojis.js` — registro central dos emojis · `utils/emojiSource.js` — download validado do `/emoji-add`
- `utils/presence.js` — presença salva e normalizada · `utils/presenceKeeper.js` — garante o status após reconexões
- `utils/captcha.js` — geração do PNG do captcha · `utils/verifyChallenges.js` — desafios e cooldowns em memória
- `utils/verifyPanelConfig.js` — aparência salva do painel de verificação (embed + botão)
- `oauth/server.js` — callback OAuth2 (verify avançado)
