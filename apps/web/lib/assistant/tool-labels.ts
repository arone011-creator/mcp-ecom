// lib/assistant/tool-labels.ts
//
// What a tool is called, in customer words.
//
// SHARED BECAUSE TWO PLACES SHOW IT. The activity chip says what is
// happening now; the step list says what the whole turn is doing. Two
// copies of this map would drift the first time a tool was renamed, and a
// plan and a chip disagreeing about what a step is called is worse than
// either of them being wrong on its own.

// The tool's own name is an implementation detail, and "get_orders" is
// not something to show a shopper.
const LABELS: Record<string, string> = {
  search_products: 'Searching products',
  get_product: 'Looking up a product',
  check_inventory: 'Checking stock',
  get_orders: 'Looking up your orders',
  get_order: 'Opening an order',
  get_cart: 'Checking your cart',
  add_to_cart: 'Adding to your cart',
  remove_from_cart: 'Removing from your cart',
  cancel_order: 'Cancelling an order',
  // The supervisor's own tools: each specialist is one. These arrive as
  // ordinary tool events, which is why the multi-agent change needed no
  // storefront work beyond naming them.
  ask_product: 'Asking the product specialist',
  ask_order: 'Asking the order specialist',
  ask_cart: 'Asking the cart specialist',
};

export function toolLabel(tool: string): string {
  // An unfamiliar tool is shown honestly rather than hidden: the agent
  // gaining a capability nobody labelled should be visible, not silent.
  return LABELS[tool] ?? tool.replace(/_/g, ' ');
}
