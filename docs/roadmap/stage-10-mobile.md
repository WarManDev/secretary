# Stage 10: Мобильное приложение и PWA

> **Срок:** 2-4 недели
> **Зависимости:** Stage 3 (универсальный API) + Stage 2 (безопасность)
> **Цель:** Создать мобильный клиент (React Native + Expo) и PWA, подключающиеся к существующему backend REST API.
>
> Этот этап **опциональный** и может выполняться параллельно с другими этапами
> после готовности API. Мобильное приложение -- это **тонкий клиент**. Вся
> бизнес-логика на бэкенде. Приложение только вызывает REST API / WebSocket.
> Никакого AI, Google API, MCP -- всё через бэкенд.
>
> **Зачем:** Plan B на случай блокировки Telegram в России + премиум-продукт
> для Business/Enterprise клиентов, которым нужен брендированный опыт.

---

## Оглавление

1. [Стратегия: PWA vs Native](#1-стратегия-pwa-vs-native)
2. [PWA -- быстрая реализация (2-3 недели)](#2-pwa--быстрая-реализация-2-3-недели)
3. [React Native + Expo (2-4 недели)](#3-react-native--expo-2-4-недели)
4. [Экраны приложения](#4-экраны-приложения)
5. [Голосовые сообщения в приложении](#5-голосовые-сообщения-в-приложении)
6. [Push-уведомления](#6-push-уведомления)
7. [Офлайн-режим](#7-офлайн-режим)
8. [Публикация в магазинах](#8-публикация-в-магазинах)
9. [Telegram Mini App (альтернатива)](#9-telegram-mini-app-альтернатива)
10. [API client -- общий слой](#10-api-client--общий-слой)
11. [State management -- Zustand](#11-state-management--zustand)
12. [Безопасность мобильного приложения](#12-безопасность-мобильного-приложения)
13. [Защита от блокировки Telegram](#13-защита-от-блокировки-telegram)
14. [Чеклист готовности](#14-чеклист-готовности)

---

## 1. Стратегия: PWA vs Native

### Контекст

Бэкенд к этому этапу полностью platform-agnostic: REST API под `/api/v1/` с JWT-авторизацией, WebSocket для real-time. Добавление нового клиента -- вопрос создания фронтенда, который вызывает готовые endpoints.

Два подхода:

1. **PWA (Progressive Web App)** -- веб-приложение с оффлайн-поддержкой и возможностью "установки" на домашний экран.
2. **React Native + Expo** -- кроссплатформенное нативное приложение (iOS + Android).

### Рекомендация

**Сначала PWA (быстрый win за 2-3 недели), затем React Native (полноценный продукт за 2-4 недели).**

PWA покрывает 80% потребностей и даёт мгновенный результат. React Native добавляет push-уведомления, оффлайн, нативный UX и присутствие в магазинах.

### Сравнительная таблица

| Критерий | PWA | React Native + Expo |
|---|---|---|
| **Время разработки** | 2-3 недели | 2-4 недели |
| **Стоимость** | $0 (хостинг бесплатный) | $99/год (Apple) + $25 (Google) |
| **Распространение** | По ссылке, без магазинов | App Store, Google Play, RuStore |
| **Push-уведомления** | Ограничены (iOS -- с iOS 16.4+) | Полная поддержка |
| **Оффлайн** | Service Worker (базовый) | SQLite/AsyncStorage (полный) |
| **Доступ к камере** | Через браузер (ограничен) | Полный нативный |
| **Запись голоса** | MediaRecorder API (ограничен) | expo-av (полный контроль) |
| **Биометрия** | Нет | Face ID / Touch ID / отпечаток |
| **Производительность** | Зависит от браузера | Нативная |
| **UX** | Хороший, но "веб-ощущение" | Нативный, плавные анимации |
| **Обновления** | Мгновенные (перезагрузка) | Через магазины (1-14 дней ревью) |
| **SEO / индексация** | Да | Нет |
| **Размер установки** | 0 (в браузере) | 30-80 MB |

### Когда что использовать

| Сценарий | Решение |
|---|---|
| Быстрый запуск, минимум усилий | PWA |
| Telegram заблокировали, нужно срочно | PWA |
| Premium для Business/Enterprise | React Native |
| Push-напоминания о встречах | React Native |
| Голосовой ввод с высоким качеством | React Native |
| Присутствие в магазинах (доверие) | React Native |
| Минимальный бюджет | PWA |

---

## 2. PWA -- быстрая реализация (2-3 недели)

### Стек технологий

| Технология | Назначение |
|---|---|
| **React 18** | UI-фреймворк |
| **Vite** | Сборка, dev-сервер, HMR |
| **vite-plugin-pwa** | Service Worker, manifest.json, автообновление |
| **React Router v6** | Маршрутизация |
| **Zustand** | State management |
| **Axios** | HTTP-клиент с JWT-интерцептором |
| **Tailwind CSS** | Утилитарные стили, mobile-first |

### Структура проекта

```
secretary-pwa/
├── public/
│   ├── icons/
│   │   ├── icon-192x192.png
│   │   ├── icon-512x512.png
│   │   └── apple-touch-icon.png
│   └── favicon.ico
│
├── src/
│   ├── components/
│   │   ├── chat/
│   │   │   ├── ChatBubble.tsx          # Сообщение (user/bot)
│   │   │   ├── ChatInput.tsx           # Поле ввода + кнопка голоса + фото
│   │   │   ├── ChatList.tsx            # Список сообщений с авто-скроллом
│   │   │   └── VoiceRecorder.tsx       # Запись голоса (MediaRecorder API)
│   │   ├── calendar/
│   │   │   ├── MonthView.tsx           # Сетка месяца
│   │   │   ├── DayView.tsx             # События за день
│   │   │   └── EventCard.tsx           # Карточка события
│   │   ├── tasks/
│   │   │   ├── TaskList.tsx            # Список задач с фильтрами
│   │   │   ├── TaskCard.tsx            # Карточка задачи (приоритет, статус)
│   │   │   └── TaskForm.tsx            # Создание/редактирование
│   │   ├── notes/
│   │   │   ├── NoteList.tsx            # Список заметок
│   │   │   └── NoteEditor.tsx          # Создание/редактирование
│   │   ├── layout/
│   │   │   ├── AppShell.tsx            # Основной layout (header + content + nav)
│   │   │   ├── BottomNav.tsx           # Нижняя навигация (5 табов)
│   │   │   └── Header.tsx              # Верхняя панель
│   │   └── ui/
│   │       ├── Button.tsx
│   │       ├── Input.tsx
│   │       ├── Modal.tsx
│   │       ├── Spinner.tsx
│   │       └── Badge.tsx
│   │
│   ├── pages/
│   │   ├── LoginPage.tsx               # Вход / регистрация
│   │   ├── ChatPage.tsx                # Главный экран -- чат
│   │   ├── CalendarPage.tsx            # Календарь
│   │   ├── TasksPage.tsx               # Задачи
│   │   ├── NotesPage.tsx               # Заметки
│   │   ├── SettingsPage.tsx            # Настройки
│   │   └── ProfilePage.tsx             # Профиль + подписка
│   │
│   ├── services/
│   │   ├── api.ts                      # Базовый axios-клиент с JWT
│   │   ├── auth.ts                     # Login, register, refresh
│   │   ├── chat.ts                     # POST /chat, GET /sessions
│   │   ├── events.ts                   # Events CRUD
│   │   ├── tasks.ts                    # Tasks CRUD
│   │   ├── notes.ts                    # Notes CRUD
│   │   └── websocket.ts               # WebSocket подключение
│   │
│   ├── stores/
│   │   ├── authStore.ts                # Zustand: user, tokens
│   │   ├── chatStore.ts                # Zustand: sessions, messages
│   │   └── uiStore.ts                  # Zustand: theme, sidebar
│   │
│   ├── hooks/
│   │   ├── useAuth.ts                  # Хук авторизации
│   │   ├── useWebSocket.ts             # Хук WebSocket
│   │   └── useVoiceRecorder.ts         # Хук записи голоса
│   │
│   ├── utils/
│   │   ├── date.ts                     # Форматирование дат
│   │   └── formatters.ts              # Форматирование данных
│   │
│   ├── App.tsx                         # Корневой компонент + Router
│   ├── main.tsx                        # Точка входа
│   └── index.css                       # Tailwind imports
│
├── index.html
├── vite.config.ts                      # Vite + PWA plugin
├── tailwind.config.js
├── tsconfig.json
├── package.json
└── .env.example
```

### Инициализация проекта

```bash
# Создать проект
npm create vite@latest secretary-pwa -- --template react-ts
cd secretary-pwa

# Зависимости
npm install react-router-dom zustand axios
npm install -D tailwindcss postcss autoprefixer vite-plugin-pwa
npx tailwindcss init -p
```

### Конфигурация PWA: `vite.config.ts`

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'icons/*.png'],
      manifest: {
        name: 'Secretary Bot -- AI Секретарь',
        short_name: 'Secretary',
        description: 'AI-секретарь: календарь, задачи, заметки, голосовой ввод',
        theme_color: '#1a73e8',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/icons/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icons/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\.secretary\.app\/api\/v1\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60, // 1 час
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
    }),
  ],
});
```

### API-клиент с JWT: `src/services/api.ts`

```ts
import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor -- добавляем JWT
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = localStorage.getItem('access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor -- обновляем токен при 401
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config;
    if (!originalRequest) return Promise.reject(error);

    // Если 401 и есть refresh token -- пробуем обновить
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      const refreshToken = localStorage.getItem('refresh_token');
      if (!refreshToken) {
        // Нет refresh token -- разлогиниваем
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        window.location.href = '/login';
        return Promise.reject(error);
      }

      try {
        const { data } = await axios.post(`${API_BASE_URL}/auth/refresh`, {
          refresh_token: refreshToken,
        });

        localStorage.setItem('access_token', data.data.access_token);
        localStorage.setItem('refresh_token', data.data.refresh_token);

        originalRequest.headers.Authorization = `Bearer ${data.data.access_token}`;
        return api(originalRequest);
      } catch (refreshError) {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        window.location.href = '/login';
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export default api;
```

### Ключевой компонент: `src/pages/ChatPage.tsx`

```tsx
import { useState, useEffect, useRef } from 'react';
import { useChatStore } from '../stores/chatStore';
import { useWebSocket } from '../hooks/useWebSocket';
import ChatList from '../components/chat/ChatList';
import ChatInput from '../components/chat/ChatInput';

export default function ChatPage() {
  const { currentSession, messages, sendMessage, loadSessions, isLoading } = useChatStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const ws = useWebSocket();

  useEffect(() => {
    loadSessions();
  }, []);

  // Авто-скролл при новом сообщении
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Слушаем WebSocket для real-time ответов
  useEffect(() => {
    if (!ws) return;
    ws.on('bot_response', (data: { message: string; session_id: number }) => {
      useChatStore.getState().addBotMessage(data.message, data.session_id);
    });
    return () => { ws.off('bot_response'); };
  }, [ws]);

  const handleSend = async (text: string) => {
    await sendMessage(text);
  };

  const handleVoiceSend = async (audioBlob: Blob) => {
    const formData = new FormData();
    formData.append('audio', audioBlob, 'voice.webm');
    if (currentSession) {
      formData.append('session_id', currentSession.id.toString());
    }
    await sendMessage(formData);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Список сообщений */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <ChatList messages={messages} isLoading={isLoading} />
        <div ref={messagesEndRef} />
      </div>

      {/* Поле ввода */}
      <div className="border-t bg-white p-3">
        <ChatInput
          onSendText={handleSend}
          onSendVoice={handleVoiceSend}
          disabled={isLoading}
        />
      </div>
    </div>
  );
}
```

### WebSocket хук: `src/hooks/useWebSocket.ts`

```ts
import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

const WS_URL = import.meta.env.VITE_WS_URL || 'http://localhost:3000';

export function useWebSocket() {
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) return;

    const socket = io(WS_URL, {
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10,
    });

    socket.on('connect', () => {
      console.log('WebSocket connected');
    });

    socket.on('disconnect', (reason) => {
      console.log('WebSocket disconnected:', reason);
    });

    socket.on('connect_error', (error) => {
      console.error('WebSocket error:', error.message);
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  return socketRef.current;
}
```

### Responsive design (mobile-first)

Tailwind CSS настроен по умолчанию на mobile-first:

```css
/* src/index.css */
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  html, body, #root {
    @apply h-full bg-gray-50;
  }
}

@layer components {
  .bottom-nav {
    @apply fixed bottom-0 left-0 right-0 bg-white border-t flex justify-around py-2;
    padding-bottom: env(safe-area-inset-bottom);
  }

  .chat-bubble-user {
    @apply bg-blue-500 text-white rounded-2xl rounded-br-sm px-4 py-2 max-w-[80%] ml-auto;
  }

  .chat-bubble-bot {
    @apply bg-gray-200 text-gray-900 rounded-2xl rounded-bl-sm px-4 py-2 max-w-[80%];
  }
}
```

### Деплой PWA

```bash
# Сборка
npm run build

# Деплой на Vercel (бесплатно)
npx vercel --prod

# Или на Netlify
npx netlify deploy --prod --dir=dist
```

### Проверка PWA

- `npm run build && npm run preview` -- проверить в браузере
- Chrome DevTools -> Application -> Manifest -- проверить manifest.json
- Chrome DevTools -> Application -> Service Workers -- проверить SW
- Lighthouse -> PWA audit -- должен быть зелёный
- На телефоне: "Добавить на главный экран" -- иконка появляется

---

## 3. React Native + Expo (2-4 недели)

### Инициализация проекта

```bash
# Создать проект
npx create-expo-app@latest secretary-mobile --template blank-typescript
cd secretary-mobile

# Ключевые зависимости
npx expo install expo-router react-native-safe-area-context react-native-screens
npx expo install expo-secure-store expo-notifications expo-av expo-image-picker
npx expo install expo-splash-screen expo-status-bar expo-constants
npm install react-native-paper zustand axios
npm install @react-native-async-storage/async-storage
npm install react-native-reanimated react-native-gesture-handler
```

### Структура проекта

```
secretary-mobile/
├── app/                                # Expo Router (file-based routing)
│   ├── _layout.tsx                     # Root layout (providers, theme)
│   │
│   ├── (auth)/                         # Auth group (без табов)
│   │   ├── _layout.tsx                 # Auth layout (без нижней навигации)
│   │   ├── login.tsx                   # Экран входа
│   │   └── register.tsx                # Экран регистрации
│   │
│   ├── (tabs)/                         # Main group (с табами)
│   │   ├── _layout.tsx                 # Tab layout (нижняя навигация)
│   │   ├── index.tsx                   # Чат (главный экран)
│   │   ├── calendar.tsx                # Календарь
│   │   ├── tasks.tsx                   # Задачи
│   │   ├── notes.tsx                   # Заметки
│   │   └── settings.tsx                # Настройки
│   │
│   ├── chat/
│   │   └── [sessionId].tsx             # Конкретная сессия чата
│   │
│   ├── event/
│   │   ├── [id].tsx                    # Просмотр события
│   │   └── create.tsx                  # Создание события
│   │
│   ├── task/
│   │   └── [id].tsx                    # Просмотр/редактирование задачи
│   │
│   ├── note/
│   │   └── [id].tsx                    # Просмотр/редактирование заметки
│   │
│   ├── contacts/
│   │   ├── index.tsx                   # Список контактов (CRM)
│   │   └── [id].tsx                    # Детали контакта
│   │
│   └── profile.tsx                     # Профиль + подписка
│
├── components/
│   ├── chat/
│   │   ├── ChatBubble.tsx              # Сообщение (user/bot)
│   │   ├── ChatInput.tsx               # Поле ввода + голос + фото
│   │   ├── MessageList.tsx             # FlatList сообщений
│   │   └── VoiceButton.tsx             # Кнопка записи голоса
│   ├── calendar/
│   │   ├── MonthView.tsx               # Календарная сетка
│   │   ├── DaySchedule.tsx             # Расписание на день
│   │   └── EventCard.tsx               # Карточка события
│   ├── tasks/
│   │   ├── TaskCard.tsx                # Карточка задачи
│   │   ├── TaskFilters.tsx             # Фильтры (статус, приоритет)
│   │   └── PriorityBadge.tsx           # Бейдж приоритета
│   ├── notes/
│   │   ├── NoteCard.tsx                # Карточка заметки
│   │   └── CategoryChip.tsx            # Чип категории
│   └── ui/
│       ├── AppHeader.tsx               # Верхняя панель
│       ├── EmptyState.tsx              # Пустое состояние
│       ├── LoadingScreen.tsx           # Экран загрузки
│       └── ErrorBoundary.tsx           # Обработка ошибок
│
├── services/
│   ├── api.ts                          # Axios + JWT interceptor
│   ├── auth.ts                         # Login, register, refresh, logout
│   ├── chat.ts                         # Chat API
│   ├── events.ts                       # Events CRUD
│   ├── tasks.ts                        # Tasks CRUD
│   ├── notes.ts                        # Notes CRUD
│   ├── contacts.ts                     # Contacts CRUD
│   └── websocket.ts                    # Socket.IO клиент
│
├── stores/
│   ├── authStore.ts                    # User, tokens, login/logout
│   ├── chatStore.ts                    # Sessions, messages
│   ├── eventsStore.ts                  # Events
│   ├── tasksStore.ts                   # Tasks
│   └── notesStore.ts                   # Notes
│
├── utils/
│   ├── date.ts                         # Форматирование дат
│   ├── storage.ts                      # Secure storage wrapper
│   └── constants.ts                    # Цвета, размеры, URLs
│
├── hooks/
│   ├── useAuth.ts                      # Хук авторизации
│   ├── useWebSocket.ts                 # Хук WebSocket
│   ├── useVoiceRecorder.ts             # Хук записи голоса (expo-av)
│   └── usePushNotifications.ts         # Хук push-уведомлений
│
├── assets/
│   ├── splash.png                      # Сплэш-скрин
│   ├── icon.png                        # Иконка приложения (1024x1024)
│   ├── adaptive-icon.png               # Android adaptive icon
│   └── favicon.png                     # Favicon для web
│
├── app.json                            # Expo конфигурация
├── eas.json                            # EAS Build конфигурация
├── tsconfig.json
├── package.json
├── babel.config.js
└── .env.example
```

### Конфигурация: `app.json`

```json
{
  "expo": {
    "name": "Secretary",
    "slug": "secretary",
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/icon.png",
    "scheme": "secretary",
    "userInterfaceStyle": "automatic",
    "splash": {
      "image": "./assets/splash.png",
      "resizeMode": "contain",
      "backgroundColor": "#1a73e8"
    },
    "assetBundlePatterns": ["**/*"],
    "ios": {
      "supportsTablet": true,
      "bundleIdentifier": "com.secretary.app",
      "infoPlist": {
        "NSMicrophoneUsageDescription": "Для записи голосовых сообщений",
        "NSCameraUsageDescription": "Для отправки фотографий",
        "NSPhotoLibraryUsageDescription": "Для выбора фотографий"
      }
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon.png",
        "backgroundColor": "#1a73e8"
      },
      "package": "com.secretary.app",
      "permissions": [
        "RECORD_AUDIO",
        "CAMERA",
        "READ_EXTERNAL_STORAGE",
        "VIBRATE",
        "RECEIVE_BOOT_COMPLETED"
      ]
    },
    "plugins": [
      "expo-router",
      "expo-secure-store",
      [
        "expo-notifications",
        {
          "icon": "./assets/notification-icon.png",
          "color": "#1a73e8"
        }
      ],
      [
        "expo-av",
        {
          "microphonePermission": "Разрешите доступ к микрофону для записи голосовых сообщений."
        }
      ]
    ]
  }
}
```

### Root layout: `app/_layout.tsx`

```tsx
import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { PaperProvider, MD3LightTheme } from 'react-native-paper';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useAuthStore } from '../stores/authStore';

SplashScreen.preventAutoHideAsync();

const theme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: '#1a73e8',
    secondary: '#34a853',
    error: '#ea4335',
  },
};

export default function RootLayout() {
  const { isAuthenticated, loadStoredAuth } = useAuthStore();

  useEffect(() => {
    async function prepare() {
      await loadStoredAuth();
      await SplashScreen.hideAsync();
    }
    prepare();
  }, []);

  return (
    <PaperProvider theme={theme}>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }}>
        {isAuthenticated ? (
          <Stack.Screen name="(tabs)" />
        ) : (
          <Stack.Screen name="(auth)" />
        )}
      </Stack>
    </PaperProvider>
  );
}
```

### Tab layout: `app/(tabs)/_layout.tsx`

```tsx
import { Tabs } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#1a73e8',
        tabBarInactiveTintColor: '#999',
        tabBarLabelStyle: { fontSize: 11 },
        headerShown: true,
        headerStyle: { backgroundColor: '#1a73e8' },
        headerTintColor: '#fff',
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Чат',
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="chat" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: 'Календарь',
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="calendar" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          title: 'Задачи',
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="checkbox-marked-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="notes"
        options={{
          title: 'Заметки',
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="note-text" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Ещё',
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="dots-horizontal" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
```

---

## 4. Экраны приложения

### 4.1. Login / Register

**Описание:** Два режима -- вход и регистрация. Переключение табами.

**Layout:**
```
┌─────────────────────────┐
│                         │
│     [Secretary Logo]    │
│     AI-секретарь        │
│                         │
│  ┌─────────┬──────────┐ │
│  │  Вход   │ Регистр. │ │ <-- табы
│  └─────────┴──────────┘ │
│                         │
│  ┌─────────────────────┐│
│  │ Username            ││
│  └─────────────────────┘│
│  ┌─────────────────────┐│
│  │ Password            ││
│  └─────────────────────┘│
│                         │
│  [      Войти         ] │ <-- основная кнопка
│                         │
│  ─── или ───            │
│                         │
│  [  Войти через Telegram ] │ <-- Telegram Login Widget
│                         │
└─────────────────────────┘
```

**Реализация: `app/(auth)/login.tsx`**

```tsx
import { useState } from 'react';
import { View, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { TextInput, Button, Text, SegmentedButtons } from 'react-native-paper';
import { router } from 'expo-router';
import { useAuthStore } from '../../stores/authStore';

export default function LoginScreen() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { login, register } = useAuthStore();

  const handleSubmit = async () => {
    setLoading(true);
    setError('');
    try {
      if (mode === 'login') {
        await login(username, password);
      } else {
        await register(username, password, email);
      }
      router.replace('/(tabs)');
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Произошла ошибка');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inner}>
        <Text variant="headlineMedium" style={styles.title}>
          Secretary
        </Text>
        <Text variant="bodyMedium" style={styles.subtitle}>
          AI-секретарь
        </Text>

        <SegmentedButtons
          value={mode}
          onValueChange={(v) => setMode(v as 'login' | 'register')}
          buttons={[
            { value: 'login', label: 'Вход' },
            { value: 'register', label: 'Регистрация' },
          ]}
          style={styles.tabs}
        />

        <TextInput
          label="Имя пользователя"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          style={styles.input}
        />

        {mode === 'register' && (
          <TextInput
            label="Email (опционально)"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            style={styles.input}
          />
        )}

        <TextInput
          label="Пароль"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          style={styles.input}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button
          mode="contained"
          onPress={handleSubmit}
          loading={loading}
          disabled={loading || !username || !password}
          style={styles.button}
        >
          {mode === 'login' ? 'Войти' : 'Зарегистрироваться'}
        </Button>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  inner: { flex: 1, justifyContent: 'center', padding: 24 },
  title: { textAlign: 'center', fontWeight: 'bold', color: '#1a73e8' },
  subtitle: { textAlign: 'center', color: '#666', marginBottom: 32 },
  tabs: { marginBottom: 24 },
  input: { marginBottom: 12, backgroundColor: '#fff' },
  button: { marginTop: 16, paddingVertical: 4 },
  error: { color: '#ea4335', textAlign: 'center', marginTop: 8 },
});
```

### 4.2. Chat (главный экран)

**Описание:** Основной экран. Список сообщений сверху, поле ввода снизу. Кнопки: отправить текст, записать голос, прикрепить фото.

**Layout:**
```
┌─────────────────────────┐
│  Secretary        [...]  │ <-- header (меню сессий)
├─────────────────────────┤
│                         │
│  ┌───────────────────┐  │
│  │ Бот: Доброе утро! │  │ <-- сообщение бота (слева)
│  │ Сегодня 3 встречи │  │
│  └───────────────────┘  │
│                         │
│  ┌───────────────────┐  │
│  │ Создай встречу    │  │ <-- сообщение пользователя (справа)
│  │ с Иваном в 15:00  │  │
│  └───────────────────┘  │
│                         │
│  ┌───────────────────┐  │
│  │ Бот: Создал       │  │
│  │ встречу "Встреча  │  │
│  │ с Иваном" на      │  │
│  │ 15:00-16:00       │  │
│  └───────────────────┘  │
│                         │
├─────────────────────────┤
│ [+] [  Сообщение...  ] │ <-- ввод
│ [mic]           [send]  │ <-- кнопки: фото, голос, отправить
└─────────────────────────┘
```

### 4.3. Calendar

**Описание:** Два режима: месяц (сетка) и день (расписание). Переключение свайпом или кнопкой.

**Layout:**
```
┌─────────────────────────┐
│  Календарь   [Месяц|День]│
├─────────────────────────┤
│  < Февраль 2026 >       │
│  Пн Вт Ср Чт Пт Сб Вс  │
│   .  .  .  .  .  .  1   │
│   2  3  4  5  6  7  8   │
│   9 10 11 [12] 13 14 15 │ <-- 12 выделен (сегодня)
│  16 17 18 19 20 21 22   │
│  23 24 25 26 27 28       │
├─────────────────────────┤
│  12 февраля (сегодня)    │
│                         │
│  09:00 Встреча с командой│
│  12:00 Обед с клиентом   │
│  15:00 Встреча с Иваном  │
│                         │
│         [+ Событие]      │
└─────────────────────────┘
```

### 4.4. Tasks

**Описание:** Список задач с фильтрами по статусу и приоритету. Свайп для быстрой смены статуса.

**Layout:**
```
┌─────────────────────────┐
│  Задачи            [+]  │
├─────────────────────────┤
│ [Все|Активные|Выполнены] │ <-- фильтр по статусу
├─────────────────────────┤
│                         │
│  [!] Подготовить отчёт  │ <-- urgent (красная метка)
│      До: 13 фев         │
│                         │
│  [^] Написать ТЗ        │ <-- high (оранжевая метка)
│      До: 15 фев         │
│                         │
│  [-] Заказать канцтовары│ <-- medium (жёлтая метка)
│      Без дедлайна        │
│                         │
│  [v] Обновить пароли     │ <-- done (зелёная галочка)
│      Выполнено 11 фев   │
│                         │
└─────────────────────────┘
```

### 4.5. Notes

**Описание:** Список заметок с категориями. Поиск по тексту.

**Layout:**
```
┌─────────────────────────┐
│  Заметки           [+]  │
├─────────────────────────┤
│  [Поиск...]              │
│  [Все] [Встречи] [Идеи] │ <-- категории
├─────────────────────────┤
│                         │
│  Протокол встречи 12/02  │
│  Обсудили Q1 бюджет...   │
│  #meeting  10:30         │
│                         │
│  Идея: PWA dashboard     │
│  Сделать дашборд для...  │
│  #idea  вчера            │
│                         │
│  Список покупок          │
│  [x] Молоко              │
│  [ ] Хлеб                │
│  #personal  09 фев       │
│                         │
└─────────────────────────┘
```

### 4.6. Contacts (CRM)

**Описание:** Список контактов с поиском. При нажатии -- карточка с историей взаимодействий.

**Layout:**
```
┌─────────────────────────┐
│  Контакты          [+]  │
├─────────────────────────┤
│  [Поиск...]              │
├─────────────────────────┤
│                         │
│  [AV] Алексей Волков     │
│       CEO, TechCorp      │
│       Последн: 10 фев    │
│                         │
│  [МП] Мария Петрова      │
│       CTO, StartupInc    │
│       Последн: 08 фев    │
│                         │
│  [ИК] Иван Козлов        │
│       PM, DesignStudio    │
│       Follow-up: 14 фев  │ <-- подсвечен (предстоящий follow-up)
│                         │
└─────────────────────────┘
```

### 4.7. Settings

**Описание:** Настройки приложения, ссылки на профиль и подписку.

**Layout:**
```
┌─────────────────────────┐
│  Настройки               │
├─────────────────────────┤
│                         │
│  [Профиль и подписка >]  │
│                         │
│  --- Общие ---           │
│  Часовой пояс  [Asia/Dubai >] │
│  Язык          [Русский >]    │
│                         │
│  --- Голос ---           │
│  Голосовые ответы  [ON]  │
│  Голос ответа [Женский>] │
│                         │
│  --- Интеграции ---      │
│  Google Calendar  [Подкл.]│
│  Gmail            [---]  │
│  Notion           [---]  │
│                         │
│  --- О приложении ---    │
│  Версия       1.0.0      │
│  [Выйти из аккаунта]    │
│                         │
└─────────────────────────┘
```

### 4.8. Profile

**Описание:** Информация о подписке, статистика использования, кнопка апгрейда.

**Layout:**
```
┌─────────────────────────┐
│  Профиль                 │
├─────────────────────────┤
│                         │
│  [Avatar] username       │
│  email@example.com       │
│                         │
│  ┌─────────────────────┐│
│  │ Тариф: Free         ││
│  │ Сообщений: 23/50    ││
│  │ Обновится: завтра    ││
│  │                     ││
│  │ [ Улучшить тариф ]  ││
│  └─────────────────────┘│
│                         │
│  --- Статистика ---      │
│  Сообщений сегодня: 23   │
│  За месяц: 412           │
│  Событий создано: 18     │
│  Задач завершено: 34     │
│                         │
└─────────────────────────┘
```

---

## 5. Голосовые сообщения в приложении

### Схема работы

```
Пользователь                Mobile App              Backend
    │                          │                       │
    │ [Нажимает mic]           │                       │
    ├─────────────────────────>│                       │
    │                          │ expo-av: startRecording│
    │                          │ (формат: m4a/wav)     │
    │                          │                       │
    │ [Отпускает mic]          │                       │
    ├─────────────────────────>│                       │
    │                          │ expo-av: stopRecording │
    │                          │                       │
    │                          │ POST /api/v1/chat     │
    │                          │ Content-Type:          │
    │                          │  multipart/form-data   │
    │                          │ Body: audio file       │
    │                          ├──────────────────────>│
    │                          │                       │ Yandex STT
    │                          │                       │ -> текст
    │                          │                       │ Claude API
    │                          │                       │ -> ответ
    │                          │                       │
    │                          │ { reply, audio_url? }  │
    │                          │<──────────────────────┤
    │                          │                       │
    │  Показать ответ текстом  │                       │
    │  + Воспроизвести аудио   │                       │
    │<─────────────────────────┤                       │
```

### Реализация: `hooks/useVoiceRecorder.ts`

```ts
import { useState, useRef } from 'react';
import { Audio } from 'expo-av';
import { Platform } from 'react-native';

interface UseVoiceRecorderResult {
  isRecording: boolean;
  duration: number;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<string | null>; // возвращает URI файла
  cancelRecording: () => Promise<void>;
}

export function useVoiceRecorder(): UseVoiceRecorderResult {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startRecording = async () => {
    try {
      // Запросить разрешение
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        throw new Error('Нет доступа к микрофону');
      }

      // Настроить аудио-режим
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      // Создать и начать запись
      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync({
        android: {
          extension: '.m4a',
          outputFormat: Audio.AndroidOutputFormat.MPEG_4,
          audioEncoder: Audio.AndroidAudioEncoder.AAC,
          sampleRate: 16000,
          numberOfChannels: 1,
          bitRate: 128000,
        },
        ios: {
          extension: '.m4a',
          outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
          audioQuality: Audio.IOSAudioQuality.HIGH,
          sampleRate: 16000,
          numberOfChannels: 1,
          bitRate: 128000,
        },
        web: {
          mimeType: 'audio/webm',
          bitsPerSecond: 128000,
        },
      });

      await recording.startAsync();
      recordingRef.current = recording;
      setIsRecording(true);
      setDuration(0);

      // Таймер длительности
      intervalRef.current = setInterval(() => {
        setDuration((d) => d + 1);
      }, 1000);
    } catch (error) {
      console.error('Ошибка начала записи:', error);
      throw error;
    }
  };

  const stopRecording = async (): Promise<string | null> => {
    if (!recordingRef.current) return null;

    try {
      if (intervalRef.current) clearInterval(intervalRef.current);
      setIsRecording(false);

      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;

      // Вернуть iOS в нормальный режим
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
      });

      return uri;
    } catch (error) {
      console.error('Ошибка остановки записи:', error);
      return null;
    }
  };

  const cancelRecording = async () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (recordingRef.current) {
      try {
        await recordingRef.current.stopAndUnloadAsync();
      } catch (e) {
        // Игнорируем -- запись могла быть уже остановлена
      }
      recordingRef.current = null;
    }
    setIsRecording(false);
    setDuration(0);
  };

  return { isRecording, duration, startRecording, stopRecording, cancelRecording };
}
```

### Отправка голоса: `services/chat.ts` (фрагмент)

```ts
import api from './api';
import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';

export async function sendVoiceMessage(
  audioUri: string,
  sessionId?: number
): Promise<{ reply: string; audio_url?: string }> {
  const formData = new FormData();

  if (Platform.OS === 'web') {
    const response = await fetch(audioUri);
    const blob = await response.blob();
    formData.append('audio', blob, 'voice.webm');
  } else {
    const fileInfo = await FileSystem.getInfoAsync(audioUri);
    if (!fileInfo.exists) throw new Error('Аудиофайл не найден');

    formData.append('audio', {
      uri: audioUri,
      type: 'audio/m4a',
      name: 'voice.m4a',
    } as any);
  }

  if (sessionId) {
    formData.append('session_id', sessionId.toString());
  }

  const { data } = await api.post('/chat', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000, // 60 секунд для голосовых (STT + Claude + TTS)
  });

  return data.data;
}
```

### Воспроизведение голосового ответа

```ts
import { Audio } from 'expo-av';

export async function playAudioResponse(audioUrl: string): Promise<void> {
  const { sound } = await Audio.Sound.createAsync(
    { uri: audioUrl },
    { shouldPlay: true }
  );

  // Автоматически освобождаем ресурсы после воспроизведения
  sound.setOnPlaybackStatusUpdate((status) => {
    if (status.isLoaded && status.didJustFinish) {
      sound.unloadAsync();
    }
  });
}
```

---

## 6. Push-уведомления

### Архитектура

```
Backend                         Expo Push Service            Mobile App
   │                                  │                          │
   │ Напоминание о встрече            │                          │
   │ через 15 минут                   │                          │
   │                                  │                          │
   │ POST https://exp.host/           │                          │
   │   --send/push/send               │                          │
   │ { to: "ExponentPushToken[xxx]",  │                          │
   │   title: "Напоминание",          │                          │
   │   body: "Встреча через 15 мин" } │                          │
   ├─────────────────────────────────>│                          │
   │                                  │ APNs (iOS)              │
   │                                  │ FCM (Android)           │
   │                                  ├─────────────────────────>│
   │                                  │                          │
   │                                  │                          │ [Push!]
   │                                  │                          │ "Встреча
   │                                  │                          │  через
   │                                  │                          │  15 мин"
```

### Мобильная часть: `hooks/usePushNotifications.ts`

```ts
import { useState, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import api from '../services/api';

// Как показывать уведомления, когда приложение открыто
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export function usePushNotifications() {
  const [expoPushToken, setExpoPushToken] = useState<string>('');
  const notificationListener = useRef<Notifications.Subscription>();
  const responseListener = useRef<Notifications.Subscription>();

  useEffect(() => {
    registerForPushNotifications().then((token) => {
      if (token) {
        setExpoPushToken(token);
        // Отправить токен на бэкенд
        savePushTokenToBackend(token);
      }
    });

    // Слушатель входящих уведомлений (приложение открыто)
    notificationListener.current = Notifications.addNotificationReceivedListener(
      (notification) => {
        console.log('Notification received:', notification);
      }
    );

    // Слушатель нажатий на уведомление
    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data;
        // Навигация в зависимости от типа уведомления
        handleNotificationNavigation(data);
      }
    );

    return () => {
      if (notificationListener.current) {
        Notifications.removeNotificationSubscription(notificationListener.current);
      }
      if (responseListener.current) {
        Notifications.removeNotificationSubscription(responseListener.current);
      }
    };
  }, []);

  return { expoPushToken };
}

async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) {
    console.log('Push-уведомления работают только на реальном устройстве');
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('Разрешение на уведомления не получено');
    return null;
  }

  // Android: создать канал уведомлений
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Secretary',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#1a73e8',
    });
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  return token.data;
}

async function savePushTokenToBackend(token: string) {
  try {
    await api.put('/users/me', { push_token: token });
  } catch (error) {
    console.error('Ошибка сохранения push-токена:', error);
  }
}

function handleNotificationNavigation(data: any) {
  // Навигация в зависимости от типа
  if (data.type === 'event_reminder') {
    // router.push(`/event/${data.event_id}`);
  } else if (data.type === 'task_deadline') {
    // router.push(`/task/${data.task_id}`);
  } else if (data.type === 'follow_up') {
    // router.push(`/contacts/${data.contact_id}`);
  }
}
```

### Backend: `src/services/core/pushService.js`

```js
import fetch from 'node-fetch';
import logger from '../../config/logger.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/**
 * Отправить push-уведомление пользователю.
 *
 * @param {string} pushToken - Expo Push Token (ExponentPushToken[xxx])
 * @param {object} notification - { title, body, data }
 */
export async function sendPushNotification(pushToken, notification) {
  if (!pushToken || !pushToken.startsWith('ExponentPushToken')) {
    logger.warn('Невалидный push-токен', { pushToken });
    return;
  }

  const message = {
    to: pushToken,
    sound: 'default',
    title: notification.title,
    body: notification.body,
    data: notification.data || {},
    badge: notification.badge || 1,
    priority: 'high',
    channelId: 'default',
  };

  try {
    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });

    const result = await response.json();

    if (result.data?.[0]?.status === 'error') {
      logger.error('Push notification error', {
        token: pushToken.substring(0, 20) + '...',
        error: result.data[0].message,
      });
    } else {
      logger.info('Push notification sent', {
        token: pushToken.substring(0, 20) + '...',
        title: notification.title,
      });
    }

    return result;
  } catch (error) {
    logger.error('Push notification failed', {
      error: error.message,
      token: pushToken.substring(0, 20) + '...',
    });
  }
}

/**
 * Отправить push-уведомления нескольким пользователям (batch).
 *
 * @param {Array<{pushToken: string, notification: object}>} notifications
 */
export async function sendBatchPushNotifications(notifications) {
  const messages = notifications
    .filter((n) => n.pushToken && n.pushToken.startsWith('ExponentPushToken'))
    .map((n) => ({
      to: n.pushToken,
      sound: 'default',
      title: n.notification.title,
      body: n.notification.body,
      data: n.notification.data || {},
      priority: 'high',
      channelId: 'default',
    }));

  if (messages.length === 0) return;

  // Expo принимает до 100 сообщений за раз
  const chunks = [];
  for (let i = 0; i < messages.length; i += 100) {
    chunks.push(messages.slice(i, i + 100));
  }

  for (const chunk of chunks) {
    try {
      await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(chunk),
      });
    } catch (error) {
      logger.error('Batch push failed', { error: error.message, count: chunk.length });
    }
  }

  logger.info('Batch push sent', { total: messages.length });
}
```

### Примеры использования на бэкенде

```js
import { sendPushNotification } from '../services/core/pushService.js';
import models from '../models/index.js';

// 1. Напоминание о событии (вызывается cron-задачей)
async function sendEventReminders() {
  const now = new Date();
  const in15min = new Date(now.getTime() + 15 * 60 * 1000);

  const upcomingEvents = await models.Event.findAll({
    where: {
      event_date: { [Op.between]: [now, in15min] },
    },
    include: [{ model: models.User, attributes: ['push_token'] }],
  });

  for (const event of upcomingEvents) {
    if (event.User?.push_token) {
      await sendPushNotification(event.User.push_token, {
        title: 'Напоминание',
        body: `"${event.title}" через 15 минут`,
        data: { type: 'event_reminder', event_id: event.id },
      });
    }
  }
}

// 2. Дедлайн задачи
async function sendTaskDeadlineReminder(task, user) {
  if (user.push_token) {
    await sendPushNotification(user.push_token, {
      title: 'Дедлайн задачи',
      body: `"${task.title}" -- срок сегодня`,
      data: { type: 'task_deadline', task_id: task.id },
    });
  }
}

// 3. Follow-up контакта
async function sendFollowUpReminder(interaction, user) {
  if (user.push_token) {
    await sendPushNotification(user.push_token, {
      title: 'Follow-up',
      body: `Напоминание: связаться с ${interaction.Contact.name}`,
      data: { type: 'follow_up', contact_id: interaction.contact_id },
    });
  }
}
```

### Новое поле в модели User

В рамках данного этапа добавить поле `push_token` в модель User (миграция):

```js
// src/migrations/XXXXXXXXXX-add-push-token-to-users.js
export default {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'push_token', {
      type: Sequelize.STRING(255),
      allowNull: true,
      defaultValue: null,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('users', 'push_token');
  },
};
```

---

## 7. Офлайн-режим

### Стратегия

Мобильное приложение должно быть полезным даже без интернета. Основные принципы:

1. **Кэширование** -- последние данные сохраняются локально.
2. **Очередь** -- исходящие действия ставятся в очередь при офлайне.
3. **Синхронизация** -- при восстановлении связи очередь обрабатывается.

### Что кэшируется локально

| Данные | Хранилище | Срок жизни |
|---|---|---|
| Последние 50 сообщений | AsyncStorage | До очистки |
| События на текущую неделю | AsyncStorage | 1 час |
| Активные задачи | AsyncStorage | 1 час |
| Последние 20 заметок | AsyncStorage | 1 час |
| Профиль пользователя | SecureStore | До logout |
| JWT-токены | SecureStore | По expiration |

### Реализация: `utils/offlineQueue.ts`

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import api from '../services/api';

interface QueuedAction {
  id: string;
  method: 'POST' | 'PUT' | 'DELETE';
  url: string;
  data?: any;
  timestamp: number;
  retries: number;
}

const QUEUE_KEY = '@secretary:offline_queue';
const MAX_RETRIES = 3;

class OfflineQueue {
  private queue: QueuedAction[] = [];
  private isSyncing = false;

  constructor() {
    this.loadQueue();
    this.setupNetworkListener();
  }

  // Загрузить очередь из хранилища
  private async loadQueue() {
    try {
      const stored = await AsyncStorage.getItem(QUEUE_KEY);
      this.queue = stored ? JSON.parse(stored) : [];
    } catch {
      this.queue = [];
    }
  }

  // Сохранить очередь в хранилище
  private async saveQueue() {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(this.queue));
  }

  // Добавить действие в очередь
  async enqueue(action: Omit<QueuedAction, 'id' | 'timestamp' | 'retries'>) {
    const item: QueuedAction = {
      ...action,
      id: `${Date.now()}_${Math.random().toString(36).substring(2)}`,
      timestamp: Date.now(),
      retries: 0,
    };
    this.queue.push(item);
    await this.saveQueue();
  }

  // Слушать изменения сети
  private setupNetworkListener() {
    NetInfo.addEventListener((state) => {
      if (state.isConnected && this.queue.length > 0) {
        this.sync();
      }
    });
  }

  // Синхронизировать очередь с сервером
  async sync() {
    if (this.isSyncing || this.queue.length === 0) return;
    this.isSyncing = true;

    const processed: string[] = [];

    for (const action of this.queue) {
      try {
        await api({
          method: action.method,
          url: action.url,
          data: action.data,
        });
        processed.push(action.id);
      } catch (error) {
        action.retries++;
        if (action.retries >= MAX_RETRIES) {
          processed.push(action.id); // Отбрасываем после MAX_RETRIES
          console.error('Action dropped after max retries:', action);
        }
      }
    }

    this.queue = this.queue.filter((a) => !processed.includes(a.id));
    await this.saveQueue();
    this.isSyncing = false;
  }

  get pendingCount() {
    return this.queue.length;
  }
}

export const offlineQueue = new OfflineQueue();
```

### Кэширование данных: `utils/cache.ts`

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';

const DEFAULT_TTL = 60 * 60 * 1000; // 1 час

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

export async function getCached<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(`@cache:${key}`);
    if (!raw) return null;

    const entry: CacheEntry<T> = JSON.parse(raw);
    const isExpired = Date.now() - entry.timestamp > entry.ttl;

    if (isExpired) {
      await AsyncStorage.removeItem(`@cache:${key}`);
      return null;
    }

    return entry.data;
  } catch {
    return null;
  }
}

export async function setCache<T>(key: string, data: T, ttl = DEFAULT_TTL): Promise<void> {
  const entry: CacheEntry<T> = { data, timestamp: Date.now(), ttl };
  await AsyncStorage.setItem(`@cache:${key}`, JSON.stringify(entry));
}

export async function clearCache(key: string): Promise<void> {
  await AsyncStorage.removeItem(`@cache:${key}`);
}
```

### Использование в store

```ts
// stores/eventsStore.ts (фрагмент)
import { getCached, setCache } from '../utils/cache';
import NetInfo from '@react-native-community/netinfo';
import { offlineQueue } from '../utils/offlineQueue';

// Загрузка событий (сначала кэш, потом сеть)
loadEvents: async () => {
  // 1. Показать кэшированные данные мгновенно
  const cached = await getCached('events_week');
  if (cached) {
    set({ events: cached });
  }

  // 2. Попробовать загрузить с сервера
  const netState = await NetInfo.fetch();
  if (netState.isConnected) {
    try {
      const { data } = await api.get('/events?period=week');
      set({ events: data.data });
      await setCache('events_week', data.data);
    } catch (error) {
      // Если нет кэша -- показать ошибку
      if (!cached) set({ error: 'Нет подключения к интернету' });
    }
  }
},

// Создание события (с оффлайн-поддержкой)
createEvent: async (eventData) => {
  const netState = await NetInfo.fetch();

  if (netState.isConnected) {
    const { data } = await api.post('/events', eventData);
    // Обновить список
  } else {
    // Сохранить в очередь
    await offlineQueue.enqueue({
      method: 'POST',
      url: '/events',
      data: eventData,
    });
    // Оптимистично добавить в локальный список
    // (с временным ID, будет заменён после синхронизации)
  }
},
```

---

## 8. Публикация в магазинах

### Конфигурация EAS Build: `eas.json`

```json
{
  "cli": {
    "version": ">= 5.0.0",
    "appVersionSource": "remote"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "env": {
        "EXPO_PUBLIC_API_URL": "http://192.168.1.100:3000/api/v1"
      }
    },
    "preview": {
      "distribution": "internal",
      "env": {
        "EXPO_PUBLIC_API_URL": "https://staging-api.secretary.app/api/v1"
      }
    },
    "production": {
      "env": {
        "EXPO_PUBLIC_API_URL": "https://api.secretary.app/api/v1"
      },
      "autoIncrement": true
    }
  },
  "submit": {
    "production": {
      "ios": {
        "appleId": "your-apple-id@email.com",
        "ascAppId": "1234567890",
        "appleTeamId": "XXXXXXXXXX"
      },
      "android": {
        "serviceAccountKeyPath": "./google-play-key.json",
        "track": "production"
      }
    }
  }
}
```

### Apple App Store

**Требования:**

| Требование | Описание |
|---|---|
| Apple Developer Program | $99/год |
| Privacy Policy URL | Обязательно. Описать: какие данные собираете, зачем, как храните |
| Data handling disclosure | App Privacy в App Store Connect: голосовые данные, календарь, история чата |
| AI disclosure | Явно указать использование AI. Disclaimer о точности |
| Screenshots | Минимум 5 скриншотов для каждого размера экрана (6.7", 6.5", 5.5") |
| App icon | 1024x1024 PNG без альфа-канала |
| Review time | 1-14 дней (обычно 1-3 дня) |

**Ключевые моменты для AI-приложений (App Store Review Guideline 5.6.4):**
- Указать, что приложение использует генеративный AI
- Иметь механизм модерации контента
- Disclaimer: "Ответы AI могут содержать неточности"
- Возможность пожаловаться на ответ AI

**Сборка и отправка:**

```bash
# Сборка iOS (не нужен Mac -- EAS делает всё в облаке)
eas build --platform ios --profile production

# Отправка в App Store Connect
eas submit --platform ios --profile production
```

### Google Play

**Требования:**

| Требование | Описание |
|---|---|
| Google Play Console | $25 единоразово |
| Privacy Policy URL | Обязательно |
| Content rating | Пройти questionnaire (IARC) |
| Data safety form | Описать все собираемые данные |
| Target API level | API 34+ (Android 14) |
| Screenshots | Минимум 2, рекомендуется 8 |
| Feature graphic | 1024x500 PNG |

**Сборка и отправка:**

```bash
# Сборка Android
eas build --platform android --profile production

# Отправка в Google Play
eas submit --platform android --profile production
```

### RuStore

**Требования:**

| Требование | Описание |
|---|---|
| Регистрация | Бесплатно |
| Комиссия | 0% (по состоянию на 2026) |
| Модерация | 1-2 дня, менее строгая |
| Формат | APK или AAB |

**Публикация:**

```bash
# Собрать APK
eas build --platform android --profile production

# Загрузить вручную в RuStore Console
# https://console.rustore.ru/
```

RuStore не имеет CLI для автоматической публикации. APK/AAB загружается вручную через веб-консоль.

---

## 9. Telegram Mini App (альтернатива)

### Описание

Telegram Mini App (ранее Web App) -- веб-приложение, открывающееся внутри Telegram. Легче полноценного мобильного приложения, но даёт визуальный интерфейс для:
- Дашборд (сводка дня)
- Календарь (визуальный)
- Настройки
- Управление подпиской
- Просмотр статистики использования

### Реализация

Telegram Mini App -- это обычное веб-приложение (HTML/JS/CSS), которое открывается через `WebApp` API Telegram.

**Структура:**

```
secretary-miniapp/
├── src/
│   ├── App.tsx
│   ├── pages/
│   │   ├── Dashboard.tsx       # Сводка дня
│   │   ├── Calendar.tsx        # Визуальный календарь
│   │   ├── Settings.tsx        # Настройки
│   │   └── Billing.tsx         # Подписка
│   ├── services/
│   │   └── api.ts              # API-клиент (авторизация через initData)
│   └── utils/
│       └── telegram.ts         # Telegram WebApp SDK helpers
├── index.html
├── vite.config.ts
└── package.json
```

**Авторизация через Telegram initData:**

```ts
// utils/telegram.ts
declare global {
  interface Window {
    Telegram: {
      WebApp: {
        initData: string;
        initDataUnsafe: {
          user?: {
            id: number;
            first_name: string;
            last_name?: string;
            username?: string;
          };
        };
        ready(): void;
        close(): void;
        expand(): void;
        MainButton: {
          text: string;
          show(): void;
          hide(): void;
          onClick(callback: () => void): void;
        };
        themeParams: {
          bg_color?: string;
          text_color?: string;
          hint_color?: string;
          button_color?: string;
          button_text_color?: string;
        };
      };
    };
  }
}

export function getTelegramWebApp() {
  return window.Telegram?.WebApp;
}

export function getTelegramInitData(): string {
  return window.Telegram?.WebApp?.initData || '';
}

export function getTelegramUser() {
  return window.Telegram?.WebApp?.initDataUnsafe?.user;
}
```

**API-клиент с Telegram-авторизацией:**

```ts
// services/api.ts
import axios from 'axios';
import { getTelegramInitData } from '../utils/telegram';

const API_URL = import.meta.env.VITE_API_URL;

const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
});

// Авторизация через Telegram initData (проверяется на бэкенде)
api.interceptors.request.use((config) => {
  const initData = getTelegramInitData();
  if (initData) {
    config.headers['X-Telegram-Init-Data'] = initData;
  }
  return config;
});

export default api;
```

**Регистрация Mini App в BotFather:**

```
/newapp
→ Выбрать бота
→ Указать название: Secretary Dashboard
→ Указать URL: https://miniapp.secretary.app
→ Получить ссылку: https://t.me/SecretaryBot/dashboard
```

**Открытие Mini App из бота:**

```js
// На бэкенде: отправить кнопку с Mini App
bot.sendMessage(chatId, 'Откройте дашборд:', {
  reply_markup: {
    inline_keyboard: [
      [
        {
          text: 'Открыть дашборд',
          web_app: { url: 'https://miniapp.secretary.app' },
        },
      ],
    ],
  },
});
```

---

## 10. API client -- общий слой

Один и тот же API-слой используется в PWA и React Native (с минимальными различиями в хранении токенов).

### `services/api.ts` -- Base API client

```ts
import axios, { AxiosInstance, InternalAxiosRequestConfig, AxiosError } from 'axios';
import { getToken, setToken, removeToken } from '../utils/storage';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000/api/v1';

const api: AxiosInstance = axios.create({
  baseURL: API_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// ---- Request: добавить JWT ----
api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const token = await getToken('access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ---- Response: обработка 401, refresh token ----
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config;
    if (!originalRequest || (originalRequest as any)._retry) {
      return Promise.reject(error);
    }

    if (error.response?.status === 401) {
      (originalRequest as any)._retry = true;

      const refreshToken = await getToken('refresh_token');
      if (!refreshToken) {
        await removeToken('access_token');
        await removeToken('refresh_token');
        return Promise.reject(error);
      }

      try {
        const { data } = await axios.post(`${API_URL}/auth/refresh`, {
          refresh_token: refreshToken,
        });

        await setToken('access_token', data.data.access_token);
        await setToken('refresh_token', data.data.refresh_token);

        originalRequest.headers.Authorization = `Bearer ${data.data.access_token}`;
        return api(originalRequest);
      } catch {
        await removeToken('access_token');
        await removeToken('refresh_token');
        return Promise.reject(error);
      }
    }

    return Promise.reject(error);
  }
);

export default api;
```

### `services/auth.ts`

```ts
import api from './api';
import { setToken, removeToken } from '../utils/storage';

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  user: {
    id: number;
    username: string;
    email?: string;
    subscription_tier: string;
  };
}

export async function loginApi(username: string, password: string): Promise<AuthResponse> {
  const { data } = await api.post('/auth/login', { username, password });
  const result = data.data as AuthResponse;
  await setToken('access_token', result.access_token);
  await setToken('refresh_token', result.refresh_token);
  return result;
}

export async function registerApi(
  username: string,
  password: string,
  email?: string
): Promise<AuthResponse> {
  const { data } = await api.post('/auth/register', { username, password, email });
  const result = data.data as AuthResponse;
  await setToken('access_token', result.access_token);
  await setToken('refresh_token', result.refresh_token);
  return result;
}

export async function logoutApi(): Promise<void> {
  await removeToken('access_token');
  await removeToken('refresh_token');
}

export async function telegramLoginApi(telegramData: any): Promise<AuthResponse> {
  const { data } = await api.post('/auth/telegram', telegramData);
  const result = data.data as AuthResponse;
  await setToken('access_token', result.access_token);
  await setToken('refresh_token', result.refresh_token);
  return result;
}
```

### `services/chat.ts`

```ts
import api from './api';

export interface ChatMessage {
  id: number;
  sender: 'user' | 'bot' | 'system';
  message_text: string;
  message_type: string;
  created_at: string;
}

export interface ChatSession {
  id: number;
  platform: string;
  started_at: string;
  ended_at: string | null;
  last_message?: string;
}

export async function sendMessageApi(
  message: string,
  sessionId?: number
): Promise<{ reply: string; session_id: number; audio_url?: string }> {
  const { data } = await api.post('/chat', {
    message,
    session_id: sessionId,
  });
  return data.data;
}

export async function getSessionsApi(
  page = 1,
  limit = 20
): Promise<{ sessions: ChatSession[]; total: number }> {
  const { data } = await api.get(`/chat/sessions?page=${page}&limit=${limit}`);
  return { sessions: data.data, total: data.meta?.total || 0 };
}

export async function getSessionMessagesApi(
  sessionId: number,
  page = 1,
  limit = 50
): Promise<{ messages: ChatMessage[]; total: number }> {
  const { data } = await api.get(
    `/chat/sessions/${sessionId}?page=${page}&limit=${limit}`
  );
  return { messages: data.data.messages || data.data, total: data.meta?.total || 0 };
}

export async function deleteSessionApi(sessionId: number): Promise<void> {
  await api.delete(`/chat/sessions/${sessionId}`);
}
```

### `services/events.ts`

```ts
import api from './api';

export interface Event {
  id: number;
  title: string;
  description?: string;
  event_date: string;
  end_date: string;
  recurrence_rule?: string;
  reminder_minutes: number;
}

export async function getEventsApi(params?: {
  from?: string;
  to?: string;
}): Promise<Event[]> {
  const { data } = await api.get('/events', { params });
  return data.data;
}

export async function getTodayEventsApi(): Promise<Event[]> {
  const { data } = await api.get('/events/today');
  return data.data;
}

export async function createEventApi(event: Partial<Event>): Promise<Event> {
  const { data } = await api.post('/events', event);
  return data.data;
}

export async function updateEventApi(id: number, updates: Partial<Event>): Promise<Event> {
  const { data } = await api.put(`/events/${id}`, updates);
  return data.data;
}

export async function deleteEventApi(id: number): Promise<void> {
  await api.delete(`/events/${id}`);
}
```

### `services/tasks.ts`

```ts
import api from './api';

export interface Task {
  id: number;
  title: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'done' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  due_date?: string;
  tags?: string[];
}

export async function getTasksApi(params?: {
  status?: string;
  priority?: string;
}): Promise<Task[]> {
  const { data } = await api.get('/tasks', { params });
  return data.data;
}

export async function createTaskApi(task: Partial<Task>): Promise<Task> {
  const { data } = await api.post('/tasks', task);
  return data.data;
}

export async function updateTaskApi(id: number, updates: Partial<Task>): Promise<Task> {
  const { data } = await api.put(`/tasks/${id}`, updates);
  return data.data;
}

export async function updateTaskStatusApi(
  id: number,
  status: Task['status']
): Promise<Task> {
  const { data } = await api.put(`/tasks/${id}/status`, { status });
  return data.data;
}

export async function deleteTaskApi(id: number): Promise<void> {
  await api.delete(`/tasks/${id}`);
}
```

### `services/websocket.ts`

```ts
import { io, Socket } from 'socket.io-client';
import { getToken } from '../utils/storage';

const WS_URL = process.env.EXPO_PUBLIC_WS_URL || 'http://localhost:3000';

let socket: Socket | null = null;

export async function connectWebSocket(): Promise<Socket> {
  if (socket?.connected) return socket;

  const token = await getToken('access_token');
  if (!token) throw new Error('Нет токена авторизации');

  socket = io(WS_URL, {
    auth: { token },
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: Infinity,
  });

  return new Promise((resolve, reject) => {
    if (!socket) return reject(new Error('Socket not created'));

    socket.on('connect', () => resolve(socket!));
    socket.on('connect_error', (err) => reject(err));

    // Таймаут подключения
    setTimeout(() => reject(new Error('WebSocket timeout')), 10000);
  });
}

export function disconnectWebSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function getSocket(): Socket | null {
  return socket;
}
```

### `utils/storage.ts` (абстракция хранилища)

```ts
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

// SecureStore работает только на нативных платформах.
// На вебе используем localStorage (менее безопасно, но единственный вариант).
const isNative = Platform.OS === 'ios' || Platform.OS === 'android';

export async function getToken(key: string): Promise<string | null> {
  if (isNative) {
    return SecureStore.getItemAsync(key);
  }
  return localStorage.getItem(key);
}

export async function setToken(key: string, value: string): Promise<void> {
  if (isNative) {
    await SecureStore.setItemAsync(key, value);
  } else {
    localStorage.setItem(key, value);
  }
}

export async function removeToken(key: string): Promise<void> {
  if (isNative) {
    await SecureStore.deleteItemAsync(key);
  } else {
    localStorage.removeItem(key);
  }
}
```

---

## 11. State management -- Zustand

### `stores/authStore.ts`

```ts
import { create } from 'zustand';
import { loginApi, registerApi, logoutApi, AuthResponse } from '../services/auth';
import { getToken, removeToken } from '../utils/storage';
import api from '../services/api';

interface User {
  id: number;
  username: string;
  email?: string;
  subscription_tier: string;
  timezone?: string;
  language?: string;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  // Actions
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, email?: string) => Promise<void>;
  logout: () => Promise<void>;
  loadStoredAuth: () => Promise<void>;
  updateProfile: (updates: Partial<User>) => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,

  login: async (username, password) => {
    const result = await loginApi(username, password);
    set({ user: result.user, isAuthenticated: true });
  },

  register: async (username, password, email) => {
    const result = await registerApi(username, password, email);
    set({ user: result.user, isAuthenticated: true });
  },

  logout: async () => {
    await logoutApi();
    set({ user: null, isAuthenticated: false });
  },

  loadStoredAuth: async () => {
    try {
      const token = await getToken('access_token');
      if (!token) {
        set({ isLoading: false });
        return;
      }

      // Проверить токен -- загрузить профиль
      const { data } = await api.get('/users/me');
      set({ user: data.data, isAuthenticated: true, isLoading: false });
    } catch {
      await removeToken('access_token');
      await removeToken('refresh_token');
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },

  updateProfile: async (updates) => {
    const { data } = await api.put('/users/me', updates);
    set({ user: data.data });
  },
}));
```

### `stores/chatStore.ts`

```ts
import { create } from 'zustand';
import {
  sendMessageApi,
  getSessionsApi,
  getSessionMessagesApi,
  ChatMessage,
  ChatSession,
} from '../services/chat';

interface ChatState {
  sessions: ChatSession[];
  currentSession: ChatSession | null;
  messages: ChatMessage[];
  isLoading: boolean;
  isSending: boolean;
  error: string | null;

  // Actions
  loadSessions: () => Promise<void>;
  selectSession: (session: ChatSession) => Promise<void>;
  sendMessage: (text: string | FormData) => Promise<void>;
  addBotMessage: (text: string, sessionId: number) => void;
  clearError: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessions: [],
  currentSession: null,
  messages: [],
  isLoading: false,
  isSending: false,
  error: null,

  loadSessions: async () => {
    set({ isLoading: true });
    try {
      const { sessions } = await getSessionsApi();
      set({ sessions, isLoading: false });

      // Автоматически выбрать последнюю сессию
      if (sessions.length > 0 && !get().currentSession) {
        await get().selectSession(sessions[0]);
      }
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
    }
  },

  selectSession: async (session) => {
    set({ currentSession: session, isLoading: true });
    try {
      const { messages } = await getSessionMessagesApi(session.id);
      set({ messages, isLoading: false });
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
    }
  },

  sendMessage: async (text) => {
    const { currentSession } = get();
    set({ isSending: true });

    // Оптимистичное добавление сообщения пользователя
    const userMessage: ChatMessage = {
      id: Date.now(), // временный ID
      sender: 'user',
      message_text: typeof text === 'string' ? text : '[Голосовое сообщение]',
      message_type: typeof text === 'string' ? 'text' : 'voice',
      created_at: new Date().toISOString(),
    };
    set((state) => ({ messages: [...state.messages, userMessage] }));

    try {
      const messageText = typeof text === 'string' ? text : '';
      const result = await sendMessageApi(messageText, currentSession?.id);

      // Добавить ответ бота
      const botMessage: ChatMessage = {
        id: Date.now() + 1,
        sender: 'bot',
        message_text: result.reply,
        message_type: 'text',
        created_at: new Date().toISOString(),
      };
      set((state) => ({
        messages: [...state.messages, botMessage],
        isSending: false,
      }));
    } catch (err: any) {
      set({
        error: err.response?.data?.error?.message || 'Ошибка отправки',
        isSending: false,
      });
    }
  },

  addBotMessage: (text, sessionId) => {
    const { currentSession } = get();
    if (currentSession?.id !== sessionId) return;

    const botMessage: ChatMessage = {
      id: Date.now(),
      sender: 'bot',
      message_text: text,
      message_type: 'text',
      created_at: new Date().toISOString(),
    };
    set((state) => ({ messages: [...state.messages, botMessage] }));
  },

  clearError: () => set({ error: null }),
}));
```

### `stores/eventsStore.ts`

```ts
import { create } from 'zustand';
import {
  getEventsApi,
  getTodayEventsApi,
  createEventApi,
  updateEventApi,
  deleteEventApi,
  Event,
} from '../services/events';

interface EventsState {
  events: Event[];
  todayEvents: Event[];
  selectedDate: string; // YYYY-MM-DD
  isLoading: boolean;
  error: string | null;

  // Actions
  loadEvents: (from?: string, to?: string) => Promise<void>;
  loadTodayEvents: () => Promise<void>;
  createEvent: (event: Partial<Event>) => Promise<void>;
  updateEvent: (id: number, updates: Partial<Event>) => Promise<void>;
  deleteEvent: (id: number) => Promise<void>;
  setSelectedDate: (date: string) => void;
}

export const useEventsStore = create<EventsState>((set, get) => ({
  events: [],
  todayEvents: [],
  selectedDate: new Date().toISOString().split('T')[0],
  isLoading: false,
  error: null,

  loadEvents: async (from, to) => {
    set({ isLoading: true });
    try {
      const events = await getEventsApi({ from, to });
      set({ events, isLoading: false });
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
    }
  },

  loadTodayEvents: async () => {
    try {
      const todayEvents = await getTodayEventsApi();
      set({ todayEvents });
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  createEvent: async (eventData) => {
    const event = await createEventApi(eventData);
    set((state) => ({ events: [...state.events, event] }));
  },

  updateEvent: async (id, updates) => {
    const updated = await updateEventApi(id, updates);
    set((state) => ({
      events: state.events.map((e) => (e.id === id ? updated : e)),
    }));
  },

  deleteEvent: async (id) => {
    await deleteEventApi(id);
    set((state) => ({
      events: state.events.filter((e) => e.id !== id),
    }));
  },

  setSelectedDate: (date) => set({ selectedDate: date }),
}));
```

---

## 12. Безопасность мобильного приложения

### Хранение токенов

| Платформа | Хранилище | Безопасность |
|---|---|---|
| iOS | expo-secure-store (Keychain) | Аппаратное шифрование |
| Android | expo-secure-store (Keystore) | Аппаратное шифрование |
| Web (PWA) | localStorage | Нет шифрования (XSS-уязвимо) |

**Правило:** НИКОГДА не хранить токены в AsyncStorage на нативных платформах. AsyncStorage -- не зашифрованный plain text.

### HTTPS only

```ts
// utils/constants.ts
const API_URL = __DEV__
  ? 'http://192.168.1.100:3000/api/v1'  // Только в development
  : 'https://api.secretary.app/api/v1';   // Всегда HTTPS в production
```

В `app.json` для iOS:

```json
{
  "expo": {
    "ios": {
      "infoPlist": {
        "NSAppTransportSecurity": {
          "NSAllowsArbitraryLoads": false
        }
      }
    }
  }
}
```

### Certificate pinning (опционально)

Для повышенной безопасности (Business/Enterprise):

```ts
// Certificate pinning через expo-certificate-pinning (community package)
// Предотвращает MITM-атаки даже при скомпрометированном CA
```

### Биометрическая аутентификация (опционально)

```ts
import * as LocalAuthentication from 'expo-local-authentication';

async function authenticateWithBiometrics(): Promise<boolean> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  if (!hasHardware) return false;

  const isEnrolled = await LocalAuthentication.isEnrolledAsync();
  if (!isEnrolled) return false;

  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Подтвердите личность',
    fallbackLabel: 'Использовать пароль',
    cancelLabel: 'Отмена',
  });

  return result.success;
}
```

### Защита от реверс-инжиниринга

- Не хранить секреты (API keys) в коде приложения
- Все секреты -- на бэкенде
- Приложение знает только URL бэкенда
- API key бэкенда никогда не попадает в клиентский код
- Обфускация JavaScript (автоматически при production-сборке Expo)

---

## 13. Защита от блокировки Telegram

### Сценарий

1. Telegram заблокирован в России.
2. Пользователи не могут использовать бот.
3. Нужна альтернатива.

### Решение

Бэкенд Secretary Bot уже platform-agnostic. Добавление нового клиента не требует изменений на сервере.

```
До блокировки:
  Пользователь → Telegram Bot → Backend API → Claude/Google/etc.

После блокировки:
  Пользователь → PWA / Mobile App → Backend API → Claude/Google/etc.
                                        ↑
                                  Тот же бэкенд
                                  Тот же аккаунт
                                  Та же история
```

### Миграция пользователя

1. Пользователь заходит в PWA / мобильное приложение.
2. Входит по username + password ИЛИ через Telegram Login Widget (если Telegram ещё работает на устройстве).
3. Аккаунт связан по `user_id` -- все данные (события, задачи, заметки, история чата) уже доступны.
4. Никакой миграции данных не нужно -- всё хранится на бэкенде.

### Экспорт истории из Telegram (опционально)

Если пользователь хочет сохранить историю переписки из Telegram:

```
1. В Telegram: Export chat history (встроенная функция)
2. В приложении: Import → загрузить JSON/HTML
3. Backend: парсит и сохраняет в Session/Message
```

Это опциональная фича. Основная история уже хранится в БД через модели Session и Message.

### План действий при блокировке

| Шаг | Время | Действие |
|---|---|---|
| 1 | 0-1 час | Отправить email/SMS всем пользователям: "Мы доступны по адресу app.secretary.app" |
| 2 | 0-1 час | PWA уже развёрнута, работает |
| 3 | 1-24 часа | Проверить, что мобильные приложения доступны в магазинах |
| 4 | 1-7 дней | Маркетинговая кампания: "Secretary Bot теперь в App Store / Google Play" |

---

## 14. Чеклист готовности

### Предварительные условия

- [ ] Stage 2 (безопасность) завершён: JWT auth, bcrypt, HTTPS
- [ ] Stage 3 (универсальный API) завершён: REST API `/api/v1/`, WebSocket
- [ ] API документация (Swagger) доступна и актуальна
- [ ] Backend развёрнут и доступен по HTTPS

### PWA

- [ ] Проект создан (React + Vite + PWA plugin)
- [ ] manifest.json сконфигурирован (name, icons, display: standalone)
- [ ] Service Worker кэширует статику и API-ответы
- [ ] API-клиент с JWT-интерцептором работает
- [ ] Экран авторизации (login / register)
- [ ] Экран чата (отправка / получение сообщений)
- [ ] Экран календаря (просмотр событий по дням/месяцам)
- [ ] Экран задач (список, фильтры, смена статуса)
- [ ] Экран заметок (список, создание, редактирование)
- [ ] Экран настроек (timezone, язык, голос)
- [ ] Responsive design (mobile-first, работает на 320px+)
- [ ] Lighthouse PWA audit -- зелёный
- [ ] Развёрнуто на Vercel / Netlify

### React Native + Expo

- [ ] Проект создан (create-expo-app, TypeScript)
- [ ] Expo Router настроен (auth group + tabs group)
- [ ] React Native Paper -- UI-компоненты
- [ ] API-клиент с JWT (expo-secure-store для токенов)
- [ ] Все экраны реализованы (login, chat, calendar, tasks, notes, settings, profile)
- [ ] Запись голоса через expo-av
- [ ] Воспроизведение голосовых ответов
- [ ] Push-уведомления (expo-notifications)
- [ ] Push-токен отправляется на бэкенд при регистрации
- [ ] Офлайн-режим (кэш + очередь)
- [ ] WebSocket для real-time обновлений

### Backend (дополнения для мобильного)

- [ ] Поле `push_token` добавлено в модель User (миграция)
- [ ] `src/services/core/pushService.js` -- отправка push-уведомлений
- [ ] Push при: напоминание о событии, дедлайн задачи, follow-up контакта
- [ ] Endpoint `POST /api/v1/chat` принимает multipart/form-data (голос)
- [ ] Endpoint `PUT /api/v1/users/me` принимает `push_token`

### Публикация

- [ ] Apple Developer Program ($99/год) -- аккаунт создан
- [ ] Google Play Console ($25) -- аккаунт создан
- [ ] RuStore Console -- аккаунт создан
- [ ] Privacy Policy URL -- готова и размещена
- [ ] Terms of Service URL -- готовы и размещены
- [ ] eas.json сконфигурирован для всех профилей
- [ ] iOS build успешно проходит через EAS Build
- [ ] Android build успешно проходит через EAS Build
- [ ] Скриншоты подготовлены (iOS: 6.7", 6.5", 5.5"; Android: phone + tablet)
- [ ] Иконка приложения 1024x1024
- [ ] Описание приложения на русском и английском
- [ ] App Store ревью пройдено
- [ ] Google Play ревью пройдено
- [ ] RuStore -- APK загружен

### Безопасность

- [ ] Токены хранятся в SecureStore (НЕ в AsyncStorage)
- [ ] HTTPS only в production
- [ ] Нет API ключей в клиентском коде
- [ ] Обфускация JavaScript (production build)

### Telegram Mini App (опционально)

- [ ] Mini App зарегистрирована в BotFather
- [ ] Дашборд показывает сводку дня
- [ ] Авторизация через initData
- [ ] Развёрнуто на отдельном домене

---

> **Следующий шаг:** При необходимости -- развернуть PWA за 2-3 недели как быстрый win. React Native приложение можно начинать параллельно.
>
> **Важно помнить:** Мобильное приложение -- ТОНКИЙ КЛИЕНТ. Вся бизнес-логика, AI, интеграции с Google, MCP -- всё на бэкенде. Приложение только отображает данные и отправляет запросы через REST API / WebSocket.
