export type TelegramProfile = {
  id: number;
  firstName: string;
  lastName?: string;
  username?: string;
  photoUrl?: string;
  startParam?: string;
};

const THEME_KEYS = [
  ["bg_color", "--tg-theme-bg-color"],
  ["text_color", "--tg-theme-text-color"],
  ["hint_color", "--tg-theme-hint-color"],
  ["link_color", "--tg-theme-link-color"],
  ["button_color", "--tg-theme-button-color"],
  ["button_text_color", "--tg-theme-button-text-color"],
  ["secondary_bg_color", "--tg-theme-secondary-bg-color"],
] as const;

function applyTheme() {
  const webApp = window.Telegram?.WebApp;
  if (!webApp) return;
  const root = document.documentElement;
  root.dataset.theme = webApp.colorScheme;
  root.style.colorScheme = webApp.colorScheme;
  for (const [key, cssVar] of THEME_KEYS) {
    const value = webApp.themeParams[key];
    if (value) root.style.setProperty(cssVar, value);
  }
}

export function bootTelegram(): TelegramProfile | null {
  const webApp = window.Telegram?.WebApp;
  if (!webApp) return null;
  webApp.ready();
  webApp.expand();
  applyTheme();
  webApp.onEvent("themeChanged", applyTheme);
  const user = webApp.initDataUnsafe.user;
  if (!user) {
    return webApp.initDataUnsafe.start_param
      ? {
          id: 0,
          firstName: "Guest",
          startParam: webApp.initDataUnsafe.start_param,
        }
      : null;
  }
  return {
    id: user.id,
    firstName: user.first_name,
    lastName: user.last_name,
    username: user.username,
    photoUrl: user.photo_url,
    startParam: webApp.initDataUnsafe.start_param,
  };
}

export async function bootTelegramSdk(): Promise<void> {
  if (!window.Telegram?.WebApp) return;
  try {
    const sdk = await import("@telegram-apps/sdk");
    sdk.init();
    if (sdk.miniApp.mount.isAvailable()) sdk.miniApp.mount();
    if (sdk.themeParams.mount.isAvailable()) sdk.themeParams.mount();
    if (sdk.viewport.mount.isAvailable()) await sdk.viewport.mount();
    if (sdk.miniApp.ready.isAvailable()) sdk.miniApp.ready();
    applyTheme();
  } catch {
    // Opened in a normal browser. The WebApp script path above still applies inside Telegram.
  }
}

export function haptic() {
  window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("light");
}
