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

Para gerar localmente um APK independente, que abre sem Metro e inclui o bundle JavaScript, use `cd android; .\\gradlew.bat assembleRelease`. O APK é assinado com a chave debug do template e serve para instalação/teste; para publicar na Play Store, configure uma chave de assinatura própria e gere o App Bundle.

O `assembleDebug` depende de um servidor Metro e não deve ser distribuído como instalador independente. A configuração Android inclui ARMv7, ARM64, x86 e x86_64 no APK universal. O app exige Android 7.0 (API 24) ou superior.

O perfil `preview` em `eas.json` também gera um APK instalável com `npx eas-cli build --platform android --profile preview`. O perfil `production` gera um Android App Bundle.

A mudança do scanner requer uma nova build/instalação do app (versionCode 7). A sessão Live usa saída AUDIO e recebe a identificação estruturada pela função `report_product_identification`, compatível com o modelo Gemini Live configurado no backend. Configure `EXPO_PUBLIC_API_URL` no ambiente de build; a URL é incorporada ao aplicativo. Nenhuma chave Gemini deve ser criada no mobile nem incluída em `.env` do app.

Consulte [docs/architecture.md](docs/architecture.md) para o fluxo de dados.

