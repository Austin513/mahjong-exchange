// WebSocket connection to one room. Keeps the per-room session token in localStorage
// so refresh/reconnect reattaches the same identity (and seat, and balance).

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, ServerMessage, StateMessage } from "../shared/protocol";

const tokenKey = (code: string) => `mx:token:${code.toUpperCase()}`;
export const NAME_KEY = "mx:name";

export const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* private mode: identity lasts for this tab only */
    }
  },
  remove(key: string) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

export const saveToken = (code: string, token: string) => storage.set(tokenKey(code), token);

export type ConnStatus = "connecting" | "open" | "reconnecting" | "closed";

export interface Toast {
  id: number;
  kind: "error" | "notice";
  text: string;
}

export function useRoom(code: string) {
  const [state, setState] = useState<StateMessage | null>(null);
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [needName, setNeedName] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [receivedAt, setReceivedAt] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const nameRef = useRef<string | undefined>(undefined);
  const retry = useRef(0);
  const stopped = useRef(false);
  const toastId = useRef(0);

  const pushToast = useCallback((kind: Toast["kind"], text: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 6000 : 4000);
  }, []);

  const connect = useCallback(() => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    wsRef.current = ws;
    ws.onopen = () => {
      const token = storage.get(tokenKey(code)) ?? undefined;
      ws.send(JSON.stringify({ t: "hello", room: code, token, name: token ? undefined : nameRef.current } satisfies ClientMessage));
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string) as ServerMessage;
      switch (msg.t) {
        case "welcome":
          saveToken(code, msg.token);
          retry.current = 0;
          setNeedName(false);
          setStatus("open");
          break;
        case "state":
          setState(msg);
          setReceivedAt(Date.now());
          break;
        case "error":
          if (msg.code === "name_required") {
            storage.remove(tokenKey(code));
            setNeedName(true);
            setStatus("open");
          } else if (msg.code === "no_room") {
            stopped.current = true;
            setFatal(msg.message);
            ws.close();
          } else pushToast("error", msg.message);
          break;
        case "notice":
          pushToast("notice", msg.text);
          break;
        default:
          break;
      }
    };
    ws.onclose = () => {
      if (stopped.current) return setStatus("closed");
      setStatus("reconnecting");
      const delay = Math.min(5000, 400 * 2 ** retry.current++);
      setTimeout(() => !stopped.current && connect(), delay);
    };
  }, [code, pushToast]);

  useEffect(() => {
    stopped.current = false;
    connect();
    return () => {
      stopped.current = true;
      wsRef.current?.close();
    };
  }, [connect]);

  const send = useCallback(
    (msg: ClientMessage) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        pushToast("error", "You're offline — reconnecting. Try again in a moment.");
        return false;
      }
      ws.send(JSON.stringify(msg));
      return true;
    },
    [pushToast],
  );

  const join = useCallback(
    (name: string) => {
      nameRef.current = name;
      storage.set(NAME_KEY, name);
      wsRef.current?.send(JSON.stringify({ t: "hello", room: code, name } satisfies ClientMessage));
    },
    [code],
  );

  return { state, status, needName, fatal, toasts, send, join, receivedAt, pushToast };
}

export type RoomConn = ReturnType<typeof useRoom>;
