/**
 * Page translators (Google Translate, Edge, Safari) replace text nodes React owns with their own
 * `<font>` wrappers. When React later removes that node, or inserts before it, the node is no
 * longer a child of the parent React remembers and the DOM throws `NotFoundError: Failed to
 * execute 'removeChild' on 'Node'`, which takes the whole route segment down to the error page.
 *
 * The guard makes those two calls a no-op (removeChild) or an append (insertBefore) only when the
 * reference node is not a child of the parent, which is exactly the translator case. Every other
 * call goes to the native method unchanged. This is the mitigation discussed on facebook/react#11538.
 */

type RemoveChild = <T extends Node>(this: Node, child: T) => T;
type InsertBefore = <T extends Node>(this: Node, node: T, child: Node | null) => T;

let originals: { removeChild: RemoveChild; insertBefore: InsertBefore } | null = null;

export function installTranslatorDomGuard(): void {
  if (originals || typeof Node !== 'function') return;

  const removeChild = Node.prototype.removeChild as RemoveChild;
  const insertBefore = Node.prototype.insertBefore as InsertBefore;
  originals = { removeChild, insertBefore };

  Node.prototype.removeChild = function guardedRemoveChild<T extends Node>(this: Node, child: T): T {
    if (child.parentNode !== this) return child;
    return removeChild.call(this, child) as T;
  };

  Node.prototype.insertBefore = function guardedInsertBefore<T extends Node>(
    this: Node,
    node: T,
    child: Node | null,
  ): T {
    if (child && child.parentNode !== this) return insertBefore.call(this, node, null) as T;
    return insertBefore.call(this, node, child) as T;
  };
}

/** Restores the native methods. Tests only. */
export function uninstallTranslatorDomGuard(): void {
  if (!originals) return;
  Node.prototype.removeChild = originals.removeChild;
  Node.prototype.insertBefore = originals.insertBefore;
  originals = null;
}
