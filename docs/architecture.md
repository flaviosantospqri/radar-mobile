# Arquitetura do RADAR Mobile

## Scanner ao vivo

1. O usuário concede a permissão e vê a prévia da câmera do aparelho dentro da tela Scanner.
2. O app pede ao backend autenticado um token Gemini Live de uso único e validade curta e abre uma conexão WebSocket direta por leitura. No Android, as respostas podem chegar como `ArrayBuffer`; o app decodifica os bytes UTF-8 diretamente, pois o Blob do React Native não aceita `ArrayBuffer` como parte. A leitura só começa após receber `setupComplete`, e a interface mostra separadamente a abertura do socket, o envio do setup e a confirmação do Gemini. Essa pequena chamada protege a chave permanente; as imagens não passam pelo Render nem pela API RADAR.
3. Enquanto mantém a prévia aberta, o app captura quadros JPEG temporários, reduz cada quadro a no máximo 768 px e envia `realtimeInput.video` no máximo uma vez por segundo por até 30 segundos. Apaga cada arquivo local assim que o envio termina.
4. A sessão usa o modelo `gemini-3.8-live`, modalidade AUDIO e a função não bloqueante `report_product_identification`. Como vídeo sozinho não inicia uma resposta, o app envia um pedido de identificação após o primeiro quadro e depois a cada três quadros. O Gemini atualiza o JSON enquanto o usuário enquadra o produto.
5. A tela mostra os campos estruturados reconhecidos, mescla atualizações parciais e preserva a melhor identificação útil. Uma resposta incompleta fica disponível como hipótese editável; se não houver candidato útil após 30 segundos, orienta o usuário a enquadrar novamente. As capturas são silenciosas e um indicador visual pede que a pessoa continue apontando durante a leitura.
6. Ao terminar, o app envia somente o JSON estruturado ao endpoint `POST /api/v1/analyses/live-result`. Campos incertos podem incluir hipóteses com confiança e justificativa em `attributes.suggestions`.
7. O backend valida e grava somente dados estruturados. Depois da leitura, a pessoa pode pesquisar imediatamente com os campos reconhecidos ou refiná-los antes da pesquisa; a confirmação não é obrigatória para obter referências.
8. O backend pesquisa páginas públicas na web e captura preços visíveis em resultados do Google/Bing e em páginas de ofertas de Zoom, Carrefour e Amazon; não usa API oficial de marketplace nem Gemini para pesquisa de preços. A tela apresenta média, mediana, faixa de preços, estimativa de revenda e preço máximo de compra. Itens semelhantes são identificados separadamente de correspondências mais fortes. Informar o preço pedido é opcional: sem ele, o RADAR mostra o teto de compra; com ele, calcula lucro líquido e ROI. Os preços são anúncios, não vendas confirmadas, e podem variar conforme marca, modelo e condição.

O Gemini recebe os quadros para inferência. O RADAR não os armazena em bucket, backend ou PostgreSQL. A chave permanente do Gemini nunca está no app: o backend emite apenas uma credencial Live efêmera vinculada ao modelo e à configuração de identificação. O log de diagnóstico registra apenas etapas, quantidade de quadros e códigos de erro; não registra token, payload de imagem ou conteúdo das identificações.

## Galeria

A seleção da galeria continua disponível. O app comprime a imagem em cache local, envia o conteúdo diretamente ao Gemini Live e apaga o arquivo derivado depois da resposta. A imagem original continua na biblioteca do usuário e não é copiada para o backend RADAR. A resposta parcial também segue para a confirmação.

## Segredos e ambiente

O único segredo configurado no mobile é o token de sessão de usuário guardado no SecureStore. `EXPO_PUBLIC_API_URL` é uma URL pública. `GEMINI_API_KEY` e `GEMINI_LIVE_MODEL` pertencem somente ao ambiente do backend no Render. Não adicione segredos Gemini ao `.env` mobile.

