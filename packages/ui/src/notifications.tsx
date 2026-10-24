import { CloseButton, Portal } from "@mantine/core";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type NotificationKind = "success" | "error" | "warning";
interface Notification {
  readonly id: number;
  readonly message: string;
  readonly kind: NotificationKind;
}
interface Notifications {
  readonly show: (message: string, kind: NotificationKind) => number;
  readonly dismiss: (id: number) => void;
}
const NotificationContext = createContext<Notifications | null>(null);

const NotificationCard = ({
  notification,
  dismiss,
}: {
  readonly notification: Notification;
  readonly dismiss: (id: number) => void;
}): React.JSX.Element => {
  const { id, message, kind } = notification;
  useEffect(() => {
    if (kind !== "success") return;
    const timer = setTimeout(() => dismiss(id), 3000);
    return () => clearTimeout(timer);
  }, [id, kind, dismiss]);
  return (
    <div
      className="app-notification"
      data-kind={kind}
      role={kind === "error" ? "alert" : "status"}
      aria-atomic="true"
    >
      <span className="app-notification-label">
        {kind === "error" ? "エラー" : kind === "warning" ? "注意" : "完了"}
      </span>
      <span className="app-notification-message">{message}</span>
      {kind !== "warning" && (
        <CloseButton
          aria-label={`通知を閉じる: ${message}`}
          onClick={() => dismiss(id)}
          size="md"
        />
      )}
    </div>
  );
};

export const NotificationProvider = ({
  children,
}: {
  readonly children: ReactNode;
}): React.JSX.Element => {
  const [notifications, setNotifications] = useState<readonly Notification[]>(
    [],
  );
  const sequence = useRef(0);
  const dismiss = useCallback((id: number) => {
    setNotifications((current) => current.filter((item) => item.id !== id));
  }, []);
  const show = useCallback(
    (message: string, kind: NotificationKind): number => {
      const notification = { id: ++sequence.current, message, kind };
      setNotifications((current) => [
        ...current.filter((item) =>
          kind === "success"
            ? item.kind !== "success"
            : kind !== "error" ||
              item.kind !== kind ||
              item.message !== message,
        ),
        notification,
      ]);
      return notification.id;
    },
    [],
  );
  const context = useMemo(() => ({ show, dismiss }), [show, dismiss]);
  return (
    <NotificationContext.Provider value={context}>
      {children}
      <Portal>
        <div className="app-notifications" aria-label="通知">
          {notifications.map((notification) => (
            <NotificationCard
              key={notification.id}
              notification={notification}
              dismiss={dismiss}
            />
          ))}
        </div>
      </Portal>
    </NotificationContext.Provider>
  );
};

const useNotifications = (): Notifications => {
  const context = useContext(NotificationContext);
  if (!context) throw new Error("NotificationProvider is required");
  return context;
};

export const useNotification = (kind: NotificationKind) => {
  const { show } = useNotifications();
  return useCallback((message: string) => show(message, kind), [show, kind]);
};

export const usePersistentWarning = (message: string | null): void => {
  const { show, dismiss } = useNotifications();
  useEffect(() => {
    if (message === null) return;
    const id = show(message, "warning");
    return () => dismiss(id);
  }, [message, show, dismiss]);
};
