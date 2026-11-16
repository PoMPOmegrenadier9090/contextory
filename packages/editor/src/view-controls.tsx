import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

/** 端末の時刻での日付（YYYY-MM-DD）。 */
export const localDate = (date = new Date()): string => {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/** ボタンの下に開く小さな窓。外を押すか、Escapeで閉じる。 */
export const Popover = ({
  label,
  ariaLabel,
  className = "",
  active = false,
  children,
}: {
  readonly label: React.ReactNode;
  readonly ariaLabel?: string;
  readonly className?: string;
  /** 設定が入っていることを、ボタンの色で示す。 */
  readonly active?: boolean;
  readonly children: (close: () => void) => React.ReactNode;
}): React.JSX.Element => {
  /** 開いているときの、窓を置く位置 */
  const [at, setAt] = useState<React.CSSProperties | null>(null);
  const root = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeFromPanel = (): void => {
    setAt(null);
    trigger.current?.focus({ preventScroll: true });
  };
  useEffect(() => {
    if (!at) return;
    const close = (): void => setAt(null);
    const onDown = (event: MouseEvent): void => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    // 窓は画面に固定して置くので、外側がスクロールしたら閉じる。
    const onScroll = (event: Event): void => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [at !== null]);
  return (
    <span
      className={`od-pop ${className}`}
      ref={root}
      onKeyDown={(event) => {
        if (!at || event.key !== "Escape" || event.nativeEvent.isComposing)
          return;
        event.preventDefault();
        event.stopPropagation();
        closeFromPanel();
      }}
    >
      <button
        type="button"
        ref={trigger}
        aria-label={ariaLabel}
        aria-expanded={at !== null}
        data-active={active}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const below = innerHeight - rect.bottom - 12;
          const above = rect.top - 12;
          // 表の中でも切れないよう、画面に固定して置く。下が狭ければ上へ開く。
          const up = below < 240 && above > below;
          setAt(
            at
              ? null
              : {
                  ...(up
                    ? { bottom: innerHeight - rect.top + 4 }
                    : { top: rect.bottom + 4 }),
                  left: Math.max(8, Math.min(rect.left, innerWidth - 288)),
                  maxHeight: Math.min(480, up ? above : below),
                },
          );
        }}
      >
        {label}
      </button>
      {at ? (
        <div className="od-pop-panel" role="dialog" style={at}>
          {children(closeFromPanel)}
        </div>
      ) : null}
    </span>
  );
};

/** 押すと切り替わる、チェック付きの行。 */
export const CheckItem = ({
  checked,
  onChange,
  children,
}: {
  readonly checked: boolean;
  readonly onChange: () => void;
  readonly children: React.ReactNode;
}): React.JSX.Element => (
  <button
    type="button"
    className="od-check"
    role="menuitemcheckbox"
    aria-checked={checked}
    onClick={onChange}
  >
    {children}
  </button>
);

/** いくつかの中から一つを選ぶ、横並びのボタン。 */
export const Segmented = <T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: string;
  readonly value: T;
  readonly options: readonly (readonly [T, string])[];
  readonly onChange: (value: T) => void;
}): React.JSX.Element => (
  <div className="od-segmented" role="group" aria-label={label}>
    {options.map(([option, text]) => (
      <button
        key={option}
        type="button"
        aria-pressed={option === value}
        onClick={() => onChange(option)}
      >
        {text}
      </button>
    ))}
  </div>
);

export interface Choice {
  readonly key: string;
  readonly label: string;
  readonly note?: string;
}

/** 入力で候補を絞って選ぶ。onCreateがあれば、候補に無い文字もそのまま使える。 */
export const Chooser = ({
  load,
  onPick,
  onCreate,
  placeholder,
}: {
  readonly load: (
    query: string,
  ) => readonly Choice[] | Promise<readonly Choice[]>;
  readonly onPick: (choice: Choice) => void;
  readonly onCreate?: (text: string) => void;
  readonly placeholder: string;
}): React.JSX.Element => {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<readonly Choice[]>([]);
  /** 候補を出し終えた入力。入力に追いつく前のEnterで、古い候補を選ばないために持つ。 */
  const [settled, setSettled] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    let live = true;
    void Promise.resolve(load(query)).then(
      (found) => {
        if (!live) return;
        setItems(found);
        setSettled(query);
        setIndex(0);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [query]);
  const text = query.trim();
  const listId = useId();
  const options =
    settled === query
      ? items.map((item) => ({
          ...item,
          pick: () => onPick(item),
        }))
      : [];
  if (
    settled === query &&
    onCreate &&
    text &&
    !items.some((item) => item.label === text)
  )
    options.push({
      key: "create",
      label: `「${text}」を使う`,
      pick: () => onCreate(text),
    });
  useEffect(() => {
    if (settled === query)
      document
        .getElementById(`${listId}-${index}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [index, listId, query, settled]);
  return (
    <div className="od-chooser">
      <input
        autoFocus
        role="combobox"
        aria-autocomplete="list"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={
          options[index] ? `${listId}-${index}` : undefined
        }
        aria-label={placeholder}
        placeholder={placeholder}
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            if (!options.length) return;
            event.preventDefault();
            const step = event.key === "ArrowDown" ? 1 : -1;
            setIndex((index + step + options.length) % options.length);
          } else if (event.key === "Enter") {
            event.preventDefault();
            options[index]?.pick();
          }
        }}
      />
      <ul role="listbox" id={listId} aria-label={placeholder}>
        {options.map((item, i) => (
          <li key={i} role="presentation">
            <button
              type="button"
              role="option"
              tabIndex={-1}
              id={`${listId}-${i}`}
              aria-selected={i === index}
              onMouseEnter={() => setIndex(i)}
              onClick={item.pick}
            >
              {item.label}
              {item.note ? <small>{item.note}</small> : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

/** 今年なら「11月20日(金)」、ほかの年なら年も付ける。 */
export const formatDate = (date: string): string => {
  const value = new Date(`${date}T12:00:00`);
  if (Number.isNaN(value.getTime())) return date;
  return new Intl.DateTimeFormat("ja-JP", {
    ...(date.startsWith(localDate().slice(0, 4)) ? {} : { year: "numeric" }),
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).format(value);
};

/** 日付を、直接入力するかカレンダーから選ぶ。空文字は「日付なし」。 */
export const DatePanel = ({
  value,
  onPick,
}: {
  readonly value: string;
  readonly onPick: (date: string) => void;
}): React.JSX.Element => {
  const initial = value || localDate();
  const [month, setMonth] = useState(initial.slice(0, 7));
  const [activeDay, setActiveDay] = useState(Number(initial.slice(8)));
  const grid = useRef<HTMLDivElement>(null);
  const moveFocus = useRef(false);
  useLayoutEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    grid.current
      ?.querySelector<HTMLButtonElement>('button[tabindex="0"]')
      ?.focus();
  }, [activeDay, month]);
  const first = new Date(`${month}-01T12:00:00`);
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const shift = (step: number): void => {
    const next = new Date(first);
    next.setMonth(next.getMonth() + step);
    setMonth(localDate(next).slice(0, 7));
  };
  return (
    <div className="od-date">
      <input
        autoFocus
        aria-label="日付"
        placeholder="2026-11-15"
        defaultValue={value}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            grid.current
              ?.querySelector<HTMLButtonElement>('button[tabindex="0"]')
              ?.focus();
            return;
          }
          if (event.key !== "Enter") return;
          event.preventDefault();
          const typed = event.currentTarget.value.trim().replaceAll("/", "-");
          const [year, mon, day] = typed.split("-");
          const date = `${year}-${mon?.padStart(2, "0")}-${day?.padStart(2, "0")}`;
          if (!typed) onPick("");
          else if (
            /^\d{4}-\d{2}-\d{2}$/.test(date) &&
            localDate(new Date(`${date}T12:00:00`)) === date
          )
            onPick(date);
        }}
      />
      <header>
        <button type="button" aria-label="前の月" onClick={() => shift(-1)}>
          ‹
        </button>
        <strong>
          {first.getFullYear()}年{first.getMonth() + 1}月
        </strong>
        <button type="button" aria-label="次の月" onClick={() => shift(1)}>
          ›
        </button>
      </header>
      <div
        className="od-date-grid"
        ref={grid}
        role="group"
        aria-label="カレンダー"
      >
        {[..."日月火水木金土"].map((day) => (
          <span key={day}>{day}</span>
        ))}
        {Array.from({ length: first.getDay() }, (_, i) => (
          <span key={`blank-${i}`} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const date = `${month}-${String(i + 1).padStart(2, "0")}`;
          return (
            <button
              key={date}
              type="button"
              aria-pressed={date === value}
              aria-label={formatDate(date)}
              tabIndex={i + 1 === Math.min(activeDay, days) ? 0 : -1}
              onFocus={() => setActiveDay(i + 1)}
              onKeyDown={(event) => {
                if (
                  event.altKey ||
                  event.ctrlKey ||
                  event.metaKey ||
                  event.shiftKey
                )
                  return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  onPick(date);
                  return;
                }
                const step = {
                  ArrowLeft: -1,
                  ArrowRight: 1,
                  ArrowUp: -7,
                  ArrowDown: 7,
                }[event.key];
                if (step === undefined) return;
                event.preventDefault();
                const next = new Date(`${date}T12:00:00`);
                next.setDate(next.getDate() + step);
                moveFocus.current = true;
                setMonth(localDate(next).slice(0, 7));
                setActiveDay(next.getDate());
              }}
              data-today={date === localDate()}
              onClick={() => onPick(date)}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
      <footer>
        <button type="button" onClick={() => onPick(localDate())}>
          今日
        </button>
        <button type="button" onClick={() => onPick("")}>
          日付なし
        </button>
      </footer>
    </div>
  );
};
