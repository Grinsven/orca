/** Fork-owned surface variants that can travel with appearance preferences. */
export type JoseUiVariant = 'vscode' | 'gray' | 'oled'

export function isJoseUiVariant(value: unknown): value is JoseUiVariant {
  return value === 'vscode' || value === 'gray' || value === 'oled'
}
