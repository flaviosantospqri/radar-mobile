import type { GeminiLiveSession } from "../../services/api/client";

type LiveMessage = {
  setupComplete?: unknown;
  error?: { message?: string; status?: string; code?: number };
  toolCall?: {
    functionCalls?: { id?: string; name?: string; args?: Record<string, unknown> }[];
  };
  serverContent?: {
    modelTurn?: { parts?: { text?: string }[] };
    turnComplete?: boolean;
    interrupted?: boolean;
  };
};

export type GeminiLiveConnection = {
  sendFrame: (base64Jpeg: string) => void;
  close: () => void;
};

const LIVE_ENDPOINT = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";
const IDENTIFICATION_TOOL = "report_product_identification";
const START_PROMPT = "Comece a identificar o produto central pelos próximos quadros. Quando tiver uma hipótese útil, envie-a pela função estruturada; aceite incerteza e continue observando para melhorar a resposta.";
const SETUP_TIMEOUT_MS = 20_000;

function diagnostic(event: string, detail?: Record<string, unknown>) {
  console.info("[RADAR][Gemini Live]", event, detail ?? "");
}

export function connectGeminiLive(
  session: GeminiLiveSession,
  onIdentification: (raw: string) => void,
  onConnectionError: (error: Error) => void,
): Promise<GeminiLiveConnection> {
  return new Promise((resolve, reject) => {
    diagnostic("websocket_connecting", { model: session.model });
    const socket = new WebSocket(`${LIVE_ENDPOINT}?access_token=${encodeURIComponent(session.token)}`);
    let connected = false;
    let closed = false;
    let frameCount = 0;
    const setupTimeout = setTimeout(() => {
      if (!connected) fail(new Error("O Gemini não concluiu a configuração da sessão a tempo."));
    }, SETUP_TIMEOUT_MS);

    const fail = (error: Error) => {
      if (closed) return;
      closed = true;
      clearTimeout(setupTimeout);
      diagnostic(connected ? "session_failed" : "setup_failed");
      try { socket.close(); } catch { /* The socket may already be closed. */ }
      if (!connected) reject(error);
      else onConnectionError(error);
    };

    socket.onopen = () => {
      diagnostic("websocket_open");
      try {
        socket.send(JSON.stringify({ setup: { model: session.model, ...session.setup } }));
        diagnostic("setup_sent");
      } catch {
        fail(new Error("Não foi possível enviar a configuração da sessão Gemini."));
      }
    };

    socket.onmessage = (event) => {
      let message: LiveMessage;
      try { message = JSON.parse(String(event.data)) as LiveMessage; }
      catch {
        diagnostic("invalid_server_message");
        return;
      }

      if (message.error) {
        diagnostic("setup_rejected", { status: message.error.status ?? "unknown", code: message.error.code ?? "unknown" });
        fail(new Error("O Gemini recusou a configuração da sessão. Confira o modelo configurado no backend."));
        return;
      }
      if (message.setupComplete) {
        if (connected || closed) return;
        try {
          socket.send(JSON.stringify({ realtimeInput: { text: START_PROMPT } }));
        } catch {
          fail(new Error("Não foi possível iniciar a leitura com o Gemini."));
          return;
        }
        connected = true;
        clearTimeout(setupTimeout);
        diagnostic("setup_complete");
        resolve({
          sendFrame(base64Jpeg) {
            if (closed || socket.readyState !== WebSocket.OPEN) throw new Error("A sessão visual foi encerrada.");
            socket.send(JSON.stringify({ realtimeInput: { video: { mimeType: "image/jpeg", data: base64Jpeg } } }));
            frameCount += 1;
            diagnostic("video_frame_sent", { count: frameCount });
          },
          close() {
            if (closed) return;
            closed = true;
            clearTimeout(setupTimeout);
            diagnostic("session_closed", { frames: frameCount });
            try { socket.close(); } catch { /* The socket may already be closed. */ }
          },
        });
        return;
      }

      const functionCalls = message.toolCall?.functionCalls;
      if (functionCalls?.length) {
        diagnostic("function_call_received", { count: functionCalls.length });
        const functionResponses = functionCalls.map((functionCall) => {
          const isIdentification = functionCall.name === IDENTIFICATION_TOOL;
          const hasArgs = Boolean(functionCall.args && typeof functionCall.args === "object" && !Array.isArray(functionCall.args));
          if (isIdentification && hasArgs) {
            try { onIdentification(JSON.stringify(functionCall.args)); }
            catch { diagnostic("identification_callback_failed"); }
          } else {
            diagnostic("unexpected_function_call", { name: functionCall.name ?? "unknown" });
          }
          return {
            ...(functionCall.id ? { id: functionCall.id } : {}),
            name: functionCall.name ?? IDENTIFICATION_TOOL,
            response: { accepted: isIdentification && hasArgs },
            scheduling: "SILENT",
          };
        });
        try {
          socket.send(JSON.stringify({ toolResponse: { functionResponses } }));
          diagnostic("function_response_sent", { count: functionResponses.length });
        } catch {
          if (connected) fail(new Error("A conexão com o Gemini caiu ao processar a identificação."));
        }
      }
    };

    socket.onerror = () => {
      diagnostic("websocket_error");
      fail(new Error("Não foi possível conectar diretamente ao Gemini. Confira a internet e tente novamente."));
    };
    socket.onclose = (event) => {
      if (closed) return;
      diagnostic("websocket_closed", { code: event.code, reasonPresent: Boolean(event.reason) });
      fail(new Error("A conexão ao vivo com o Gemini foi encerrada. Tente novamente."));
    };
  });
}
