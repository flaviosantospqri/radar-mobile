# RADAR Mobile

Aplicativo Android com React Native, Expo, TypeScript e Expo Router, mantido em repositório independente de `radar-back`.

## Configuração local

Requer Node.js e Android Studio/SDK ou um development build Expo compatível. Copie `.env.example` para `.env` e configure `EXPO_PUBLIC_API_URL`. O padrão aponta para o backend hospedado no Render. Para executar o backend localmente, use `http://10.0.2.2:4000/api/v1` no emulador Android ou o IP acessível do computador em um aparelho físico.

```powershell
npm install
npx expo start
```

## Leitura de produtos

A aba Scanner abre a prévia da câmera do próprio aparelho. Ao iniciar a leitura, o app solicita uma sessão e mantém uma conexão WebSocket direta com o Gemini Live por até 30 segundos. Captura e envia quadros JPEG pequenos em sequência, no máximo um por segundo; o backend não recebe arquivos de imagem. O backend emite um token de sessão de uso único; a chave Gemini permanente fica apenas no servidor.

O Gemini recebe os quadros para inferência. Eles não são armazenados pelo RADAR, enviados ao Render ou gravados no Neon. Cada captura comprimida no cache local é excluída após o envio. Se a resposta exata não estiver clara, o Gemini pode retornar uma hipótese com confiança e justificativa visual; o app mantém a melhor resposta durante a leitura e permite revisar ou aceitar hipóteses de categoria, tipo, marca, modelo ou edição/ano antes da pesquisa. A galeria permanece como alternativa e usa a mesma conexão direta ao Gemini. Após identificar, o app envia somente o JSON estruturado ao backend para histórico, confirmação e pesquisa de mercado.

A conexão direta ao Gemini exige internet. Se a conexão ou a configuração inicial falhar, o app solicita uma sessão nova e repete a tentativa uma vez. Se não houver uma identificação útil ao final de 30 segundos, o app orienta a aproximar a câmera e tentar novamente. Nenhuma imagem entra em uma fila persistente.

## Build Android

Para gerar localmente um APK independente, que abre sem Metro e inclui o bundle JavaScript, use `cd android; .\\gradlew.bat assembleRelease`. O APK é assinado com a chave debug do template e serve para instalação/teste; para publicar na Play Store, configure uma chave de assinatura própria e gere o App Bundle.

O `assembleDebug` depende de um servidor Metro e não deve ser distribuído como instalador independente. A configuração Android inclui ARMv7, ARM64, x86 e x86_64 no APK universal. O app exige Android 7.0 (API 24) ou superior.

O perfil `preview` em `eas.json` também gera um APK instalável com `npx eas-cli build --platform android --profile preview`. O perfil `production` gera um Android App Bundle.

A mudança do scanner requer uma nova build/instalação do app (versionCode 12). A sessão Live usa `gemini-3.8-live`, saída AUDIO e a função `report_product_identification` não bloqueante. O app decodifica quadros binários do WebSocket diretamente como UTF-8, sem criar Blob a partir de ArrayBuffer, envia quadros diretamente ao Gemini e, após o primeiro quadro e depois a cada três quadros, pede explicitamente uma atualização do JSON. A tela mostra o JSON estruturado preenchendo nome, categoria, marca, modelo, edição/ano e hipóteses. Somente o resultado estruturado segue ao backend para histórico e pesquisa de mercado. Configure `EXPO_PUBLIC_API_URL` no ambiente de build; a URL é incorporada ao aplicativo. Nenhuma chave Gemini deve ser criada no mobile nem incluída em `.env` do app.

Consulte [docs/architecture.md](docs/architecture.md) para o fluxo de dados.

