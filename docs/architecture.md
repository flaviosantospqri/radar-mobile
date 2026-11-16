# Arquitetura do RADAR Mobile

## Scanner ao vivo

1. O usuário concede a permissão e vê a prévia da câmera do aparelho dentro da tela Scanner.
2. Ao iniciar, o app pede ao backend autenticado um token Gemini Live de uso único e validade curta.
3. A câmera produz quadros temporários em JPEG. O app os reduz para 768 px, limita a frequência a no máximo um quadro por segundo e apaga os arquivos do cache após processá-los.
4. O app envia os quadros diretamente ao WebSocket Gemini Live. A conexão não atravessa Render nem a API RADAR.
5. A sessão usa a modalidade AUDIO aceita pelo modelo Live nativo e declara a função `report_product_identification`; o Gemini retorna os campos da identificação nos argumentos estruturados dessa função. O app reconhece esses argumentos sem reproduzir áudio e os normaliza.
6. A sessão Live autenticada permanece ativa durante as tentativas de leitura; depois da chamada estruturada, o app responde à ferramenta e aguarda o fim do turno antes de enviar outro quadro. O app envia somente os campos estruturados ao endpoint `POST /api/v1/analyses/live-result`.
7. O backend valida e grava somente dados estruturados. A tela existente de confirmação, pesquisa de mercado, cálculo e histórico continua sendo usada.

O Gemini recebe os quadros para inferência. O RADAR não os armazena em bucket, backend ou PostgreSQL. A chave permanente do Gemini nunca está no app: o backend emite apenas uma credencial Live efêmera vinculada ao modelo e à configuração de identificação.

## Galeria

A seleção da galeria continua disponível. O app comprime a imagem em cache local, envia o conteúdo diretamente ao Gemini Live e apaga o arquivo derivado depois da resposta. A imagem original continua na biblioteca do usuário e não é copiada para o backend RADAR.

## Segredos e ambiente

O único segredo configurado no mobile é o token de sessão de usuário guardado no SecureStore. `EXPO_PUBLIC_API_URL` é uma URL pública. `GEMINI_API_KEY` e `GEMINI_LIVE_MODEL` pertencem somente ao ambiente do backend no Render. Não adicione segredos Gemini ao `.env` mobile.

