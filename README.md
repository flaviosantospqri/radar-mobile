# RADAR Mobile

Aplicativo Android com React Native, Expo, TypeScript e Expo Router, mantido em repositório independente de `radar-back`.

## Configuração local

Requer Node.js e Android Studio/SDK ou um development build Expo compatível. Copie `.env.example` para `.env` e defina `EXPO_PUBLIC_API_URL`. O valor padrão aponta para o backend hospedado no Render. Para executar o backend localmente, use `http://10.0.2.2:4000/api/v1` no emulador Android ou o IP acessível do computador em um aparelho físico.

```powershell
npm install
npx expo start
```

## Imagens

As imagens selecionadas são enviadas ao backend por `multipart/form-data`. O mobile não chama o Gemini e não usa Firebase Storage nem Cloudflare R2. O backend descarta a cópia temporária após a identificação; a API devolve dados estruturados e o histórico não contém a fotografia original.

## Build Android

O perfil `preview` em `eas.json` gera um APK instalável com `npx eas-cli build --platform android --profile preview`. O perfil `production` gera um Android App Bundle.

Configure `EXPO_PUBLIC_API_URL` no ambiente usado pelo build antes de gerar o APK. O valor é incorporado ao app, então uma mudança de servidor exige nova build. Builds locais de validação são assinadas pela chave Android de debug e não servem para publicação na Play Store.

