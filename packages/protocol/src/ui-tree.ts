import { z } from "zod";

// Messages for the semantic-target channel (ADR 0064): the viewer asks the computer for the interface tree of the window
// it is sharing, and the computer answers with a bounded, filtered tree or a reason it cannot. Nothing here grants the
// right to ask: that is the separate `ui_tree` scope the owner approves on the computer.

export const UI_TREE_CHANNEL = "beacon-ui-tree-v1";
export const UI_TREE_MAX_NODES = 500;
export const UI_TREE_MAX_DEPTH = 12;
export const UI_TREE_MAX_NAME = 120;

export const uiState = z.enum([
  "enabled",
  "disabled",
  "focused",
  "checked",
  "unchecked",
  "selected",
  "expanded",
  "collapsed",
  "offscreen",
]);

const coordinate = z.number().int().min(-1_000_000).max(1_000_000);
const size = z.number().int().min(0).max(1_000_000);

export type UiNode = {
  role: string;
  name?: string | undefined;
  protected?: boolean | undefined;
  states: z.infer<typeof uiState>[];
  bounds: { x: number; y: number; width: number; height: number };
  children: UiNode[];
};

export const uiNode: z.ZodType<UiNode> = z.lazy(() =>
  z
    .object({
      role: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/),
      name: z.string().max(UI_TREE_MAX_NAME).optional(),
      protected: z.boolean().optional(),
      states: z.array(uiState).max(9),
      bounds: z
        .object({
          x: coordinate,
          y: coordinate,
          width: size,
          height: size,
        })
        .strict(),
      children: z.array(uiNode).max(UI_TREE_MAX_NODES),
    })
    .strict()
    // A protected field has no name: the computer never sends one, and a viewer never accepts one.
    .refine((node) => !(node.protected && node.name !== undefined), {
      message: "a protected field carries no name",
    }),
);

function measure(
  node: UiNode,
  depth: number,
): { count: number; depth: number } {
  let count = 1;
  let deepest = depth;
  for (const child of node.children) {
    const inner = measure(child, depth + 1);
    count += inner.count;
    deepest = Math.max(deepest, inner.depth);
  }
  return { count, depth: deepest };
}

/** The display the window is on, in the same screen coordinates as the tree's boxes. */
export const uiDisplay = z
  .object({
    x: coordinate,
    y: coordinate,
    width: z.number().int().min(1).max(1_000_000),
    height: z.number().int().min(1).max(1_000_000),
  })
  .strict();
export type UiDisplay = z.infer<typeof uiDisplay>;

export const uiTreeRequest = z
  .object({ type: z.literal("ui-tree-request"), id: z.uuid() })
  .strict();

export const uiTreeResponse = z.discriminatedUnion("ok", [
  z
    .object({
      type: z.literal("ui-tree"),
      id: z.uuid(),
      ok: z.literal(true),
      truncated: z.boolean(),
      // Where the boxes are: lets a viewer turn a box into a point on the picture it is looking at.
      display: uiDisplay.optional(),
      tree: uiNode,
    })
    .strict()
    .superRefine((message, context) => {
      const { count, depth } = measure(message.tree, 0);
      if (count > UI_TREE_MAX_NODES)
        context.addIssue({ code: "custom", message: "too many nodes" });
      if (depth > UI_TREE_MAX_DEPTH)
        context.addIssue({ code: "custom", message: "tree too deep" });
    }),
  z
    .object({
      type: z.literal("ui-tree"),
      id: z.uuid(),
      ok: z.literal(false),
      reason: z.enum(["unavailable", "denied", "busy"]),
    })
    .strict(),
]);

export type UiTreeRequest = z.infer<typeof uiTreeRequest>;
export type UiTreeResponse = z.infer<typeof uiTreeResponse>;
