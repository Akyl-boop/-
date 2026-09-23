export type Messages = Record<string, string>;
export type TranslateVars = Record<string, string | number>;

export function translate(messages: Messages, key: string, vars?: TranslateVars): string {
  const template = messages[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}
