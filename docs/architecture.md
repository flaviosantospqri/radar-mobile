# Arquitetura do RADAR Mobile

## Scanner ao vivo

1. O usuário concede a permissão e vê a prévia da câmera do aparelho dentro da tela Scanner.
2. A câmera produz um quadro temporário JPEG. O app o reduz para 768 px e apaga os arquivos do cache após processá-los.
3. Para cada tentativa, o app pede ao backend autenticado um token Gemini Live de uso único e validade curta e abre uma conexão WebSocket direta com o Gemini. As imagens não passam pelo Render nem pela API RADAR.
4. A sessão usa a modalidade AUDIO aceita pelo modelo Live nativo e declara a função `report_product_identification`; o Gemini retorna os campos da identificação nos argumentos estruturados dessa função.
5. Ao receber os argumentos, o app responde à chamada da ferramenta e usa imediatamente a identificação, sem aguardar a geração ou reprodução de áudio. Cada tentativa termina ao fechar a conexão correspondente.
6. O app normaliza os campos e envia somente o JSON estruturado ao endpoint `POST /api/v1/analyses/live-result`.
7. O backend valida e grava somente dados estruturados. A tela existente de confirmação, pesquisa de mercado, cálculo e histórico continua sendo usada.

O Gemini recebe os quadros para inferência. O RADAR não os armazena em bucket, backend ou PostgreSQL. A chave permanente do Gemini nunca está no app: o backend emite apenas uma credencial Live efêmera vinculada ao modelo e à configuração de identificação.

## Galeria

A seleção da galeria continua disponível. O app comprime a imagem em cache local, envia o conteúdo diretamente ao Gemini Live e apaga o arquivo derivado depois da resposta. A imagem original continua na biblioteca do usuário e não é copiada para o backend RADAR.

## Segredos e ambiente

O único segredo configurado no mobile é o token de sessão de usuário guardado no SecureStore. `EXPO_PUBLIC_API_URL` é uma URL pública. `GEMINI_API_KEY` e `GEMINI_LIVE_MODEL` pertencem somente ao ambiente do backend no Render. Não adicione segredos Gemini ao `.env` mobile.

