// Safari may report isComposing=false for the Enter that confirms an IME edit.
export const isComposingKey = (event: {
  readonly isComposing: boolean;
  readonly keyCode: number;
}): boolean => event.isComposing || event.keyCode === 229;

export const blurOnInputExit = (event: {
  readonly key: string;
  readonly nativeEvent: {
    readonly isComposing: boolean;
    readonly keyCode: number;
  };
  readonly currentTarget: { blur(): void };
  preventDefault(): void;
}): void => {
  if (isComposingKey(event.nativeEvent)) return;
  if (event.key !== "Enter" && event.key !== "Escape") return;
  event.preventDefault();
  event.currentTarget.blur();
};
