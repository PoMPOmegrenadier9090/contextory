import { createRoot } from "react-dom/client";
import { ObjectEditor, type EditorHost } from "./object-editor.js";

export async function runObjectEditorBrowserChecks(parent: HTMLElement) {
  let checks = 0;
  const assert = (value: unknown, message: string) => {
    if (!value) throw new Error(message);
    checks++;
  };
  const paint = () =>
    new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  const object = (type: string, title: string, content: string) => ({
    type: "objectBlock",
    attrs: { type, objectId: type, collapsed: false },
    content: [
      {
        type: "objectTitle",
        content: title ? [{ type: "text", text: title }] : [],
      },
      { type: "paragraph", content: [{ type: "text", text: content }] },
    ],
  });
  let opened: string | undefined;
  let openedType: string | undefined;
  const host: EditorHost = {
    lookup: () => undefined,
    search: () => Promise.resolve([]),
    create: () => "",
    open: (id) => {
      opened = id;
    },
    openType: (type) => {
      openedType = type;
    },
    types: () => [],
    page: null,
  };
  createRoot(parent).render(
    <div className="od-demo">
      <section className="od-document">
        <ObjectEditor
          ariaLabel="Daily本文"
          host={host}
          initialDoc={{
            type: "doc",
            content: [
              object("task", "短いタイトル", "Objectの本文"),
              object("memo", "", "空のタイトルでも入力できる"),
              object(
                "decision",
                "折り返すタイトル".repeat(12),
                "長いタイトルの本文",
              ),
              {
                type: "paragraph",
                content: [{ type: "text", text: "通常の段落" }],
              },
            ],
          }}
          onChange={() => {}}
        />
      </section>
    </div>,
  );
  await paint();
  const editor = parent.querySelector<HTMLElement>(".tiptap")!;
  const task = editor.querySelector<HTMLElement>(
    '.pe-object[data-type="task"]',
  )!;
  const title = task.querySelector<HTMLElement>("[data-object-title]")!;
  const paragraph = editor.querySelector<HTMLElement>(":scope > p")!;
  const titleLeft = title.getBoundingClientRect().left;
  const toggle = task.querySelector<HTMLButtonElement>(".pe-toggle")!;
  const detail = task.querySelector<HTMLButtonElement>(".pe-object-open")!;
  const tag = task.querySelector<HTMLButtonElement>(".pe-tag")!;
  assert(
    paragraph.getBoundingClientRect().left ===
      task.getBoundingClientRect().left,
    "Normal paragraphs must start at the Object row's edge",
  );
  assert(
    toggle.getBoundingClientRect().left === task.getBoundingClientRect().left,
    "Toggle must start inside the Object row",
  );
  assert(
    detail.getBoundingClientRect().right < titleLeft,
    "Detail must be before the title",
  );
  assert(
    !title.contains(tag) && !tag.isContentEditable,
    "Tag must be outside the editable title",
  );
  tag.click();
  assert(openedType === "task", "Tag must open the type page");
  detail.click();
  assert(opened === "task", "Vertical bar must open Object details");
  toggle.click();
  await paint();
  assert(
    task.querySelector("p")!.getClientRects().length === 0,
    "Collapse must hide the body",
  );
  toggle.click();
  await paint();
  assert(
    task.querySelector("p")!.getClientRects().length > 0,
    "Expand must show the body",
  );
  assert(
    editor.scrollWidth === editor.clientWidth,
    "Long titles must wrap without overflow",
  );
  return { checks };
}
