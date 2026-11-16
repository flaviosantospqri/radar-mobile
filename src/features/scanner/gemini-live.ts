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
  sendFrame: (base64Jpeg: string, requestIdentification?: boolean) => void;
  close: () => void;
};

export type GeminiLiveConnectionStage = "websocket_open" | "setup_sent" | "setup_complete";

const LIVE_ENDPOINT = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";
const IDENTIFICATION_TOOL = "report_product_identification";
const IDENTIFICATION_PROMPT = "Analise os quadros da câmera recebidos até agora e chame report_product_identification agora com sua melhor identificação estruturada. Se não souber marca, modelo, ano ou edição, forneça uma hipótese ampla útil em attributes.suggestions. Não espere novos quadros para responder.";
const SETUP_TIMEOUT_MS = 20_000;

function diagnostic(event: string, detail?: Record<string, unknown>) {
  console.info("[RADAR][Gemini Live]", event, detail ?? "");
}

async function readSocketMessage(data: unknown): Promise<string> {
  if (typeof data === "string") return data;

  let blob: Blob;
  if (typeof Blob !== "undefined" && data instanceof Blob) blob = data;
  else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) blob = new Blob([data as BlobPart]);
  else throw new Error("O Gemini retornou um quadro de mensagem incompatível.");

  if (typeof blob.text === "function") return blob.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string"
      ? resolve(reader.result)
      : reject(new Error("Não foi possível decodificar a resposta do Gemini."));
    reader.onerror = () => reject(new Error("Não foi possível ler a resposta binária do Gemini."));
    reader.readAsText(blob);
  });
}

export function connectGeminiLive(
  session: GeminiLiveSession,
  onIdentification: (raw: string) => void,
  onConnectionError: (error: Error) => void,
  onStage?: (stage: GeminiLiveConnectionStage) => void,
): Promise<GeminiLiveConnection> {
  return new Promise((resolve, reject) => {
    diagnostic("websocket_connecting", { model: session.model });
    const socket = new WebSocket(`${LIVE_ENDPOINT}?access_token=${encodeURIComponent(session.token)}`);
    socket.binaryType = "arraybuffer";
    let connected = false;
    let closed = false;
    let frameCount = 0;
    let incomingMessages = Promise.resolve();
    const reportStage = (stage: GeminiLiveConnectionStage) => {
      try { onStage?.(stage); } catch { diagnostic("stage_callback_failed", { stage }); }
    };
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
      reportStage("websocket_open");
      try {
        socket.send(JSON.stringify({ setup: { model: session.model, ...session.setup } }));
        diagnostic("setup_sent");
        reportStage("setup_sent");
      } catch {
        fail(new Error("Não foi possível enviar a configuração da sessão Gemini."));
      }
    };

    const handleMessage = async (data: unknown) => {
      let message: LiveMessage;
      try { message = JSON.parse(await readSocketMessage(data)) as LiveMessage; }
      catch {
        const isBlob = typeof Blob !== "undefined" && data instanceof Blob;
        diagnostic("invalid_server_message", { dataType: data instanceof ArrayBuffer ? "arraybuffer" : isBlob ? "blob" : typeof data });
        return;
      }

      if (message.error) {
        diagnostic("setup_rejected", { status: message.error.status ?? "unknown", code: message.error.code ?? "unknown" });
        const reason = message.error.status ?? (message.error.code ? `código ${message.error.code}` : "sem código");
        fail(new Error(`O Gemini recusou a configuração da sessão (${reason}).`));
        return;
      }
      if (message.setupComplete) {
        if (connected || closed) return;
        connected = true;
        clearTimeout(setupTimeout);
        diagnostic("setup_complete");
        reportStage("setup_complete");
        resolve({
          sendFrame(base64Jpeg, requestIdentification = false) {
            if (closed || socket.readyState !== WebSocket.OPEN) throw new Error("A sessão visual foi encerrada.");
            socket.send(JSON.stringify({ realtimeInput: { video: { mimeType: "image/jpeg", data: base64Jpeg } } }));
            frameCount += 1;
            diagnostic("video_frame_sent", { count: frameCount });
            if (requestIdentification) {
              // Video frames are streamed as transient input, but do not by themselves start a reasoning turn.
              // Prompt after the frame so Gemini has visual context when the turn begins.
              socket.send(JSON.stringify({ realtimeInput: { text: IDENTIFICATION_PROMPT } }));
              diagnostic("identification_prompt_sent", { frame: frameCount });
            }
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

    socket.onmessage = (event) => {
      incomingMessages = incomingMessages
        .then(() => handleMessage(event.data))
        .catch(() => diagnostic("message_handler_failed"));
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
