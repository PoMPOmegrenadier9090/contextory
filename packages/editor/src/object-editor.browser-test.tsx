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
  const object = (
    type: string,
    title: string,
    content: string,
    field?: { readonly name: string; readonly value: string },
  ) => ({
    type: "objectBlock",
    attrs: { type, objectId: type, collapsed: false },
    content: [
      {
        type: "objectTitle",
        content: title ? [{ type: "text", text: title }] : [],
      },
      ...(field
        ? [
            {
              type: "objectFieldControl",
              attrs: {
                fieldId: "due",
                name: field.name,
                kind: "date",
                value: field.value,
              },
            },
          ]
        : []),
      { type: "paragraph", content: [{ type: "text", text: content }] },
    ],
  });
  let opened: string | undefined;
  let openedType: string | undefined;
  let saved:
    Parameters<Parameters<typeof ObjectEditor>[0]["onChange"]>[0] | undefined;
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
              object("project", "タグ解除", "残す本文", {
                name: "期限",
                value: "2026-11-14",
              }),
              {
                type: "paragraph",
                content: [{ type: "text", text: "通常の段落" }],
              },
            ],
          }}
          onChange={(doc) => {
            saved = doc;
          }}
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
  const rowLeft = task.getBoundingClientRect().left;
  const titleLeft = title.getBoundingClientRect().left;
  const toggle = task.querySelector<HTMLButtonElement>(".pe-toggle")!;
  const detail = task.querySelector<HTMLButtonElement>(".pe-object-open")!;
  const checkbox = task.querySelector<HTMLInputElement>(
    "input[type=checkbox]",
  )!;
  const tag = task.querySelector<HTMLButtonElement>(".pe-tag")!;
  assert(
    paragraph.getBoundingClientRect().left === rowLeft,
    "Normal paragraphs must start at the Object row's edge",
  );
  assert(
    titleLeft - rowLeft === 42,
    "Titles must keep the former checkbox-free indentation",
  );
  assert(
    toggle.getBoundingClientRect().right <=
      detail.getBoundingClientRect().left &&
      detail.getBoundingClientRect().right <=
        checkbox.getBoundingClientRect().left &&
      checkbox.getBoundingClientRect().right < titleLeft,
    "Leading controls must not overlap each other or the title",
  );
  assert(
    Array.from(editor.querySelectorAll("[data-object-title]")).every(
      (value) => value.getBoundingClientRect().left === titleLeft,
    ),
    "Checkbox and non-checkbox rows must align",
  );
  assert(
    !title.contains(tag) && !tag.isContentEditable,
    "Tag must be outside the editable title",
  );
  tag.click();
  await paint();
  assert(
    document.activeElement === tag &&
      tag.getAttribute("aria-expanded") === "true",
    "Click must select the tag and show actions",
  );
  const actions = document.getElementById(tag.getAttribute("aria-controls")!)!;
  assert(!actions.hidden, "Tag actions must be visible");
  actions.querySelector("button")!.click();
  assert(openedType === "task", "Tag details must open the type page");
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
  const removable = editor.querySelector<HTMLElement>(
    '.pe-object[data-type="project"]',
  )!;
  const removableTag = removable.querySelector<HTMLButtonElement>(".pe-tag")!;
  removableTag.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
  await paint();
  const removeActions = document.getElementById(
    removableTag.getAttribute("aria-controls")!,
  )!;
  assert(!removeActions.hidden, "Right click must open tag actions");
  removeActions.querySelectorAll("button")[1]!.click();
  await paint();
  assert(
    !removable.querySelector(".pe-tag"),
    "Removing the tag must hide the chip",
  );
  const untagged = saved?.content?.find(
    (child) => child.attrs?.objectId === "project",
  );
  assert(
    untagged?.attrs?.type === "",
    "Removing the tag must retain the Object ID",
  );
  assert(
    untagged?.content?.some(
      (child) =>
        child.content?.map((inline) => inline.text).join("") ===
        "期限: 2026-11-14",
    ) && removable.textContent.includes("残す本文"),
    "Removing the tag must preserve the field value and body",
  );
  return { checks };
}
