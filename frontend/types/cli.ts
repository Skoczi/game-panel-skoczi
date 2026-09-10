export interface CLIMessage {
  id: string;
  timestamp: string;
  displayTime?: string;
  server?: string;
  action?: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
}
