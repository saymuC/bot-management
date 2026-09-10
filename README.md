# Bot Discord Multifuncional

Bot de gerenciamento com tickets, moderação, **AutoMod configurável**, **níveis e XP**, sorteios, boas-vindas, logs, self-roles, verificação, emojis configuráveis e controle de status — Node.js + discord.js v14 + SQLite (better-sqlite3).

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

Os testes da lógica pura (normalização de texto, curingas, detectores, janelas de tempo, escada de pontos, fórmula de níveis, anti-farm) rodam sem Discord e sem dependência extra:

```bash
npm test
```

## Comandos

São 38 comandos. A coluna **Permissão** é a exigência padrão do Discord para o membro ver e usar o comando (dá para sobrescrever em _Configurações do servidor → Integrações_).

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

### Níveis e XP

| Comando | O que faz | Permissão |
|---|---|---|
| `/rank usuario` | Card com nível, XP total, progresso até o próximo nível e posição no servidor | Todos |
| `/top pagina` | Imagem do ranking, 10 por página, com botões que trocam a imagem | Todos |
| `/levelconfig` | Painel do sistema de níveis: XP, cooldown, anti-farm, anúncios, exclusões, recompensas e aparência | Gerenciar servidor |
| `/add-xp usuario quantidade` | Adiciona XP a um membro | Gerenciar servidor |
| `/remove-xp usuario quantidade` | Remove XP de um membro | Gerenciar servidor |
| `/set-level usuario nivel` | Define o nível de um membro (grava o XP mínimo daquele nível) | Gerenciar servidor |
| `/reset-xp usuario` | Zera o XP de um membro, com confirmação | Gerenciar servidor |

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

- **Início** — menu com as 20 regras (✅/▫️ indicando ligada), select do canal de logs do AutoMod e os botões `[Ligar/Desligar o AutoMod] [Isenções globais] [Escada] [Isentar mods: sim/não] [Fechar]`. O resumo lista as regras **ligadas mas sem efeito** e diz o motivo de cada uma (nenhum canal vigiado, nenhuma categoria marcada, ou nem apaga nem pune nem pontua) — é o erro de configuração mais fácil de cometer.
- **Regra** — quatro selects (ação imediata, pontos de 0–10, quem vê o aviso, quanto tempo o aviso fica) e os botões `[Ligar/Desligar] [Apagar: sim/não] [Limites…] [Isenções] [Voltar]`. "Limites…" abre um modal com os campos daquela regra; listas (palavras, domínios, extensões) vêm uma por linha. Nas regras de alcance restrito o quarto botão vira `[Canais vigiados]`, em azul enquanto nenhum canal foi escolhido.
- **Isenções** — `RoleSelect` + `ChannelSelect` (múltiplos), tanto no escopo global quanto por regra. Nas regras de alcance restrito ganha um `ChannelSelect` a mais, o dos canais vigiados.

O AutoMod só age depois de `[Ligar o AutoMod]`: ligar uma regra sozinha não basta, o que permite configurar tudo com calma antes de valer.

### As 20 regras

| Regra | Família | O que barra | Limites |
|---|---|---|---|
| @everyone e @here | Excessos | `@everyone`/`@here` de qualquer um, tenha ou não a permissão | — |
| Menções em massa | Excessos | Muitas menções de usuário/cargo na mesma mensagem | máximo de menções |
| CAIXA ALTA | Excessos | Maiúsculas demais | % de maiúsculas, mínimo de caracteres |
| Excesso de emojis | Excessos | Emojis normais + personalizados | máximo de emojis |
| Excesso de linhas | Excessos | O "muro de texto" | máximo de linhas |
| Excesso de spoilers | Excessos | Muitos blocos `\|\|spoiler\|\|` | máximo de spoilers |
| Zalgo | Excessos | Pilhas de acentos combinantes que esticam a linha | densidade máxima (%) |
| Mídia e anexos | Mídia | Imagem, gif, vídeo, arquivo, figurinha e link direto de mídia — **só nos canais vigiados** | barrar imagens, gifs, vídeos, outros arquivos, figurinhas |
| Tipos de arquivo | Mídia | Anexos por extensão | extensões bloqueadas |
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

**Uma punição por mensagem.** O Discord manda um evento de atualização para a própria mensagem sem ninguém tê-la editado: quando resolve um anexo, quando gera o preview de um link, quando alguém fixa. O bot reexamina só quando o **texto** mudou de fato, e além disso guarda por 5 minutos os ids que já renderam punição. Sem as duas travas um PDF no canal errado dava duas advertências — a segunda com "não conseguiu apagar", porque a primeira já havia apagado a mensagem.

### Canal só de texto: mídia e links

Duas regras cobrem isso, e o alcance de cada uma é o oposto do da outra — de propósito.

**Mídia e anexos** vale **só nos canais vigiados**, escolhidos no botão `[Canais vigiados]` da regra. Enquanto a lista estiver vazia a regra não vale em lugar nenhum, mesmo ligada, e o painel diz isso na cara. A inversão é deliberada: num servidor comum mandar foto é normal e proibido em dois ou três cantos (`#regras`, `#avisos`, `#suporte`), então listar esses dois é curto e listar os trinta que podem mandar foto não é. Escolher uma **categoria** vigia os canais dela; escolher um canal vigia os tópicos dele. As isenções da regra continuam existindo e abrem exceções *dentro* dos canais vigiados — um cargo de staff que pode mandar print no `#suporte`, por exemplo.

Tudo o mais no AutoMod segue o alcance normal: vale em todo canal, menos as isenções. A regra de mídia é a única que restringe hoje; a flag (`watchlist`) está no catálogo e serve para qualquer regra futura em que essa leitura fizer sentido.

**Mídia e anexos** barra as cinco categorias, cada uma com seu interruptor: imagens (`png`, `jpg`, `webp`), gifs (`gif` e link de `tenor.com`/`giphy.com`), vídeos (`mp4`, `mov`, `webm`), outros arquivos (áudio, pdf, zip, exe — tudo o que não é imagem, gif nem vídeo) e figurinhas. Ligar a regra barra tudo; desmarque no `[Limites…]` o que quiser permitir. A categoria é decidida pelo `content-type` que o Discord manda, com a extensão do nome como reserva — anexo sem tipo identificável cai em "outros arquivos", porque quem barrou o resto quis dizer "só texto".

A regra pega os **dois** caminhos pelos quais mídia entra num canal: o anexo e o **link direto** (`i.imgur.com/x.png`, `tenor.com/view/…`). Barrar só o anexo seria um filtro que se contorna colando a URL. O que ela não faz é abrir a página de um link sem extensão para descobrir se há imagem lá dentro: `imgur.com/a/album` passa por esta regra — é a regra de links que decide sobre ele.

**Links em geral** barra qualquer URL: deixe a lista de permitidos vazia e nada passa; preencha e só o que está nela passa (subdomínios incluídos). O link é reconhecido sem `http://` e por baixo de disfarces (`site [.] com`, `hxxp://`), mas sem esquema é preciso um TLD conhecido — a lista cobre o que aparece em divulgação e golpe, e é o que impede "abre o index.js" de virar infração. **Com** `https://` na frente, qualquer TLD conta, inclusive os exóticos: quem escreveu o esquema declarou que é link.

O relatório do `/automod-test` só recebe texto, então ele mostra o que estiver **escrito** (link de imagem, gif de tenor) e não tem como simular anexo, arquivo ou figurinha. Quando a regra de mídia está ligada mas não vigia o canal testado, o relatório diz isso em vez de deixar o "passou" sem explicação.

### Ação imediata, pontos e escada

Cada regra tem, de forma independente: apagar a mensagem (sim/não), uma **ação imediata** (nenhuma, advertir, silenciar, expulsar, banir), duração do mute, quantos **pontos** vale (0–10) e como o infrator é avisado (ver abaixo).

Os pontos alimentam a **escada**, configurada no botão `[Escada]` com um degrau por linha:

```
3 mute 10m
5 mute 1h
8 kick
12 ban
```

O degrau só vale **na infração que o cruza**. Nesta escada, quem vai de 6 para 7 pontos não cruzou nada — o degrau de 5 ele já pagou — e não é silenciado de novo; quem vai de 2 para 7 cruza 3 e 5 de uma vez e leva só o mais alto, o mute de 1 h.

**Uma punição por evento.** Quando a ação imediata da regra e o degrau caem na mesma mensagem, aplica-se **a mais grave** das duas (`nenhuma` < `advertir` < `silenciar` < `expulsar` < `banir`); empatando em `silenciar`, vale o timeout mais longo. Advertir *e* silenciar pela mesma mensagem seria punir duas vezes pelo mesmo fato. A consequência prática: quando a escada absorve um `Advertir`, **nenhum warn é gravado**, então aquele evento não aparece no `/warnings` — ele aparece no `/infractions`, e o log do AutoMod diz que a ação da regra foi absorvida.

Pontos vencem — 7 dias por padrão, ajustável no mesmo modal — e vencer significa **sair da soma, não ser apagado**: o `/infractions` continua mostrando a linha marcada com ⏳. A soma é feita no banco, sem teto de linhas: um reincidente com 250 infrações soma 250, não 200.

`/infractions @usuario` mostra pontos válidos, total de infrações, quando vencem, o degrau atual (o mais alto alcançado, não o último cruzado), o próximo degrau e as 10 últimas linhas.

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

O texto do aviso diz o que **de fato** aconteceu: se a regra não apaga a mensagem, ou se o bot não conseguiu apagá-la, o aviso não afirma que ela foi removida — ele diz que a mensagem infringe as regras. O mesmo vale para a punição: uma ação que falhou não vira promessa no aviso.

Num flood de 20 mensagens o bot apaga as 20 e **avisa uma vez** (cooldown de 10 s por usuário e escopo) — sem isso o remédio viraria o spam. O escopo é o canal para o aviso público e um escopo único para a DM: um flood espalhado por cinco canais rende cinco recados públicos, um por plateia, mas **uma** DM. Regras de flood vêm com o aviso na DM por padrão, justamente para não somar barulho ao barulho — e é por isso que o cooldown vale ali também. Todo aviso vai com `allowedMentions` restrito.

### Isenções

Valem em dois níveis, e a soma dos dois é o que conta: **globais** (cargos e canais para o AutoMod inteiro) e **por regra**. Isentar um canal isenta também os tópicos dele, e isentar uma categoria isenta os canais dentro dela.

**Nenhum filtro deduz isenção de permissão do Discord.** Ter `Mencionar @everyone` não livra ninguém do filtro de `@everyone`, e o mesmo vale para as outras regras: se alguém deve poder fazer aquilo, o cargo ou o canal dele entra numa das listas acima. A permissão do Discord diz o que o membro *consegue* fazer; as isenções do bot dizem o que o AutoMod *deixa passar* — e é só a segunda lista que o AutoMod consulta.

A única exceção é explícita e **desligada por padrão**: o botão `[Isentar mods]`, que poupa quem tem `Gerenciar mensagens`. Ligue se não quiser que a equipe seja filtrada.

> Se você ligar, isso vale para **você** também — é a explicação mais comum para "configurei tudo e nada aconteceu". O painel avisa em cima quando quem está lendo está isento, e o `/automod-test` diz o mesmo.

Fora das isenções, o AutoMod vale em **todo** canal que o bot consegue ver. A exceção é a regra de **Mídia e anexos**, que funciona ao contrário: ela tem uma lista de canais vigiados e só age neles (ver *Canal só de texto*). As isenções continuam valendo por cima, para abrir exceção dentro dos canais vigiados.

`/automod-test texto:"..."` confere um texto contra as regras ligadas sem punir ninguém, e diz o que aconteceria: qual regra pegou, por quê, se apagaria, qual ação, quantos pontos e onde avisaria. Aceita `canal:` e `como:` para simular outro canal ou outro membro — inclusive para descobrir que a resposta é "nada, esse membro está isento". Regras de flood e repetição dependem do histórico real e não são simuladas.

### Log

O select de canal na tela inicial define onde ficam os registros do AutoMod. Sem ele, tudo cai no canal de `/setup-logs`.

> Os comandos `/automod`, `/infractions` e `/automod-test` são novos: rode `npm run deploy` depois de atualizar, senão eles não aparecem no Discord.

## Níveis e XP

Sistema de engajamento por servidor: cada mensagem elegível vale um XP sorteado, o nível sai do XP acumulado e cargos podem ser entregues ao alcançar níveis.

**Nasce desligado.** `/levelconfig` → `[Ativar]` é o que faz o sistema valer, pelo mesmo motivo do AutoMod: dá para configurar tudo com calma antes de o primeiro XP ser gravado.

### Quando a mensagem vale XP

Todas as condições precisam ser verdadeiras — basta uma falhar e **nenhum registro é criado**:

- está num servidor (DM não conta) e o autor não é bot nem webhook;
- o sistema de níveis está ligado;
- a mensagem **não foi barrada pelo AutoMod** (ver abaixo);
- o canal não está na lista de exclusões e o membro não tem cargo isento;
- o texto tem o mínimo de caracteres **úteis**;
- não é comando de bot nem menção solta ao bot;
- não repete uma mensagem recente do mesmo autor;
- o cooldown do autor já venceu.

O anti-farm é deliberadamente modesto: ele barra farm **óbvio** — `.`, `ok`, um emoji, um link solto, a mesma frase dez vezes — e não tenta julgar se a conversa é boa, senão passaria a punir quem escreve curto. A contagem útil desconta menções, URLs e emojis, porque colar um link é um caractere de esforço e não trinta; uma frase de verdade **com** link continua valendo, porque o que sobra depois do desconto ainda passa do mínimo.

A trava de repetição compara o texto normalizado (minúsculo, sem acento, espaços colapsados), então "OI" e "oi" são a mesma mensagem. O cooldown e as assinaturas de repetição vivem em memória — um reinício do bot os descarta, e nada disso vai para o banco.

> **A ordem importa:** o AutoMod roda **antes** do XP, e quem decide é o retorno dele, não `message.deleted`. Uma mensagem infratora que o bot não conseguiu apagar por falta de permissão continua sem render XP — senão o caminho para farmar seria justamente infringir num canal onde o bot não apaga.

### Fórmula

O XP para sair do nível `N` é `5N² + 50N + 100`: 100 XP do nível 0 para o 1, 155 do 1 para o 2, 220 do 2 para o 3, e assim por diante. O nível é **sempre derivado** do XP acumulado, nunca gravado — não existe coluna `level` no banco, então não há como o nível divergir do XP. O teto é o nível 1000.

Consequência prática: `/set-level` grava o XP mínimo daquele nível, e `/add-xp`/`/remove-xp` podem mudar o nível como efeito colateral. É o comportamento certo — o nível é uma leitura do XP, não um valor paralelo.

### Painel do `/levelconfig`

Só para você (efêmero), tudo salvo na hora, sem botão "salvar". O resumo no topo aponta a configuração **ligada mas sem efeito**: sistema desligado, canal de anúncio apagado, cargo de recompensa inutilizável, ou sistema ligado sem nenhuma recompensa e sem anúncio.

| Tela | O que configura |
|---|---|
| **Início** | Ligar/desligar · resumo de XP, cooldown, anti-farm, exclusões e recompensas |
| **XP e cooldown** | Modal: XP mínimo, XP máximo e cooldown em segundos |
| **Anti-farm** | Modal: mínimo de caracteres úteis e janela de repetição |
| **Anúncios** | Ligar/desligar · canal fixo ou "usar o canal da mensagem" |
| **Exclusões** | Canais e cargos fora do sistema (selects múltiplos) |
| **Recompensas** | Cargos por nível, o modo de entrega e a remoção de uma faixa |
| **Aparência** | Modal: imagem de fundo (URL) e frase do topo das imagens do `/top` e do `/rank` |

Padrões recomendados, e o que o painel traz: sistema **desligado**, 15–25 XP por mensagem, cooldown de 60 s, mínimo de 5 caracteres úteis, janela de repetição de 300 s, anúncio **ligado** no canal da mensagem, recompensas em modo acumulativo.

| Campo | Faixa aceita |
|---|---|
| XP mínimo / máximo | 1 – 10000 |
| Cooldown | 10 – 3600 s |
| Caracteres úteis | 1 – 100 |
| Janela de repetição | 0 – 3600 s (`0` desliga a trava) |
| Canais / cargos excluídos | 50 cada |
| Recompensas | 50 níveis, 10 cargos por nível |

Excluir uma **categoria** exclui os canais dela, e excluir um canal exclui os tópicos dele — mesma leitura das isenções do AutoMod. Valor fora da faixa é grudado no limite, não recusado; config corrompida ou editada à mão volta ao padrão em vez de derrubar o motor, justamente para não impedir o admin de abrir o painel e consertá-la.

### Anúncio de level-up

Sai uma vez por alteração, com `allowedMentions` restrito ao autor. Um salto de vários níveis de uma vez (via `/add-xp` ou uma configuração generosa) rende **um** anúncio dizendo as duas pontas, não um por nível atravessado.

O canal é o configurado; se ele foi apagado, ou se o bot não pode escrever nele, o anúncio cai no canal da mensagem. Uma falha no envio **não desfaz o XP já gravado** — a gravação vem primeiro, e o anúncio é consequência dela.

### Recompensas por nível

Dois modos, no painel de recompensas:

- **Acumulativo** (padrão) — o membro fica com os cargos de **todos** os níveis que alcançou.
- **Somente o maior** — fica só com os do nível mais alto alcançado; subir troca o cargo antigo pelo novo.

A entrega é uma **reconciliação**, não uma concessão simples: o bot compara o que o membro deveria ter com o que ele tem e ajusta as duas direções em um lote de `add` e um de `remove`. Isso é o que faz um salto de 4 para 10 entregar também os cargos de 5 e 8, em vez de deixar o membro sem eles para sempre, e o que faz `/remove-xp` retirar o que já não vale.

**O escopo é só o que o próprio módulo distribui.** Um cargo que não está na lista de recompensas nunca é removido — cargo de staff, de booster ou de self-role não desaparece porque alguém mudou de nível.

Antes de tocar em qualquer cargo o bot confere a permissão *Gerenciar Cargos* e a hierarquia. Cargo acima do bot, cargo de integração (booster, bot), `@everyone` e cargo que já não existe são **relatados** em vez de silenciados: o painel marca a faixa com ⚠️ e o motivo, e os comandos de admin acrescentam uma linha `⚠️ Cargos:` na resposta. Uma falha de rede na entrega volta como problema relatado, nunca como exceção que derruba o processamento da mensagem.

### `/rank` e `/top`

Os dois respondem com uma **imagem gerada pelo bot**: fundo escuro, avatar circular, nome, nível, barra de progresso e `XP no nível / XP do nível`.

`/rank` é **só leitura**: consultar alguém que nunca falou não cria registro nem coloca a pessoa no ranking. O card traz nível, XP no nível atual, XP total, barra e posição no servidor (a posição só aparece para quem tem XP). Com o sistema desligado ele responde e avisa disso.

A tipografia das duas imagens é a **Klee One**, que viaja com o projeto em `assets/fonts/` (licença OFL, incluída no mesmo diretório) e é registrada no boot. Isso mantém o traço igual em qualquer host — e traz de graça a cobertura de japonês/CJK que as fontes latinas do sistema não têm. As fontes do sistema continuam entrando como reserva por glifo (emoji, árabe, tailandês).

Cada posição é um **cartão de papel opaco** (claro, texto escuro), não um painel translúcido: assim a legibilidade do XP não depende da imagem de fundo que o servidor configurou.

`/top` desenha 10 por página, com o primeiro lugar num card mais alto e mais claro, faixa lateral e selo da posição em dourado/prata/bronze nas três primeiras, e a página no cabeçalho. Os botões de navegação **trocam a imagem** — cada página é um anexo novo, com a página no nome do arquivo para o cliente do Discord não reusar a anterior em cache. Uma última página incompleta sai mais curta, sem espaço vazio.

O desempate entre XP iguais é estável (por id), então ninguém aparece em duas páginas nem desaparece entre elas. Quem saiu do servidor continua no ranking marcado como `(saiu)` — o registro não é apagado em `guildMemberRemove`, e quem volta reencontra o progresso.

Detalhes que só aparecem quando algo dá errado:

- **Sem fonte alguma** (a Klee One embutida sumiu do repositório *e* o host não tem pacote de fontes) o `@napi-rs/canvas` não registra família nenhuma e a imagem sairia em branco. Nesse caso os dois comandos caem no **embed de texto** automaticamente. O captcha da verificação, que não usa a fonte embutida, continua exigindo fonte de sistema (`apt-get install fonts-dejavu-core`).
- Avatar que não baixa vira um círculo com a inicial do nome, nunca um furo na linha. Qualquer falha no desenho também cai no embed, com log no console.
- Páginas já desenhadas ficam ~60 s em cache, chaveadas pelo XP das linhas: ida e volta nos botões não redesenha nada, e XP novo invalida a imagem sozinho.

### Aparência do ranking

`/levelconfig` → `[🎨 Aparência]` configura duas coisas por servidor:

| Campo | O que faz |
|---|---|
| Imagem de fundo | URL de uma imagem que entra atrás do ranking, cobrindo a área sem distorcer, com um véu escuro por cima para o texto continuar legível |
| Frase do topo | Até 80 caracteres abaixo do nome do servidor (ex.: "Quem mais conversou desde o começo do mês") |

Sem imagem configurada o bot **desenha** o fundo (gradiente escuro, textura e vinheta) — a aparência padrão não depende de nada externo.

A URL passa pela mesma validação do `/emoji-add`: só `https`, só host público (IP literal, `localhost` e domínios internos são recusados), com teto de 4 MB, tempo limite e revalidação a cada redirecionamento. O painel **baixa a imagem na hora de salvar** e diz o motivo exato quando recusa — validar só o formato deixaria o admin achar que configurou algo que nunca vai aparecer. Uma URL recusada não apaga a que já estava salva. `[♻️ Voltar ao padrão]` limpa os dois campos.

Depois de salva, a imagem é baixada uma vez por hora e guardada decodificada em memória. Se o host de terceiro sair do ar, o ranking volta ao fundo desenhado sem avisar ninguém.

### Comandos de administração

`/add-xp`, `/remove-xp`, `/set-level` e `/reset-xp` exigem *Gerenciar servidor*, recusam bots como alvo e, depois de gravar, reconciliam os cargos de recompensa nas duas direções. Toda alteração vai para o canal de logs com o administrador, o membro afetado, a operação, o XP anterior e o novo, e o nível anterior e o novo.

`/reset-xp` pede **confirmação** antes de zerar, e recusa quem já está com 0. Remover XP nunca deixa o total negativo, e adicionar nunca passa do teto do nível 1000.

> Os sete comandos de níveis são novos: rode `npm run deploy` depois de atualizar, senão eles não aparecem no Discord.

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
- `handlers/` — loaders e a lógica dos painéis: tickets, giveaways, embed, verificação, boas-vindas, status, emojis, AutoMod e níveis
- `handlers/automodHandler.js` — o motor (`inspectMessage`) · `handlers/automodSetupHandler.js` — painel do `/automod`
- `handlers/levelsHandler.js` — concessão de XP na mensagem · `handlers/levelsSetupHandler.js` — painel do `/levelconfig` · `handlers/levelsLeaderboardHandler.js` — paginação do `/top`
- `events/` — ready, interactionCreate (roteia botões/selects por prefixo do customId), message create/update, member add/remove, logs
- `commands/<módulo>/` — um arquivo por comando
- `config/automodRules.js` — catálogo declarativo das 19 regras (o painel e os detectores leem daqui)
- `config/levels.js` — teto de nível, faixas aceitas, modos de recompensa e padrões do sistema de níveis
- `utils/automod/` — `config.js` (JSON normalizado + isenções) · `textNormalize.js` (desdisfarce) · `wildcard.js` (curinga `*` sem regex do usuário) · `tracker.js` (janelas em memória) · `infractions.js` (pontos e escada) · `enforce.js` (ações e log) · `raid.js` · `detectors/` (`excess` · `media` · `links` · `words` · `flood`)
- `utils/levels/card/` — o desenho das imagens: `theme.js` (medidas e paleta) · `primitives.js` (retângulo, avatar, barra, corte de texto) · `background.js` (fundo gerado e o remoto em cache) · `avatars.js` (download em paralelo com reserva) · `leaderboardCard.js` (página do `/top`) · `rankCard.js` (card do `/rank`) · `cache.js` (TTL + teto)
- `utils/canvasFonts.js` — registro da fonte embutida, descoberta das fontes do sistema e a cadeia de reserva por glifo (emoji, CJK), compartilhada pelo card e pelo captcha
- `assets/fonts/` — Klee One (Regular e SemiBold) usada nas imagens do ranking, com a licença OFL ao lado
- `utils/remoteImage.js` — download validado de imagem remota (https, host público, teto de bytes), usado pelo `/emoji-add` e pelo fundo do ranking
- `utils/levels/` — `formula.js` (nível derivado do XP) · `config.js` (JSON normalizado + exclusões) · `repository.js` (statements preparados) · `service.js` (alteração transacional) · `antiFarm.js` (elegibilidade do conteúdo) · `tracker.js` (cooldown e repetição em memória) · `rewards.js` (reconciliação de cargos) · `leaderboard.js` (formatação) · `adminAction.js` (corpo comum dos comandos de XP)
- `test/automod.test.js` e `test/levels.*.test.js` — testes da lógica pura e de integração (`npm test`)
- `utils/emojis.js` — registro central dos emojis · `utils/emojiSource.js` — resolução da origem do emoji (upload, ID ou URL)
- `utils/presence.js` — presença salva e normalizada · `utils/presenceKeeper.js` — garante o status após reconexões
- `utils/captcha.js` — geração do PNG do captcha · `utils/verifyChallenges.js` — desafios e cooldowns em memória
- `utils/verifyPanelConfig.js` — aparência salva do painel de verificação (embed + botão)
- `oauth/server.js` — callback OAuth2 (verify avançado)
