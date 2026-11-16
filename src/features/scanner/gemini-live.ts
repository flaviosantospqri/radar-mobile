import type { GeminiLiveSession } from "../../services/api/client";

type LiveMessage = {
  setupComplete?: unknown;
  error?: { message?: string; status?: string };
  toolCall?: {
    functionCalls?: { id?: string; name?: string; args?: Record<string, unknown> }[];
  };
  serverContent?: {
    modelTurn?: { parts?: { text?: string }[] };
    turnComplete?: boolean;
    interrupted?: boolean;
  };
};

type PendingTurn = {
  text: string;
  resolve: (text: string) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

export type GeminiLiveConnection = {
  sendFrame: (base64Jpeg: string) => Promise<string>;
  close: () => void;
};

const LIVE_ENDPOINT = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";
const IDENTIFICATION_TOOL = "report_product_identification";
const FRAME_PROMPT = `Identifique o produto que aparece nesta imagem agora e chame a função ${IDENTIFICATION_TOOL} com todos os campos exigidos.`;

export function connectGeminiLive(session: GeminiLiveSession): Promise<GeminiLiveConnection> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${LIVE_ENDPOINT}?access_token=${encodeURIComponent(session.token)}`);
    let connected = false;
    let closed = false;
    let pending: PendingTurn | null = null;
    const setupTimeout = setTimeout(() => {
      if (!connected) fail(new Error("O Gemini não concluiu a conexão a tempo."));
    }, 15_000);

    const fail = (error: Error) => {
      if (closed) return;
      closed = true;
      clearTimeout(setupTimeout);
      if (pending) {
        clearTimeout(pending.timeout);
        pending.reject(error);
        pending = null;
      }
      try { socket.close(); } catch { /* The socket may already be closed. */ }
      if (!connected) reject(error);
    };

    socket.onopen = () => {
      try {
        socket.send(JSON.stringify({ setup: { model: session.model, ...session.setup } }));
      } catch {
        fail(new Error("Não foi possível iniciar a conexão visual com o Gemini."));
      }
    };

    socket.onmessage = (event) => {
      let message: LiveMessage;
      try { message = JSON.parse(String(event.data)) as LiveMessage; }
      catch { return; }

      if (message.error) {
        fail(new Error(message.error.message ?? "O Gemini recusou a sessão visual."));
        return;
      }
      if (message.setupComplete) {
        connected = true;
        clearTimeout(setupTimeout);
        resolve({
          sendFrame(base64Jpeg) {
            if (closed || socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error("A sessão visual foi encerrada."));
            if (pending) return Promise.reject(new Error("A análise do quadro anterior ainda está em andamento."));
            return new Promise((turnResolve, turnReject) => {
              const timeout = setTimeout(() => {
                if (!pending) return;
                pending = null;
                turnReject(new Error("O Gemini demorou para identificar este quadro. Tente novamente."));
              }, 45_000);
              pending = { text: "", resolve: turnResolve, reject: turnReject, timeout };
              try {
                socket.send(JSON.stringify({
                  clientContent: {
                    turns: [{ role: "user", parts: [
                      { inlineData: { mimeType: "image/jpeg", data: base64Jpeg } },
                      { text: FRAME_PROMPT },
                    ] }],
                    turnComplete: true,
                  },
                }));
              } catch {
                clearTimeout(timeout);
                pending = null;
                turnReject(new Error("Não foi possível enviar o quadro ao Gemini."));
              }
            });
          },
          close() {
            if (closed) return;
            closed = true;
            clearTimeout(setupTimeout);
            if (pending) {
              clearTimeout(pending.timeout);
              pending.reject(new Error("A leitura ao vivo foi encerrada."));
              pending = null;
            }
            try { socket.close(); } catch { /* The socket may already be closed. */ }
          },
        });
        return;
      }

      const functionCall = message.toolCall?.functionCalls?.find((call) => call.name === IDENTIFICATION_TOOL);
      if (functionCall) {
        if (!pending) return;
        if (!functionCall.args || typeof functionCall.args !== "object" || Array.isArray(functionCall.args)) {
          const current = pending;
          pending = null;
          clearTimeout(current.timeout);
          current.reject(new Error("O Gemini retornou uma identificação em formato inválido."));
          return;
        }
        const result = JSON.stringify(functionCall.args);
        try {
          socket.send(JSON.stringify({
            toolResponse: {
              functionResponses: [{
                ...(functionCall.id ? { id: functionCall.id } : {}),
                name: IDENTIFICATION_TOOL,
                response: { accepted: true },
              }],
            },
          }));
        } catch { /* The structured result is still usable if the socket closes. */ }
        const current = pending;
        pending = null;
        clearTimeout(current.timeout);
        current.resolve(result);
        return;
      }

      const serverContent = message.serverContent;
      if (!serverContent || !pending) return;
      if (serverContent.interrupted) {
        const current = pending;
        pending = null;
        clearTimeout(current.timeout);
        current.reject(new Error("O Gemini interrompeu a identificação. Tente novamente."));
        return;
      }
      for (const part of serverContent.modelTurn?.parts ?? []) {
        if (typeof part.text === "string") pending.text += part.text;
      }
      if (serverContent.turnComplete) {
        const current = pending;
        pending = null;
        clearTimeout(current.timeout);
        current.resolve(current.text);
      }
    };

    socket.onerror = () => fail(new Error("Não foi possível conectar diretamente ao Gemini. Confira a internet e tente novamente."));
    socket.onclose = (event) => {
      const closeMessage = event.reason ? ` (${event.reason})` : "";
      fail(new Error(`A conexão do Gemini foi encerrada${closeMessage}.`));
    };
  });
}
