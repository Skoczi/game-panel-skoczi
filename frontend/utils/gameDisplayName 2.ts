// Presentation only: keep engine details in the template and runtime settings.
export function gameDisplayName(name: string): string {
  return name.replace(/\s*·\s*ReHLDS\s*$/i, '').trim();
}
