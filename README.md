# RADAR Mobile

Aplicativo Android com React Native, Expo, TypeScript e Expo Router, mantido em repositório independente de `radar-back`.

## Configuração local

Requer Node.js e Android Studio/SDK ou um development build Expo compatível. Copie `.env.example` para `.env` e configure `EXPO_PUBLIC_API_URL`. O padrão aponta para o backend hospedado no Render. Para executar o backend localmente, use `http://10.0.2.2:4000/api/v1` no emulador Android ou o IP acessível do computador em um aparelho físico.

```powershell
npm install
npx expo start
```

## Leitura de produtos

A aba Scanner abre a prévia da câmera do próprio aparelho. Ao iniciar a leitura, o app captura quadros JPEG pequenos e temporários enquanto o produto é enquadrado e os envia diretamente ao Gemini Live por WebSocket. O backend não recebe arquivos de imagem. Ele emite um token de sessão de uso único; a chave Gemini permanente fica apenas no servidor.

O Gemini recebe os quadros para inferência. Eles não são armazenados pelo RADAR, enviados ao Render ou gravados no Neon. Cada captura comprimida no cache local é excluída após o processamento. A galeria permanece como alternativa e usa a mesma conexão direta ao Gemini. Após identificar, o app envia somente o JSON estruturado ao backend para histórico, confirmação e pesquisa de mercado.

A conexão direta ao Gemini exige internet. Se ela falhar, a leitura pode ser iniciada novamente; nenhuma imagem entra em uma fila persistente.

## Build Android

O perfil `preview` em `eas.json` gera um APK instalável com `npx eas-cli build --platform android --profile preview`. O perfil `production` gera um Android App Bundle.

A mudança do scanner requer uma nova build/instalação do app (versionCode 5). Configure `EXPO_PUBLIC_API_URL` no ambiente de build; a URL é incorporada ao aplicativo. Nenhuma chave Gemini deve ser criada no mobile nem incluída em `.env` do app.

Consulte [docs/architecture.md](docs/architecture.md) para o fluxo de dados.

