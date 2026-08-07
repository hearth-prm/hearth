/** Shape returned by every server action, consumed via React's useActionState. */
export interface ActionState {
  ok: boolean;
  /** Form-level message: an error summary, or a success confirmation. */
  message?: string;
  /** Per-field errors keyed by FieldDef.key (or a plain input name). */
  errors?: Record<string, string>;
}

export const EMPTY_ACTION_STATE: ActionState = { ok: false };

export function actionError(
  message: string,
  errors?: Record<string, string>,
): ActionState {
  return { ok: false, message, errors };
}

export function actionOk(message?: string): ActionState {
  return { ok: true, message };
}
