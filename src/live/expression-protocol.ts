// Expression switches sent from other apps (keyboard shortcuts, button panels) through the
// local development server to the Live page.
export const EXPRESSION_EVENT = 'studio:expression';
export const EXPRESSION_PATH = '/__live/expression';
export const EXPRESSION_TOKEN_PATH = '/__live/expression-token';
export const TOKEN_HEADER = 'x-studio-token';
export const REMOTE_EXPRESSIONS = ['neutral', 'smile', 'shy', 'surprise', 'halfLidded', 'angry', 'sad', 'wink'] as const;
export type RemoteExpression = typeof REMOTE_EXPRESSIONS[number];
export interface ExpressionMessage { expression: RemoteExpression; project: string | null }

const projectName = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/** Accepts `{ expression, project? }` with a known expression and a plain project name only. */
export function expressionMessage(input: unknown): ExpressionMessage | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const data = input as Record<string, unknown>;
  if (Object.keys(data).some(key => key !== 'expression' && key !== 'project')) return null;
  if (typeof data.expression !== 'string' || !(REMOTE_EXPRESSIONS as readonly string[]).includes(data.expression)) return null;
  if (data.project !== undefined && data.project !== null && (typeof data.project !== 'string' || !projectName.test(data.project))) return null;
  return { expression: data.expression as RemoteExpression, project: typeof data.project === 'string' ? data.project : null };
}
