# RADAR Mobile

Aplicativo Android com React Native, Expo, TypeScript e Expo Router, mantido em repositório independente de `radar-back`.

## Configuração local

Requer Node.js e Android Studio/SDK ou um development build Expo compatível. Copie `.env.example` para `.env` e defina `EXPO_PUBLIC_API_URL`. O endereço `10.0.2.2` funciona no emulador Android; em aparelho físico, use o IP local do computador que executa o backend.

```powershell
npm install
npx expo start
```

## Imagens

As imagens selecionadas são enviadas ao backend por `multipart/form-data`. O mobile não chama o Gemini e não usa Firebase Storage nem Cloudflare R2. O backend descarta a cópia temporária após a identificação; a API devolve dados estruturados e o histórico não contém a fotografia original.

## Build Android

O perfil `preview` em `eas.json` gera um APK instalável com `npx eas-cli build --platform android --profile preview`. O perfil `production` gera um Android App Bundle.

O arquivo `RADAR-preview-arm64.apk` incluído neste repositório é uma build local de validação para arm64, assinada pela chave Android de debug. Para usar o backend local, configure `EXPO_PUBLIC_API_URL` antes de gerar outra build; `10.0.2.2` funciona no emulador, enquanto aparelho físico precisa de um endereço acessível na rede. Essa assinatura de debug não é adequada para publicação na Play Store.

