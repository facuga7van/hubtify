/**
 * The hub's "create the first thing here" bus.
 *
 * The dashboard's empty state used to offer three buttons that only NAVIGATED
 * to a module — the user landed on an equally empty page and still had to find
 * the form. A call to action that does not act is decoration.
 *
 * Each widget owns its own creation affordance; the dashboard just asks for it
 * by name. A window event keeps the widgets independent of the dashboard (they
 * are mounted through a registry, not as children).
 */

export type QuickCreateTarget = 'quest' | 'habit' | 'meal' | 'expense';

export const QUICK_CREATE_EVENT = 'hub:quickCreate';

export function requestQuickCreate(target: QuickCreateTarget): void {
  window.dispatchEvent(new CustomEvent(QUICK_CREATE_EVENT, { detail: { target } }));
}

/**
 * Subscribes to the bus. `onRequest` is called when the dashboard asks for this
 * widget's form; the widget is responsible for opening it and focusing it.
 */
export function subscribeQuickCreate(
  target: QuickCreateTarget,
  onRequest: () => void,
): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ target?: QuickCreateTarget }>).detail;
    if (detail?.target === target) onRequest();
  };
  window.addEventListener(QUICK_CREATE_EVENT, handler);
  return () => window.removeEventListener(QUICK_CREATE_EVENT, handler);
}

/**
 * Brings the widget that just opened its form into view. A form that opens
 * below the fold is, from the user's chair, a button that did nothing.
 */
export function revealWidget(node: HTMLElement | null): void {
  if (!node) return;
  try {
    node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch {
    // Older engines (and jsdom) do not take the options object.
    node.scrollIntoView();
  }
}
