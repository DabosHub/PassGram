export {};

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }
}

interface TelegramWebAppUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

interface TelegramThemeParams {
  bg_color?: string;
  text_color?: string;
  hint_color?: string;
  link_color?: string;
  button_color?: string;
  button_text_color?: string;
  secondary_bg_color?: string;
}

interface TelegramWebApp {
  ready: () => void;
  expand: () => void;
  colorScheme: "light" | "dark";
  themeParams: TelegramThemeParams;
  initData: string;
  initDataUnsafe: { user?: TelegramWebAppUser; start_param?: string };
  version?: string;
  isVersionAtLeast?: (version: string) => boolean;
  requestChat?: (requestId: string, callback?: (sent: boolean) => void) => void;
  onEvent: (event: string, handler: () => void) => void;
  offEvent: (event: string, handler: () => void) => void;
  HapticFeedback?: { impactOccurred: (style: "light" | "medium" | "heavy") => void };
}
