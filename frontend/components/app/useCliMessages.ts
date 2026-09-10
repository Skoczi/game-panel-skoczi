import { useCallback, useRef, useState } from 'react';
import type { CLIMessage } from '../../types/cli';
import { nextId } from '../../utils/uid';
import { formatLogDisplayTime } from '../../utils/serverRuntime';

const MAX_CLI_MESSAGES = 2000;

export function useCliMessages() {
  const [cliMessages, setCliMessages] = useState<CLIMessage[]>([]);
  const lastCliMessageRef = useRef<{ key: string; at: number } | null>(null);

  const addCliMessage = useCallback(
    (
      type: 'success' | 'error' | 'info' | 'warning',
      message: string,
      server?: string,
      action?: string
    ) => {
      const isNoisyInfo =
        type === 'info' &&
        (message.startsWith('[WS]') ||
          message.startsWith('[API]') ||
          message.startsWith('[TIMER]') ||
          message.includes('[INSTALL] Server Name:') ||
          message.includes('[INSTALL] Game:') ||
          message.includes('[INSTALL] Awaiting real-time install updates...') ||
          message.includes('[INSTALL] Server ID:'));

      if (isNoisyInfo) return;

      const now = Date.now();
      const dedupeKey = `${type}|${server || ''}|${action || ''}|${message}`;
      if (
        lastCliMessageRef.current &&
        lastCliMessageRef.current.key === dedupeKey &&
        now - lastCliMessageRef.current.at < 1500
      ) {
        return;
      }
      lastCliMessageRef.current = { key: dedupeKey, at: now };

      const timestamp = new Date().toISOString();
      const newMessage: CLIMessage = {
        id: String(nextId()),
        timestamp,
        displayTime: formatLogDisplayTime(timestamp),
        message,
        type,
        server,
        action,
      };
      if (import.meta.env.DEV) {
        console.log('[CLI]', { timestamp: newMessage.timestamp, type, server, action, message });
      }
      setCliMessages((prev) => [...prev, newMessage].slice(-MAX_CLI_MESSAGES));
    },
    []
  );

  const clearCliMessages = useCallback(() => {
    setCliMessages([]);
  }, []);

  return {
    cliMessages,
    setCliMessages,
    addCliMessage,
    clearCliMessages,
  };
}
